import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { writeAuditEvent } from "@/server/audit/audit-writer";
import { hasPermission } from "@/server/authorization/authorization";

import { JobExecutionError } from "./job-error";
import { findJobDefinition } from "./job-registry";
import {
  claimNextJob,
  completeJob,
  failJob,
  isCancelRequested,
  markJobCancelled,
  reclaimExpiredLeases,
  renewLease,
  reportJobProgress,
  resolveJobActor,
} from "./job-runtime";

export type ProcessedJob = {
  jobId: string;
  type: string;
  outcome: "SUCCEEDED" | "FAILED" | "REQUEUED" | "CANCELLED" | "LEASE_LOST";
  attempt: number;
  durationMs: number;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "알 수 없는 오류로 작업이 실패했습니다.";
}

/**
 * 큐에서 작업 하나를 잡아 끝까지 처리한다. 처리할 작업이 없으면 `null`을 준다.
 * worker 반복문과 통합 테스트가 같은 경로를 쓴다.
 */
export async function processNextJob(prisma: PrismaClient, workerId: string): Promise<ProcessedJob | null> {
  await reclaimExpiredLeases(prisma);
  const claimed = await claimNextJob(prisma, workerId);
  if (!claimed) return null;

  const startedAt = Date.now();
  const finish = (outcome: ProcessedJob["outcome"]): ProcessedJob => ({
    jobId: claimed.id,
    type: claimed.type,
    outcome,
    attempt: claimed.attempt,
    durationMs: Date.now() - startedAt,
  });

  const definition = findJobDefinition(claimed.type);
  if (!definition) {
    await failJob(prisma, { jobId: claimed.id, workerId, attempt: claimed.attempt, maxAttempts: claimed.maxAttempts, message: `등록되지 않은 작업 종류입니다: ${claimed.type}`, retryable: false });
    return finish("FAILED");
  }

  // 작업 종류가 정한 lease로 늘린다. claim은 짧은 기본값으로 잡았다.
  const leaseHeld = await renewLease(prisma, { jobId: claimed.id, workerId, leaseSeconds: definition.leaseSeconds });
  if (!leaseHeld) return finish("LEASE_LOST");

  const actor = await resolveJobActor(prisma, {
    organizationId: claimed.organizationId,
    membershipId: claimed.requestedByMembershipId,
    jobId: claimed.id,
  });
  if (!actor) {
    await failJob(prisma, { jobId: claimed.id, workerId, attempt: claimed.attempt, maxAttempts: claimed.maxAttempts, message: "작업을 등록한 사용자가 더 이상 활성 상태가 아닙니다.", retryable: false });
    return finish("FAILED");
  }
  // 등록 뒤 권한이 회수됐으면 실행하지 않는다.
  if (!hasPermission(actor, definition.permission)) {
    await failJob(prisma, { jobId: claimed.id, workerId, attempt: claimed.attempt, maxAttempts: claimed.maxAttempts, message: "작업 실행에 필요한 권한이 없습니다.", retryable: false });
    return finish("FAILED");
  }

  const parsed = definition.payloadSchema.safeParse(claimed.payload);
  if (!parsed.success) {
    await failJob(prisma, { jobId: claimed.id, workerId, attempt: claimed.attempt, maxAttempts: claimed.maxAttempts, message: "작업 입력이 현재 계약과 맞지 않습니다.", retryable: false });
    return finish("FAILED");
  }

  if (await isCancelRequested(prisma, claimed.id)) {
    await markJobCancelled(prisma, { jobId: claimed.id, workerId });
    return finish("CANCELLED");
  }

  // lease 길이의 1/3 주기로 갱신한다. 갱신에 실패해도 완료 update가
  // lockedBy·status 조건을 걸고 있어 회수된 작업을 덮어쓰지 않는다.
  const heartbeat = setInterval(() => {
    void renewLease(prisma, { jobId: claimed.id, workerId, leaseSeconds: definition.leaseSeconds });
  }, Math.max(1_000, Math.floor((definition.leaseSeconds * 1000) / 3)));
  heartbeat.unref?.();

  const requestId = `job-${claimed.id}`;
  try {
    const result = await definition.run(prisma, {
      jobId: claimed.id,
      attempt: claimed.attempt,
      requestId,
      actor,
      reportProgress: (percent) => reportJobProgress(prisma, { jobId: claimed.id, workerId, percent }),
      isCancelRequested: () => isCancelRequested(prisma, claimed.id),
    }, parsed.data as never);

    if (await isCancelRequested(prisma, claimed.id)) {
      await markJobCancelled(prisma, { jobId: claimed.id, workerId });
      return finish("CANCELLED");
    }
    const completed = await completeJob(prisma, { jobId: claimed.id, workerId, result });
    if (!completed) return finish("LEASE_LOST");
    await writeAuditEvent(prisma, {
      organizationId: claimed.organizationId,
      actorUserId: actor.userId,
      action: "job.succeeded",
      entityId: claimed.id,
      requestId,
      metadata: { type: claimed.type, attempt: claimed.attempt, durationMs: Date.now() - startedAt },
    });
    return finish("SUCCEEDED");
  } catch (error) {
    const retryable = error instanceof JobExecutionError ? error.retryable : true;
    const message = errorMessage(error);
    const outcome = await failJob(prisma, {
      jobId: claimed.id,
      workerId,
      attempt: claimed.attempt,
      maxAttempts: claimed.maxAttempts,
      message,
      retryable,
    });
    await writeAuditEvent(prisma, {
      organizationId: claimed.organizationId,
      actorUserId: actor.userId,
      action: "job.failed",
      entityId: claimed.id,
      requestId,
      metadata: { type: claimed.type, attempt: claimed.attempt, maxAttempts: claimed.maxAttempts, retryable, error: message.slice(0, 500) },
    });
    return finish(outcome.status === "FAILED" ? "FAILED" : "REQUEUED");
  } finally {
    clearInterval(heartbeat);
  }
}

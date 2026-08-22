import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { JobStatus, PrismaClient } from "@/generated/prisma/client";
import { permissionUnion } from "@/domain/permission";
import type { AuthenticatedContext } from "@/server/auth/auth-types";

export const BACKOFF_BASE_MS = 10_000;
export const BACKOFF_CAP_MS = 600_000;

/** `availableAt = now + min(10초 × 2^attempt, 10분)` (`D2-B01-E`). */
export function backoffDelayMs(attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  if (exponent >= 31) return BACKOFF_CAP_MS;
  return Math.min(BACKOFF_BASE_MS * 2 ** exponent, BACKOFF_CAP_MS);
}

export type ClaimedJob = {
  id: string;
  organizationId: string;
  type: string;
  payload: unknown;
  attempt: number;
  maxAttempts: number;
  requestedByMembershipId: string;
};

type ClaimRow = {
  id: string;
  organizationId: string;
  type: string;
  payload: unknown;
  attempt: number;
  maxAttempts: number;
  requestedByMembershipId: string;
};

/**
 * lease가 만료된 `RUNNING` 작업을 회수한다. worker가 강제 종료되거나 서버가
 * 재부팅돼도 작업이 `RUNNING`에 갇히지 않는다(`D2-B01-F`).
 *
 * 남은 시도가 있으면 다시 큐에 넣고, 없으면 `FAILED`로 확정한다.
 */
export async function reclaimExpiredLeases(prisma: PrismaClient, now = new Date()): Promise<number> {
  const requeued = await prisma.$executeRaw`
    UPDATE "JobQueue"
    SET "status" = 'QUEUED',
        "lockedBy" = NULL,
        "leaseExpiresAt" = NULL,
        "availableAt" = ${now},
        "lastError" = '작업 lease가 만료되어 회수했습니다.',
        "updatedAt" = ${now}
    WHERE "status" = 'RUNNING'
      AND "leaseExpiresAt" < ${now}
      AND "attempt" < "maxAttempts"
  `;
  const failed = await prisma.$executeRaw`
    UPDATE "JobQueue"
    SET "status" = 'FAILED',
        "lockedBy" = NULL,
        "leaseExpiresAt" = NULL,
        "finishedAt" = ${now},
        "lastError" = '작업 lease가 만료되었고 남은 시도가 없습니다.',
        "updatedAt" = ${now}
    WHERE "status" = 'RUNNING'
      AND "leaseExpiresAt" < ${now}
      AND "attempt" >= "maxAttempts"
  `;
  return requeued + failed;
}

/**
 * 실행할 작업 하나를 원자적으로 잡는다. `FOR UPDATE SKIP LOCKED`라서 worker를
 * 여러 개 띄워도 같은 작업을 두 번 잡지 않는다.
 *
 * lease는 여기서 기본값으로 걸고, 작업 종류가 정한 길이는 호출자가 곧바로
 * `renewLease`로 늘린다. 작업 종류는 행을 잡은 뒤에야 알 수 있기 때문이다.
 */
export async function claimNextJob(
  prisma: PrismaClient,
  workerId: string,
  options: { now?: Date; defaultLeaseSeconds?: number } = {},
): Promise<ClaimedJob | null> {
  const now = options.now ?? new Date();
  const leaseExpiresAt = new Date(now.getTime() + (options.defaultLeaseSeconds ?? 60) * 1000);
  const rows = await prisma.$queryRaw<ClaimRow[]>`
    UPDATE "JobQueue"
    SET "status" = 'RUNNING',
        "lockedBy" = ${workerId},
        "startedAt" = COALESCE("startedAt", ${now}),
        "leaseExpiresAt" = ${leaseExpiresAt},
        "attempt" = "attempt" + 1,
        "updatedAt" = ${now}
    WHERE "id" = (
      SELECT "id" FROM "JobQueue"
      WHERE "status" = 'QUEUED' AND "availableAt" <= ${now}
      ORDER BY "priority" ASC, "availableAt" ASC, "id" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING "id", "organizationId", "type", "payload", "attempt", "maxAttempts", "requestedByMembershipId"
  `;
  return rows[0] ?? null;
}

/**
 * lease를 연장한다. 다른 worker가 이미 회수해 갔으면 `false`를 돌려주고,
 * 호출자는 즉시 실행을 멈춰야 한다. 그래야 회수된 작업과 겹쳐 돌지 않는다.
 */
export async function renewLease(
  prisma: PrismaClient,
  input: { jobId: string; workerId: string; leaseSeconds: number; now?: Date },
): Promise<boolean> {
  const now = input.now ?? new Date();
  const changed = await prisma.jobQueue.updateMany({
    where: { id: input.jobId, lockedBy: input.workerId, status: "RUNNING" },
    data: { leaseExpiresAt: new Date(now.getTime() + input.leaseSeconds * 1000), updatedAt: now },
  });
  return changed.count === 1;
}

export async function reportJobProgress(
  prisma: PrismaClient,
  input: { jobId: string; workerId: string; percent: number },
): Promise<void> {
  const percent = Math.min(100, Math.max(0, Math.round(input.percent)));
  await prisma.jobQueue.updateMany({
    where: { id: input.jobId, lockedBy: input.workerId, status: "RUNNING" },
    data: { progressPercent: percent, updatedAt: new Date() },
  });
}

export async function isCancelRequested(prisma: PrismaClient, jobId: string): Promise<boolean> {
  const row = await prisma.jobQueue.findUnique({ where: { id: jobId }, select: { cancelRequestedAt: true } });
  return row?.cancelRequestedAt !== null && row?.cancelRequestedAt !== undefined;
}

export async function completeJob(
  prisma: PrismaClient,
  input: { jobId: string; workerId: string; result: Record<string, unknown> },
): Promise<boolean> {
  const now = new Date();
  const changed = await prisma.jobQueue.updateMany({
    where: { id: input.jobId, lockedBy: input.workerId, status: "RUNNING" },
    data: {
      status: "SUCCEEDED",
      result: input.result as Prisma.InputJsonValue,
      progressPercent: 100,
      lockedBy: null,
      leaseExpiresAt: null,
      finishedAt: now,
      lastError: null,
      updatedAt: now,
    },
  });
  return changed.count === 1;
}

/**
 * 실패를 기록한다. 재시도할 수 있고 남은 시도가 있으면 backoff 간격으로 다시
 * 큐에 넣고, 아니면 `FAILED`로 확정한다(`D2-B01-E`).
 */
export async function failJob(
  prisma: PrismaClient,
  input: { jobId: string; workerId: string; attempt: number; maxAttempts: number; message: string; retryable: boolean },
): Promise<{ status: JobStatus; availableAt: Date | null }> {
  const now = new Date();
  const message = input.message.slice(0, 1000);
  const willRetry = input.retryable && input.attempt < input.maxAttempts;
  if (!willRetry) {
    await prisma.jobQueue.updateMany({
      where: { id: input.jobId, lockedBy: input.workerId, status: "RUNNING" },
      data: { status: "FAILED", lockedBy: null, leaseExpiresAt: null, finishedAt: now, lastError: message, updatedAt: now },
    });
    return { status: "FAILED", availableAt: null };
  }
  const availableAt = new Date(now.getTime() + backoffDelayMs(input.attempt));
  await prisma.jobQueue.updateMany({
    where: { id: input.jobId, lockedBy: input.workerId, status: "RUNNING" },
    data: { status: "QUEUED", lockedBy: null, leaseExpiresAt: null, availableAt, lastError: message, updatedAt: now },
  });
  return { status: "QUEUED", availableAt };
}

export async function markJobCancelled(
  prisma: PrismaClient,
  input: { jobId: string; workerId: string },
): Promise<boolean> {
  const now = new Date();
  const changed = await prisma.jobQueue.updateMany({
    where: { id: input.jobId, lockedBy: input.workerId, status: "RUNNING" },
    data: {
      status: "CANCELLED",
      lockedBy: null,
      leaseExpiresAt: null,
      finishedAt: now,
      lastError: "실행 중 취소 요청으로 중단했습니다.",
      updatedAt: now,
    },
  });
  return changed.count === 1;
}

/**
 * 끝난 작업을 보존 기간이 지나면 지운다(`D2-B01-M`). 큐 테이블이 계속 커지면
 * claim 선택 쿼리가 느려진다. 감사 이벤트는 append-only로 따로 남아 있다.
 */
export async function purgeFinishedJobs(
  prisma: PrismaClient,
  options: { retentionDays?: number; now?: Date } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - (options.retentionDays ?? 90) * 24 * 60 * 60 * 1000);
  const removed = await prisma.jobQueue.deleteMany({
    where: { status: { in: ["SUCCEEDED", "FAILED", "CANCELLED"] }, finishedAt: { lt: cutoff } },
  });
  return removed.count;
}

/**
 * worker에는 로그인 session이 없으므로 작업을 등록한 membership의 현재 권한을
 * 다시 읽어 실행 주체를 만든다. 등록 뒤 권한이 회수됐다면 여기서 걸린다.
 */
export async function resolveJobActor(
  prisma: PrismaClient,
  input: { organizationId: string; membershipId: string; jobId: string },
): Promise<AuthenticatedContext | null> {
  const membership = await prisma.organizationMembership.findFirst({
    where: {
      id: input.membershipId,
      organizationId: input.organizationId,
      status: "ACTIVE",
      user: { status: "ACTIVE" },
    },
    select: {
      id: true,
      departmentId: true,
      userId: true,
      user: { select: { displayName: true } },
      organization: { select: { id: true, code: true, name: true, status: true } },
      roles: {
        where: { role: { active: true } },
        select: { role: { select: { organizationId: true, key: true, permissions: { select: { permission: { select: { key: true } } } } } } },
      },
    },
  });
  if (!membership || membership.organization.status !== "ACTIVE") return null;
  const roles = membership.roles
    .map(({ role }) => role)
    .filter(({ organizationId }) => organizationId === membership.organization.id);
  return {
    // worker 실행에는 session이 없다. 추적용으로 작업 ID를 넣는다.
    sessionId: input.jobId,
    userId: membership.userId,
    displayName: membership.user.displayName,
    membershipId: membership.id,
    departmentId: membership.departmentId,
    organizationId: membership.organization.id,
    organizationCode: membership.organization.code,
    organizationName: membership.organization.name,
    roleKeys: roles.map(({ key }) => key).sort(),
    permissions: permissionUnion(roles.map((role) => ({ permissions: role.permissions.map(({ permission }) => permission.key) }))),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  };
}

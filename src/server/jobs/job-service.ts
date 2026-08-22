import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { JobStatus, PrismaClient } from "@/generated/prisma/client";
import { writeAuditEvent } from "@/server/audit/audit-writer";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { requirePermission } from "@/server/authorization/authorization";

import { JobError } from "./job-error";
import { findJobDefinition, jobTypeLabel } from "./job-registry";

const jobSelect = {
  id: true,
  type: true,
  status: true,
  idempotencyKey: true,
  payload: true,
  result: true,
  priority: true,
  attempt: true,
  maxAttempts: true,
  progressPercent: true,
  availableAt: true,
  startedAt: true,
  finishedAt: true,
  cancelRequestedAt: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
  requestedByMembershipId: true,
  requestedByMembership: { select: { user: { select: { displayName: true } } } },
} as const satisfies Prisma.JobQueueSelect;

type JobRow = Prisma.JobQueueGetPayload<{ select: typeof jobSelect }>;

export type JobDto = ReturnType<typeof toJobDto>;

const terminalStatuses: JobStatus[] = ["SUCCEEDED", "FAILED", "CANCELLED"];

function toJobDto(row: JobRow) {
  const definition = findJobDefinition(row.type);
  // payload 원문은 응답에 넣지 않는다(`D2-B01-L`). 작업 종류가 정한 요약만 내보낸다.
  let summary: string | null = null;
  if (definition) {
    const parsed = definition.payloadSchema.safeParse(row.payload);
    if (parsed.success) summary = definition.summarize(parsed.data);
  }
  return {
    id: row.id,
    type: row.type,
    typeLabel: jobTypeLabel(row.type),
    summary,
    status: row.status,
    idempotencyKey: row.idempotencyKey,
    result: terminalStatuses.includes(row.status) ? (row.result as unknown) : null,
    priority: row.priority,
    attempt: row.attempt,
    maxAttempts: row.maxAttempts,
    progressPercent: row.progressPercent,
    availableAt: row.availableAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    cancelRequested: row.cancelRequestedAt !== null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    requestedByName: row.requestedByMembership.user.displayName,
  };
}

/**
 * 작업 목록은 본인이 등록한 것만 보여준다. 조직 전체 조회는 `admin.manage`가
 * 있을 때만 허용한다(`D2-B01-J`).
 */
function visibilityFilter(context: AuthenticatedContext): Prisma.JobQueueWhereInput {
  if (context.permissions.includes("admin.manage")) return {};
  return { requestedByMembershipId: context.membershipId };
}

type JobCursor = { createdAt: Date; id: string };

function decodeCursor(value: string | undefined): JobCursor | null {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { createdAt?: string; id?: string };
    const createdAt = new Date(decoded.createdAt ?? "");
    if (!decoded.id || !/^[0-9a-f-]{36}$/i.test(decoded.id) || Number.isNaN(createdAt.getTime())) throw new Error("invalid");
    return { createdAt, id: decoded.id };
  } catch {
    throw new JobError("INVALID_REQUEST", "작업 목록 페이지 위치가 올바르지 않습니다.");
  }
}

function encodeCursor(cursor: JobCursor) {
  return Buffer.from(JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id }), "utf8").toString("base64url");
}

export async function enqueueJob(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: {
    type: string;
    payload: unknown;
    idempotencyKey: string;
    priority?: number;
    requestId: string;
  },
): Promise<{ job: JobDto; reused: boolean }> {
  const definition = findJobDefinition(input.type);
  if (!definition) throw new JobError("INVALID_REQUEST", "알 수 없는 작업 종류입니다.");
  // 작업 등록은 그 작업이 하는 일의 권한을 그대로 요구한다.
  requirePermission(context, definition.permission);
  const parsed = definition.payloadSchema.safeParse(input.payload);
  if (!parsed.success) throw new JobError("INVALID_REQUEST", "작업 입력을 확인해 주세요.");

  const existing = await prisma.jobQueue.findUnique({
    where: {
      organizationId_type_idempotencyKey: {
        organizationId: context.organizationId,
        type: input.type,
        idempotencyKey: input.idempotencyKey,
      },
    },
    select: jobSelect,
  });
  if (existing) return { job: toJobDto(existing), reused: true };

  try {
    const created = await prisma.$transaction(async (tx) => {
      const job = await tx.jobQueue.create({
        data: {
          organizationId: context.organizationId,
          type: definition.type,
          idempotencyKey: input.idempotencyKey,
          payload: parsed.data as Prisma.InputJsonValue,
          priority: input.priority ?? 100,
          maxAttempts: definition.maxAttempts,
          requestedByMembershipId: context.membershipId,
        },
        select: jobSelect,
      });
      await writeAuditEvent(tx, {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "job.enqueued",
        entityId: job.id,
        requestId: input.requestId,
        metadata: {
          type: job.type,
          idempotencyKey: job.idempotencyKey,
          priority: job.priority,
          maxAttempts: job.maxAttempts,
          reused: false,
        },
      });
      return job;
    });
    return { job: toJobDto(created), reused: false };
  } catch (error) {
    // 같은 멱등키로 동시에 두 요청이 들어오면 unique 제약이 하나를 막는다.
    // 진 쪽은 이긴 작업을 그대로 돌려준다(`D2-B01-D`).
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      const winner = await prisma.jobQueue.findUnique({
        where: {
          organizationId_type_idempotencyKey: {
            organizationId: context.organizationId,
            type: input.type,
            idempotencyKey: input.idempotencyKey,
          },
        },
        select: jobSelect,
      });
      if (winner) return { job: toJobDto(winner), reused: true };
    }
    throw error;
  }
}

export async function getJob(prisma: PrismaClient, context: AuthenticatedContext, jobId: string): Promise<JobDto> {
  const row = await prisma.jobQueue.findFirst({
    where: { id: jobId, organizationId: context.organizationId, ...visibilityFilter(context) },
    select: jobSelect,
  });
  if (!row) throw new JobError("NOT_FOUND", "작업을 찾을 수 없습니다.");
  return toJobDto(row);
}

export async function listJobs(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: { type?: string; statuses?: JobStatus[]; cursor?: string; limit?: 25 | 100 } = {},
): Promise<{ items: JobDto[]; nextCursor: string | null }> {
  const cursor = decodeCursor(input.cursor);
  const limit = input.limit ?? 25;
  const rows = await prisma.jobQueue.findMany({
    where: {
      organizationId: context.organizationId,
      ...visibilityFilter(context),
      ...(input.type ? { type: input.type } : {}),
      ...(input.statuses?.length ? { status: { in: input.statuses } } : {}),
      ...(cursor
        ? { AND: [{ OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }] }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: jobSelect,
  });
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  return {
    items: items.map(toJobDto),
    nextCursor: hasMore ? encodeCursor({ createdAt: items.at(-1)!.createdAt, id: items.at(-1)!.id }) : null,
  };
}

export async function cancelJob(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: { jobId: string; requestId: string },
): Promise<JobDto> {
  return prisma.$transaction(async (tx) => {
    const job = await tx.jobQueue.findFirst({
      where: { id: input.jobId, organizationId: context.organizationId, ...visibilityFilter(context) },
      select: { id: true, type: true, status: true },
    });
    if (!job) throw new JobError("NOT_FOUND", "작업을 찾을 수 없습니다.");
    if (terminalStatuses.includes(job.status)) throw new JobError("CONFLICT", "이미 끝난 작업은 취소할 수 없습니다.");

    if (job.status === "QUEUED") {
      // 아직 아무도 잡지 않은 작업은 그 자리에서 끝낸다.
      const changed = await tx.jobQueue.updateMany({
        where: { id: job.id, organizationId: context.organizationId, status: "QUEUED" },
        data: { status: "CANCELLED", cancelRequestedAt: new Date(), finishedAt: new Date() },
      });
      if (changed.count !== 1) throw new JobError("CONFLICT", "작업 상태가 방금 변경되었습니다. 다시 확인해 주세요.");
    } else {
      // 실행 중인 작업은 표시만 남기고 worker가 확인 지점에서 스스로 멈춘다(`D2-B01-G`).
      const changed = await tx.jobQueue.updateMany({
        where: { id: job.id, organizationId: context.organizationId, status: "RUNNING", cancelRequestedAt: null },
        data: { cancelRequestedAt: new Date() },
      });
      if (changed.count !== 1) throw new JobError("CONFLICT", "작업 상태가 방금 변경되었습니다. 다시 확인해 주세요.");
    }

    await writeAuditEvent(tx, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "job.cancelled",
      entityId: job.id,
      requestId: input.requestId,
      metadata: { type: job.type, previousStatus: job.status },
    });
    const updated = await tx.jobQueue.findUniqueOrThrow({ where: { id: job.id }, select: jobSelect });
    return toJobDto(updated);
  });
}

export async function retryJob(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: { jobId: string; requestId: string },
): Promise<JobDto> {
  return prisma.$transaction(async (tx) => {
    const job = await tx.jobQueue.findFirst({
      where: { id: input.jobId, organizationId: context.organizationId, ...visibilityFilter(context) },
      select: { id: true, type: true, status: true, attempt: true },
    });
    if (!job) throw new JobError("NOT_FOUND", "작업을 찾을 수 없습니다.");
    if (job.status !== "FAILED") throw new JobError("CONFLICT", "실패한 작업만 다시 실행할 수 있습니다.");
    const definition = findJobDefinition(job.type);
    if (!definition) throw new JobError("CONFLICT", "더 이상 지원하지 않는 작업 종류입니다.");
    requirePermission(context, definition.permission);

    const changed = await tx.jobQueue.updateMany({
      where: { id: job.id, organizationId: context.organizationId, status: "FAILED" },
      data: {
        status: "QUEUED",
        attempt: 0,
        progressPercent: 0,
        availableAt: new Date(),
        startedAt: null,
        finishedAt: null,
        cancelRequestedAt: null,
        lastError: null,
        result: Prisma.DbNull,
      },
    });
    if (changed.count !== 1) throw new JobError("CONFLICT", "작업 상태가 방금 변경되었습니다. 다시 확인해 주세요.");

    await writeAuditEvent(tx, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "job.retried",
      entityId: job.id,
      requestId: input.requestId,
      metadata: { type: job.type, previousAttempt: job.attempt },
    });
    const updated = await tx.jobQueue.findUniqueOrThrow({ where: { id: job.id }, select: jobSelect });
    return toJobDto(updated);
  });
}

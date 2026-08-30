import "server-only";

import type { CuttingInput, CuttingResult } from "@/domain/cutting/schema";
import { cuttingInputSchema, cuttingResultSchema } from "@/domain/cutting/schema";
import { writeAuditEvent } from "@/server/audit/audit-writer";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { requirePermission } from "@/server/authorization/authorization";
import { enqueueJob } from "@/server/jobs/job-service";
import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient, SalesOrderStatus } from "@/generated/prisma/client";
import { buildCuttingInputs } from "./cutting-input-builder";
import { CuttingError } from "./cutting-error";
import { recordSheetUsageForApproval, voidSheetUsageForPlan } from "./sheet-usage-service";

type Database = PrismaClient | Prisma.TransactionClient;

/** 재단을 열 수 있는 수주 상태(`D2-B05-A`). 승인 전에는 도면이 아직 바뀐다. */
const cuttableOrderStatuses: SalesOrderStatus[] = [
  "APPROVED",
  "PRODUCTION_REQUESTED",
  "IN_PRODUCTION",
];

export type CuttingPin = { partId: string; sheetIndex: number };

const revisionSelect = {
  id: true,
  revisionNumber: true,
  status: true,
  jobId: true,
  pins: true,
  engineVersion: true,
  sheetCount: true,
  usedAreaM2: true,
  totalAreaM2: true,
  yieldPercent: true,
  unplacedQuantity: true,
  failureReason: true,
  createdAt: true,
  createdByMembership: { select: { user: { select: { displayName: true } } } },
} as const satisfies Prisma.CuttingPlanRevisionSelect;

const planSelect = {
  id: true,
  salesOrderId: true,
  materialVariantId: true,
  status: true,
  contractVersion: true,
  inputChecksumSha256: true,
  approvedAt: true,
  approvedRevisionId: true,
  lockVersion: true,
  updatedAt: true,
  salesOrder: { select: { orderNumber: true, status: true } },
  materialVariant: {
    select: { code: true, name: true, thicknessMm: true, material: { select: { name: true } } },
  },
  approvedByMembership: { select: { user: { select: { displayName: true } } } },
  currentRevision: { select: revisionSelect },
} as const satisfies Prisma.CuttingPlanSelect;

type PlanRow = Prisma.CuttingPlanGetPayload<{ select: typeof planSelect }>;
type RevisionRow = Prisma.CuttingPlanRevisionGetPayload<{ select: typeof revisionSelect }>;

export type CuttingPlanDto = ReturnType<typeof toPlanDto>;
export type CuttingRevisionDto = ReturnType<typeof toRevisionDto>;

function toRevisionDto(row: RevisionRow) {
  return {
    id: row.id,
    revisionNumber: row.revisionNumber,
    status: row.status,
    jobId: row.jobId,
    pins: row.pins as unknown as CuttingPin[],
    engineVersion: row.engineVersion,
    sheetCount: row.sheetCount,
    usedAreaM2: row.usedAreaM2?.toString() ?? null,
    totalAreaM2: row.totalAreaM2?.toString() ?? null,
    yieldPercent: row.yieldPercent?.toString() ?? null,
    unplacedQuantity: row.unplacedQuantity,
    failureReason: row.failureReason,
    createdAt: row.createdAt.toISOString(),
    createdByName: row.createdByMembership.user.displayName,
  };
}

function toPlanDto(row: PlanRow) {
  return {
    id: row.id,
    salesOrderId: row.salesOrderId,
    orderNumber: row.salesOrder.orderNumber,
    orderStatus: row.salesOrder.status,
    materialVariantId: row.materialVariantId,
    materialLabel: `${row.materialVariant.material.name} ${row.materialVariant.name}`.trim(),
    materialCode: row.materialVariant.code,
    thicknessMm: row.materialVariant.thicknessMm.toString(),
    status: row.status,
    contractVersion: row.contractVersion,
    inputChecksumSha256: row.inputChecksumSha256,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    approvedRevisionId: row.approvedRevisionId,
    approvedByName: row.approvedByMembership?.user.displayName ?? null,
    currentRevision: row.currentRevision ? toRevisionDto(row.currentRevision) : null,
    lockVersion: row.lockVersion,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadPlan(database: Database, organizationId: string, planId: string) {
  const plan = await database.cuttingPlan.findFirst({
    where: { id: planId, organizationId },
    select: planSelect,
  });
  if (!plan) throw new CuttingError("NOT_FOUND", "재단 작업을 찾을 수 없습니다.");
  return plan;
}

/**
 * 승인된 수주에서 재질별 재단 작업을 만든다(`D2-B05-A`·`D2-B05-I`).
 * 이미 있는 재질은 다시 만들지 않고 그대로 둔다. 다시 돌리는 것은 재실행이다.
 */
export async function createCuttingPlansForOrder(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: { salesOrderId: string; requestId: string },
): Promise<CuttingPlanDto[]> {
  requirePermission(context, "cutting.optimize");

  const order = await prisma.salesOrder.findFirst({
    where: { id: input.salesOrderId, organizationId: context.organizationId },
    select: { id: true, status: true },
  });
  if (!order) throw new CuttingError("NOT_FOUND", "수주를 찾을 수 없습니다.");
  if (!cuttableOrderStatuses.includes(order.status)) {
    throw new CuttingError("CONFLICT", "승인된 수주만 재단할 수 있습니다.");
  }

  const builds = await buildCuttingInputs(prisma, {
    organizationId: context.organizationId,
    salesOrderId: order.id,
  });

  const plans: CuttingPlanDto[] = [];
  for (const build of builds) {
    const existing = await prisma.cuttingPlan.findUnique({
      where: {
        salesOrderId_materialVariantId: {
          salesOrderId: order.id,
          materialVariantId: build.materialVariantId,
        },
      },
      select: planSelect,
    });
    if (existing) {
      plans.push(toPlanDto(existing));
      continue;
    }

    const created = await prisma.$transaction(async (tx) => {
      const plan = await tx.cuttingPlan.create({
        data: {
          organizationId: context.organizationId,
          salesOrderId: order.id,
          materialVariantId: build.materialVariantId,
          contractVersion: build.input.contractVersion,
          input: build.input as unknown as Prisma.InputJsonValue,
          inputChecksumSha256: build.inputChecksumSha256,
          createdByMembershipId: context.membershipId,
        },
        select: { id: true },
      });
      await writeAuditEvent(tx, {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "cutting.plan_created",
        entityId: plan.id,
        requestId: input.requestId,
        metadata: {
          salesOrderId: order.id,
          materialVariantId: build.materialVariantId,
          partCount: build.input.parts.length,
          sheetCandidateCount: build.input.sheets.length,
        },
      });
      return plan;
    });

    await startRevision(prisma, context, {
      planId: created.id,
      pins: [],
      requestId: input.requestId,
    });
    plans.push(toPlanDto(await loadPlan(prisma, context.organizationId, created.id)));
  }

  return plans;
}

/**
 * 개정을 하나 만들고 queue 에 올린다(`D2-B05-E`·`D2-B05-H`).
 * 결과를 덮어쓰지 않고 개정 번호를 올린다.
 */
async function startRevision(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: { planId: string; pins: CuttingPin[]; requestId: string },
): Promise<CuttingRevisionDto> {
  const revision = await prisma.$transaction(async (tx) => {
    const plan = await tx.cuttingPlan.findFirstOrThrow({
      where: { id: input.planId, organizationId: context.organizationId },
      select: { id: true, nextRevisionNumber: true },
    });
    const created = await tx.cuttingPlanRevision.create({
      data: {
        organizationId: context.organizationId,
        cuttingPlanId: plan.id,
        revisionNumber: plan.nextRevisionNumber,
        pins: input.pins as unknown as Prisma.InputJsonValue,
        createdByMembershipId: context.membershipId,
      },
      select: revisionSelect,
    });
    await tx.cuttingPlan.update({
      where: { id: plan.id },
      data: {
        nextRevisionNumber: { increment: 1 },
        currentRevisionId: created.id,
        status: "PENDING",
        lockVersion: { increment: 1 },
      },
    });
    return created;
  });

  const { job } = await enqueueJob(prisma, context, {
    type: "cutting.optimize",
    payload: { cuttingPlanRevisionId: revision.id },
    // 개정마다 한 번만 돈다. 같은 개정을 두 번 등록해도 작업은 하나다.
    idempotencyKey: `cutting-revision-${revision.id}`,
    requestId: input.requestId,
  });

  const linked = await prisma.$transaction(async (tx) => {
    const updated = await tx.cuttingPlanRevision.update({
      where: { id: revision.id },
      data: { jobId: job.id },
      select: revisionSelect,
    });
    await writeAuditEvent(tx, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "cutting.revision_created",
      entityId: input.planId,
      requestId: input.requestId,
      metadata: {
        revisionNumber: updated.revisionNumber,
        pinnedPartCount: input.pins.length,
        jobId: job.id,
      },
    });
    return updated;
  });

  return toRevisionDto(linked);
}

/** 고정 지시를 붙여 다시 돌린다(`D2-B05-J`). 승인된 작업은 먼저 잠금을 푼다. */
export async function rerunCuttingPlan(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: { planId: string; pins: CuttingPin[]; expectedLockVersion: number; requestId: string },
): Promise<CuttingPlanDto> {
  requirePermission(context, "cutting.optimize");
  const plan = await loadPlan(prisma, context.organizationId, input.planId);
  if (plan.status === "APPROVED") {
    throw new CuttingError("CONFLICT", "승인된 재단 작업은 다시 돌릴 수 없습니다.");
  }
  if (plan.lockVersion !== input.expectedLockVersion) {
    throw new CuttingError("CONFLICT", "재단 작업이 다른 화면에서 변경되었습니다.");
  }
  await assertPinsAreKnown(prisma, plan.id, input.pins);

  await startRevision(prisma, context, {
    planId: plan.id,
    pins: input.pins,
    requestId: input.requestId,
  });
  return toPlanDto(await loadPlan(prisma, context.organizationId, plan.id));
}

/** 고정 지시에 적힌 부품이 이 작업의 입력에 실제로 있는지 본다. */
async function assertPinsAreKnown(database: Database, planId: string, pins: CuttingPin[]) {
  if (pins.length === 0) return;
  const row = await database.cuttingPlan.findUniqueOrThrow({
    where: { id: planId },
    select: { input: true },
  });
  const partIds = new Set(readPlanInput(planId, row.input).parts.map((part) => part.id));
  if (pins.some((pin) => !partIds.has(pin.partId))) {
    throw new CuttingError("INVALID_REQUEST", "고정한 부품이 이 재단 입력에 없습니다.");
  }
}

function readPlanInput(planId: string, raw: unknown): CuttingInput {
  const parsed = cuttingInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CuttingError("CONFLICT", `재단 입력을 읽을 수 없습니다. (${planId})`);
  }
  return parsed.data;
}

export async function listCuttingPlans(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  filter: { salesOrderId?: string; limit?: number } = {},
): Promise<{ items: CuttingPlanDto[] }> {
  requirePermission(context, "cutting.optimize");
  const rows = await prisma.cuttingPlan.findMany({
    where: {
      organizationId: context.organizationId,
      ...(filter.salesOrderId ? { salesOrderId: filter.salesOrderId } : {}),
    },
    select: planSelect,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: filter.limit ?? 50,
  });
  return { items: rows.map(toPlanDto) };
}

export type CuttingPlanDetailDto = CuttingPlanDto & {
  input: CuttingInput;
  result: CuttingResult | null;
  revisions: CuttingRevisionDto[];
};

export async function getCuttingPlan(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  planId: string,
): Promise<CuttingPlanDetailDto> {
  requirePermission(context, "cutting.optimize");
  const row = await prisma.cuttingPlan.findFirst({
    where: { id: planId, organizationId: context.organizationId },
    select: { ...planSelect, input: true, revisions: { select: revisionSelect, orderBy: { revisionNumber: "desc" } } },
  });
  if (!row) throw new CuttingError("NOT_FOUND", "재단 작업을 찾을 수 없습니다.");

  let result: CuttingResult | null = null;
  if (row.currentRevision?.status === "SUCCEEDED") {
    const stored = await prisma.cuttingPlanRevision.findUniqueOrThrow({
      where: { id: row.currentRevision.id },
      select: { result: true },
    });
    const parsed = cuttingResultSchema.safeParse(stored.result);
    result = parsed.success ? parsed.data : null;
  }

  return {
    ...toPlanDto(row),
    input: readPlanInput(row.id, row.input),
    result,
    revisions: row.revisions.map(toRevisionDto),
  };
}

/** 승인하면 잠긴다(`D2-B05-G`). 성공한 개정만 승인할 수 있다. */
export async function approveCuttingPlan(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: { planId: string; revisionId: string; expectedLockVersion: number; requestId: string },
): Promise<CuttingPlanDto> {
  requirePermission(context, "cutting.approve");
  const plan = await loadPlan(prisma, context.organizationId, input.planId);
  if (plan.status === "APPROVED") {
    throw new CuttingError("CONFLICT", "이미 승인된 재단 작업입니다.");
  }

  const revision = await prisma.cuttingPlanRevision.findFirst({
    where: { id: input.revisionId, cuttingPlanId: plan.id, organizationId: context.organizationId },
    select: revisionSelect,
  });
  if (!revision) throw new CuttingError("NOT_FOUND", "재단 개정을 찾을 수 없습니다.");
  if (revision.status !== "SUCCEEDED") {
    throw new CuttingError("CONFLICT", "성공한 재단 결과만 승인할 수 있습니다.");
  }
  if ((revision.unplacedQuantity ?? 0) > 0) {
    throw new CuttingError("CONFLICT", "배치하지 못한 부품이 있어 승인할 수 없습니다.");
  }

  const approved = await prisma.$transaction(async (tx) => {
    const claimed = await tx.cuttingPlan.updateMany({
      where: {
        id: plan.id,
        organizationId: context.organizationId,
        lockVersion: input.expectedLockVersion,
        status: { not: "APPROVED" },
      },
      data: {
        status: "APPROVED",
        approvedRevisionId: revision.id,
        currentRevisionId: revision.id,
        approvedAt: new Date(),
        approvedByMembershipId: context.membershipId,
        lockVersion: { increment: 1 },
      },
    });
    if (claimed.count !== 1) {
      throw new CuttingError("CONFLICT", "재단 작업이 다른 화면에서 변경되었습니다.");
    }
    // 승인이 곧 원판을 쓴 것이다. 같은 트랜잭션에서 실적을 남긴다(`D2-B06-A`).
    const usage = await recordSheetUsageForApproval(tx, {
      organizationId: context.organizationId,
      salesOrderId: plan.salesOrderId,
      cuttingPlanId: plan.id,
      cuttingPlanRevisionId: revision.id,
      orderNumber: plan.salesOrder.orderNumber,
      materialCode: plan.materialVariant.code,
      materialVariantId: plan.materialVariantId,
      revisionNumber: revision.revisionNumber,
    });
    await writeAuditEvent(tx, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "cutting.approved",
      entityId: plan.id,
      requestId: input.requestId,
      before: { status: plan.status, lockVersion: plan.lockVersion },
      after: { status: "APPROVED", lockVersion: plan.lockVersion + 1 },
      metadata: {
        revisionNumber: revision.revisionNumber,
        sheetCount: revision.sheetCount ?? 0,
        yieldPercent: revision.yieldPercent?.toString() ?? "0",
        sheetUsageCount: usage.usageCount,
        remnantCount: usage.remnantCount,
      },
    });
    return tx.cuttingPlan.findFirstOrThrow({ where: { id: plan.id }, select: planSelect });
  });

  return toPlanDto(approved);
}

/**
 * 재단 승인을 취소한다(`D2-B06-F`).
 *
 * `P2-B05` 는 승인을 되돌리는 길을 두지 않았다. 실적이 붙으면서 필요해졌다.
 * 잘못 승인한 것을 되돌릴 수 없으면 틀린 실적이 그대로 남기 때문이다.
 * 사유를 반드시 받는다. 무엇 때문에 되돌렸는지가 실적보다 오래 남는다.
 */
export async function cancelCuttingApproval(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: { planId: string; reason: string; expectedLockVersion: number; requestId: string },
): Promise<CuttingPlanDto> {
  requirePermission(context, "cutting.approve");
  const reason = input.reason.trim();
  if (!reason) {
    throw new CuttingError("INVALID_REQUEST", "승인 취소 사유를 입력해 주세요.");
  }
  const plan = await loadPlan(prisma, context.organizationId, input.planId);
  if (plan.status !== "APPROVED") {
    throw new CuttingError("CONFLICT", "승인된 재단 작업만 취소할 수 있습니다.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.cuttingPlan.updateMany({
      where: {
        id: plan.id,
        organizationId: context.organizationId,
        lockVersion: input.expectedLockVersion,
        status: "APPROVED",
      },
      data: {
        status: "CALCULATED",
        approvedRevisionId: null,
        approvedAt: null,
        approvedByMembershipId: null,
        lockVersion: { increment: 1 },
      },
    });
    if (claimed.count !== 1) {
      throw new CuttingError("CONFLICT", "재단 작업이 다른 화면에서 변경되었습니다.");
    }
    const reverted = await voidSheetUsageForPlan(tx, {
      organizationId: context.organizationId,
      cuttingPlanId: plan.id,
      reason,
    });
    await writeAuditEvent(tx, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "cutting.approval_cancelled",
      entityId: plan.id,
      requestId: input.requestId,
      before: { status: "APPROVED", lockVersion: plan.lockVersion },
      after: { status: "CALCULATED", lockVersion: plan.lockVersion + 1 },
      metadata: {
        reason,
        voidedUsageCount: reverted.voidedCount,
        discardedRemnantCount: reverted.discardedRemnantCount,
        restoredRemnantCount: reverted.restoredRemnantCount,
      },
    });
    return tx.cuttingPlan.findFirstOrThrow({ where: { id: plan.id }, select: planSelect });
  });

  return toPlanDto(updated);
}

/** worker 가 결과를 돌려줄 때 부른다. 개정과 작업 상태를 함께 옮긴다. */
export async function recordCuttingRevisionResult(
  database: Database,
  input: { revisionId: string; result: CuttingResult },
): Promise<void> {
  const unplacedQuantity = input.result.summary.unplacedParts.reduce(
    (total, part) => total + part.quantity,
    0,
  );
  const revision = await database.cuttingPlanRevision.update({
    where: { id: input.revisionId },
    data: {
      status: "SUCCEEDED",
      engineVersion: input.result.engineVersion,
      result: input.result as unknown as Prisma.InputJsonValue,
      sheetCount: input.result.summary.sheetCount,
      usedAreaM2: input.result.summary.usedAreaM2,
      totalAreaM2: input.result.summary.totalAreaM2,
      yieldPercent: input.result.summary.yieldPercent,
      unplacedQuantity,
      failureReason: null,
    },
    select: { cuttingPlanId: true, id: true },
  });
  await database.cuttingPlan.updateMany({
    // 그 사이에 새 개정이 시작됐다면 옛 결과로 상태를 되돌리지 않는다.
    where: { id: revision.cuttingPlanId, currentRevisionId: revision.id, status: { not: "APPROVED" } },
    data: { status: "CALCULATED" },
  });
}

export async function recordCuttingRevisionFailure(
  database: Database,
  input: { revisionId: string; reason: string },
): Promise<void> {
  const revision = await database.cuttingPlanRevision.update({
    where: { id: input.revisionId },
    data: { status: "FAILED", failureReason: input.reason.slice(0, 500) },
    select: { cuttingPlanId: true, id: true },
  });
  await database.cuttingPlan.updateMany({
    where: { id: revision.cuttingPlanId, currentRevisionId: revision.id, status: { not: "APPROVED" } },
    data: { status: "FAILED" },
  });
}

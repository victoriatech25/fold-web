import "server-only";

import {
  cuttingInputSchema,
  cuttingResultSchema,
  type CuttingInput,
  type CuttingResult,
} from "@/domain/cutting/schema";
import {
  readRemnantId,
  summarizeSheetUsage,
  type SheetUsageSummary,
} from "@/domain/cutting/sheet-usage";
import {
  addCanonicalDecimals,
  divideCanonicalDecimalByPowerOfTen,
  divideCanonicalDecimals,
  multiplyCanonicalDecimalByInteger,
  multiplyCanonicalDecimals,
  quantizeCanonicalDecimal,
} from "@/domain/calculation-decimal";
import { writeAuditEvent } from "@/server/audit/audit-writer";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { requirePermission } from "@/server/authorization/authorization";
import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";
import { CuttingError } from "./cutting-error";

type Database = PrismaClient | Prisma.TransactionClient;

/**
 * 승인된 재단을 원판 사용 실적으로 남긴다(`P2-B06`).
 *
 * 원천은 승인된 개정뿐이다(`D2-B06-A`). 승인 트랜잭션 안에서 불리며,
 * 그 시점의 규격·단가·중량 계수를 복사해 넣는다(`D2-B06-E`).
 */

const WEIGHT_SCALE = 6;
const MONEY_SCALE = 2;

const sheetItemSelect = {
  id: true,
  code: true,
  name: true,
  widthMm: true,
  lengthMm: true,
  weightOverrideKg: true,
  standardPurchaseCostKrw: true,
  materialVariantId: true,
  materialVariant: {
    select: { thicknessMm: true, material: { select: { densityKgPerM3: true } } },
  },
} as const satisfies Prisma.SheetItemSelect;

type SheetItemRow = Prisma.SheetItemGetPayload<{ select: typeof sheetItemSelect }>;

/**
 * 판 하나의 이론 중량. 면적 × 두께 × 밀도다.
 *
 * 밀도가 없으면 `null` 이다. 중량을 0 으로 만들면 "가벼운 판" 과 구분되지 않는다
 * (`P2-A05` 의 같은 규칙).
 */
function theoreticalWeightKg(
  widthMm: string,
  lengthMm: string,
  thicknessMm: string,
  densityKgPerM3: string | null,
): string | null {
  if (!densityKgPerM3) return null;
  return quantizeCanonicalDecimal(
    divideCanonicalDecimalByPowerOfTen(
      multiplyCanonicalDecimals(
        multiplyCanonicalDecimals(multiplyCanonicalDecimals(widthMm, lengthMm), thicknessMm),
        densityKgPerM3,
      ),
      9,
    ),
    WEIGHT_SCALE,
    "round",
  );
}

function multiplyByCount(value: string | null, count: number, scale: number): string | null {
  if (value === null) return null;
  return quantizeCanonicalDecimal(multiplyCanonicalDecimalByInteger(value, count), scale, "round");
}

/**
 * 잔재를 잘라 쓴 줄의 참고 매입원가는 `0` 으로 둔다.
 *
 * 그 판값은 잔재를 만든 수주가 이미 전액 졌다(`D2-B06-I`). 여기서 또 세면
 * 같은 원판이 두 번 원가로 잡힌다. 잔재를 쓴 만큼 원가가 실제로 내려가는 것이
 * 잔재를 후보로 넣는 이유이기도 하다.
 */
const REMNANT_UNIT_COST_KRW = "0";

type ApprovalContext = {
  organizationId: string;
  salesOrderId: string;
  cuttingPlanId: string;
  cuttingPlanRevisionId: string;
  orderNumber: string;
  materialCode: string;
  materialVariantId: string;
  revisionNumber: number;
};

/** 잔재 이름. 어느 수주의 몇 번째 개정에서 나온 몇 번째 조각인지 그대로 읽힌다. */
function remnantCode(context: ApprovalContext, index: number): string {
  return `R-${context.orderNumber}-${context.materialCode.slice(0, 12)}-${context.revisionNumber}-${index + 1}`.slice(
    0,
    80,
  );
}

function readInput(raw: unknown): CuttingInput {
  const parsed = cuttingInputSchema.safeParse(raw);
  if (!parsed.success) throw new CuttingError("CONFLICT", "재단 입력을 읽을 수 없습니다.");
  return parsed.data;
}

function readResult(raw: unknown): CuttingResult {
  const parsed = cuttingResultSchema.safeParse(raw);
  if (!parsed.success) throw new CuttingError("CONFLICT", "재단 결과를 읽을 수 없습니다.");
  return parsed.data;
}

/**
 * 사용 실적 한 줄이 어느 원판 품목에서 나왔는지 푼다.
 * 잔재를 쓴 줄이면 그 잔재가 태어난 원판 품목을 그대로 따른다.
 */
async function resolveSheetItem(
  database: Database,
  organizationId: string,
  summary: SheetUsageSummary,
): Promise<{ sheetItem: SheetItemRow; remnantId: string | null }> {
  const remnantId = readRemnantId(summary.sheetKey);
  const sheetItemId = remnantId
    ? (
        await database.sheetRemnant.findFirstOrThrow({
          where: { id: remnantId, organizationId },
          select: { sheetItemId: true },
        })
      ).sheetItemId
    : summary.sheetKey;

  const sheetItem = await database.sheetItem.findFirst({
    where: { id: sheetItemId, organizationId },
    select: sheetItemSelect,
  });
  if (!sheetItem) {
    throw new CuttingError("CONFLICT", "재단에 쓴 원판을 기준정보에서 찾을 수 없습니다.");
  }
  return { sheetItem, remnantId };
}

/**
 * 승인 시 사용 기록과 잔재 개체를 만든다.
 *
 * 승인 트랜잭션 안에서 부른다. 같은 개정을 두 번 승인하는 길은 없지만,
 * 유일 제약(`cuttingPlanRevisionId`+`sheetKey`)이 겹쳐 쓰기를 막는다.
 */
export async function recordSheetUsageForApproval(
  database: Database,
  context: ApprovalContext,
): Promise<{ usageCount: number; remnantCount: number }> {
  const plan = await database.cuttingPlan.findFirstOrThrow({
    where: { id: context.cuttingPlanId, organizationId: context.organizationId },
    select: { input: true },
  });
  const revision = await database.cuttingPlanRevision.findFirstOrThrow({
    where: { id: context.cuttingPlanRevisionId, organizationId: context.organizationId },
    select: { result: true },
  });

  const breakdown = summarizeSheetUsage(readInput(plan.input), readResult(revision.result));

  let remnantIndex = 0;
  let remnantCount = 0;

  for (const item of breakdown.items) {
    const { sheetItem, remnantId } = await resolveSheetItem(
      database,
      context.organizationId,
      item,
    );
    const thicknessMm = sheetItem.materialVariant.thicknessMm.toString();
    const densityKgPerM3 = sheetItem.materialVariant.material.densityKgPerM3?.toString() ?? null;

    // 잔재는 규격이 원판과 다르므로 중량도 잔재 크기로 다시 계산한다.
    const unitWeightKg = remnantId
      ? theoreticalWeightKg(item.widthMm, item.lengthMm, thicknessMm, densityKgPerM3)
      : (sheetItem.weightOverrideKg?.toString() ??
        theoreticalWeightKg(item.widthMm, item.lengthMm, thicknessMm, densityKgPerM3));
    const unitCostKrw = remnantId
      ? REMNANT_UNIT_COST_KRW
      : (sheetItem.standardPurchaseCostKrw?.toString() ?? null);

    await database.sheetUsageRecord.create({
      data: {
        organizationId: context.organizationId,
        salesOrderId: context.salesOrderId,
        cuttingPlanId: context.cuttingPlanId,
        cuttingPlanRevisionId: context.cuttingPlanRevisionId,
        sheetItemId: sheetItem.id,
        sheetKey: item.sheetKey,
        sourceRemnantId: remnantId,
        label: item.label,
        widthMm: item.widthMm,
        lengthMm: item.lengthMm,
        sheetCount: item.sheetCount,
        totalAreaM2: item.totalAreaM2,
        placedAreaM2: item.placedAreaM2,
        remnantAreaM2: item.remnantAreaM2,
        lossAreaM2: item.lossAreaM2,
        yieldPercent: item.yieldPercent,
        unitWeightKg,
        totalWeightKg: multiplyByCount(unitWeightKg, item.sheetCount, WEIGHT_SCALE),
        unitCostKrw,
        totalCostKrw: multiplyByCount(unitCostKrw, item.sheetCount, MONEY_SCALE),
      },
    });

    // 쓴 잔재는 소진 처리한다. 남아 있는 것만 다음 재단 후보가 된다(`D2-B06-H`).
    if (remnantId) {
      await database.sheetRemnant.updateMany({
        where: { id: remnantId, organizationId: context.organizationId, status: "AVAILABLE" },
        data: {
          status: "CONSUMED",
          consumedByCuttingPlanId: context.cuttingPlanId,
          consumedAt: new Date(),
          lockVersion: { increment: 1 },
        },
      });
    }

    for (const remnant of item.remnants) {
      await database.sheetRemnant.create({
        data: {
          organizationId: context.organizationId,
          sheetItemId: sheetItem.id,
          materialVariantId: context.materialVariantId,
          code: remnantCode(context, remnantIndex),
          widthMm: remnant.widthMm,
          lengthMm: remnant.lengthMm,
          areaM2: remnant.areaM2,
          originCuttingPlanId: context.cuttingPlanId,
        },
      });
      remnantIndex += 1;
      remnantCount += 1;
    }
  }

  return { usageCount: breakdown.items.length, remnantCount };
}

/**
 * 승인을 취소할 때 실적을 되돌린다(`D2-B06-F`).
 *
 * 지우지 않는다. 사용 기록은 무효로 표시하고, 이 재단이 만든 잔재는 폐기로,
 * 이 재단이 쓴 잔재는 다시 쓸 수 있게 되돌린다. 이미 다른 재단이 가져다 쓴
 * 잔재는 건드리지 않는다. 그쪽 계획을 조용히 무너뜨리지 않기 위해서다.
 */
export async function voidSheetUsageForPlan(
  database: Database,
  input: { organizationId: string; cuttingPlanId: string; reason: string },
): Promise<{ voidedCount: number; discardedRemnantCount: number; restoredRemnantCount: number }> {
  const now = new Date();
  const voided = await database.sheetUsageRecord.updateMany({
    where: {
      organizationId: input.organizationId,
      cuttingPlanId: input.cuttingPlanId,
      status: "ACTIVE",
    },
    data: { status: "VOID", voidedAt: now, voidReason: input.reason.slice(0, 500) },
  });

  const discarded = await database.sheetRemnant.updateMany({
    where: {
      organizationId: input.organizationId,
      originCuttingPlanId: input.cuttingPlanId,
      status: "AVAILABLE",
    },
    data: {
      status: "DISCARDED",
      discardedAt: now,
      discardReason: input.reason.slice(0, 500),
      lockVersion: { increment: 1 },
    },
  });

  const restored = await database.sheetRemnant.updateMany({
    where: {
      organizationId: input.organizationId,
      consumedByCuttingPlanId: input.cuttingPlanId,
      status: "CONSUMED",
    },
    data: {
      status: "AVAILABLE",
      consumedByCuttingPlanId: null,
      consumedAt: null,
      lockVersion: { increment: 1 },
    },
  });

  return {
    voidedCount: voided.count,
    discardedRemnantCount: discarded.count,
    restoredRemnantCount: restored.count,
  };
}

/* ------------------------------------------------------------------ 조회 */

const usageSelect = {
  id: true,
  salesOrderId: true,
  cuttingPlanId: true,
  sheetItemId: true,
  sheetKey: true,
  sourceRemnantId: true,
  status: true,
  label: true,
  widthMm: true,
  lengthMm: true,
  sheetCount: true,
  totalAreaM2: true,
  placedAreaM2: true,
  remnantAreaM2: true,
  lossAreaM2: true,
  yieldPercent: true,
  unitWeightKg: true,
  totalWeightKg: true,
  unitCostKrw: true,
  totalCostKrw: true,
  voidedAt: true,
  voidReason: true,
  createdAt: true,
  salesOrder: { select: { orderNumber: true } },
  sheetItem: { select: { code: true, name: true } },
} as const satisfies Prisma.SheetUsageRecordSelect;

type UsageRow = Prisma.SheetUsageRecordGetPayload<{ select: typeof usageSelect }>;

export type SheetUsageDto = ReturnType<typeof toUsageDto>;

function toUsageDto(row: UsageRow) {
  return {
    id: row.id,
    salesOrderId: row.salesOrderId,
    orderNumber: row.salesOrder.orderNumber,
    cuttingPlanId: row.cuttingPlanId,
    sheetItemId: row.sheetItemId,
    sheetItemCode: row.sheetItem.code,
    sheetItemName: row.sheetItem.name,
    /** 잔재를 잘라 쓴 줄이면 참이다. 화면에서 원판과 구분해 보여 준다. */
    fromRemnant: row.sourceRemnantId !== null,
    status: row.status,
    label: row.label,
    widthMm: row.widthMm.toString(),
    lengthMm: row.lengthMm.toString(),
    sheetCount: row.sheetCount,
    totalAreaM2: row.totalAreaM2.toString(),
    placedAreaM2: row.placedAreaM2.toString(),
    remnantAreaM2: row.remnantAreaM2.toString(),
    lossAreaM2: row.lossAreaM2.toString(),
    yieldPercent: row.yieldPercent.toString(),
    unitWeightKg: row.unitWeightKg?.toString() ?? null,
    totalWeightKg: row.totalWeightKg?.toString() ?? null,
    unitCostKrw: row.unitCostKrw?.toString() ?? null,
    totalCostKrw: row.totalCostKrw?.toString() ?? null,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    voidReason: row.voidReason,
    createdAt: row.createdAt.toISOString(),
  };
}

export type SheetUsageTotals = {
  sheetCount: number;
  totalAreaM2: string;
  placedAreaM2: string;
  remnantAreaM2: string;
  lossAreaM2: string;
  yieldPercent: string;
  /** 중량·원가는 값이 없는 원판이 섞이면 비운다. 반쪽 합계를 보여 주지 않는다. */
  totalWeightKg: string | null;
  totalCostKrw: string | null;
};

function sumUsage(rows: SheetUsageDto[]): SheetUsageTotals {
  let sheetCount = 0;
  let totalAreaM2 = "0";
  let placedAreaM2 = "0";
  let remnantAreaM2 = "0";
  let lossAreaM2 = "0";
  let totalWeightKg: string | null = "0";
  let totalCostKrw: string | null = "0";

  for (const row of rows) {
    sheetCount += row.sheetCount;
    totalAreaM2 = addCanonicalDecimals(totalAreaM2, row.totalAreaM2);
    placedAreaM2 = addCanonicalDecimals(placedAreaM2, row.placedAreaM2);
    remnantAreaM2 = addCanonicalDecimals(remnantAreaM2, row.remnantAreaM2);
    lossAreaM2 = addCanonicalDecimals(lossAreaM2, row.lossAreaM2);
    totalWeightKg =
      totalWeightKg === null || row.totalWeightKg === null
        ? null
        : addCanonicalDecimals(totalWeightKg, row.totalWeightKg);
    totalCostKrw =
      totalCostKrw === null || row.totalCostKrw === null
        ? null
        : addCanonicalDecimals(totalCostKrw, row.totalCostKrw);
  }

  return {
    sheetCount,
    totalAreaM2,
    placedAreaM2,
    remnantAreaM2,
    lossAreaM2,
    yieldPercent:
      totalAreaM2 === "0"
        ? "0"
        : quantizeCanonicalDecimal(
            multiplyCanonicalDecimalByInteger(
              divideCanonicalDecimals(placedAreaM2, totalAreaM2),
              100,
            ),
            MONEY_SCALE,
            "round",
          ),
    totalWeightKg,
    totalCostKrw,
  };
}

/** 수주 한 건이 쓴 원판. 무효 기록도 함께 주고 화면이 구분해 보인다. */
export async function listSheetUsageForOrder(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  salesOrderId: string,
): Promise<{ items: SheetUsageDto[]; totals: SheetUsageTotals }> {
  requirePermission(context, "cutting.optimize");
  const rows = await prisma.sheetUsageRecord.findMany({
    where: { organizationId: context.organizationId, salesOrderId },
    select: usageSelect,
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });
  const items = rows.map(toUsageDto);
  return { items, totals: sumUsage(items.filter((item) => item.status === "ACTIVE")) };
}

/**
 * 기간·원판별 사용 실적(`D2-B06-B`).
 * 무효 기록은 세지 않는다. 승인이 살아 있는 것만 실적이다.
 */
export async function summarizeSheetUsageByPeriod(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  filter: { from?: Date; to?: Date; sheetItemId?: string; limit?: number } = {},
): Promise<{
  items: { sheetItemId: string; code: string; name: string; totals: SheetUsageTotals }[];
  totals: SheetUsageTotals;
  rows: SheetUsageDto[];
}> {
  requirePermission(context, "cutting.optimize");
  const rows = await prisma.sheetUsageRecord.findMany({
    where: {
      organizationId: context.organizationId,
      status: "ACTIVE",
      ...(filter.sheetItemId ? { sheetItemId: filter.sheetItemId } : {}),
      ...(filter.from || filter.to
        ? { createdAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } }
        : {}),
    },
    select: usageSelect,
    orderBy: [{ createdAt: "desc" }],
    take: filter.limit ?? 500,
  });
  const items = rows.map(toUsageDto);

  const grouped = new Map<string, SheetUsageDto[]>();
  for (const item of items) {
    grouped.set(item.sheetItemId, [...(grouped.get(item.sheetItemId) ?? []), item]);
  }

  return {
    items: [...grouped.entries()]
      .map(([sheetItemId, group]) => ({
        sheetItemId,
        code: group[0].sheetItemCode,
        name: group[0].sheetItemName,
        totals: sumUsage(group),
      }))
      .sort((left, right) => right.totals.sheetCount - left.totals.sheetCount),
    totals: sumUsage(items),
    rows: items,
  };
}

const remnantSelect = {
  id: true,
  code: true,
  status: true,
  widthMm: true,
  lengthMm: true,
  areaM2: true,
  lockVersion: true,
  consumedAt: true,
  discardedAt: true,
  discardReason: true,
  createdAt: true,
  sheetItem: { select: { id: true, code: true, name: true } },
  materialVariant: { select: { id: true, code: true, name: true, material: { select: { name: true } } } },
  originCuttingPlan: { select: { id: true, salesOrder: { select: { orderNumber: true } } } },
} as const satisfies Prisma.SheetRemnantSelect;

export type SheetRemnantDto = ReturnType<typeof toRemnantDto>;

function toRemnantDto(row: Prisma.SheetRemnantGetPayload<{ select: typeof remnantSelect }>) {
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    widthMm: row.widthMm.toString(),
    lengthMm: row.lengthMm.toString(),
    areaM2: row.areaM2.toString(),
    lockVersion: row.lockVersion,
    sheetItemId: row.sheetItem.id,
    sheetItemLabel: `${row.sheetItem.code} ${row.sheetItem.name}`.trim(),
    materialLabel: `${row.materialVariant.material.name} ${row.materialVariant.name}`.trim(),
    originOrderNumber: row.originCuttingPlan?.salesOrder.orderNumber ?? null,
    originCuttingPlanId: row.originCuttingPlan?.id ?? null,
    consumedAt: row.consumedAt?.toISOString() ?? null,
    discardedAt: row.discardedAt?.toISOString() ?? null,
    discardReason: row.discardReason,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listSheetRemnants(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  filter: { status?: "AVAILABLE" | "CONSUMED" | "DISCARDED"; materialVariantId?: string; limit?: number } = {},
): Promise<{ items: SheetRemnantDto[] }> {
  requirePermission(context, "cutting.optimize");
  const rows = await prisma.sheetRemnant.findMany({
    where: {
      organizationId: context.organizationId,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.materialVariantId ? { materialVariantId: filter.materialVariantId } : {}),
    },
    select: remnantSelect,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: filter.limit ?? 200,
  });
  return { items: rows.map(toRemnantDto) };
}

/**
 * 실물에 없는 잔재를 지운다(`D2-B06-H` 의 실제 비용).
 *
 * 계산에서 빼되 기록은 남긴다. 폐기하지 않으면 없는 조각을 깔고 앉은 계획이
 * 계속 나온다. 이미 쓴 잔재는 되돌릴 것이 없으므로 폐기하지 않는다.
 */
export async function discardSheetRemnant(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: { remnantId: string; reason: string; expectedLockVersion: number; requestId: string },
): Promise<SheetRemnantDto> {
  requirePermission(context, "cutting.approve");
  const reason = input.reason.trim();
  if (!reason) throw new CuttingError("INVALID_REQUEST", "폐기 사유를 입력해 주세요.");

  const remnant = await prisma.sheetRemnant.findFirst({
    where: { id: input.remnantId, organizationId: context.organizationId },
    select: remnantSelect,
  });
  if (!remnant) throw new CuttingError("NOT_FOUND", "잔재를 찾을 수 없습니다.");
  if (remnant.status !== "AVAILABLE") {
    throw new CuttingError("CONFLICT", "남아 있는 잔재만 폐기할 수 있습니다.");
  }

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.sheetRemnant.updateMany({
      where: {
        id: remnant.id,
        organizationId: context.organizationId,
        status: "AVAILABLE",
        lockVersion: input.expectedLockVersion,
      },
      data: {
        status: "DISCARDED",
        discardedAt: new Date(),
        discardReason: reason.slice(0, 500),
        lockVersion: { increment: 1 },
      },
    });
    if (claimed.count !== 1) {
      throw new CuttingError("CONFLICT", "잔재가 다른 화면에서 변경되었습니다.");
    }
    await writeAuditEvent(tx, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "cutting.remnant_discarded",
      entityId: remnant.id,
      requestId: input.requestId,
      metadata: { code: remnant.code, reason, areaM2: remnant.areaM2.toString() },
    });
    const updated = await tx.sheetRemnant.findFirstOrThrow({
      where: { id: remnant.id },
      select: remnantSelect,
    });
    return toRemnantDto(updated);
  });
}

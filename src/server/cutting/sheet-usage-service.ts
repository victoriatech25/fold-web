import "server-only";

import {
  cuttingInputSchema,
  cuttingResultSchema,
  type CuttingInput,
  type CuttingResult,
} from "@/domain/cutting/schema";
import { summarizeSheetUsage, type SheetUsageSummary } from "@/domain/cutting/sheet-usage";
import {
  addCanonicalDecimals,
  divideCanonicalDecimalByPowerOfTen,
  divideCanonicalDecimals,
  multiplyCanonicalDecimalByInteger,
  multiplyCanonicalDecimals,
  quantizeCanonicalDecimal,
} from "@/domain/calculation-decimal";
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

type ApprovalContext = {
  organizationId: string;
  salesOrderId: string;
  cuttingPlanId: string;
  cuttingPlanRevisionId: string;
};

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

/** 사용 실적 한 줄이 어느 원판 품목에서 나왔는지 푼다. */
async function resolveSheetItem(
  database: Database,
  organizationId: string,
  summary: SheetUsageSummary,
): Promise<SheetItemRow> {
  const sheetItem = await database.sheetItem.findFirst({
    where: { id: summary.sheetKey, organizationId },
    select: sheetItemSelect,
  });
  if (!sheetItem) {
    throw new CuttingError("CONFLICT", "재단에 쓴 원판을 기준정보에서 찾을 수 없습니다.");
  }
  return sheetItem;
}

/**
 * 승인 시 사용 기록을 만든다.
 *
 * 승인 트랜잭션 안에서 부른다. 승인을 취소했다가 같은 개정을 다시 승인할 수 있으므로
 * 같은 개정에 실적이 여러 겹 쌓인다. 살아 있는 것은 항상 하나뿐이며, 부분 유일 인덱스
 * `SheetUsageRecord_one_active_per_revision_sheet_key` 가 그것을 보장한다.
 */
export async function recordSheetUsageForApproval(
  database: Database,
  context: ApprovalContext,
): Promise<{ usageCount: number }> {
  const plan = await database.cuttingPlan.findFirstOrThrow({
    where: { id: context.cuttingPlanId, organizationId: context.organizationId },
    select: { input: true },
  });
  const revision = await database.cuttingPlanRevision.findFirstOrThrow({
    where: { id: context.cuttingPlanRevisionId, organizationId: context.organizationId },
    select: { result: true },
  });

  const breakdown = summarizeSheetUsage(readInput(plan.input), readResult(revision.result));

  for (const item of breakdown.items) {
    const sheetItem = await resolveSheetItem(database, context.organizationId, item);
    const thicknessMm = sheetItem.materialVariant.thicknessMm.toString();
    const densityKgPerM3 = sheetItem.materialVariant.material.densityKgPerM3?.toString() ?? null;

    const unitWeightKg =
      sheetItem.weightOverrideKg?.toString() ??
      theoreticalWeightKg(item.widthMm, item.lengthMm, thicknessMm, densityKgPerM3);
    const unitCostKrw = sheetItem.standardPurchaseCostKrw?.toString() ?? null;

    await database.sheetUsageRecord.create({
      data: {
        organizationId: context.organizationId,
        salesOrderId: context.salesOrderId,
        cuttingPlanId: context.cuttingPlanId,
        cuttingPlanRevisionId: context.cuttingPlanRevisionId,
        sheetItemId: sheetItem.id,
        sheetKey: item.sheetKey,
        label: item.label,
        widthMm: item.widthMm,
        lengthMm: item.lengthMm,
        sheetCount: item.sheetCount,
        totalAreaM2: item.totalAreaM2,
        placedAreaM2: item.placedAreaM2,
        lossAreaM2: item.lossAreaM2,
        yieldPercent: item.yieldPercent,
        unitWeightKg,
        totalWeightKg: multiplyByCount(unitWeightKg, item.sheetCount, WEIGHT_SCALE),
        unitCostKrw,
        totalCostKrw: multiplyByCount(unitCostKrw, item.sheetCount, MONEY_SCALE),
      },
    });

  }

  return { usageCount: breakdown.items.length };
}

/**
 * 승인을 취소할 때 실적을 되돌린다(`D2-B06-F`).
 *
 * 지우지 않는다. 무효로 표시하고 왜 그랬는지를 남긴다. 지우면 그 실적이
 * 있었다는 사실 자체가 사라진다.
 */
export async function voidSheetUsageForPlan(
  database: Database,
  input: { organizationId: string; cuttingPlanId: string; reason: string },
): Promise<{ voidedCount: number }> {
  const voided = await database.sheetUsageRecord.updateMany({
    where: {
      organizationId: input.organizationId,
      cuttingPlanId: input.cuttingPlanId,
      status: "ACTIVE",
    },
    data: { status: "VOID", voidedAt: new Date(), voidReason: input.reason.slice(0, 500) },
  });
  return { voidedCount: voided.count };
}

/* ------------------------------------------------------------------ 조회 */

const usageSelect = {
  id: true,
  salesOrderId: true,
  cuttingPlanId: true,
  sheetItemId: true,
  sheetKey: true,
  status: true,
  label: true,
  widthMm: true,
  lengthMm: true,
  sheetCount: true,
  totalAreaM2: true,
  placedAreaM2: true,
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
    status: row.status,
    label: row.label,
    widthMm: row.widthMm.toString(),
    lengthMm: row.lengthMm.toString(),
    sheetCount: row.sheetCount,
    totalAreaM2: row.totalAreaM2.toString(),
    placedAreaM2: row.placedAreaM2.toString(),
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
  let lossAreaM2 = "0";
  let totalWeightKg: string | null = "0";
  let totalCostKrw: string | null = "0";

  for (const row of rows) {
    sheetCount += row.sheetCount;
    totalAreaM2 = addCanonicalDecimals(totalAreaM2, row.totalAreaM2);
    placedAreaM2 = addCanonicalDecimals(placedAreaM2, row.placedAreaM2);
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

import "server-only";

import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  PRICING_ENGINE_VERSION,
  PRICING_METRICS_VERSION,
  PricingCalculationError,
  extractFoldPricingMetrics,
  type FoldPriceResult,
} from "@/domain/pricing";
import {
  addCanonicalDecimals,
  divideCanonicalDecimalByPowerOfTen,
  quantizeCanonicalDecimal,
} from "@/domain/calculation-decimal";
import { projectCanonicalJsonV1 } from "@/domain/fold-document/canonical";
import { serverDocumentToBrowserFoldProfileV4 } from "@/domain/fold-document/adapter";
import { FoldDocumentValidationError } from "@/domain/fold-document/errors";
import { requirePermission } from "@/server/authorization/authorization";
import { writeAuditEvent } from "@/server/audit/audit-writer";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { readFoldRevisionDocument } from "@/server/fold-document/revision-contract";
import { PricingError } from "@/server/pricing/pricing-error";
import { calculateResolvedFoldPrice } from "@/server/pricing/pricing-service";

import { OrderError } from "./order-error";

type Database = PrismaClient | Prisma.TransactionClient;

const itemSelect = {
  id: true,
  lineNumber: true,
  name: true,
  quantity: true,
  materialRuleRevisionId: true,
  documentSchemaVersion: true,
  document: true,
  documentChecksumSha256: true,
  createdAt: true,
  updatedAt: true,
  materialRuleRevision: { select: { materialVariantId: true } },
} as const satisfies Prisma.SalesOrderFoldItemSelect;

type CalculationInputItem = Prisma.SalesOrderFoldItemGetPayload<{ select: typeof itemSelect }>;

const snapshotInclude = {
  itemSnapshots: { orderBy: [{ lineNumber: "asc" as const }, { id: "asc" as const }] },
} as const satisfies Prisma.SalesOrderCalculationSnapshotInclude;

type SnapshotRow = Prisma.SalesOrderCalculationSnapshotGetPayload<{ include: typeof snapshotInclude }>;

export type OrderCalculationSnapshotDto = ReturnType<typeof toSnapshotDto>;
export type OrderCalculationStateDto = {
  snapshot: OrderCalculationSnapshotDto | null;
  stale: boolean;
  currentInputChecksumSha256: string;
  canCalculate: boolean;
};

function sha256(value: unknown) {
  return createHash("sha256").update(projectCanonicalJsonV1(value), "utf8").digest("hex");
}

function currentInputChecksum(order: { customerId: string; partySnapshotChecksumSha256: string | null }, items: CalculationInputItem[]) {
  return sha256({
    schemaVersion: 1,
    customerId: order.customerId,
    partySnapshotChecksumSha256: order.partySnapshotChecksumSha256,
    items: [...items]
      .sort((left, right) => left.lineNumber - right.lineNumber || left.id.localeCompare(right.id))
      .map((item) => ({ id: item.id, lineNumber: item.lineNumber, documentChecksumSha256: item.documentChecksumSha256 })),
  });
}

function toSnapshotDto(row: SnapshotRow) {
  return {
    id: row.id,
    snapshotNumber: row.snapshotNumber,
    inputChecksumSha256: row.inputChecksumSha256,
    resultChecksumSha256: row.resultChecksumSha256,
    pricingEngineVersion: row.pricingEngineVersion,
    pricingMetricsVersion: row.pricingMetricsVersion,
    priceEffectiveAt: row.priceEffectiveAt.toISOString(),
    currency: "KRW" as const,
    vatRatePercent: row.vatRatePercent.toString(),
    supplyAmountKrw: row.supplyAmountKrw.toString(),
    vatAmountKrw: row.vatAmountKrw.toString(),
    totalAmountKrw: row.totalAmountKrw.toString(),
    itemCount: row.itemCount,
    createdAt: row.createdAt.toISOString(),
    items: row.itemSnapshots.map((item) => {
      const metrics = item.metrics as unknown as ReturnType<typeof extractFoldPricingMetrics>;
      const pricingResult = item.pricingResult as unknown as FoldPriceResult;
      return {
        id: item.id,
        foldItemId: item.salesOrderFoldItemId,
        lineNumber: item.lineNumber,
        name: item.name,
        quantity: item.quantity,
        itemDocumentChecksumSha256: item.itemDocumentChecksumSha256,
        inputChecksumSha256: item.inputChecksumSha256,
        resultChecksumSha256: item.resultChecksumSha256,
        metrics,
        pricingResult,
        materialAmountKrw: item.materialAmountKrw.toString(),
        bendAmountKrw: item.bendAmountKrw.toString(),
        vCutAmountKrw: item.vCutAmountKrw.toString(),
        surchargeAmountKrw: item.surchargeAmountKrw.toString(),
        supplyAmountKrw: item.supplyAmountKrw.toString(),
      };
    }),
  };
}

async function readOrderAndItems(database: Database, organizationId: string, orderId: string) {
  const order = await database.salesOrder.findFirst({
    where: { id: orderId, organizationId },
    select: {
      id: true,
      customerId: true,
      status: true,
      lockVersion: true,
      nextCalculationNumber: true,
      partySnapshotChecksumSha256: true,
      foldItems: {
        where: { removedAt: null },
        orderBy: [{ lineNumber: "asc" }, { id: "asc" }],
        select: itemSelect,
      },
    },
  });
  if (!order) throw new OrderError("NOT_FOUND", "수주를 찾을 수 없습니다.");
  return order;
}

export async function getCurrentOrderCalculation(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  orderId: string,
): Promise<OrderCalculationStateDto> {
  requirePermission(context, "order.read");
  const order = await readOrderAndItems(prisma, context.organizationId, orderId);
  const inputChecksumSha256 = currentInputChecksum(order, order.foldItems);
  const snapshot = await prisma.salesOrderCalculationSnapshot.findFirst({
    where: { organizationId: context.organizationId, salesOrderId: orderId },
    orderBy: [{ snapshotNumber: "desc" }, { id: "desc" }],
    include: snapshotInclude,
  });
  return {
    snapshot: snapshot ? toSnapshotDto(snapshot) : null,
    stale: snapshot ? snapshot.inputChecksumSha256 !== inputChecksumSha256 : false,
    currentInputChecksumSha256: inputChecksumSha256,
    canCalculate: (order.status === "DRAFT" || order.status === "CALCULATED") && order.foldItems.length > 0,
  };
}

function mapPricingError(error: PricingError): OrderError {
  if (error.code === "PRICE_NOT_CONFIGURED" || error.code === "PRICE_REVISION_NOT_EFFECTIVE" || error.code === "NOT_FOUND") {
    return new OrderError("CONFLICT", error.message);
  }
  return new OrderError("INVALID_REQUEST", error.message);
}

export async function createOrderCalculationSnapshot(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: { orderId: string; expectedOrderLockVersion: number; requestId: string },
) {
  requirePermission(context, "order.calculate");
  return prisma.$transaction(async (tx) => {
    const order = await readOrderAndItems(tx, context.organizationId, input.orderId);
    if (order.status !== "DRAFT" && order.status !== "CALCULATED") throw new OrderError("CONFLICT", "작성 중 또는 계산 완료 수주에서만 계산할 수 있습니다.");
    if (order.lockVersion !== input.expectedOrderLockVersion) {
      throw new OrderError("CONFLICT", "수주가 다른 화면에서 변경되었습니다.", { latest: { id: order.id, lockVersion: order.lockVersion, status: order.status } });
    }
    if (order.foldItems.length === 0) throw new OrderError("CONFLICT", "계산할 절곡 작업을 먼저 추가해 주세요.");

    const claimed = await tx.salesOrder.updateMany({
      where: { id: order.id, organizationId: context.organizationId, status: { in: ["DRAFT", "CALCULATED"] }, lockVersion: input.expectedOrderLockVersion },
      data: {
        status: "CALCULATED",
        statusChangedAt: new Date(),
        statusChangedByMembershipId: context.membershipId,
        lockVersion: { increment: 1 },
        nextCalculationNumber: { increment: 1 },
      },
    });
    if (claimed.count !== 1) throw new OrderError("CONFLICT", "수주가 다른 화면에서 변경되었습니다.");

    const priceEffectiveAt = new Date();
    const inputChecksumSha256 = currentInputChecksum(order, order.foldItems);
    const calculatedItems: Array<{
      item: CalculationInputItem;
      metrics: ReturnType<typeof extractFoldPricingMetrics>;
      result: FoldPriceResult;
      inputChecksumSha256: string;
      resultChecksumSha256: string;
    }> = [];

    for (const item of order.foldItems) {
      let metrics: ReturnType<typeof extractFoldPricingMetrics>;
      try {
        const document = readFoldRevisionDocument(item);
        const profile = serverDocumentToBrowserFoldProfileV4(JSON.parse(JSON.stringify(document)), {
          id: item.id,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        });
        metrics = extractFoldPricingMetrics(profile);
      } catch (error) {
        if (error instanceof PricingCalculationError || error instanceof FoldDocumentValidationError) {
          throw new OrderError("INVALID_REQUEST", `작업 ${item.lineNumber}의 계산 입력을 확인해 주세요. ${error.message}`);
        }
        throw error;
      }
      let result: FoldPriceResult;
      try {
        result = await calculateResolvedFoldPrice(tx, {
          organizationId: context.organizationId,
          customerId: order.customerId,
          materialVariantId: item.materialRuleRevision.materialVariantId,
          metrics,
          effectiveAt: priceEffectiveAt,
        });
      } catch (error) {
        if (error instanceof PricingError) throw mapPricingError(error);
        throw error;
      }
      const itemInputChecksumSha256 = sha256({
        schemaVersion: 1,
        foldItemId: item.id,
        lineNumber: item.lineNumber,
        documentChecksumSha256: item.documentChecksumSha256,
      });
      calculatedItems.push({
        item,
        metrics,
        result,
        inputChecksumSha256: itemInputChecksumSha256,
        resultChecksumSha256: sha256({ metrics, result }),
      });
    }

    const supplyAmountKrw = calculatedItems.reduce((sum, item) => addCanonicalDecimals(sum, item.result.amounts.supplyKrw), "0");
    const vatAmountKrw = quantizeCanonicalDecimal(divideCanonicalDecimalByPowerOfTen(supplyAmountKrw, 1), 0, "round");
    const totalAmountKrw = addCanonicalDecimals(supplyAmountKrw, vatAmountKrw);
    const resultChecksumSha256 = sha256({
      schemaVersion: 1,
      inputChecksumSha256,
      pricingEngineVersion: PRICING_ENGINE_VERSION,
      pricingMetricsVersion: PRICING_METRICS_VERSION,
      currency: "KRW",
      vatRatePercent: "10",
      supplyAmountKrw,
      vatAmountKrw,
      totalAmountKrw,
      items: calculatedItems.map(({ item, inputChecksumSha256: itemInput, resultChecksumSha256: itemResult }) => ({
        foldItemId: item.id,
        inputChecksumSha256: itemInput,
        resultChecksumSha256: itemResult,
      })),
    });

    const created = await tx.salesOrderCalculationSnapshot.create({
      data: {
        organizationId: context.organizationId,
        salesOrderId: order.id,
        snapshotNumber: order.nextCalculationNumber,
        inputChecksumSha256,
        resultChecksumSha256,
        pricingEngineVersion: PRICING_ENGINE_VERSION,
        pricingMetricsVersion: PRICING_METRICS_VERSION,
        priceEffectiveAt,
        currency: "KRW",
        vatRatePercent: "10",
        supplyAmountKrw,
        vatAmountKrw,
        totalAmountKrw,
        itemCount: calculatedItems.length,
        createdByMembershipId: context.membershipId,
        itemSnapshots: {
          create: calculatedItems.map(({ item, metrics, result, inputChecksumSha256: itemInput, resultChecksumSha256: itemResult }) => ({
            organizationId: context.organizationId,
            salesOrderFoldItemId: item.id,
            lineNumber: item.lineNumber,
            name: item.name,
            quantity: item.quantity,
            materialRuleRevisionId: item.materialRuleRevisionId,
            itemDocumentChecksumSha256: item.documentChecksumSha256,
            inputChecksumSha256: itemInput,
            resultChecksumSha256: itemResult,
            metrics: metrics as unknown as Prisma.InputJsonValue,
            pricingResult: result as unknown as Prisma.InputJsonValue,
            materialAmountKrw: result.amounts.materialKrw,
            bendAmountKrw: result.amounts.bendKrw,
            vCutAmountKrw: result.amounts.vCutKrw,
            surchargeAmountKrw: result.amounts.surchargeKrw,
            supplyAmountKrw: result.amounts.supplyKrw,
          })),
        },
      },
      include: snapshotInclude,
    });

    await writeAuditEvent(tx, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "order.calculation_snapshot_created",
      entityId: created.id,
      requestId: input.requestId,
      after: {
        salesOrderId: order.id,
        snapshotNumber: created.snapshotNumber,
        supplyAmountKrw,
        vatAmountKrw,
        totalAmountKrw,
      },
      metadata: { inputChecksumSha256, resultChecksumSha256, itemCount: calculatedItems.length },
    });

    return {
      orderLockVersion: input.expectedOrderLockVersion + 1,
      state: {
        snapshot: toSnapshotDto(created),
        stale: false,
        currentInputChecksumSha256: inputChecksumSha256,
        canCalculate: true,
      } satisfies OrderCalculationStateDto,
    };
  }, { timeout: 15_000 });
}

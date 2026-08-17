import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import type { ServerFoldDocumentV1 } from "@/domain/fold-document/schema";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { disconnectPrisma, getPrisma } from "@/server/db/prisma";
import { prepareFoldRevisionDocument } from "@/server/fold-document/revision-contract";
import {
  addOrderFoldItem,
  copyOrderFoldItem,
  listOrderFoldItems,
  listOrderFoldOptions,
  removeOrderFoldItem,
  reorderOrderFoldItems,
  updateOrderFoldItem,
} from "@/server/orders/order-fold-service";
import { createOrder, getOrder, updateOrder } from "@/server/orders/order-service";
import { createOrderCalculationSnapshot, getCurrentOrderCalculation } from "@/server/orders/order-calculation-service";
import { transitionOrder } from "@/server/orders/order-transition-service";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

integration.sequential("sales order fold snapshot integration", () => {
  let prisma: PrismaClient;
  let context: AuthenticatedContext;
  let customerId: string;
  let siteId: string;
  let contactId: string;
  let sourceRevisionId: string;
  let alternateRuleId: string;
  let alternateSheetId: string;
  let primaryVariantId: string;

  beforeAll(async () => {
    prisma = getPrisma();
    const organization = await prisma.organization.create({ data: { code: "ORDER-FOLD-INTEGRATION", name: "수주 절곡 통합 조직" } });
    const user = await prisma.user.create({ data: { email: "order-fold@example.test", normalizedEmail: "order-fold@example.test", displayName: "절곡 수주 담당자", status: "ACTIVE" } });
    const membership = await prisma.organizationMembership.create({ data: { organizationId: organization.id, userId: user.id } });
    context = {
      sessionId: crypto.randomUUID(), userId: user.id, displayName: user.displayName,
      membershipId: membership.id, departmentId: null, organizationId: organization.id,
      organizationCode: organization.code, organizationName: organization.name,
      roleKeys: ["SALES"], permissions: ["order.read", "order.edit", "order.calculate", "order.approve"], expiresAt: new Date("2027-01-01T00:00:00Z"),
    };
    const customer = await prisma.customer.create({ data: { organizationId: organization.id, code: "FOLD-CUSTOMER", name: "절곡 거래처", normalizedName: "절곡거래처", phone: "02-1000-2000", addressLine1: "서울시 테스트로 1" } });
    customerId = customer.id;
    siteId = (await prisma.customerSite.create({ data: { organizationId: organization.id, customerId, code: "SITE", name: "절곡 현장", addressLine1: "경기도 테스트길 2", isDefault: true } })).id;
    contactId = (await prisma.customerContact.create({ data: { organizationId: organization.id, customerId, customerSiteId: siteId, name: "김절곡", mobile: "010-1000-2000", isPrimary: true } })).id;

    const material = await prisma.material.create({ data: { organizationId: organization.id, code: "FOLD-MAT", name: "절곡 재질", normalizedName: "절곡재질", densityKgPerM3: "2700" } });
    const firstVariant = await prisma.materialVariant.create({ data: { organizationId: organization.id, materialId: material.id, code: "FOLD-MAT-1", name: "절곡 1T", thicknessMm: "1", defaultInsideRadiusMm: "1" } });
    primaryVariantId = firstVariant.id;
    const firstRule = await prisma.materialRuleRevision.create({ data: {
      organizationId: organization.id, materialVariantId: firstVariant.id, revisionNumber: 1, status: "PUBLISHED",
      calculationMode: "FIXED", elongationOption: "STANDARD", vCutEnabled: true, decimalPlaces: 1, decimalOperation: "ROUND",
      cutAngleDeg: "135", insideBendRadiusMm: "1", elongationVCutMm: "0.6", elongationACutMm: "0.4", elongationNoCutMm: "1",
      cutDepthVCutMm: "0.5", cutDepthACutMm: "0.5", cutDepthNoCutMm: "0", publishedAt: new Date(),
    } });
    const secondVariant = await prisma.materialVariant.create({ data: { organizationId: organization.id, materialId: material.id, code: "FOLD-MAT-2", name: "절곡 2T", thicknessMm: "2", defaultInsideRadiusMm: "2" } });
    alternateRuleId = (await prisma.materialRuleRevision.create({ data: {
      organizationId: organization.id, materialVariantId: secondVariant.id, revisionNumber: 1, status: "PUBLISHED",
      calculationMode: "FIXED", elongationOption: "STANDARD", vCutEnabled: true, decimalPlaces: 1, decimalOperation: "ROUND",
      cutAngleDeg: "135", insideBendRadiusMm: "2", elongationVCutMm: "1.2", elongationACutMm: "0.8", elongationNoCutMm: "2",
      cutDepthVCutMm: "0.5", cutDepthACutMm: "0.5", cutDepthNoCutMm: "0", publishedAt: new Date(),
    } })).id;
    alternateSheetId = (await prisma.sheetItem.create({ data: {
      organizationId: organization.id, materialVariantId: secondVariant.id, code: "FOLD-SHEET-2", name: "2T 기본 원판",
      widthMm: "1219", lengthMm: "2438", isDefault: true,
    } })).id;
    const document: ServerFoldDocumentV1 = {
      schemaVersion: 1, documentType: "normal", name: "주문 스냅샷 ㄱ자",
      product: { lengthMm: "1000", quantity: 2 },
      material: {
        ruleRevisionId: firstRule.id, name: "절곡 1T", thicknessMm: "1", insideBendRadiusMm: "1", cutAngleDeg: "135",
        elongationMm: { vCut: "0.6", aCut: "0.4", noCut: "1" }, cutDepthMm: { vCut: "0.5", aCut: "0.5", noCut: "0" },
      },
      calculation: { mode: "fixed", elongationOption: "standard", vCutEnabled: true, decimalPlaces: 1, decimalOperation: "round" },
      variables: [
        { name: "A", valueMm: "100" },
        { name: "B", valueMm: "101", expression: { grammarVersion: "v1", source: "A+1" } },
      ],
      blocks: [{ id: "block-1", name: "단면", order: 1, segments: [{ id: "segment-1", order: 1, geometry: { kind: "line", start: { xMm: "0", yMm: "0" }, end: { xMm: "100", yMm: "0" }, direction: "e" }, nominalLengthMm: "100" }] }],
    };
    const prepared = prepareFoldRevisionDocument(document);
    const template = await prisma.foldTemplate.create({ data: { organizationId: organization.id, code: "ORDER-FOLD-L", name: "주문 ㄱ자", documentType: "NORMAL" } });
    sourceRevisionId = (await prisma.foldRevision.create({ data: {
      organizationId: organization.id, templateId: template.id, revisionNumber: 1, status: "PUBLISHED", name: document.name,
      publishedAt: new Date(), ...prepared,
    } })).id;
    const priceBook = await prisma.priceBook.create({ data: { organizationId: organization.id, scopeType: "STANDARD", code: "ORDER-FOLD-STANDARD", name: "수주 계산 표준 가격" } });
    const priceRevision = await prisma.priceBookRevision.create({ data: {
      organizationId: organization.id, priceBookId: priceBook.id, revisionNumber: 1, status: "PUBLISHED",
      contentChecksumSha256: "a".repeat(64), effectiveFrom: new Date(Date.now() - 60_000), publishedAt: new Date(),
    } });
    await prisma.foldPriceRate.create({ data: {
      organizationId: organization.id, priceBookRevisionId: priceRevision.id, materialVariantId: primaryVariantId,
      materialRatePerM2Krw: "1000", bendRatePerOperationKrw: "100", vCutRatePerMeterKrw: "50",
    } });
    await prisma.surchargePolicy.create({ data: {
      organizationId: organization.id, priceBookRevisionId: priceRevision.id,
      minimumBendOperations: 3, ratePercent: "10", baseType: "PROCESSING_ONLY",
    } });
  });

  afterAll(async () => disconnectPrisma());

  it("deep-copies a published revision and freezes customer display information", async () => {
    const order = await createOrder(prisma, context, { customerId, customerSiteId: siteId, customerContactId: contactId, requestId: "order-fold-create" });
    const options = await listOrderFoldOptions(prisma, context, { orderId: order.id, q: "주문 ㄱ자" });
    expect(options.templates).toHaveLength(1);
    const added = await addOrderFoldItem(prisma, context, { orderId: order.id, sourceFoldRevisionId: sourceRevisionId, expectedOrderLockVersion: order.lockVersion, requestId: "order-fold-add" });
    expect(added.item).toMatchObject({ lineNumber: 1, quantity: 2, materialName: "절곡 1T", lockVersion: 1 });
    expect(added.partySnapshotCapturedAt).not.toBeNull();

    await prisma.foldTemplate.update({ where: { id: added.item.source.templateId }, data: { name: "나중에 바뀐 템플릿명" } });
    await prisma.customer.update({ where: { id: customerId }, data: { name: "나중에 바뀐 거래처명", normalizedName: "나중에바뀐거래처명" } });
    await prisma.foldRevision.update({ where: { id: sourceRevisionId }, data: { status: "RETIRED" } });
    const persisted = (await listOrderFoldItems(prisma, context, order.id))[0];
    expect(persisted.source.templateName).toBe("주문 ㄱ자");
    expect(persisted.documentChecksumSha256).toBe(added.item.documentChecksumSha256);
    await expect(updateOrder(prisma, context, {
      id: order.id, customerId, customerSiteId: null, customerContactId: contactId,
      expectedLockVersion: added.orderLockVersion, requestId: "order-fold-customer-change",
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await getOrder(prisma, context, order.id)).customerFieldsLocked).toBe(true);
  });

  it("updates allowed inputs and supports copy, reorder, remove and stale locks", async () => {
    const order = await createOrder(prisma, context, { customerId, customerSiteId: siteId, customerContactId: contactId, requestId: "order-fold-lifecycle-create" });
    await prisma.foldRevision.update({ where: { id: sourceRevisionId }, data: { status: "PUBLISHED" } });
    const added = await addOrderFoldItem(prisma, context, { orderId: order.id, sourceFoldRevisionId: sourceRevisionId, expectedOrderLockVersion: order.lockVersion, requestId: "order-fold-lifecycle-add" });
    const updated = await updateOrderFoldItem(prisma, context, {
      orderId: order.id, itemId: added.item.id, quantity: 7, variableValues: { A: "250" },
      materialRuleRevisionId: alternateRuleId, sheetItemId: alternateSheetId,
      expectedOrderLockVersion: added.orderLockVersion, expectedItemLockVersion: added.item.lockVersion,
      requestId: "order-fold-update",
    });
    expect(updated.item).toMatchObject({ quantity: 7, materialRuleRevisionId: alternateRuleId, sheetItemId: alternateSheetId, sheetName: "2T 기본 원판", lockVersion: 2 });
    expect(updated.item.variables.find((variable) => variable.name === "A")?.valueMm).toBe("250");
    await expect(updateOrderFoldItem(prisma, context, {
      orderId: order.id, itemId: updated.item.id, quantity: 8, variableValues: { B: "300" },
      expectedOrderLockVersion: updated.orderLockVersion, expectedItemLockVersion: updated.item.lockVersion,
      requestId: "order-fold-expression-change",
    })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    const copied = await copyOrderFoldItem(prisma, context, { orderId: order.id, itemId: updated.item.id, expectedOrderLockVersion: updated.orderLockVersion, requestId: "order-fold-copy" });
    expect(copied.item).toMatchObject({ lineNumber: 2, quantity: 7, documentChecksumSha256: updated.item.documentChecksumSha256 });
    const reordered = await reorderOrderFoldItems(prisma, context, { orderId: order.id, itemIds: [copied.item.id, updated.item.id], expectedOrderLockVersion: copied.orderLockVersion, requestId: "order-fold-reorder" });
    expect((await listOrderFoldItems(prisma, context, order.id)).map((item) => item.id)).toEqual([copied.item.id, updated.item.id]);
    const removed = await removeOrderFoldItem(prisma, context, { orderId: order.id, itemId: copied.item.id, expectedOrderLockVersion: reordered.orderLockVersion, expectedItemLockVersion: copied.item.lockVersion, requestId: "order-fold-remove" });
    expect((await listOrderFoldItems(prisma, context, order.id)).map((item) => item.id)).toEqual([updated.item.id]);
    await expect(copyOrderFoldItem(prisma, context, { orderId: order.id, itemId: updated.item.id, expectedOrderLockVersion: removed.orderLockVersion - 1, requestId: "order-fold-stale" })).rejects.toMatchObject({ code: "CONFLICT" });
    const actions = await prisma.auditEvent.findMany({ where: { organizationId: context.organizationId, requestId: { startsWith: "order-fold-" } }, select: { action: true } });
    expect(actions.map((event) => event.action)).toEqual(expect.arrayContaining(["order.party_snapshot_captured", "order.fold_item_added", "order.fold_item_updated", "order.fold_item_copied", "order.fold_items_reordered", "order.fold_item_removed"]));
  });

  it("creates immutable calculation snapshots and marks changed inputs stale", async () => {
    await prisma.foldRevision.update({ where: { id: sourceRevisionId }, data: { status: "PUBLISHED" } });
    const order = await createOrder(prisma, context, { customerId, customerSiteId: siteId, customerContactId: contactId, requestId: "order-calc-create" });
    const added = await addOrderFoldItem(prisma, context, { orderId: order.id, sourceFoldRevisionId: sourceRevisionId, expectedOrderLockVersion: order.lockVersion, requestId: "order-calc-add" });
    const calculated = await createOrderCalculationSnapshot(prisma, context, {
      orderId: order.id,
      expectedOrderLockVersion: added.orderLockVersion,
      requestId: "order-calc-v1",
    });
    expect(calculated.state.snapshot).toMatchObject({ snapshotNumber: 1, supplyAmountKrw: "200", vatAmountKrw: "20", totalAmountKrw: "220", itemCount: 1 });
    expect(calculated.state.snapshot?.items[0]).toMatchObject({ materialAmountKrw: "200", supplyAmountKrw: "200" });
    expect(calculated.state.snapshot?.items[0]?.pricingResult.trace.foldRate.scopeType).toBe("STANDARD");

    // 값이 그대로인 저장은 계산을 무효화하지 않는다.
    const unchanged = await updateOrderFoldItem(prisma, context, {
      orderId: order.id,
      itemId: added.item.id,
      quantity: added.item.quantity,
      expectedOrderLockVersion: calculated.orderLockVersion,
      expectedItemLockVersion: added.item.lockVersion,
      requestId: "order-calc-noop-save",
    });
    expect((await getOrder(prisma, context, order.id)).status).toBe("CALCULATED");
    expect((await getCurrentOrderCalculation(prisma, context, order.id)).stale).toBe(false);

    const changed = await updateOrderFoldItem(prisma, context, {
      orderId: order.id,
      itemId: added.item.id,
      quantity: 3,
      expectedOrderLockVersion: unchanged.orderLockVersion,
      expectedItemLockVersion: unchanged.item.lockVersion,
      requestId: "order-calc-input-change",
    });
    expect((await getOrder(prisma, context, order.id)).status).toBe("DRAFT");
    const stale = await getCurrentOrderCalculation(prisma, context, order.id);
    expect(stale.stale).toBe(true);
    expect(stale.snapshot?.snapshotNumber).toBe(1);
    expect(stale.snapshot?.totalAmountKrw).toBe("220");

    const recalculated = await createOrderCalculationSnapshot(prisma, context, {
      orderId: order.id,
      expectedOrderLockVersion: changed.orderLockVersion,
      requestId: "order-calc-v2",
    });
    expect(recalculated.state).toMatchObject({ stale: false, snapshot: { snapshotNumber: 2, supplyAmountKrw: "300", vatAmountKrw: "30", totalAmountKrw: "330" } });
    expect(await prisma.salesOrderCalculationSnapshot.count({ where: { salesOrderId: order.id } })).toBe(2);
    expect(await prisma.auditEvent.count({ where: { organizationId: context.organizationId, action: "order.calculation_snapshot_created", entityId: { not: null } } })).toBeGreaterThanOrEqual(2);
  });

  it("freezes an approved calculation and enforces the production state flow", async () => {
    await prisma.foldRevision.update({ where: { id: sourceRevisionId }, data: { status: "PUBLISHED" } });
    const order = await createOrder(prisma, context, { customerId, customerSiteId: siteId, customerContactId: contactId, requestId: "order-state-create" });
    const added = await addOrderFoldItem(prisma, context, { orderId: order.id, sourceFoldRevisionId: sourceRevisionId, expectedOrderLockVersion: order.lockVersion, requestId: "order-state-add" });
    const calculated = await createOrderCalculationSnapshot(prisma, context, { orderId: order.id, expectedOrderLockVersion: added.orderLockVersion, requestId: "order-state-calculate" });
    expect((await getOrder(prisma, context, order.id)).status).toBe("CALCULATED");

    const approved = await transitionOrder(prisma, context, { orderId: order.id, action: "APPROVE", expectedLockVersion: calculated.orderLockVersion, requestId: "order-state-approve" });
    expect(approved).toMatchObject({ status: "APPROVED", approvedCalculationSnapshotNumber: 1 });
    await expect(updateOrderFoldItem(prisma, context, {
      orderId: order.id, itemId: added.item.id, quantity: 4,
      expectedOrderLockVersion: approved.lockVersion, expectedItemLockVersion: added.item.lockVersion,
      requestId: "order-state-frozen-change",
    })).rejects.toMatchObject({ code: "CONFLICT" });

    const reopened = await transitionOrder(prisma, context, { orderId: order.id, action: "CANCEL_APPROVAL", reason: "고객 수량 변경", expectedLockVersion: approved.lockVersion, requestId: "order-state-unapprove" });
    expect(reopened).toMatchObject({ status: "CALCULATED", approvedCalculationSnapshotId: null });
    const changed = await updateOrderFoldItem(prisma, context, {
      orderId: order.id, itemId: added.item.id, quantity: 4,
      expectedOrderLockVersion: reopened.lockVersion, expectedItemLockVersion: added.item.lockVersion,
      requestId: "order-state-change",
    });
    expect((await getOrder(prisma, context, order.id)).status).toBe("DRAFT");

    const recalculated = await createOrderCalculationSnapshot(prisma, context, { orderId: order.id, expectedOrderLockVersion: changed.orderLockVersion, requestId: "order-state-recalculate" });
    const reapproved = await transitionOrder(prisma, context, { orderId: order.id, action: "APPROVE", expectedLockVersion: recalculated.orderLockVersion, requestId: "order-state-reapprove" });
    const requested = await transitionOrder(prisma, context, { orderId: order.id, action: "REQUEST_PRODUCTION", expectedLockVersion: reapproved.lockVersion, requestId: "order-state-request" });
    const started = await transitionOrder(prisma, context, { orderId: order.id, action: "START_PRODUCTION", expectedLockVersion: requested.lockVersion, requestId: "order-state-start" });
    const produced = await transitionOrder(prisma, context, { orderId: order.id, action: "COMPLETE_PRODUCTION", expectedLockVersion: started.lockVersion, requestId: "order-state-complete" });
    const closed = await transitionOrder(prisma, context, { orderId: order.id, action: "CLOSE", expectedLockVersion: produced.lockVersion, requestId: "order-state-close" });
    expect(closed.status).toBe("CLOSED");
    expect(await prisma.auditEvent.count({ where: { organizationId: context.organizationId, action: "order.status_transitioned", requestId: { startsWith: "order-state-" } } })).toBe(7);
  });
});

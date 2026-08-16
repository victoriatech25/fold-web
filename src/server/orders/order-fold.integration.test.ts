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

  beforeAll(async () => {
    prisma = getPrisma();
    const organization = await prisma.organization.create({ data: { code: "ORDER-FOLD-INTEGRATION", name: "수주 절곡 통합 조직" } });
    const user = await prisma.user.create({ data: { email: "order-fold@example.test", normalizedEmail: "order-fold@example.test", displayName: "절곡 수주 담당자", status: "ACTIVE" } });
    const membership = await prisma.organizationMembership.create({ data: { organizationId: organization.id, userId: user.id } });
    context = {
      sessionId: crypto.randomUUID(), userId: user.id, displayName: user.displayName,
      membershipId: membership.id, departmentId: null, organizationId: organization.id,
      organizationCode: organization.code, organizationName: organization.name,
      roleKeys: ["SALES"], permissions: ["order.read", "order.edit"], expiresAt: new Date("2027-01-01T00:00:00Z"),
    };
    const customer = await prisma.customer.create({ data: { organizationId: organization.id, code: "FOLD-CUSTOMER", name: "절곡 거래처", normalizedName: "절곡거래처", phone: "02-1000-2000", addressLine1: "서울시 테스트로 1" } });
    customerId = customer.id;
    siteId = (await prisma.customerSite.create({ data: { organizationId: organization.id, customerId, code: "SITE", name: "절곡 현장", addressLine1: "경기도 테스트길 2", isDefault: true } })).id;
    contactId = (await prisma.customerContact.create({ data: { organizationId: organization.id, customerId, customerSiteId: siteId, name: "김절곡", mobile: "010-1000-2000", isPrimary: true } })).id;

    const material = await prisma.material.create({ data: { organizationId: organization.id, code: "FOLD-MAT", name: "절곡 재질", normalizedName: "절곡재질", densityKgPerM3: "2700" } });
    const firstVariant = await prisma.materialVariant.create({ data: { organizationId: organization.id, materialId: material.id, code: "FOLD-MAT-1", name: "절곡 1T", thicknessMm: "1", defaultInsideRadiusMm: "1" } });
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
});

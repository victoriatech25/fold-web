import "server-only";

import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { projectCanonicalJsonV1 } from "@/domain/fold-document/canonical";
import { parseServerFoldDocument, type ServerFoldDocumentV3 } from "@/domain/fold-document/schema";
import { requirePermission } from "@/server/authorization/authorization";
import { writeAuditEvent } from "@/server/audit/audit-writer";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { resolvePublishedMaterialRuleSnapshot } from "@/server/fold-document/material-snapshot";
import { prepareFoldRevisionDocument, readFoldRevisionDocument } from "@/server/fold-document/revision-contract";
import { resolveSheetItemSnapshot } from "@/server/fold-document/sheet-item-snapshot";
import { OrderError } from "./order-error";

type Database = PrismaClient | Prisma.TransactionClient;
type Transaction = Prisma.TransactionClient;

export const MAX_ACTIVE_ORDER_FOLD_ITEMS = 1_000;

const foldItemSelect = {
  id: true,
  salesOrderId: true,
  lineNumber: true,
  sortOrder: true,
  sourceFoldTemplateId: true,
  sourceFoldRevisionId: true,
  sourceTemplateCode: true,
  sourceTemplateName: true,
  sourceRevisionNumber: true,
  sourceDocumentChecksumSha256: true,
  name: true,
  quantity: true,
  materialRuleRevisionId: true,
  sheetItemId: true,
  documentSchemaVersion: true,
  document: true,
  documentChecksumSha256: true,
  lockVersion: true,
  removedAt: true,
  updatedAt: true,
} as const satisfies Prisma.SalesOrderFoldItemSelect;

type FoldItemRow = Prisma.SalesOrderFoldItemGetPayload<{ select: typeof foldItemSelect }>;

export type OrderFoldItemDto = ReturnType<typeof toFoldItemDto>;

export type OrderFoldOptionsDto = {
  templates: Array<{
    revisionId: string;
    templateId: string;
    code: string;
    name: string;
    revisionNumber: number;
    documentType: "normal" | "box" | "panel";
    categoryName: string | null;
    materialName: string;
    thicknessMm: string;
    checksumSha256: string;
  }>;
  materials: Array<{
    ruleRevisionId: string;
    label: string;
    materialName: string;
    thicknessMm: string;
    sheets: Array<{ id: string; code: string; name: string; size: string; isDefault: boolean }>;
  }>;
};

export type OrderFoldMutationResult = {
  orderLockVersion: number;
  partySnapshotCapturedAt: string | null;
};

function readItemDocument(row: FoldItemRow): ServerFoldDocumentV3 {
  return readFoldRevisionDocument(row);
}

function toFoldItemDto(row: FoldItemRow) {
  const document = readItemDocument(row);
  const segmentCount = document.blocks.reduce((sum, block) => sum + block.segments.length, 0) +
    document.panelAttachments.reduce((sum, panel) => sum + panel.block.segments.length, 0);
  return {
    id: row.id,
    salesOrderId: row.salesOrderId,
    lineNumber: row.lineNumber,
    sortOrder: row.sortOrder,
    source: {
      templateId: row.sourceFoldTemplateId,
      revisionId: row.sourceFoldRevisionId,
      templateCode: row.sourceTemplateCode,
      templateName: row.sourceTemplateName,
      revisionNumber: row.sourceRevisionNumber,
      checksumSha256: row.sourceDocumentChecksumSha256,
    },
    name: row.name,
    quantity: row.quantity,
    productLengthMm: document.product.lengthMm,
    documentType: document.documentType,
    materialRuleRevisionId: row.materialRuleRevisionId,
    materialName: document.material.name,
    thicknessMm: document.material.thicknessMm,
    sheetItemId: row.sheetItemId,
    sheetName: document.sheetItemSnapshot?.name ?? null,
    variables: document.variables.map((variable) => ({
      name: variable.name,
      valueMm: variable.valueMm,
      editable: variable.expression === undefined,
      expression: variable.expression?.source ?? null,
    })),
    blockCount: document.blocks.length + document.panelAttachments.length,
    segmentCount,
    documentSchemaVersion: row.documentSchemaVersion,
    documentChecksumSha256: row.documentChecksumSha256,
    lockVersion: row.lockVersion,
    removed: row.removedAt !== null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function foldItemAuditSnapshot(row: FoldItemRow) {
  return {
    salesOrderId: row.salesOrderId,
    lineNumber: row.lineNumber,
    sortOrder: row.sortOrder,
    name: row.name,
    quantity: row.quantity,
    materialRuleRevisionId: row.materialRuleRevisionId,
    sheetItemId: row.sheetItemId,
    documentChecksumSha256: row.documentChecksumSha256,
    lockVersion: row.lockVersion,
    removed: row.removedAt !== null,
  };
}

function sourceAuditMetadata(row: FoldItemRow) {
  return {
    sourceFoldTemplateId: row.sourceFoldTemplateId,
    sourceFoldRevisionId: row.sourceFoldRevisionId,
    sourceRevisionNumber: row.sourceRevisionNumber,
    sourceDocumentChecksumSha256: row.sourceDocumentChecksumSha256,
  };
}

async function getOrderForMutation(
  tx: Transaction,
  organizationId: string,
  orderId: string,
  expectedLockVersion: number,
) {
  const order = await tx.salesOrder.findFirst({
    where: { id: orderId, organizationId },
    include: { customer: true, customerSite: true, customerContact: true },
  });
  if (!order) throw new OrderError("NOT_FOUND", "수주를 찾을 수 없습니다.");
  if (order.status !== "DRAFT" && order.status !== "CALCULATED") throw new OrderError("CONFLICT", "승인·생산·마감 또는 취소 상태에서는 절곡 작업을 변경할 수 없습니다.");
  if (order.lockVersion !== expectedLockVersion) {
    throw new OrderError("CONFLICT", "수주가 다른 화면에서 변경되었습니다.", {
      latest: { id: order.id, lockVersion: order.lockVersion, status: order.status },
    });
  }
  return order;
}

async function incrementOrderLock(
  tx: Transaction,
  organizationId: string,
  orderId: string,
  expectedLockVersion: number,
  data: Prisma.SalesOrderUpdateManyMutationInput = {},
  affectsCalculation = true,
): Promise<OrderFoldMutationResult> {
  const updated = await tx.salesOrder.updateMany({
    where: { id: orderId, organizationId, status: { in: ["DRAFT", "CALCULATED"] }, lockVersion: expectedLockVersion },
    data: { ...data, ...(affectsCalculation ? { status: "DRAFT" } : {}), lockVersion: { increment: 1 } },
  });
  if (updated.count !== 1) throw new OrderError("CONFLICT", "수주가 다른 화면에서 변경되었습니다.");
  const order = await tx.salesOrder.findUniqueOrThrow({
    where: { id: orderId },
    select: { lockVersion: true, partySnapshotCapturedAt: true },
  });
  return {
    orderLockVersion: order.lockVersion,
    partySnapshotCapturedAt: order.partySnapshotCapturedAt?.toISOString() ?? null,
  };
}

function buildPartySnapshot(order: Awaited<ReturnType<typeof getOrderForMutation>>) {
  const snapshot = {
    schemaVersion: 1,
    customer: {
      id: order.customer.id,
      code: order.customer.code,
      name: order.customer.name,
      businessRegistrationNumber: order.customer.businessRegistrationNumber,
      representativeName: order.customer.representativeName,
      phone: order.customer.phone,
      email: order.customer.email,
      postalCode: order.customer.postalCode,
      addressLine1: order.customer.addressLine1,
      addressLine2: order.customer.addressLine2,
    },
    site: order.customerSite ? {
      id: order.customerSite.id,
      code: order.customerSite.code,
      name: order.customerSite.name,
      phone: order.customerSite.phone,
      postalCode: order.customerSite.postalCode,
      addressLine1: order.customerSite.addressLine1,
      addressLine2: order.customerSite.addressLine2,
    } : null,
    contact: order.customerContact ? {
      id: order.customerContact.id,
      name: order.customerContact.name,
      department: order.customerContact.department,
      title: order.customerContact.title,
      phone: order.customerContact.phone,
      mobile: order.customerContact.mobile,
      email: order.customerContact.email,
    } : null,
  };
  const canonical = projectCanonicalJsonV1(snapshot);
  return {
    schemaVersion: 1,
    json: JSON.parse(canonical) as Prisma.InputJsonValue,
    checksumSha256: createHash("sha256").update(canonical, "utf8").digest("hex"),
  };
}

async function getActiveItemRow(db: Database, organizationId: string, orderId: string, itemId: string) {
  const row = await db.salesOrderFoldItem.findFirst({
    where: { id: itemId, organizationId, salesOrderId: orderId, removedAt: null },
    select: foldItemSelect,
  });
  if (!row) throw new OrderError("NOT_FOUND", "절곡 작업을 찾을 수 없습니다.");
  return row;
}

function normalizeElongationOption(value: "STANDARD" | "TWO_LINE" | "DIAGONAL" | "EXT1") {
  return ({ STANDARD: "standard", TWO_LINE: "two-line", DIAGONAL: "diagonal", EXT1: "ext1" } as const)[value];
}

export async function listOrderFoldOptions(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: { orderId: string; q?: string },
): Promise<OrderFoldOptionsDto> {
  requirePermission(context, "order.read");
  const order = await prisma.salesOrder.findFirst({ where: { id: input.orderId, organizationId: context.organizationId }, select: { id: true } });
  if (!order) throw new OrderError("NOT_FOUND", "수주를 찾을 수 없습니다.");
  const q = input.q?.trim();
  const [revisions, rules] = await Promise.all([
    prisma.foldRevision.findMany({
      where: {
        organizationId: context.organizationId,
        status: "PUBLISHED",
        deletedAt: null,
        template: {
          organizationId: context.organizationId,
          active: true,
          deletedAt: null,
          ...(q ? { OR: [{ code: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] } : {}),
        },
      },
      orderBy: [{ template: { name: "asc" } }, { revisionNumber: "desc" }],
      take: 50,
      include: { template: { include: { category: true } } },
    }),
    prisma.materialRuleRevision.findMany({
      where: {
        organizationId: context.organizationId,
        status: "PUBLISHED",
        deletedAt: null,
        materialVariant: { organizationId: context.organizationId, active: true, deletedAt: null, material: { active: true, deletedAt: null } },
      },
      orderBy: [{ materialVariant: { material: { sortOrder: "asc" } } }, { materialVariant: { sortOrder: "asc" } }],
      include: {
        materialVariant: {
          include: {
            material: true,
            sheetItems: { where: { active: true, deletedAt: null }, orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { name: "asc" }] },
          },
        },
      },
    }),
  ]);
  return {
    templates: revisions.map((revision) => {
      const document = readFoldRevisionDocument(revision);
      return {
        revisionId: revision.id,
        templateId: revision.templateId,
        code: revision.template.code,
        name: revision.template.name,
        revisionNumber: revision.revisionNumber,
        documentType: document.documentType,
        categoryName: revision.template.category?.name ?? null,
        materialName: document.material.name,
        thicknessMm: document.material.thicknessMm,
        checksumSha256: revision.documentChecksumSha256,
      };
    }),
    materials: rules.map((rule) => ({
      ruleRevisionId: rule.id,
      label: `${rule.materialVariant.material.name} · ${rule.materialVariant.name}`,
      materialName: rule.materialVariant.name,
      thicknessMm: rule.materialVariant.thicknessMm.toString(),
      sheets: rule.materialVariant.sheetItems.map((sheet) => ({
        id: sheet.id,
        code: sheet.code,
        name: sheet.name,
        size: `${sheet.widthMm.toString()} × ${sheet.lengthMm.toString()} mm`,
        isDefault: sheet.isDefault,
      })),
    })),
  };
}

export async function listOrderFoldItems(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  orderId: string,
): Promise<OrderFoldItemDto[]> {
  requirePermission(context, "order.read");
  const exists = await prisma.salesOrder.findFirst({ where: { id: orderId, organizationId: context.organizationId }, select: { id: true } });
  if (!exists) throw new OrderError("NOT_FOUND", "수주를 찾을 수 없습니다.");
  const rows = await prisma.salesOrderFoldItem.findMany({
    where: { organizationId: context.organizationId, salesOrderId: orderId, removedAt: null },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    take: MAX_ACTIVE_ORDER_FOLD_ITEMS,
    select: foldItemSelect,
  });
  return rows.map(toFoldItemDto);
}

export async function addOrderFoldItem(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: { orderId: string; sourceFoldRevisionId: string; quantity?: number; expectedOrderLockVersion: number; requestId: string },
) {
  requirePermission(context, "order.edit");
  return prisma.$transaction(async (tx) => {
    const order = await getOrderForMutation(tx, context.organizationId, input.orderId, input.expectedOrderLockVersion);
    const count = await tx.salesOrderFoldItem.count({ where: { organizationId: context.organizationId, salesOrderId: input.orderId, removedAt: null } });
    if (count >= MAX_ACTIVE_ORDER_FOLD_ITEMS) throw new OrderError("CONFLICT", `한 수주에는 절곡 작업을 최대 ${MAX_ACTIVE_ORDER_FOLD_ITEMS}개까지 추가할 수 있습니다.`);
    const source = await tx.foldRevision.findFirst({
      where: {
        id: input.sourceFoldRevisionId,
        organizationId: context.organizationId,
        status: "PUBLISHED",
        deletedAt: null,
        template: { organizationId: context.organizationId, active: true, deletedAt: null },
      },
      include: { template: true },
    });
    if (!source) throw new OrderError("NOT_FOUND", "추가할 수 있는 게시 절곡 개정을 찾을 수 없습니다.");
    const sourceDocument = readFoldRevisionDocument(source);
    const document = parseServerFoldDocument({
      ...sourceDocument,
      product: { ...sourceDocument.product, quantity: input.quantity ?? sourceDocument.product.quantity },
    });
    const prepared = prepareFoldRevisionDocument(document);
    const party = order.partySnapshotCapturedAt ? null : buildPartySnapshot(order);
    const created = await tx.salesOrderFoldItem.create({
      data: {
        organizationId: context.organizationId,
        salesOrderId: order.id,
        lineNumber: order.nextFoldLineNumber,
        sortOrder: count + 1,
        sourceFoldTemplateId: source.templateId,
        sourceFoldRevisionId: source.id,
        sourceTemplateCode: source.template.code,
        sourceTemplateName: source.template.name,
        sourceRevisionNumber: source.revisionNumber,
        sourceDocumentChecksumSha256: source.documentChecksumSha256,
        name: document.name,
        quantity: document.product.quantity,
        sheetItemId: document.sheetItemSnapshot?.sheetItemId ?? null,
        ...prepared,
        createdByMembershipId: context.membershipId,
        updatedByMembershipId: context.membershipId,
      },
      select: foldItemSelect,
    });
    const orderResult = await incrementOrderLock(tx, context.organizationId, order.id, input.expectedOrderLockVersion, {
      nextFoldLineNumber: { increment: 1 },
      ...(party ? {
        partySnapshotSchemaVersion: party.schemaVersion,
        partySnapshot: party.json,
        partySnapshotChecksumSha256: party.checksumSha256,
        partySnapshotCapturedAt: new Date(),
      } : {}),
    });
    if (party) {
      await writeAuditEvent(tx, {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "order.party_snapshot_captured",
        entityId: order.id,
        requestId: input.requestId,
        after: { schemaVersion: party.schemaVersion, checksumSha256: party.checksumSha256 },
      });
    }
    await writeAuditEvent(tx, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "order.fold_item_added",
      entityId: created.id,
      requestId: input.requestId,
      after: foldItemAuditSnapshot(created),
      metadata: sourceAuditMetadata(created),
    });
    return { ...orderResult, item: toFoldItemDto(created) };
  });
}

export async function updateOrderFoldItem(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: {
    orderId: string;
    itemId: string;
    quantity: number;
    variableValues?: Record<string, string>;
    materialRuleRevisionId?: string;
    sheetItemId?: string | null;
    expectedOrderLockVersion: number;
    expectedItemLockVersion: number;
    requestId: string;
  },
) {
  requirePermission(context, "order.edit");
  return prisma.$transaction(async (tx) => {
    await getOrderForMutation(tx, context.organizationId, input.orderId, input.expectedOrderLockVersion);
    const old = await getActiveItemRow(tx, context.organizationId, input.orderId, input.itemId);
    if (old.lockVersion !== input.expectedItemLockVersion) throw new OrderError("CONFLICT", "절곡 작업이 다른 화면에서 변경되었습니다.", { latest: toFoldItemDto(old) });
    const previous = readItemDocument(old);
    const suppliedVariables = input.variableValues ?? {};
    const knownVariables = new Set(previous.variables.map((variable) => variable.name));
    if (Object.keys(suppliedVariables).some((name) => !knownVariables.has(name))) throw new OrderError("INVALID_REQUEST", "알 수 없는 절곡 변수가 포함되어 있습니다.");
    const variables = previous.variables.map((variable) => {
      const supplied = suppliedVariables[variable.name];
      if (supplied === undefined) return variable;
      if (variable.expression) throw new OrderError("INVALID_REQUEST", `${variable.name} 변수는 수식으로 계산되어 직접 수정할 수 없습니다.`);
      return { ...variable, valueMm: supplied };
    });

    let material = previous.material;
    let calculation = previous.calculation;
    let sheetItemSnapshot = previous.sheetItemSnapshot;
    if (input.materialRuleRevisionId && input.materialRuleRevisionId !== old.materialRuleRevisionId) {
      const rule = await tx.materialRuleRevision.findFirst({
        where: {
          id: input.materialRuleRevisionId,
          organizationId: context.organizationId,
          status: "PUBLISHED",
          deletedAt: null,
          materialVariant: { active: true, deletedAt: null, material: { active: true, deletedAt: null } },
        },
      });
      if (!rule) throw new OrderError("NOT_FOUND", "사용할 수 있는 게시 재질 계산 기준을 찾을 수 없습니다.");
      material = await resolvePublishedMaterialRuleSnapshot(tx, context.organizationId, rule.id);
      calculation = {
        mode: rule.calculationMode.toLowerCase() as "fixed" | "ratio",
        elongationOption: normalizeElongationOption(rule.elongationOption),
        vCutEnabled: rule.vCutEnabled,
        decimalPlaces: rule.decimalPlaces,
        decimalOperation: rule.decimalOperation.toLowerCase() as "none" | "round" | "floor" | "ceil",
      };
      sheetItemSnapshot = undefined;
    }
    const selectedRuleId = input.materialRuleRevisionId ?? old.materialRuleRevisionId;
    if (input.sheetItemId !== undefined) {
      sheetItemSnapshot = input.sheetItemId
        ? await resolveSheetItemSnapshot(tx, context.organizationId, input.sheetItemId, selectedRuleId)
        : undefined;
    }
    const { sheetItemSnapshot: _previousSheetItemSnapshot, ...previousWithoutSheetItem } = previous;
    void _previousSheetItemSnapshot;
    const document = parseServerFoldDocument({
      ...previousWithoutSheetItem,
      product: { ...previous.product, quantity: input.quantity },
      variables,
      material,
      calculation,
      ...(sheetItemSnapshot ? { sheetItemSnapshot } : {}),
    });
    const prepared = prepareFoldRevisionDocument(document);
    const updatedCount = await tx.salesOrderFoldItem.updateMany({
      where: { id: old.id, organizationId: context.organizationId, salesOrderId: input.orderId, removedAt: null, lockVersion: input.expectedItemLockVersion },
      data: {
        quantity: document.product.quantity,
        sheetItemId: document.sheetItemSnapshot?.sheetItemId ?? null,
        ...prepared,
        updatedByMembershipId: context.membershipId,
        lockVersion: { increment: 1 },
      },
    });
    if (updatedCount.count !== 1) throw new OrderError("CONFLICT", "절곡 작업이 다른 화면에서 변경되었습니다.");
    // 문서가 실제로 바뀐 저장만 계산을 무효화한다. 화면도 같은 checksum 비교로 판단하므로
    // 값이 그대로인 저장에서 서버만 DRAFT로 되돌아가 상태가 어긋나는 일이 없다.
    const documentChanged = old.documentChecksumSha256 !== prepared.documentChecksumSha256;
    const orderResult = await incrementOrderLock(tx, context.organizationId, input.orderId, input.expectedOrderLockVersion, {}, documentChanged);
    const updated = await getActiveItemRow(tx, context.organizationId, input.orderId, input.itemId);
    const changedFields = [
      ...(old.quantity !== updated.quantity ? ["quantity"] : []),
      ...(old.materialRuleRevisionId !== updated.materialRuleRevisionId ? ["materialRuleRevisionId"] : []),
      ...(old.sheetItemId !== updated.sheetItemId ? ["sheetItemId"] : []),
      ...(Object.keys(suppliedVariables).length ? ["variables"] : []),
    ];
    await writeAuditEvent(tx, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "order.fold_item_updated",
      entityId: updated.id,
      requestId: input.requestId,
      before: foldItemAuditSnapshot(old),
      after: foldItemAuditSnapshot(updated),
      metadata: { changedFields },
    });
    return { ...orderResult, item: toFoldItemDto(updated) };
  });
}

export async function copyOrderFoldItem(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: { orderId: string; itemId: string; expectedOrderLockVersion: number; requestId: string },
) {
  requirePermission(context, "order.edit");
  return prisma.$transaction(async (tx) => {
    const order = await getOrderForMutation(tx, context.organizationId, input.orderId, input.expectedOrderLockVersion);
    const count = await tx.salesOrderFoldItem.count({ where: { organizationId: context.organizationId, salesOrderId: input.orderId, removedAt: null } });
    if (count >= MAX_ACTIVE_ORDER_FOLD_ITEMS) throw new OrderError("CONFLICT", `한 수주에는 절곡 작업을 최대 ${MAX_ACTIVE_ORDER_FOLD_ITEMS}개까지 추가할 수 있습니다.`);
    const source = await getActiveItemRow(tx, context.organizationId, input.orderId, input.itemId);
    const copied = await tx.salesOrderFoldItem.create({
      data: {
        organizationId: context.organizationId,
        salesOrderId: input.orderId,
        lineNumber: order.nextFoldLineNumber,
        sortOrder: count + 1,
        sourceFoldTemplateId: source.sourceFoldTemplateId,
        sourceFoldRevisionId: source.sourceFoldRevisionId,
        sourceTemplateCode: source.sourceTemplateCode,
        sourceTemplateName: source.sourceTemplateName,
        sourceRevisionNumber: source.sourceRevisionNumber,
        sourceDocumentChecksumSha256: source.sourceDocumentChecksumSha256,
        name: source.name,
        quantity: source.quantity,
        materialRuleRevisionId: source.materialRuleRevisionId,
        sheetItemId: source.sheetItemId,
        documentSchemaVersion: source.documentSchemaVersion,
        document: source.document as Prisma.InputJsonValue,
        documentChecksumSha256: source.documentChecksumSha256,
        createdByMembershipId: context.membershipId,
        updatedByMembershipId: context.membershipId,
      },
      select: foldItemSelect,
    });
    const orderResult = await incrementOrderLock(tx, context.organizationId, input.orderId, input.expectedOrderLockVersion, { nextFoldLineNumber: { increment: 1 } });
    await writeAuditEvent(tx, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "order.fold_item_copied",
      entityId: copied.id,
      requestId: input.requestId,
      after: foldItemAuditSnapshot(copied),
      metadata: { ...sourceAuditMetadata(copied), sourceItemId: source.id },
    });
    return { ...orderResult, item: toFoldItemDto(copied) };
  });
}

export async function removeOrderFoldItem(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: { orderId: string; itemId: string; expectedOrderLockVersion: number; expectedItemLockVersion: number; requestId: string },
) {
  requirePermission(context, "order.edit");
  return prisma.$transaction(async (tx) => {
    await getOrderForMutation(tx, context.organizationId, input.orderId, input.expectedOrderLockVersion);
    const old = await getActiveItemRow(tx, context.organizationId, input.orderId, input.itemId);
    if (old.lockVersion !== input.expectedItemLockVersion) throw new OrderError("CONFLICT", "절곡 작업이 다른 화면에서 변경되었습니다.", { latest: toFoldItemDto(old) });
    const changed = await tx.salesOrderFoldItem.updateMany({
      where: { id: old.id, organizationId: context.organizationId, removedAt: null, lockVersion: input.expectedItemLockVersion },
      data: { removedAt: new Date(), removedByMembershipId: context.membershipId, updatedByMembershipId: context.membershipId, lockVersion: { increment: 1 } },
    });
    if (changed.count !== 1) throw new OrderError("CONFLICT", "절곡 작업이 다른 화면에서 변경되었습니다.");
    const remaining = await tx.salesOrderFoldItem.findMany({
      where: { organizationId: context.organizationId, salesOrderId: input.orderId, removedAt: null },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    for (const [index, item] of remaining.entries()) {
      await tx.salesOrderFoldItem.update({ where: { id: item.id }, data: { sortOrder: index + 1 } });
    }
    const orderResult = await incrementOrderLock(tx, context.organizationId, input.orderId, input.expectedOrderLockVersion);
    const removed = await tx.salesOrderFoldItem.findUniqueOrThrow({ where: { id: old.id }, select: foldItemSelect });
    await writeAuditEvent(tx, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "order.fold_item_removed",
      entityId: removed.id,
      requestId: input.requestId,
      before: foldItemAuditSnapshot(old),
      after: foldItemAuditSnapshot(removed),
    });
    return { ...orderResult, removedItemId: removed.id };
  });
}

export async function reorderOrderFoldItems(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: { orderId: string; itemIds: string[]; expectedOrderLockVersion: number; requestId: string },
) {
  requirePermission(context, "order.edit");
  return prisma.$transaction(async (tx) => {
    await getOrderForMutation(tx, context.organizationId, input.orderId, input.expectedOrderLockVersion);
    const current = await tx.salesOrderFoldItem.findMany({
      where: { organizationId: context.organizationId, salesOrderId: input.orderId, removedAt: null },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (input.itemIds.length !== current.length || new Set(input.itemIds).size !== current.length || current.some((item) => !input.itemIds.includes(item.id))) {
      throw new OrderError("INVALID_REQUEST", "현재 절곡 작업 전체를 중복 없이 순서대로 보내 주세요.");
    }
    for (const [index, id] of input.itemIds.entries()) {
      await tx.salesOrderFoldItem.update({ where: { id }, data: { sortOrder: index + 1 } });
    }
    const orderResult = await incrementOrderLock(tx, context.organizationId, input.orderId, input.expectedOrderLockVersion, {}, false);
    await writeAuditEvent(tx, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "order.fold_items_reordered",
      entityId: input.orderId,
      requestId: input.requestId,
      metadata: { itemCount: input.itemIds.length, orderedItemIds: input.itemIds },
    });
    return orderResult;
  });
}

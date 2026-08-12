import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { calculateFoldPrice, PricingCalculationError, type PriceSourceTrace } from "@/domain/pricing";
import { requirePermission } from "@/server/authorization/authorization";
import { writeAuditEvent } from "@/server/audit/audit-writer";
import type { AuthenticatedContext } from "@/server/auth/auth-types";

import { PricingError } from "./pricing-error";
import {
  calculatePriceRevisionChecksum,
  normalizePriceCode,
  normalizePriceRevisionFields,
  normalizePriceText,
  parsePriceEffectiveAt,
} from "./pricing-policy";
import type {
  FoldPricePreviewDto,
  ManualFoldPriceInput,
  PriceBookSummaryDto,
  PriceBookWorkspaceDto,
  PriceRevisionDto,
  PriceRevisionFields,
  PriceRevisionTransitionAction,
  PriceTierDto,
  PricingMaterialDto,
  PricingWorkspaceDto,
} from "./pricing-types";

type Database = PrismaClient | Prisma.TransactionClient;
type Transaction = Prisma.TransactionClient;

const revisionInclude = {
  foldRates: { orderBy: { materialVariantId: "asc" as const } },
  sheetRates: { orderBy: { sheetItemId: "asc" as const } },
  surchargePolicy: true,
} as const satisfies Prisma.PriceBookRevisionInclude;

type RevisionRow = Prisma.PriceBookRevisionGetPayload<{ include: typeof revisionInclude }>;

const bookInclude = {
  priceTier: { select: { id: true, code: true, name: true } },
  customer: { select: { id: true, code: true, name: true } },
  revisions: {
    where: { deletedAt: null },
    orderBy: { revisionNumber: "desc" as const },
    include: revisionInclude,
  },
} as const satisfies Prisma.PriceBookInclude;

type BookRow = Prisma.PriceBookGetPayload<{ include: typeof bookInclude }>;

function effectiveStatus(row: Pick<RevisionRow, "status" | "effectiveFrom" | "effectiveTo">, now: Date): PriceRevisionDto["effectiveStatus"] {
  if (row.status === "DRAFT" || row.status === "REVIEW" || row.status === "RETIRED") return row.status;
  if (row.effectiveFrom && row.effectiveFrom > now) return "SCHEDULED";
  if (row.effectiveTo && row.effectiveTo <= now) return "EXPIRED";
  return "ACTIVE";
}

function rowFields(row: RevisionRow): PriceRevisionFields {
  return {
    changeSummary: row.changeSummary,
    foldRates: row.foldRates.map((rate) => ({
      materialVariantId: rate.materialVariantId,
      materialRatePerM2Krw: rate.materialRatePerM2Krw.toString(),
      bendRatePerOperationKrw: rate.bendRatePerOperationKrw.toString(),
      vCutRatePerMeterKrw: rate.vCutRatePerMeterKrw.toString(),
    })),
    sheetRates: row.sheetRates.map((rate) => ({
      sheetItemId: rate.sheetItemId,
      materialPricePerSheetKrw: rate.materialPricePerSheetKrw.toString(),
      processingPricePerSheetKrw: rate.processingPricePerSheetKrw?.toString() ?? null,
    })),
    surchargePolicy: row.surchargePolicy ? {
      minimumBendOperations: row.surchargePolicy.minimumBendOperations,
      ratePercent: row.surchargePolicy.ratePercent.toString(),
      baseType: "PROCESSING_ONLY",
    } : null,
  };
}

function toRevisionDto(row: RevisionRow, now = new Date()): PriceRevisionDto {
  return {
    id: row.id,
    revisionNumber: row.revisionNumber,
    status: row.status,
    effectiveStatus: effectiveStatus(row, now),
    currency: "KRW",
    taxIncluded: false,
    ...rowFields(row),
    contentChecksumSha256: row.contentChecksumSha256,
    effectiveFrom: row.effectiveFrom?.toISOString() ?? null,
    effectiveTo: row.effectiveTo?.toISOString() ?? null,
    lockVersion: row.lockVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
  };
}

function toBookSummary(row: BookRow, now = new Date()): PriceBookSummaryDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    scopeType: row.scopeType,
    priceTier: row.priceTier,
    customer: row.customer,
    active: row.active,
    lockVersion: row.lockVersion,
    currentRevisionId: row.revisions.find((revision) => effectiveStatus(revision, now) === "ACTIVE")?.id ?? null,
    scheduledRevisionId: row.revisions.find((revision) => effectiveStatus(revision, now) === "SCHEDULED")?.id ?? null,
    openRevisionId: row.revisions.find((revision) => revision.status === "DRAFT" || revision.status === "REVIEW")?.id ?? null,
    revisionCount: row.revisions.length,
  };
}

function toTier(row: { id: string; code: string; name: string; description: string | null; isDefault: boolean; active: boolean; sortOrder: number; lockVersion: number; _count: { customers: number } }): PriceTierDto {
  return { ...row, customerCount: row._count.customers };
}

async function pricingMaterials(database: Database, organizationId: string): Promise<PricingMaterialDto[]> {
  const rows = await database.material.findMany({
    where: { organizationId, active: true, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true, code: true, name: true,
      variants: {
        where: { active: true, deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { thicknessMm: "asc" }],
        select: {
          id: true, code: true, name: true, thicknessMm: true,
          sheetItems: { where: { active: true, deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, code: true, name: true, widthMm: true, lengthMm: true } },
        },
      },
    },
  });
  return rows.map((material) => ({
    ...material,
    variants: material.variants.map((variant) => ({
      ...variant,
      thicknessMm: variant.thicknessMm.toString(),
      sheetItems: variant.sheetItems.map((sheet) => ({ ...sheet, widthMm: sheet.widthMm.toString(), lengthMm: sheet.lengthMm.toString() })),
    })),
  }));
}

async function findBook(database: Database, organizationId: string, bookId: string): Promise<BookRow> {
  const book = await database.priceBook.findFirst({ where: { id: bookId, organizationId, deletedAt: null }, include: bookInclude });
  if (!book) throw new PricingError("NOT_FOUND", "가격표를 찾을 수 없습니다.");
  return book;
}

async function findRevision(database: Database, organizationId: string, bookId: string, revisionId: string): Promise<RevisionRow> {
  const revision = await database.priceBookRevision.findFirst({ where: { id: revisionId, priceBookId: bookId, organizationId, deletedAt: null }, include: revisionInclude });
  if (!revision) throw new PricingError("NOT_FOUND", "가격표 개정을 찾을 수 없습니다.");
  return revision;
}

async function lockBook(tx: Transaction, organizationId: string, bookId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "PriceBook" WHERE "id"=${bookId}::uuid AND "organizationId"=${organizationId}::uuid AND "deletedAt" IS NULL FOR UPDATE`;
  if (!rows.length) throw new PricingError("NOT_FOUND", "가격표를 찾을 수 없습니다.");
}

async function lockRevision(tx: Transaction, organizationId: string, revisionId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "PriceBookRevision" WHERE "id"=${revisionId}::uuid AND "organizationId"=${organizationId}::uuid AND "deletedAt" IS NULL FOR UPDATE`;
  if (!rows.length) throw new PricingError("NOT_FOUND", "가격표 개정을 찾을 수 없습니다.");
}

function isPrismaCode(error: unknown, code: string) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function rethrowConstraint(error: unknown): never {
  if (error instanceof PricingError) throw error;
  if (isPrismaCode(error, "P2002") || isPrismaCode(error, "P2003")) throw new PricingError("PRICE_SCOPE_CONFLICT", "같은 범위의 가격 기준이 이미 있거나 참조 대상이 올바르지 않습니다.");
  throw error;
}

export async function getPricingWorkspace(prisma: PrismaClient, context: AuthenticatedContext): Promise<PricingWorkspaceDto> {
  requirePermission(context, "pricing.read");
  const [tiers, books, customers, materials] = await Promise.all([
    prisma.priceTier.findMany({ where: { organizationId: context.organizationId, deletedAt: null }, orderBy: [{ active: "desc" }, { isDefault: "desc" }, { sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { customers: true } } } }),
    prisma.priceBook.findMany({ where: { organizationId: context.organizationId, deletedAt: null }, orderBy: [{ active: "desc" }, { scopeType: "asc" }, { name: "asc" }], include: bookInclude }),
    prisma.customer.findMany({ where: { organizationId: context.organizationId, type: { in: ["SALES", "TEMPORARY"] }, active: true, deletedAt: null }, orderBy: [{ name: "asc" }, { code: "asc" }], select: { id: true, code: true, name: true, priceTierId: true, lockVersion: true } }),
    pricingMaterials(prisma, context.organizationId),
  ]);
  return { tiers: tiers.map(toTier), books: books.map((book) => toBookSummary(book)), customers, materials };
}

export async function getPriceBookWorkspace(prisma: PrismaClient, context: AuthenticatedContext, bookId: string): Promise<PriceBookWorkspaceDto> {
  requirePermission(context, "pricing.read");
  const [book, materials] = await Promise.all([findBook(prisma, context.organizationId, bookId), pricingMaterials(prisma, context.organizationId)]);
  return { book: toBookSummary(book), revisions: book.revisions.map((revision) => toRevisionDto(revision)), materials };
}

export async function createPriceTier(prisma: PrismaClient, context: AuthenticatedContext, input: { code: string; name: string; description?: string | null; sortOrder?: number; requestId: string }) {
  requirePermission(context, "pricing.write");
  const code = normalizePriceCode(input.code);
  const name = normalizePriceText(input.name, "가격등급명", 100, true)!;
  const description = normalizePriceText(input.description, "설명", 500);
  const sortOrder = input.sortOrder ?? 0;
  if (!Number.isInteger(sortOrder) || sortOrder < -9999 || sortOrder > 9999) throw new PricingError("INVALID_REQUEST", "정렬 순서를 확인해 주세요.");
  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.priceTier.create({ data: { organizationId: context.organizationId, code, name, description, sortOrder }, include: { _count: { select: { customers: true } } } });
      await writeAuditEvent(tx, { organizationId: context.organizationId, actorUserId: context.userId, action: "pricing.tier_changed", entityId: created.id, requestId: input.requestId, after: { code, name, active: true, isDefault: false, lockVersion: 1 } });
      return toTier(created);
    });
  } catch (error) { rethrowConstraint(error); }
}

export async function updatePriceTier(prisma: PrismaClient, context: AuthenticatedContext, input: { tierId: string; name: string; description?: string | null; sortOrder?: number; expectedLockVersion: number; requestId: string }) {
  requirePermission(context, "pricing.write");
  const name = normalizePriceText(input.name, "가격등급명", 100, true)!;
  const description = normalizePriceText(input.description, "설명", 500);
  const updated = await prisma.priceTier.updateMany({ where: { id: input.tierId, organizationId: context.organizationId, deletedAt: null, lockVersion: input.expectedLockVersion }, data: { name, description, sortOrder: input.sortOrder ?? 0, lockVersion: { increment: 1 } } });
  if (!updated.count) throw new PricingError("CONFLICT", "가격등급이 다른 화면에서 변경됐거나 존재하지 않습니다.");
  const row = await prisma.priceTier.findUniqueOrThrow({ where: { id: input.tierId }, include: { _count: { select: { customers: true } } } });
  await writeAuditEvent(prisma, { organizationId: context.organizationId, actorUserId: context.userId, action: "pricing.tier_changed", entityId: row.id, requestId: input.requestId, before: { lockVersion: input.expectedLockVersion }, after: { code: row.code, name: row.name, active: row.active, isDefault: row.isDefault, lockVersion: row.lockVersion } });
  return toTier(row);
}

export async function transitionPriceTier(prisma: PrismaClient, context: AuthenticatedContext, input: { tierId: string; action: "set_default" | "deactivate" | "reactivate"; expectedLockVersion: number; requestId: string }) {
  requirePermission(context, "pricing.write");
  return prisma.$transaction(async (tx) => {
    const current = await tx.priceTier.findFirst({ where: { id: input.tierId, organizationId: context.organizationId, deletedAt: null }, include: { _count: { select: { customers: true } } } });
    if (!current) throw new PricingError("NOT_FOUND", "가격등급을 찾을 수 없습니다.");
    if (current.lockVersion !== input.expectedLockVersion) throw new PricingError("CONFLICT", "가격등급이 다른 화면에서 변경되었습니다.");
    if (input.action === "deactivate" && current._count.customers > 0) throw new PricingError("CONFLICT", "거래처가 배정된 가격등급은 비활성화할 수 없습니다.");
    if (input.action === "set_default") {
      if (!current.active) throw new PricingError("CONFLICT", "비활성 가격등급은 기본으로 지정할 수 없습니다.");
      await tx.priceTier.updateMany({ where: { organizationId: context.organizationId, isDefault: true, id: { not: current.id }, deletedAt: null }, data: { isDefault: false, lockVersion: { increment: 1 } } });
    }
    const row = await tx.priceTier.update({ where: { id: current.id }, data: {
      ...(input.action === "set_default" ? { isDefault: true } : {}),
      ...(input.action === "deactivate" ? { active: false, isDefault: false } : {}),
      ...(input.action === "reactivate" ? { active: true } : {}),
      lockVersion: { increment: 1 },
    }, include: { _count: { select: { customers: true } } } });
    await writeAuditEvent(tx, { organizationId: context.organizationId, actorUserId: context.userId, action: "pricing.tier_changed", entityId: row.id, requestId: input.requestId, before: { active: current.active, isDefault: current.isDefault, lockVersion: current.lockVersion }, after: { code: row.code, name: row.name, active: row.active, isDefault: row.isDefault, lockVersion: row.lockVersion }, metadata: { reason: input.action } });
    return toTier(row);
  });
}

export async function assignCustomerPriceTier(prisma: PrismaClient, context: AuthenticatedContext, input: { customerId: string; priceTierId: string | null; expectedLockVersion: number; requestId: string }) {
  requirePermission(context, "pricing.write");
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({ where: { id: input.customerId, organizationId: context.organizationId, deletedAt: null }, select: { id: true, priceTierId: true, lockVersion: true } });
    if (!customer) throw new PricingError("NOT_FOUND", "거래처를 찾을 수 없습니다.");
    if (customer.lockVersion !== input.expectedLockVersion) throw new PricingError("CONFLICT", "거래처가 다른 화면에서 변경되었습니다.");
    if (input.priceTierId) {
      const tier = await tx.priceTier.findFirst({ where: { id: input.priceTierId, organizationId: context.organizationId, active: true, deletedAt: null }, select: { id: true } });
      if (!tier) throw new PricingError("NOT_FOUND", "활성 가격등급을 찾을 수 없습니다.");
    }
    const updated = await tx.customer.update({ where: { id: customer.id }, data: { priceTierId: input.priceTierId, lockVersion: { increment: 1 } }, select: { id: true, code: true, name: true, priceTierId: true, lockVersion: true } });
    await writeAuditEvent(tx, { organizationId: context.organizationId, actorUserId: context.userId, action: "pricing.customer_tier_assigned", entityId: customer.id, requestId: input.requestId, before: { priceTierId: customer.priceTierId, lockVersion: customer.lockVersion }, after: { priceTierId: updated.priceTierId, lockVersion: updated.lockVersion } });
    return updated;
  });
}

export async function createPriceBook(prisma: PrismaClient, context: AuthenticatedContext, input: { code: string; name: string; scopeType: "STANDARD" | "TIER" | "CUSTOMER"; priceTierId?: string | null; customerId?: string | null; requestId: string }) {
  requirePermission(context, "pricing.write");
  const code = normalizePriceCode(input.code);
  const name = normalizePriceText(input.name, "가격표명", 150, true)!;
  const targetValid = input.scopeType === "STANDARD" ? !input.priceTierId && !input.customerId
    : input.scopeType === "TIER" ? Boolean(input.priceTierId) && !input.customerId
      : Boolean(input.customerId) && !input.priceTierId;
  if (!targetValid) throw new PricingError("INVALID_REQUEST", "가격표 범위와 대상을 확인해 주세요.");
  if (input.priceTierId && !(await prisma.priceTier.findFirst({ where: { id: input.priceTierId, organizationId: context.organizationId, active: true, deletedAt: null }, select: { id: true } }))) throw new PricingError("NOT_FOUND", "가격등급을 찾을 수 없습니다.");
  if (input.customerId && !(await prisma.customer.findFirst({ where: { id: input.customerId, organizationId: context.organizationId, active: true, deletedAt: null }, select: { id: true } }))) throw new PricingError("NOT_FOUND", "거래처를 찾을 수 없습니다.");
  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.priceBook.create({ data: { organizationId: context.organizationId, code, name, scopeType: input.scopeType, priceTierId: input.priceTierId ?? null, customerId: input.customerId ?? null }, include: bookInclude });
      await writeAuditEvent(tx, { organizationId: context.organizationId, actorUserId: context.userId, action: "pricing.book_changed", entityId: created.id, requestId: input.requestId, after: { code, name, active: true, lockVersion: 1 }, metadata: { scopeType: input.scopeType } });
      return toBookSummary(created);
    });
  } catch (error) { rethrowConstraint(error); }
}

async function validateRateTargets(database: Database, organizationId: string, fields: PriceRevisionFields) {
  const variantIds = fields.foldRates.map((rate) => rate.materialVariantId);
  const sheetIds = fields.sheetRates.map((rate) => rate.sheetItemId);
  const [variantCount, sheetCount] = await Promise.all([
    variantIds.length ? database.materialVariant.count({ where: { id: { in: variantIds }, organizationId, deletedAt: null } }) : 0,
    sheetIds.length ? database.sheetItem.count({ where: { id: { in: sheetIds }, organizationId, deletedAt: null } }) : 0,
  ]);
  if (variantCount !== variantIds.length || sheetCount !== sheetIds.length) throw new PricingError("NOT_FOUND", "가격 대상 재질·두께 또는 원판을 찾을 수 없습니다.");
}

async function writeRevisionChildren(tx: Transaction, organizationId: string, revisionId: string, fields: PriceRevisionFields) {
  if (fields.foldRates.length) await tx.foldPriceRate.createMany({ data: fields.foldRates.map((rate) => ({ organizationId, priceBookRevisionId: revisionId, ...rate })) });
  if (fields.sheetRates.length) await tx.sheetPriceRate.createMany({ data: fields.sheetRates.map((rate) => ({ organizationId, priceBookRevisionId: revisionId, ...rate })) });
  if (fields.surchargePolicy) await tx.surchargePolicy.create({ data: { organizationId, priceBookRevisionId: revisionId, ...fields.surchargePolicy } });
}

export async function createPriceRevision(prisma: PrismaClient, context: AuthenticatedContext, input: { bookId: string; sourceRevisionId?: string | null; requestId: string }) {
  requirePermission(context, "pricing.write");
  try {
    return await prisma.$transaction(async (tx) => {
      await lockBook(tx, context.organizationId, input.bookId);
      const book = await findBook(tx, context.organizationId, input.bookId);
      if (!book.active) throw new PricingError("CONFLICT", "비활성 가격표에는 새 개정을 만들 수 없습니다.");
      if (book.revisions.some((revision) => revision.status === "DRAFT" || revision.status === "REVIEW")) throw new PricingError("CONFLICT", "이미 작성 또는 검토 중인 가격표 개정이 있습니다.");
      const source = input.sourceRevisionId ? await findRevision(tx, context.organizationId, input.bookId, input.sourceRevisionId) : null;
      const fields = normalizePriceRevisionFields(source ? rowFields(source) : { changeSummary: null, foldRates: [], sheetRates: [], surchargePolicy: null });
      await validateRateTargets(tx, context.organizationId, fields);
      const checksum = calculatePriceRevisionChecksum(fields);
      const latest = await tx.priceBookRevision.aggregate({ where: { priceBookId: input.bookId }, _max: { revisionNumber: true } });
      const revision = await tx.priceBookRevision.create({ data: { organizationId: context.organizationId, priceBookId: input.bookId, revisionNumber: (latest._max.revisionNumber ?? 0) + 1, changeSummary: fields.changeSummary, contentChecksumSha256: checksum, createdByUserId: context.userId, updatedByUserId: context.userId, statusChangedByUserId: context.userId } });
      await writeRevisionChildren(tx, context.organizationId, revision.id, fields);
      const created = await findRevision(tx, context.organizationId, input.bookId, revision.id);
      await writeAuditEvent(tx, { organizationId: context.organizationId, actorUserId: context.userId, action: "pricing.revision_created", entityId: revision.id, requestId: input.requestId, after: { revisionNumber: revision.revisionNumber, status: revision.status, lockVersion: revision.lockVersion }, metadata: { checksumSha256: checksum, sourceRevisionId: input.sourceRevisionId ?? null, foldRateCount: fields.foldRates.length, sheetRateCount: fields.sheetRates.length } });
      return toRevisionDto(created);
    });
  } catch (error) { rethrowConstraint(error); }
}

export async function updatePriceRevision(prisma: PrismaClient, context: AuthenticatedContext, input: PriceRevisionFields & { bookId: string; revisionId: string; expectedLockVersion: number; requestId: string }) {
  requirePermission(context, "pricing.write");
  const fields = normalizePriceRevisionFields(input);
  const checksum = calculatePriceRevisionChecksum(fields);
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, context.organizationId, input.bookId);
    await lockRevision(tx, context.organizationId, input.revisionId);
    const current = await findRevision(tx, context.organizationId, input.bookId, input.revisionId);
    if (current.status !== "DRAFT") throw new PricingError("PRICE_REVISION_LOCKED", "초안 가격표만 수정할 수 있습니다.");
    if (current.lockVersion !== input.expectedLockVersion) throw new PricingError("CONFLICT", "가격표가 다른 화면에서 변경되었습니다.");
    await validateRateTargets(tx, context.organizationId, fields);
    await Promise.all([
      tx.foldPriceRate.deleteMany({ where: { priceBookRevisionId: current.id } }),
      tx.sheetPriceRate.deleteMany({ where: { priceBookRevisionId: current.id } }),
      tx.surchargePolicy.deleteMany({ where: { priceBookRevisionId: current.id } }),
    ]);
    await writeRevisionChildren(tx, context.organizationId, current.id, fields);
    await tx.priceBookRevision.update({ where: { id: current.id }, data: { changeSummary: fields.changeSummary, contentChecksumSha256: checksum, lockVersion: { increment: 1 }, updatedByUserId: context.userId } });
    const updated = await findRevision(tx, context.organizationId, input.bookId, current.id);
    await writeAuditEvent(tx, { organizationId: context.organizationId, actorUserId: context.userId, action: "pricing.revision_updated", entityId: current.id, requestId: input.requestId, before: { status: current.status, lockVersion: current.lockVersion, checksumSha256: current.contentChecksumSha256 }, after: { status: updated.status, lockVersion: updated.lockVersion, checksumSha256: checksum }, metadata: { revisionNumber: current.revisionNumber, foldRateCount: fields.foldRates.length, sheetRateCount: fields.sheetRates.length } });
    return toRevisionDto(updated);
  });
}

const transitionAudit = {
  review: "pricing.revision_review_requested",
  return: "pricing.revision_returned",
  publish: "pricing.revision_published",
  retire: "pricing.revision_retired",
  discard: "pricing.revision_discarded",
} as const;

export async function transitionPriceRevision(prisma: PrismaClient, context: AuthenticatedContext, input: { bookId: string; revisionId: string; action: PriceRevisionTransitionAction; expectedLockVersion: number; effectiveFrom?: string | null; reason?: string | null; requestId: string }) {
  requirePermission(context, input.action === "review" || input.action === "discard" ? "pricing.write" : "pricing.approve");
  const reason = normalizePriceText(input.reason, "처리 사유", 500);
  if ((input.action === "return" || input.action === "retire") && !reason) throw new PricingError("INVALID_REQUEST", "처리 사유를 입력해 주세요.");
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, context.organizationId, input.bookId);
    await lockRevision(tx, context.organizationId, input.revisionId);
    const current = await findRevision(tx, context.organizationId, input.bookId, input.revisionId);
    if (current.lockVersion !== input.expectedLockVersion) throw new PricingError("CONFLICT", "가격표 상태가 다른 화면에서 변경되었습니다.");
    const now = new Date();
    let nextStatus = current.status;
    let effectiveFrom = current.effectiveFrom;
    let effectiveTo = current.effectiveTo;
    if (input.action === "review") {
      if (current.status !== "DRAFT") throw new PricingError("CONFLICT", "초안만 검토 요청할 수 있습니다.");
      if (!current.changeSummary) throw new PricingError("INVALID_REQUEST", "검토 요청 전에 변경 요약을 입력해 주세요.");
      if (!current.foldRates.length && !current.sheetRates.length) throw new PricingError("PRICE_NOT_CONFIGURED", "가격 행을 한 건 이상 입력해 주세요.");
      effectiveFrom = parsePriceEffectiveAt(input.effectiveFrom, "효력 시작 시각");
      nextStatus = "REVIEW";
    } else if (input.action === "return") {
      if (current.status !== "REVIEW") throw new PricingError("CONFLICT", "검토 중인 가격표만 수정 반려할 수 있습니다.");
      nextStatus = "DRAFT";
    } else if (input.action === "publish") {
      if (current.status !== "REVIEW" || !current.effectiveFrom) throw new PricingError("CONFLICT", "검토 중이며 효력 시작이 정해진 가격표만 게시할 수 있습니다.");
      const checksum = calculatePriceRevisionChecksum(rowFields(current));
      if (checksum !== current.contentChecksumSha256) throw new PricingError("CONFLICT", "검토 중 가격표 내용이 변경되었습니다.");
      const overlaps = await tx.priceBookRevision.findMany({ where: { priceBookId: input.bookId, organizationId: context.organizationId, id: { not: current.id }, status: "PUBLISHED", deletedAt: null, OR: [{ effectiveTo: null }, { effectiveTo: { gt: current.effectiveFrom } }] }, orderBy: { revisionNumber: "desc" }, select: { id: true, effectiveFrom: true } });
      const future = overlaps.filter((row) => row.effectiveFrom && row.effectiveFrom >= current.effectiveFrom!);
      const predecessors = overlaps.filter((row) => !row.effectiveFrom || row.effectiveFrom < current.effectiveFrom!);
      if (future.length || predecessors.length > 1) throw new PricingError("PRICE_SCOPE_CONFLICT", "가격표 게시 유효기간이 기존 또는 예약 개정과 겹칩니다.");
      if (predecessors[0]) await tx.priceBookRevision.update({ where: { id: predecessors[0].id }, data: { effectiveTo: current.effectiveFrom, lockVersion: { increment: 1 }, updatedByUserId: context.userId } });
      nextStatus = "PUBLISHED";
      effectiveTo = null;
    } else if (input.action === "retire") {
      if (current.status !== "PUBLISHED") throw new PricingError("CONFLICT", "게시된 가격표만 사용 종료할 수 있습니다.");
      if (current.effectiveFrom && current.effectiveFrom > now) {
        const predecessor = await tx.priceBookRevision.findFirst({ where: { priceBookId: input.bookId, status: "PUBLISHED", effectiveTo: current.effectiveFrom, deletedAt: null }, select: { id: true } });
        if (predecessor) await tx.priceBookRevision.update({ where: { id: predecessor.id }, data: { effectiveTo: null, lockVersion: { increment: 1 } } });
      } else effectiveTo = now;
      nextStatus = "RETIRED";
    } else {
      if (current.status !== "DRAFT") throw new PricingError("CONFLICT", "초안만 폐기할 수 있습니다.");
    }
    const checksum = current.contentChecksumSha256 ?? calculatePriceRevisionChecksum(rowFields(current));
    await tx.priceBookRevision.update({ where: { id: current.id }, data: input.action === "discard"
      ? { deletedAt: now, deletedByUserId: context.userId, lockVersion: { increment: 1 }, updatedByUserId: context.userId, statusChangedAt: now, statusChangedByUserId: context.userId }
      : { status: nextStatus, effectiveFrom, effectiveTo, contentChecksumSha256: checksum, lockVersion: { increment: 1 }, updatedByUserId: context.userId, statusChangedAt: now, statusChangedByUserId: context.userId, ...(input.action === "publish" ? { publishedAt: now, publishedByUserId: context.userId } : {}) } });
    const updated = input.action === "discard" ? null : await findRevision(tx, context.organizationId, input.bookId, current.id);
    await writeAuditEvent(tx, { organizationId: context.organizationId, actorUserId: context.userId, action: transitionAudit[input.action], entityId: current.id, requestId: input.requestId, before: { status: current.status, lockVersion: current.lockVersion }, after: { status: input.action === "discard" ? "DISCARDED" : nextStatus, lockVersion: current.lockVersion + 1 }, metadata: { revisionNumber: current.revisionNumber, checksumSha256: checksum, reason, effectiveFrom: effectiveFrom?.toISOString() ?? null } });
    return updated ? toRevisionDto(updated, now) : null;
  });
}

async function effectiveRevision(database: Database, organizationId: string, bookId: string, effectiveAt: Date) {
  return database.priceBookRevision.findFirst({
    where: { organizationId, priceBookId: bookId, status: "PUBLISHED", deletedAt: null, OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: effectiveAt } }], AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveAt } }] }] },
    orderBy: { revisionNumber: "desc" },
    include: revisionInclude,
  });
}

async function priceResolutionChain(database: Database, organizationId: string, customerId: string, effectiveAt: Date) {
  const customer = await database.customer.findFirst({ where: { id: customerId, organizationId, active: true, deletedAt: null }, select: { id: true, code: true, name: true, priceTierId: true } });
  if (!customer) throw new PricingError("NOT_FOUND", "활성 거래처를 찾을 수 없습니다.");
  const defaultTier = customer.priceTierId ? null : await database.priceTier.findFirst({ where: { organizationId, isDefault: true, active: true, deletedAt: null }, select: { id: true } });
  const tierId = customer.priceTierId ?? defaultTier?.id ?? null;
  const candidates = await database.priceBook.findMany({ where: { organizationId, active: true, deletedAt: null, OR: [
    { scopeType: "CUSTOMER", customerId: customer.id },
    ...(tierId ? [{ scopeType: "TIER" as const, priceTierId: tierId }] : []),
    { scopeType: "STANDARD" },
  ] }, select: { id: true, scopeType: true } });
  const ordered = ["CUSTOMER", "TIER", "STANDARD"].flatMap((scope) => candidates.filter((book) => book.scopeType === scope));
  const chain: Array<{ book: typeof ordered[number]; revision: RevisionRow }> = [];
  for (const book of ordered) {
    const revision = await effectiveRevision(database, organizationId, book.id, effectiveAt);
    if (revision) chain.push({ book, revision });
  }
  return { customer, chain };
}

function traceOf(scopeType: PriceSourceTrace["scopeType"], bookId: string, revision: RevisionRow, rateId: string | null, effectiveAt: Date): PriceSourceTrace {
  return { scopeType, priceBookId: bookId, revisionId: revision.id, rateId, contentChecksumSha256: revision.contentChecksumSha256, effectiveAt: effectiveAt.toISOString() };
}

export async function calculateManualFoldPrice(prisma: PrismaClient, context: AuthenticatedContext, input: ManualFoldPriceInput): Promise<FoldPricePreviewDto> {
  requirePermission(context, "pricing.read");
  const effectiveAt = parsePriceEffectiveAt(input.effectiveAt);
  const variant = await prisma.materialVariant.findFirst({ where: { id: input.materialVariantId, organizationId: context.organizationId, active: true, deletedAt: null }, select: { id: true, code: true, name: true } });
  if (!variant) throw new PricingError("NOT_FOUND", "활성 재질·두께를 찾을 수 없습니다.");
  const { customer, chain } = await priceResolutionChain(prisma, context.organizationId, input.customerId, effectiveAt);
  if (!chain.length) throw new PricingError("PRICE_REVISION_NOT_EFFECTIVE", "계산 시점에 유효한 게시 가격표가 없습니다.");
  let foldRate: { row: RevisionRow["foldRates"][number]; source: typeof chain[number] } | null = null;
  let surcharge: { row: NonNullable<RevisionRow["surchargePolicy"]>; source: typeof chain[number] } | null = null;
  for (const source of chain) {
    const rate = source.revision.foldRates.find((row) => row.materialVariantId === input.materialVariantId);
    if (!foldRate && rate) foldRate = { row: rate, source };
    if (!surcharge && source.revision.surchargePolicy) surcharge = { row: source.revision.surchargePolicy, source };
  }
  if (!foldRate) throw new PricingError("PRICE_NOT_CONFIGURED", "선택한 거래처와 재질·두께에 적용할 가격 행이 없습니다.");
  try {
    const result = calculateFoldPrice({
      metrics: input.metrics,
      rate: { materialRatePerM2Krw: foldRate.row.materialRatePerM2Krw.toString(), bendRatePerOperationKrw: foldRate.row.bendRatePerOperationKrw.toString(), vCutRatePerMeterKrw: foldRate.row.vCutRatePerMeterKrw.toString() },
      surchargePolicy: surcharge ? { minimumBendOperations: surcharge.row.minimumBendOperations, ratePercent: surcharge.row.ratePercent.toString(), baseType: "PROCESSING_ONLY" } : null,
      trace: {
        foldRate: traceOf(foldRate.source.book.scopeType, foldRate.source.book.id, foldRate.source.revision, foldRate.row.id, effectiveAt),
        surcharge: surcharge ? traceOf(surcharge.source.book.scopeType, surcharge.source.book.id, surcharge.source.revision, surcharge.row.id, effectiveAt) : null,
      },
    });
    return { ...result, customer, materialVariant: variant, preview: true, notForOrder: true };
  } catch (error) {
    if (error instanceof PricingCalculationError) throw new PricingError(error.code === "PRICE_INPUT_INVALID" ? "PRICE_INPUT_INVALID" : "PRICE_INPUT_INVALID", error.message);
    throw error;
  }
}

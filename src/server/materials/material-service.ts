import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { requirePermission } from "@/server/authorization/authorization";
import { writeAuditEvent } from "@/server/audit/audit-writer";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { MaterialError } from "./material-error";
import {
  decodeMaterialCursor,
  encodeMaterialCursor,
  isValidMaterialCode,
  normalizeMaterialCode,
  normalizeMaterialName,
  normalizeNonNegativeDecimal,
  normalizeOptionalText,
  normalizePositiveDecimal,
} from "./material-policy";
import type { MaterialDetailDto, MaterialFields, MaterialListDto, MaterialSummaryDto, MaterialVariantDto, MaterialVariantFields } from "./material-types";

type Database = PrismaClient | Prisma.TransactionClient;
type Transaction = Prisma.TransactionClient;

const currentRuleSelect = {
  id: true,
  revisionNumber: true,
  effectiveFrom: true,
  effectiveTo: true,
  insideBendRadiusMm: true,
} as const;

function currentRuleWhere(now: Date): Prisma.MaterialRuleRevisionWhereInput {
  return {
    status: "PUBLISHED",
    OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }],
    AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }],
  };
}

function detailSelect(now: Date) {
  return {
    id: true, code: true, name: true, normalizedName: true, densityKgPerM3: true,
    sortOrder: true, memo: true, active: true, lockVersion: true, updatedAt: true,
    variants: {
      where: { deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { thicknessMm: "asc" }, { name: "asc" }, { id: "asc" }],
      select: {
        id: true, code: true, name: true, thicknessMm: true, defaultInsideRadiusMm: true,
        sortOrder: true, active: true, lockVersion: true, updatedAt: true,
        ruleRevisions: { where: currentRuleWhere(now), orderBy: [{ revisionNumber: "desc" }], take: 1, select: currentRuleSelect },
      },
    },
  } as const satisfies Prisma.MaterialSelect;
}

type DetailRow = Prisma.MaterialGetPayload<{ select: ReturnType<typeof detailSelect> }>;

function toVariant(row: DetailRow["variants"][number]): MaterialVariantDto {
  const rule = row.ruleRevisions[0];
  return {
    id: row.id, code: row.code, name: row.name, thicknessMm: row.thicknessMm.toString(),
    defaultInsideRadiusMm: row.defaultInsideRadiusMm.toString(), sortOrder: row.sortOrder,
    active: row.active, lockVersion: row.lockVersion, updatedAt: row.updatedAt.toISOString(),
    publishedRule: rule ? { id: rule.id, revisionNumber: rule.revisionNumber, effectiveFrom: rule.effectiveFrom?.toISOString() ?? null, effectiveTo: rule.effectiveTo?.toISOString() ?? null, insideBendRadiusMm: rule.insideBendRadiusMm.toString() } : null,
  };
}

function toSummary(row: DetailRow): MaterialSummaryDto {
  const activeVariants = row.variants.filter((item) => item.active);
  return {
    id: row.id, code: row.code, name: row.name, densityKgPerM3: row.densityKgPerM3?.toString() ?? null,
    sortOrder: row.sortOrder, active: row.active, lockVersion: row.lockVersion,
    activeVariantCount: activeVariants.length,
    calculationRequiredCount: activeVariants.filter((item) => item.ruleRevisions.length === 0).length,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDetail(row: DetailRow): MaterialDetailDto { return { ...toSummary(row), memo: row.memo, variants: row.variants.map(toVariant) }; }

function materialData(input: MaterialFields) {
  const code = normalizeMaterialCode(input.code);
  if (!isValidMaterialCode(code)) throw new MaterialError("INVALID_REQUEST", "재질 코드는 영문 대문자·숫자·-·_ 조합 2~50자여야 합니다.");
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) throw new MaterialError("INVALID_REQUEST", "재질명을 입력해 주세요.");
  try {
    return { code, name, normalizedName: normalizeMaterialName(name), densityKgPerM3: input.densityKgPerM3 ? normalizePositiveDecimal(input.densityKgPerM3) : null, sortOrder: input.sortOrder, memo: normalizeOptionalText(input.memo) };
  } catch { throw new MaterialError("INVALID_REQUEST", "밀도는 0보다 큰 숫자이며 소수 6자리 이하여야 합니다."); }
}

function variantData(input: MaterialVariantFields) {
  const code = normalizeMaterialCode(input.code);
  if (!isValidMaterialCode(code)) throw new MaterialError("INVALID_REQUEST", "두께 코드는 영문 대문자·숫자·-·_ 조합 2~50자여야 합니다.");
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) throw new MaterialError("INVALID_REQUEST", "표시 이름을 입력해 주세요.");
  try { return { code, name, thicknessMm: normalizePositiveDecimal(input.thicknessMm), defaultInsideRadiusMm: normalizeNonNegativeDecimal(input.defaultInsideRadiusMm), sortOrder: input.sortOrder }; }
  catch { throw new MaterialError("INVALID_REQUEST", "두께와 내측반경은 소수 6자리 이하의 올바른 값이어야 합니다."); }
}

function isPrismaCode(error: unknown, code: string) { return typeof error === "object" && error !== null && "code" in error && error.code === code; }
function throwUnique(error: unknown): never { if (isPrismaCode(error, "P2002")) throw new MaterialError("CONFLICT", "같은 재질 코드·재질명 또는 두께가 이미 등록되어 있습니다."); throw error; }

async function getRow(database: Database, organizationId: string, materialId: string, now = new Date()): Promise<DetailRow> {
  const row = await database.material.findFirst({ where: { id: materialId, organizationId, deletedAt: null }, select: detailSelect(now) });
  if (!row) throw new MaterialError("NOT_FOUND", "재질을 찾을 수 없습니다.");
  return row;
}

async function lockMaterial(tx: Transaction, organizationId: string, materialId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Material" WHERE "id"=${materialId}::uuid AND "organizationId"=${organizationId}::uuid AND "deletedAt" IS NULL FOR UPDATE`;
  if (!rows.length) throw new MaterialError("NOT_FOUND", "재질을 찾을 수 없습니다.");
}

export async function listMaterials(prisma: PrismaClient, context: AuthenticatedContext, input: { q?: string; includeInactive?: boolean; cursor?: string; limit: number }): Promise<MaterialListDto> {
  requirePermission(context, "material.read");
  let cursor;
  try { cursor = decodeMaterialCursor(input.cursor); } catch { throw new MaterialError("INVALID_REQUEST", "재질 목록 페이지 위치가 올바르지 않습니다."); }
  const q = input.q?.trim() ?? "";
  const and: Prisma.MaterialWhereInput[] = [];
  if (q) and.push({ OR: [{ code: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }, { variants: { some: { deletedAt: null, OR: [{ code: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] } } }] });
  if (cursor) and.push({ OR: [{ sortOrder: { gt: cursor.sortOrder } }, { sortOrder: cursor.sortOrder, normalizedName: { gt: cursor.normalizedName } }, { sortOrder: cursor.sortOrder, normalizedName: cursor.normalizedName, id: { gt: cursor.id } }] });
  const rows = await prisma.material.findMany({ where: { organizationId: context.organizationId, deletedAt: null, ...(input.includeInactive ? {} : { active: true }), AND: and }, orderBy: [{ sortOrder: "asc" }, { normalizedName: "asc" }, { id: "asc" }], take: input.limit + 1, select: detailSelect(new Date()) });
  const hasNext = rows.length > input.limit; const visible = hasNext ? rows.slice(0, input.limit) : rows; const last = visible.at(-1);
  return { items: visible.map(toSummary), nextCursor: hasNext && last ? encodeMaterialCursor(last.sortOrder, last.normalizedName, last.id) : null };
}

export async function getMaterial(prisma: PrismaClient, context: AuthenticatedContext, materialId: string) { requirePermission(context, "material.read"); return toDetail(await getRow(prisma, context.organizationId, materialId)); }

export async function createMaterial(prisma: PrismaClient, context: AuthenticatedContext, input: MaterialFields & { requestId: string }): Promise<MaterialDetailDto> {
  requirePermission(context, "material.write"); const data = materialData(input);
  try { return await prisma.$transaction(async (tx) => { const created = await tx.material.create({ data: { organizationId: context.organizationId, ...data }, select: detailSelect(new Date()) }); await writeAuditEvent(tx, { organizationId: context.organizationId, actorUserId: context.userId, action: "material.created", entityId: created.id, requestId: input.requestId, after: { code: created.code, name: created.name, densityKgPerM3: created.densityKgPerM3?.toString() ?? null, active: created.active, lockVersion: created.lockVersion } }); return toDetail(created); }); } catch (error) { throwUnique(error); }
}

export async function updateMaterial(prisma: PrismaClient, context: AuthenticatedContext, input: MaterialFields & { materialId: string; active: boolean; expectedLockVersion: number; requestId: string }): Promise<MaterialDetailDto> {
  requirePermission(context, "material.write"); const data = materialData(input);
  try { return await prisma.$transaction(async (tx) => { await lockMaterial(tx, context.organizationId, input.materialId); const current = await getRow(tx, context.organizationId, input.materialId); if (current.lockVersion !== input.expectedLockVersion) throw new MaterialError("CONFLICT", "재질 정보가 변경되었습니다. 최신 정보를 불러온 뒤 다시 시도해 주세요."); if (data.code !== current.code) throw new MaterialError("CONFLICT", "등록된 재질 코드는 변경할 수 없습니다."); await tx.material.update({ where: { id: current.id }, data: { name: data.name, normalizedName: data.normalizedName, densityKgPerM3: data.densityKgPerM3, sortOrder: data.sortOrder, memo: data.memo, active: input.active, lockVersion: { increment: 1 } } }); const updated = await getRow(tx, context.organizationId, current.id); const snap = (row: DetailRow) => ({ code: row.code, name: row.name, densityKgPerM3: row.densityKgPerM3?.toString() ?? null, active: row.active, lockVersion: row.lockVersion }); await writeAuditEvent(tx, { organizationId: context.organizationId, actorUserId: context.userId, action: "material.updated", entityId: current.id, requestId: input.requestId, before: snap(current), after: snap(updated) }); return toDetail(updated); }); } catch (error) { if (error instanceof MaterialError) throw error; throwUnique(error); }
}

export async function createMaterialVariant(prisma: PrismaClient, context: AuthenticatedContext, input: MaterialVariantFields & { materialId: string; requestId: string }): Promise<MaterialVariantDto> {
  requirePermission(context, "material.write"); const data = variantData(input);
  try { return await prisma.$transaction(async (tx) => { await lockMaterial(tx, context.organizationId, input.materialId); const material = await getRow(tx, context.organizationId, input.materialId); const created = await tx.materialVariant.create({ data: { organizationId: context.organizationId, materialId: material.id, ...data }, select: detailSelect(new Date()).variants.select }); const dto = toVariant(created); await writeAuditEvent(tx, { organizationId: context.organizationId, actorUserId: context.userId, action: "material.variant_created", entityId: created.id, requestId: input.requestId, after: { materialId: material.id, code: created.code, thicknessMm: created.thicknessMm.toString(), defaultInsideRadiusMm: created.defaultInsideRadiusMm.toString(), active: created.active, lockVersion: created.lockVersion } }); return dto; }); } catch (error) { throwUnique(error); }
}

export async function updateMaterialVariant(prisma: PrismaClient, context: AuthenticatedContext, input: MaterialVariantFields & { materialId: string; variantId: string; active: boolean; expectedLockVersion: number; requestId: string }): Promise<MaterialVariantDto> {
  requirePermission(context, "material.write"); const data = variantData(input);
  try { return await prisma.$transaction(async (tx) => { await lockMaterial(tx, context.organizationId, input.materialId); const select = detailSelect(new Date()).variants.select; const current = await tx.materialVariant.findFirst({ where: { id: input.variantId, materialId: input.materialId, organizationId: context.organizationId, deletedAt: null }, select }); if (!current) throw new MaterialError("NOT_FOUND", "두께 항목을 찾을 수 없습니다."); if (current.lockVersion !== input.expectedLockVersion) throw new MaterialError("CONFLICT", "두께 정보가 다른 화면에서 변경되었습니다."); if (current.code !== data.code || current.thicknessMm.toString() !== data.thicknessMm) throw new MaterialError("CONFLICT", "등록된 두께 코드와 두께 값은 변경할 수 없습니다."); const updated = await tx.materialVariant.update({ where: { id: current.id }, data: { name: data.name, defaultInsideRadiusMm: data.defaultInsideRadiusMm, sortOrder: data.sortOrder, active: input.active, lockVersion: { increment: 1 } }, select }); const snap = (row: typeof current) => ({ materialId: input.materialId, code: row.code, thicknessMm: row.thicknessMm.toString(), defaultInsideRadiusMm: row.defaultInsideRadiusMm.toString(), active: row.active, lockVersion: row.lockVersion }); await writeAuditEvent(tx, { organizationId: context.organizationId, actorUserId: context.userId, action: "material.variant_updated", entityId: current.id, requestId: input.requestId, before: snap(current), after: snap(updated) }); return toVariant(updated); }); } catch (error) { if (error instanceof MaterialError) throw error; throwUnique(error); }
}

import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { requirePermission } from "@/server/authorization/authorization";
import { writeAuditEvent } from "@/server/audit/audit-writer";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { MaterialError } from "@/server/materials/material-error";
import {
  calculateSheetItem,
  normalizeFinishName,
  normalizeSheetItemFields,
} from "./sheet-item-policy";
import type {
  SheetItemDto,
  SheetItemFields,
  SheetItemTransitionAction,
  SheetItemWorkspaceDto,
} from "./sheet-item-types";

type Database = PrismaClient | Prisma.TransactionClient;
type Transaction = Prisma.TransactionClient;

const itemSelect = {
  id: true,
  materialVariantId: true,
  code: true,
  name: true,
  finishName: true,
  widthMm: true,
  lengthMm: true,
  rotationPolicy: true,
  grainAxis: true,
  trimTopMm: true,
  trimRightMm: true,
  trimBottomMm: true,
  trimLeftMm: true,
  weightOverrideKg: true,
  weightOverrideReason: true,
  standardPurchaseCostKrw: true,
  minRemnantWidthMm: true,
  minRemnantLengthMm: true,
  minRemnantAreaM2: true,
  inventoryUnit: true,
  isDefault: true,
  active: true,
  sortOrder: true,
  memo: true,
  lockVersion: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.SheetItemSelect;

type ItemRow = Prisma.SheetItemGetPayload<{ select: typeof itemSelect }>;

const variantSelect = {
  id: true,
  code: true,
  name: true,
  thicknessMm: true,
  active: true,
  material: {
    select: {
      id: true,
      code: true,
      name: true,
      densityKgPerM3: true,
      active: true,
    },
  },
} as const satisfies Prisma.MaterialVariantSelect;

type VariantRow = Prisma.MaterialVariantGetPayload<{ select: typeof variantSelect }>;

function toDto(row: ItemRow, variant: VariantRow): SheetItemDto {
  const fields: SheetItemFields = {
    code: row.code,
    name: row.name,
    finishName: row.finishName,
    widthMm: row.widthMm.toString(),
    lengthMm: row.lengthMm.toString(),
    rotationPolicy: row.rotationPolicy,
    grainAxis: row.grainAxis,
    trimTopMm: row.trimTopMm.toString(),
    trimRightMm: row.trimRightMm.toString(),
    trimBottomMm: row.trimBottomMm.toString(),
    trimLeftMm: row.trimLeftMm.toString(),
    weightOverrideKg: row.weightOverrideKg?.toString() ?? null,
    weightOverrideReason: row.weightOverrideReason,
    standardPurchaseCostKrw: row.standardPurchaseCostKrw?.toString() ?? null,
    minRemnantWidthMm: row.minRemnantWidthMm?.toString() ?? null,
    minRemnantLengthMm: row.minRemnantLengthMm?.toString() ?? null,
    minRemnantAreaM2: row.minRemnantAreaM2?.toString() ?? null,
    sortOrder: row.sortOrder,
    memo: row.memo,
  };
  return {
    ...fields,
    id: row.id,
    materialVariantId: row.materialVariantId,
    inventoryUnit: row.inventoryUnit,
    isDefault: row.isDefault,
    active: row.active,
    lockVersion: row.lockVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    calculation: calculateSheetItem(
      fields,
      variant.material.densityKgPerM3?.toString() ?? null,
      variant.thicknessMm.toString(),
    ),
  };
}

function auditSnapshot(row: ItemRow) {
  return {
    materialVariantId: row.materialVariantId,
    code: row.code,
    name: row.name,
    widthMm: row.widthMm.toString(),
    lengthMm: row.lengthMm.toString(),
    finishName: row.finishName,
    active: row.active,
    isDefault: row.isDefault,
    lockVersion: row.lockVersion,
  };
}

function stateSnapshot(row: ItemRow) {
  return { active: row.active, isDefault: row.isDefault, lockVersion: row.lockVersion };
}

async function getVariant(
  database: Database,
  organizationId: string,
  materialId: string,
  variantId: string,
): Promise<VariantRow> {
  const row = await database.materialVariant.findFirst({
    where: {
      id: variantId,
      materialId,
      organizationId,
      deletedAt: null,
      material: { deletedAt: null },
    },
    select: variantSelect,
  });
  if (!row) throw new MaterialError("NOT_FOUND", "재질 두께 항목을 찾을 수 없습니다.");
  return row;
}

async function getItem(
  database: Database,
  organizationId: string,
  variantId: string,
  sheetItemId: string,
): Promise<ItemRow> {
  const row = await database.sheetItem.findFirst({
    where: { id: sheetItemId, organizationId, materialVariantId: variantId, deletedAt: null },
    select: itemSelect,
  });
  if (!row) throw new MaterialError("NOT_FOUND", "원판 품목을 찾을 수 없습니다.");
  return row;
}

async function lockVariant(tx: Transaction, organizationId: string, variantId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "MaterialVariant"
    WHERE "id"=${variantId}::uuid AND "organizationId"=${organizationId}::uuid
      AND "deletedAt" IS NULL FOR UPDATE`;
  if (!rows.length) throw new MaterialError("NOT_FOUND", "재질 두께 항목을 찾을 수 없습니다.");
}

function isPrismaCode(error: unknown, code: string) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function throwDatabaseError(error: unknown): never {
  if (error instanceof MaterialError) throw error;
  if (isPrismaCode(error, "P2002")) {
    throw new MaterialError("CONFLICT", "같은 원판 코드가 이미 있거나 기본 원판이 중복되었습니다.");
  }
  throw error;
}

function createData(fields: SheetItemFields) {
  return {
    ...fields,
    normalizedFinishName: normalizeFinishName(fields.finishName),
    inventoryUnit: "SHEET" as const,
  };
}

export async function getSheetItemWorkspace(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  materialId: string,
  variantId: string,
): Promise<SheetItemWorkspaceDto> {
  requirePermission(context, "material.read");
  const variant = await getVariant(prisma, context.organizationId, materialId, variantId);
  const rows = await prisma.sheetItem.findMany({
    where: { organizationId: context.organizationId, materialVariantId: variantId, deletedAt: null },
    orderBy: [{ active: "desc" }, { isDefault: "desc" }, { sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
    select: itemSelect,
  });
  return {
    material: {
      id: variant.material.id,
      code: variant.material.code,
      name: variant.material.name,
      densityKgPerM3: variant.material.densityKgPerM3?.toString() ?? null,
      active: variant.material.active,
    },
    variant: {
      id: variant.id,
      code: variant.code,
      name: variant.name,
      thicknessMm: variant.thicknessMm.toString(),
      active: variant.active,
    },
    items: rows.map((row) => toDto(row, variant)),
    activeCount: rows.filter((row) => row.active).length,
    defaultItemId: rows.find((row) => row.active && row.isDefault)?.id ?? null,
  };
}

export async function previewSheetItem(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: SheetItemFields & { materialId: string; variantId: string },
) {
  requirePermission(context, "material.read");
  const variant = await getVariant(prisma, context.organizationId, input.materialId, input.variantId);
  const fields = normalizeSheetItemFields(input);
  return calculateSheetItem(fields, variant.material.densityKgPerM3?.toString() ?? null, variant.thicknessMm.toString());
}

export async function createSheetItem(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: SheetItemFields & { materialId: string; variantId: string; isDefault: boolean; requestId: string },
): Promise<SheetItemDto> {
  requirePermission(context, "material.write");
  const fields = normalizeSheetItemFields(input);
  try {
    return await prisma.$transaction(async (tx) => {
      await lockVariant(tx, context.organizationId, input.variantId);
      const variant = await getVariant(tx, context.organizationId, input.materialId, input.variantId);
      const activeCount = await tx.sheetItem.count({ where: { materialVariantId: input.variantId, active: true, deletedAt: null } });
      const isDefault = input.isDefault || activeCount === 0;
      if (isDefault) {
        await tx.sheetItem.updateMany({
          where: { materialVariantId: input.variantId, active: true, isDefault: true, deletedAt: null },
          data: { isDefault: false, lockVersion: { increment: 1 } },
        });
      }
      const created = await tx.sheetItem.create({
        data: {
          organizationId: context.organizationId,
          materialVariantId: variant.id,
          ...createData(fields),
          isDefault,
        },
        select: itemSelect,
      });
      await writeAuditEvent(tx, {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "material.sheet_created",
        entityId: created.id,
        requestId: input.requestId,
        after: auditSnapshot(created),
      });
      return toDto(created, variant);
    });
  } catch (error) { throwDatabaseError(error); }
}

export async function updateSheetItem(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: SheetItemFields & { materialId: string; variantId: string; sheetItemId: string; expectedLockVersion: number; requestId: string },
): Promise<SheetItemDto> {
  requirePermission(context, "material.write");
  const fields = normalizeSheetItemFields(input);
  try {
    return await prisma.$transaction(async (tx) => {
      await lockVariant(tx, context.organizationId, input.variantId);
      const variant = await getVariant(tx, context.organizationId, input.materialId, input.variantId);
      const current = await getItem(tx, context.organizationId, input.variantId, input.sheetItemId);
      if (current.lockVersion !== input.expectedLockVersion) throw new MaterialError("CONFLICT", "원판 정보가 다른 화면에서 변경되었습니다.");
      if (current.code !== fields.code || current.widthMm.toString() !== fields.widthMm || current.lengthMm.toString() !== fields.lengthMm) {
        throw new MaterialError("CONFLICT", "등록된 원판 코드와 폭·길이는 변경할 수 없습니다. 새 품목으로 복사해 주세요.");
      }
      const updated = await tx.sheetItem.update({
        where: { id: current.id },
        data: {
          name: fields.name,
          finishName: fields.finishName,
          normalizedFinishName: normalizeFinishName(fields.finishName),
          rotationPolicy: fields.rotationPolicy,
          grainAxis: fields.grainAxis,
          trimTopMm: fields.trimTopMm,
          trimRightMm: fields.trimRightMm,
          trimBottomMm: fields.trimBottomMm,
          trimLeftMm: fields.trimLeftMm,
          weightOverrideKg: fields.weightOverrideKg,
          weightOverrideReason: fields.weightOverrideReason,
          standardPurchaseCostKrw: fields.standardPurchaseCostKrw,
          minRemnantWidthMm: fields.minRemnantWidthMm,
          minRemnantLengthMm: fields.minRemnantLengthMm,
          minRemnantAreaM2: fields.minRemnantAreaM2,
          sortOrder: fields.sortOrder,
          memo: fields.memo,
          lockVersion: { increment: 1 },
        },
        select: itemSelect,
      });
      await writeAuditEvent(tx, {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "material.sheet_updated",
        entityId: updated.id,
        requestId: input.requestId,
        before: auditSnapshot(current),
        after: auditSnapshot(updated),
      });
      return toDto(updated, variant);
    });
  } catch (error) { throwDatabaseError(error); }
}

export async function transitionSheetItem(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: {
    materialId: string;
    variantId: string;
    sheetItemId: string;
    action: SheetItemTransitionAction;
    expectedLockVersion: number;
    requestId: string;
  },
): Promise<SheetItemDto> {
  requirePermission(context, "material.write");
  try {
    return await prisma.$transaction(async (tx) => {
      await lockVariant(tx, context.organizationId, input.variantId);
      const variant = await getVariant(tx, context.organizationId, input.materialId, input.variantId);
      const current = await getItem(tx, context.organizationId, input.variantId, input.sheetItemId);
      if (current.lockVersion !== input.expectedLockVersion) throw new MaterialError("CONFLICT", "원판 상태가 다른 화면에서 변경되었습니다.");
      let action: "material.sheet_default_set" | "material.sheet_deactivated" | "material.sheet_reactivated";
      let data: Prisma.SheetItemUpdateInput;
      if (input.action === "set_default") {
        if (!current.active) throw new MaterialError("CONFLICT", "비활성 원판은 기본값으로 지정할 수 없습니다.");
        await tx.sheetItem.updateMany({
          where: { materialVariantId: input.variantId, active: true, isDefault: true, deletedAt: null, id: { not: current.id } },
          data: { isDefault: false, lockVersion: { increment: 1 } },
        });
        action = "material.sheet_default_set";
        data = { isDefault: true, lockVersion: { increment: 1 } };
      } else if (input.action === "deactivate") {
        if (!current.active) throw new MaterialError("CONFLICT", "이미 비활성화된 원판입니다.");
        action = "material.sheet_deactivated";
        data = { active: false, isDefault: false, lockVersion: { increment: 1 } };
      } else {
        if (current.active) throw new MaterialError("CONFLICT", "이미 활성화된 원판입니다.");
        const hasDefault = await tx.sheetItem.count({ where: { materialVariantId: input.variantId, active: true, isDefault: true, deletedAt: null } });
        action = "material.sheet_reactivated";
        data = { active: true, isDefault: hasDefault === 0, lockVersion: { increment: 1 } };
      }
      const updated = await tx.sheetItem.update({ where: { id: current.id }, data, select: itemSelect });
      await writeAuditEvent(tx, {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action,
        entityId: updated.id,
        requestId: input.requestId,
        before: stateSnapshot(current),
        after: stateSnapshot(updated),
      });
      return toDto(updated, variant);
    });
  } catch (error) { throwDatabaseError(error); }
}

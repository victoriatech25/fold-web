import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { SheetItemSnapshot } from "@/domain/fold-document/schema";
import { calculateSheetItem } from "@/server/sheet-items/sheet-item-policy";

type Database = PrismaClient | Prisma.TransactionClient;

export class FoldSheetItemNotFoundError extends Error {
  constructor() {
    super("Fold sheet item was not found for the selected material rule.");
    this.name = "FoldSheetItemNotFoundError";
  }
}

export async function resolveSheetItemSnapshot(
  database: Database,
  organizationId: string,
  sheetItemId: string,
  materialRuleRevisionId: string,
): Promise<SheetItemSnapshot> {
  const sheet = await database.sheetItem.findFirst({
    where: {
      id: sheetItemId,
      organizationId,
      deletedAt: null,
      materialVariant: {
        organizationId,
        deletedAt: null,
        ruleRevisions: { some: { id: materialRuleRevisionId, organizationId } },
      },
    },
    include: { materialVariant: { include: { material: true } } },
  });
  if (!sheet) throw new FoldSheetItemNotFoundError();
  const calculation = calculateSheetItem(
    {
      widthMm: sheet.widthMm.toString(),
      lengthMm: sheet.lengthMm.toString(),
      trimTopMm: sheet.trimTopMm.toString(),
      trimRightMm: sheet.trimRightMm.toString(),
      trimBottomMm: sheet.trimBottomMm.toString(),
      trimLeftMm: sheet.trimLeftMm.toString(),
      weightOverrideKg: sheet.weightOverrideKg?.toString() ?? null,
    },
    sheet.materialVariant.material.densityKgPerM3?.toString() ?? null,
    sheet.materialVariant.thicknessMm.toString(),
  );
  return {
    sheetItemId: sheet.id,
    materialVariantId: sheet.materialVariantId,
    code: sheet.code,
    name: sheet.name,
    finishName: sheet.finishName,
    widthMm: sheet.widthMm.toString(),
    lengthMm: sheet.lengthMm.toString(),
    rotationPolicy: sheet.rotationPolicy,
    grainAxis: sheet.grainAxis,
    trimTopMm: sheet.trimTopMm.toString(),
    trimRightMm: sheet.trimRightMm.toString(),
    trimBottomMm: sheet.trimBottomMm.toString(),
    trimLeftMm: sheet.trimLeftMm.toString(),
    nominalAreaM2: calculation.nominalAreaM2,
    usableWidthMm: calculation.usableWidthMm,
    usableLengthMm: calculation.usableLengthMm,
    usableAreaM2: calculation.usableAreaM2,
    effectiveWeightKg: calculation.effectiveWeightKg,
    weightSource: calculation.weightSource,
  };
}

import "server-only";

import { z } from "zod";

export const sheetItemFieldsSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  finishName: z.string().max(100).nullable(),
  widthMm: z.string().min(1).max(50),
  lengthMm: z.string().min(1).max(50),
  rotationPolicy: z.enum(["FREE", "KEEP_GRAIN"]),
  grainAxis: z.enum(["NONE", "WIDTH", "LENGTH"]),
  trimTopMm: z.string().min(1).max(50),
  trimRightMm: z.string().min(1).max(50),
  trimBottomMm: z.string().min(1).max(50),
  trimLeftMm: z.string().min(1).max(50),
  weightOverrideKg: z.string().max(50).nullable(),
  weightOverrideReason: z.string().max(500).nullable(),
  standardPurchaseCostKrw: z.string().max(50).nullable(),
  minRemnantWidthMm: z.string().max(50).nullable(),
  minRemnantLengthMm: z.string().max(50).nullable(),
  minRemnantAreaM2: z.string().max(50).nullable(),
  sortOrder: z.number().int().min(-100000).max(100000),
  memo: z.string().max(2000).nullable(),
}).strict();

export function validSheetIds(ids: { materialId: string; variantId: string; sheetItemId?: string }) {
  return z.uuid().safeParse(ids.materialId).success
    && z.uuid().safeParse(ids.variantId).success
    && (ids.sheetItemId === undefined || z.uuid().safeParse(ids.sheetItemId).success);
}

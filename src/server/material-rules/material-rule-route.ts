import "server-only";

import { z } from "zod";

export const materialRuleFieldsSchema = z.object({
  calculationMode: z.enum(["FIXED", "RATIO"]),
  elongationOption: z.enum(["STANDARD", "TWO_LINE", "DIAGONAL", "EXT1"]),
  vCutEnabled: z.boolean(),
  decimalPlaces: z.number().int().min(0).max(6),
  decimalOperation: z.enum(["NONE", "ROUND", "FLOOR", "CEIL"]),
  cutAngleDeg: z.string().min(1).max(50),
  insideBendRadiusMm: z.string().min(1).max(50),
  elongationVCutMm: z.string().min(1).max(50),
  elongationACutMm: z.string().min(1).max(50),
  elongationNoCutMm: z.string().min(1).max(50),
  cutDepthVCutMm: z.string().min(1).max(50),
  cutDepthACutMm: z.string().min(1).max(50),
  cutDepthNoCutMm: z.string().min(1).max(50),
  changeSummary: z.string().max(500).nullable(),
}).strict();

export function validRuleIds(ids: { materialId: string; variantId: string; ruleId?: string }) {
  return z.uuid().safeParse(ids.materialId).success
    && z.uuid().safeParse(ids.variantId).success
    && (ids.ruleId === undefined || z.uuid().safeParse(ids.ruleId).success);
}

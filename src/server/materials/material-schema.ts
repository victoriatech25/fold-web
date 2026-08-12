import { z } from "zod";
import { decimalStringSchema } from "@/domain/fold-document/decimal";
import { NON_NEGATIVE_MATERIAL_DECIMAL_POLICY, POSITIVE_MATERIAL_DECIMAL_POLICY } from "./material-policy";

const optionalText = (max: number) => z.union([z.string().trim().max(max), z.literal(""), z.null()]).optional();
const optionalDensity = z.union([decimalStringSchema(POSITIVE_MATERIAL_DECIMAL_POLICY), z.literal(""), z.null()]).optional();

export const materialFieldsSchema = {
  code: z.string().trim().min(2).max(50),
  name: z.string().trim().min(1).max(100),
  densityKgPerM3: optionalDensity,
  sortOrder: z.number().int().min(-999999).max(999999),
  memo: optionalText(2000),
};

export const materialVariantFieldsSchema = {
  code: z.string().trim().min(2).max(50),
  name: z.string().trim().min(1).max(100),
  thicknessMm: decimalStringSchema(POSITIVE_MATERIAL_DECIMAL_POLICY),
  defaultInsideRadiusMm: decimalStringSchema(NON_NEGATIVE_MATERIAL_DECIMAL_POLICY),
  sortOrder: z.number().int().min(-999999).max(999999),
};

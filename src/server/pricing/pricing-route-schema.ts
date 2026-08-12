import { z } from "zod";

const money = z.string().min(1).max(30);
export const priceRevisionFieldsSchema = z.object({
  changeSummary: z.string().max(500).nullable(),
  foldRates: z.array(z.object({
    materialVariantId: z.uuid(),
    materialRatePerM2Krw: money,
    bendRatePerOperationKrw: money,
    vCutRatePerMeterKrw: money,
  }).strict()).max(2000),
  sheetRates: z.array(z.object({
    sheetItemId: z.uuid(),
    materialPricePerSheetKrw: money,
    processingPricePerSheetKrw: money.nullable(),
  }).strict()).max(5000),
  surchargePolicy: z.object({
    minimumBendOperations: z.number().int().min(0).max(999),
    ratePercent: z.string().min(1).max(20),
    baseType: z.literal("PROCESSING_ONLY"),
  }).strict().nullable(),
}).strict();

export const uuidParam = z.uuid();

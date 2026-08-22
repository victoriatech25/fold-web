import { z } from "zod";

import {
  LENGTH_DECIMAL_POLICY,
  NON_NEGATIVE_LENGTH_DECIMAL_POLICY,
  POSITIVE_LENGTH_DECIMAL_POLICY,
  decimalStringSchema,
} from "@/domain/fold-document/decimal";

/**
 * 재단 계약 버전(`D2-B03-A`). 결과에 함께 남겨 나중에 계약이 바뀌어도
 * 옛 결과를 어떤 규칙으로 만들었는지 알 수 있게 한다.
 */
export const CUTTING_CONTRACT_VERSION = "cutting-contract-v1" as const;

const lengthMm = decimalStringSchema(LENGTH_DECIMAL_POLICY);
const nonNegativeMm = decimalStringSchema(NON_NEGATIVE_LENGTH_DECIMAL_POLICY);
const positiveMm = decimalStringSchema(POSITIVE_LENGTH_DECIMAL_POLICY);
const nonNegativeArea = decimalStringSchema({ precision: 18, scale: 8, min: "0" });

/** 결 방향. `NONE`은 결이 없어 어느 방향으로도 놓을 수 있다는 뜻이다. */
export const grainDirectionSchema = z.enum(["NONE", "WIDTH", "LENGTH"]);

/** 원판이 회전 배치를 허용하는지. 기준정보 `SheetItem.rotationPolicy`와 같은 값이다. */
export const rotationPolicySchema = z.enum(["FREE", "FIXED"]);

export const cuttingPartSchema = z.strictObject({
  id: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(200),
  widthMm: positiveMm,
  lengthMm: positiveMm,
  quantity: z.number().int().min(1).max(100_000),
  /** 부품 쪽에서 90도 회전을 허용하는지. 원판 정책과 함께 만족해야 회전한다(`D2-B03-G`). */
  rotationAllowed: z.boolean(),
  grainDirection: grainDirectionSchema,
});

export const cuttingSheetSchema = z.strictObject({
  sheetItemId: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(200),
  widthMm: positiveMm,
  lengthMm: positiveMm,
  trimTopMm: nonNegativeMm,
  trimRightMm: nonNegativeMm,
  trimBottomMm: nonNegativeMm,
  trimLeftMm: nonNegativeMm,
  rotationPolicy: rotationPolicySchema,
  grainAxis: grainDirectionSchema,
  /** 이 크기를 모두 넘는 남은 조각만 잔재로 본다(`D2-B03-L`). */
  minRemnantWidthMm: nonNegativeMm.nullable(),
  minRemnantLengthMm: nonNegativeMm.nullable(),
  minRemnantAreaM2: nonNegativeArea.nullable(),
  /** 쓸 수 있는 장수. `null`이면 제한이 없다. */
  availableCount: z.number().int().min(1).max(100_000).nullable(),
});

/** 최적화 목표(`D2-B03-O`). 2026-08-22 원판 수 우선으로 확정했다. */
export const cuttingObjectiveSchema = z.enum([
  "SHEET_COUNT_FIRST",
  "YIELD_FIRST",
  "CUT_COUNT_FIRST",
]);

export const cuttingOptionsSchema = z.strictObject({
  /** 칼날 두께. 부품 사이와 trim 경계 사이에 모두 확보해야 한다(`D2-B03-F`). */
  bladeKerfMm: nonNegativeMm,
  objective: cuttingObjectiveSchema,
  /** 무작위를 쓰는 구현을 위한 seed. 결과에 함께 남긴다(`D2-B03-C`). */
  seed: z.number().int().min(0).max(2_147_483_647).nullable(),
});

export const cuttingInputSchema = z.strictObject({
  contractVersion: z.literal(CUTTING_CONTRACT_VERSION),
  parts: z.array(cuttingPartSchema).min(1).max(10_000),
  sheets: z.array(cuttingSheetSchema).min(1).max(100),
  options: cuttingOptionsSchema,
});

export const cuttingPlacementSchema = z.strictObject({
  partId: z.string().trim().min(1).max(100),
  /** 원판 왼쪽 아래를 원점으로 한 좌표. X는 폭, Y는 길이 방향이다(`D2-B03-B`). */
  xMm: lengthMm,
  yMm: lengthMm,
  rotated: z.boolean(),
});

export const cuttingRemnantSchema = z.strictObject({
  xMm: lengthMm,
  yMm: lengthMm,
  widthMm: positiveMm,
  lengthMm: positiveMm,
  areaM2: nonNegativeArea,
});

export const cuttingSheetResultSchema = z.strictObject({
  sheetIndex: z.number().int().min(0),
  sheetItemId: z.string().trim().min(1).max(100),
  placements: z.array(cuttingPlacementSchema),
  usedAreaM2: nonNegativeArea,
  remnants: z.array(cuttingRemnantSchema),
});

export const unplacedPartSchema = z.strictObject({
  partId: z.string().trim().min(1).max(100),
  quantity: z.number().int().min(1),
  reason: z.enum(["TOO_LARGE", "GRAIN_CONFLICT", "SHEET_LIMIT", "OTHER"]),
});

export const cuttingSummarySchema = z.strictObject({
  sheetCount: z.number().int().min(0),
  totalAreaM2: nonNegativeArea,
  usedAreaM2: nonNegativeArea,
  /** 사용 면적 ÷ 전체 원판 면적. trim 과 손실을 모두 포함해 계산한다. */
  yieldPercent: decimalStringSchema({ precision: 6, scale: 2, min: "0", max: "100" }),
  unplacedParts: z.array(unplacedPartSchema),
});

export const cuttingResultSchema = z.strictObject({
  contractVersion: z.literal(CUTTING_CONTRACT_VERSION),
  /** solver 구현 버전. 계약 버전과 따로 움직인다. */
  engineVersion: z.string().trim().min(1).max(50),
  seed: z.number().int().nullable(),
  sheets: z.array(cuttingSheetResultSchema),
  summary: cuttingSummarySchema,
});

export type CuttingPart = z.infer<typeof cuttingPartSchema>;
export type CuttingSheet = z.infer<typeof cuttingSheetSchema>;
export type CuttingOptions = z.infer<typeof cuttingOptionsSchema>;
export type CuttingInput = z.infer<typeof cuttingInputSchema>;
export type CuttingPlacement = z.infer<typeof cuttingPlacementSchema>;
export type CuttingRemnant = z.infer<typeof cuttingRemnantSchema>;
export type CuttingSheetResult = z.infer<typeof cuttingSheetResultSchema>;
export type CuttingSummary = z.infer<typeof cuttingSummarySchema>;
export type CuttingResult = z.infer<typeof cuttingResultSchema>;
export type CuttingObjective = z.infer<typeof cuttingObjectiveSchema>;
export type GrainDirection = z.infer<typeof grainDirectionSchema>;

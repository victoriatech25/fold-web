import { z } from "zod";

import {
  LENGTH_DECIMAL_POLICY,
  NON_NEGATIVE_LENGTH_DECIMAL_POLICY,
  POSITIVE_LENGTH_DECIMAL_POLICY,
  decimalStringSchema,
} from "@/domain/fold-document/decimal";
import type { CuttingSheetResult } from "@/domain/cutting/schema";

/**
 * 편집기가 재단 개정 위에 얹는 지정(`P2-B11` 4.3). 레이저 그룹·가로 절단선·필름.
 * 배치 자체는 `cuttingResult` 에 그대로 있고, 여기서는 그 배치를 가리키기만 한다.
 */
export const CUTTING_ANNOTATIONS_VERSION = "cutting-annotations-v1" as const;

const lengthMm = decimalStringSchema(LENGTH_DECIMAL_POLICY);
const nonNegativeMm = decimalStringSchema(NON_NEGATIVE_LENGTH_DECIMAL_POLICY);
const positiveMm = decimalStringSchema(POSITIVE_LENGTH_DECIMAL_POLICY);
const annotationId = z.string().trim().min(1).max(100);
const sheetIndex = z.number().int().min(0).max(9_999);

/** `${partId}#${n}` — 같은 부품의 n번째 배치. 배열 순서는 편집으로 바뀌므로 인덱스로 가리키지 않는다. */
export const placementKeySchema = z.string().trim().min(3).max(120).regex(/^.+#\d+$/);

export const laserGroupSchema = z.strictObject({
  id: annotationId,
  sheetIndex,
  placementKeys: z.array(placementKeySchema).min(1).max(1_000),
  /** 저장 시 계산해 넣는다. 검증·DXF 는 이 값을 다시 계산하지 않고 대조만 한다. */
  boundsMm: z.strictObject({
    xMm: nonNegativeMm,
    yMm: nonNegativeMm,
    widthMm: positiveMm,
    lengthMm: positiveMm,
  }),
});

export const horizontalCutLineSchema = z.strictObject({
  id: annotationId,
  sheetIndex,
  yMm: lengthMm,
});

export const sheetAnnotationSchema = z.strictObject({
  sheetIndex,
  film: z.boolean(),
});

export const cuttingAnnotationsSchema = z.strictObject({
  version: z.literal(CUTTING_ANNOTATIONS_VERSION),
  laserGroups: z.array(laserGroupSchema).max(1_000),
  horizontalCutLines: z.array(horizontalCutLineSchema).max(1_000),
  sheets: z.array(sheetAnnotationSchema).max(10_000),
});

export type LaserGroup = z.infer<typeof laserGroupSchema>;
export type HorizontalCutLine = z.infer<typeof horizontalCutLineSchema>;
export type SheetAnnotation = z.infer<typeof sheetAnnotationSchema>;
export type CuttingAnnotations = z.infer<typeof cuttingAnnotationsSchema>;

export function emptyAnnotations(): CuttingAnnotations {
  return { version: CUTTING_ANNOTATIONS_VERSION, laserGroups: [], horizontalCutLines: [], sheets: [] };
}

export function placementKey(partId: string, ordinal: number): string {
  return `${partId}#${ordinal}`;
}

/**
 * 원판 하나의 배치에 키를 붙인다. 같은 부품은 `placements` 에 나온 순서대로 0부터 센다.
 * 편집기가 저장할 때와 서버가 읽을 때 같은 규칙을 써야 하므로 여기 한 곳에만 둔다.
 */
export function assignPlacementKeys(sheet: CuttingSheetResult): string[] {
  const ordinal = new Map<string, number>();
  return sheet.placements.map((placement) => {
    const next = ordinal.get(placement.partId) ?? 0;
    ordinal.set(placement.partId, next + 1);
    return placementKey(placement.partId, next);
  });
}

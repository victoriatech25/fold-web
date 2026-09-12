import "server-only";

import { z } from "zod";

import { cuttingAnnotationsSchema } from "@/domain/cutting/annotations";
import { cuttingPlacementSchema } from "@/domain/cutting/schema";

/** 편집기가 보내는 배치. 검증·저장 요청이 같은 몸체를 쓴다(`P2-B11` 4.5). */
export const manualRevisionBodySchema = z.strictObject({
  baseRevisionId: z.uuid(),
  sheets: z
    .array(
      z.strictObject({
        sheetItemId: z.string().trim().min(1).max(100),
        placements: z.array(cuttingPlacementSchema).max(10_000),
      }),
    )
    .min(1)
    .max(1_000),
  annotations: cuttingAnnotationsSchema,
});

export const manualRevisionSaveSchema = manualRevisionBodySchema.extend({
  expectedLockVersion: z.number().int().min(1),
});

/** 원판 1,000장 × 부품 수천 개까지 담는다. */
export const MANUAL_REVISION_BODY_LIMIT = 4 * 1024 * 1024;

import { z } from "zod";

import {
  cuttingInputSchema,
  type CuttingResult,
} from "@/domain/cutting/schema";
import { decimalStringSchema } from "@/domain/fold-document/decimal";

const percent = decimalStringSchema({ precision: 6, scale: 2, min: "0", max: "100" });

/**
 * 재단 표본(golden master). MFC 표본이 준비되기 전에는 손으로 만든 `SYNTHETIC`
 * 표본으로 계약을 검증하고, 실제 표본이 들어오면 같은 형식으로 적재한다(`D2-B03-Q`).
 */
export const cuttingSampleSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  source: z.enum(["MFC", "SYNTHETIC"]),
  note: z.string().trim().max(1_000).nullable(),
  input: cuttingInputSchema,
  expected: z.strictObject({
    sheetCount: z.number().int().min(0),
    yieldPercent: percent,
  }),
});

export type CuttingSample = z.infer<typeof cuttingSampleSchema>;

/** 허용 편차(`D2-B03-P`). 원판 수는 같아야 하고 수율은 2%p 까지 낮아도 통과한다. */
export const SHEET_COUNT_TOLERANCE = 0;
export const YIELD_TOLERANCE_POINTS = 2;

export type SampleComparison = {
  passed: boolean;
  sheetCountDelta: number;
  yieldDelta: number;
  issues: string[];
};

/** 표본과 solver 결과를 비교한다. 배치가 같은지는 보지 않는다(`P0-05` 7.2). */
export function compareWithSample(
  sample: CuttingSample,
  result: CuttingResult,
): SampleComparison {
  const issues: string[] = [];
  const sheetCountDelta = result.summary.sheetCount - sample.expected.sheetCount;
  const yieldDelta =
    Number(result.summary.yieldPercent) - Number(sample.expected.yieldPercent);

  if (Math.abs(sheetCountDelta) > SHEET_COUNT_TOLERANCE) {
    issues.push(
      `원판 수가 표본과 다릅니다. 표본 ${sample.expected.sheetCount}, 결과 ${result.summary.sheetCount}.`,
    );
  }
  if (yieldDelta < -YIELD_TOLERANCE_POINTS) {
    issues.push(
      `수율이 허용 편차를 넘어 낮습니다. 표본 ${sample.expected.yieldPercent}%, 결과 ${result.summary.yieldPercent}%.`,
    );
  }

  return { passed: issues.length === 0, sheetCountDelta, yieldDelta, issues };
}

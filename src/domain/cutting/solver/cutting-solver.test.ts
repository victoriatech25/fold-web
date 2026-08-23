import { describe, expect, it } from "vitest";

import legacySamples from "@/domain/cutting/fixtures/legacy-input-samples.json";
import { cuttingSampleSchema } from "@/domain/cutting/sample";
import {
  cuttingInputSchema,
  type CuttingInput,
  type CuttingPart,
  type CuttingSheet,
} from "@/domain/cutting/schema";
import { validateCuttingResult } from "@/domain/cutting/validate";
import { CUTTING_ENGINE_VERSION, optimizeCutting } from "./optimize";

function part(overrides: Partial<CuttingPart> & Pick<CuttingPart, "id">): CuttingPart {
  return {
    label: `부품 ${overrides.id}`,
    widthMm: "600",
    lengthMm: "600",
    quantity: 1,
    rotationAllowed: true,
    grainDirection: "NONE",
    ...overrides,
  };
}

function sheet(overrides: Partial<CuttingSheet> = {}): CuttingSheet {
  return {
    sheetItemId: "SHEET-1220x2440",
    label: "1220×2440",
    widthMm: "1220",
    lengthMm: "2440",
    trimTopMm: "0",
    trimRightMm: "0",
    trimBottomMm: "0",
    trimLeftMm: "0",
    rotationPolicy: "FREE",
    grainAxis: "NONE",
    minRemnantWidthMm: null,
    minRemnantLengthMm: null,
    minRemnantAreaM2: null,
    availableCount: null,
    ...overrides,
  };
}

function input(overrides: Partial<CuttingInput> = {}): CuttingInput {
  return cuttingInputSchema.parse({
    contractVersion: "cutting-contract-v1",
    parts: [part({ id: "part-1" })],
    sheets: [sheet()],
    options: { bladeKerfMm: "0", objective: "SHEET_COUNT_FIRST", seed: null },
    ...overrides,
  });
}

describe("optimizeCutting", () => {
  it("레거시 입력 표본을 제약 위반 없이 배치한다", () => {
    for (const raw of legacySamples) {
      const sample = cuttingSampleSchema.parse(raw);
      const result = optimizeCutting(sample.input);

      expect(validateCuttingResult(sample.input, result)).toEqual([]);
      expect(result.summary.unplacedParts).toEqual([]);
      expect(result.summary.sheetCount).toBeGreaterThan(0);
      expect(result.engineVersion).toBe(CUTTING_ENGINE_VERSION);
    }
  });

  it("같은 입력을 두 번 돌리면 같은 결과가 나온다", () => {
    const sample = cuttingSampleSchema.parse(legacySamples[0]);
    expect(optimizeCutting(sample.input)).toEqual(optimizeCutting(sample.input));
  });

  it("칼날 두께만큼 부품 사이를 벌린다", () => {
    const request = input({
      parts: [part({ id: "part-1", quantity: 4, widthMm: "600", lengthMm: "600" })],
      options: { bladeKerfMm: "5", objective: "SHEET_COUNT_FIRST", seed: null },
    });
    const result = optimizeCutting(request);

    expect(validateCuttingResult(request, result)).toEqual([]);
    // 600 짜리 옆에 놓이는 부품은 600 이 아니라 kerf 를 더한 605 자리에서 시작한다.
    const coordinates = result.sheets[0].placements.flatMap((placement) => [
      Number(placement.xMm),
      Number(placement.yMm),
    ]);
    expect(coordinates).toContain(605);
    expect(coordinates).not.toContain(600);
  });

  it("회전을 금지한 원판에서는 돌려 놓지 않는다", () => {
    const request = input({
      parts: [part({ id: "part-1", widthMm: "400", lengthMm: "1200", quantity: 3 })],
      sheets: [sheet({ rotationPolicy: "FIXED" })],
    });
    const result = optimizeCutting(request);

    expect(validateCuttingResult(request, result)).toEqual([]);
    expect(result.sheets.flatMap((item) => item.placements).every((p) => !p.rotated)).toBe(true);
  });

  it("결이 어긋나 놓을 수 없는 부품은 사유와 함께 보고한다", () => {
    const request = input({
      parts: [part({ id: "part-1", grainDirection: "WIDTH", rotationAllowed: false })],
      sheets: [sheet({ grainAxis: "LENGTH" })],
    });
    const result = optimizeCutting(request);

    expect(validateCuttingResult(request, result)).toEqual([]);
    expect(result.summary.unplacedParts).toEqual([
      { partId: "part-1", quantity: 1, reason: "GRAIN_CONFLICT" },
    ]);
  });

  it("원판보다 큰 부품은 TOO_LARGE 로 보고한다", () => {
    const request = input({
      parts: [part({ id: "part-1" }), part({ id: "part-2", widthMm: "5000", lengthMm: "5000" })],
    });
    const result = optimizeCutting(request);

    expect(validateCuttingResult(request, result)).toEqual([]);
    expect(result.summary.unplacedParts).toEqual([
      { partId: "part-2", quantity: 1, reason: "TOO_LARGE" },
    ]);
    expect(result.sheets[0].placements).toHaveLength(1);
  });

  it("쓸 수 있는 장수를 넘기지 않고 SHEET_LIMIT 로 보고한다", () => {
    const request = input({
      parts: [part({ id: "part-1", widthMm: "1220", lengthMm: "1220", quantity: 4 })],
      sheets: [sheet({ availableCount: 1 })],
    });
    const result = optimizeCutting(request);

    expect(validateCuttingResult(request, result)).toEqual([]);
    expect(result.summary.sheetCount).toBe(1);
    expect(result.summary.unplacedParts).toEqual([
      { partId: "part-1", quantity: 2, reason: "SHEET_LIMIT" },
    ]);
  });

  it("trim 을 뺀 영역만 쓰고 수율은 원판 전체 면적으로 계산한다", () => {
    const request = input({
      parts: [part({ id: "part-1", widthMm: "1000", lengthMm: "2000" })],
      sheets: [
        sheet({
          trimTopMm: "10",
          trimRightMm: "10",
          trimBottomMm: "10",
          trimLeftMm: "10",
        }),
      ],
    });
    const result = optimizeCutting(request);

    expect(validateCuttingResult(request, result)).toEqual([]);
    expect(result.sheets[0].placements[0]).toMatchObject({ xMm: "10", yMm: "10" });
    // 1000×2000 ÷ (1220×2440) = 67.18%
    expect(result.summary.yieldPercent).toBe("67.18");
  });

  it("기준에 못 미치는 조각은 잔재로 보고하지 않는다", () => {
    const request = input({
      parts: [part({ id: "part-1", widthMm: "1200", lengthMm: "2400" })],
      sheets: [
        sheet({
          minRemnantWidthMm: "100",
          minRemnantLengthMm: "100",
          minRemnantAreaM2: "0.05",
        }),
      ],
    });
    const result = optimizeCutting(request);

    expect(validateCuttingResult(request, result)).toEqual([]);
    // 남는 것은 20mm·40mm 폭의 가장자리뿐이라 잔재 기준에 못 미친다.
    expect(result.sheets[0].remnants).toEqual([]);
  });

  it("기준을 넘는 조각은 잔재로 보고한다", () => {
    const request = input({
      parts: [part({ id: "part-1", widthMm: "600", lengthMm: "600" })],
      sheets: [
        sheet({
          minRemnantWidthMm: "100",
          minRemnantLengthMm: "100",
          minRemnantAreaM2: "0.05",
        }),
      ],
    });
    const result = optimizeCutting(request);

    expect(validateCuttingResult(request, result)).toEqual([]);
    expect(result.sheets[0].remnants.length).toBeGreaterThan(0);
  });

  it("시간 상한을 넘겨도 유효한 결과를 낸다", () => {
    const sample = cuttingSampleSchema.parse(legacySamples[0]);
    let clock = 0;
    // 첫 전략을 마친 뒤 곧바로 상한을 넘긴 것으로 만든다.
    const result = optimizeCutting(sample.input, {
      timeBudgetMs: 10,
      now: () => {
        clock += 100;
        return clock;
      },
    });

    expect(validateCuttingResult(sample.input, result)).toEqual([]);
    expect(result.summary.unplacedParts).toEqual([]);
  });
});

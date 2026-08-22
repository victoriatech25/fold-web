import { describe, expect, it } from "vitest";

import {
  CUTTING_CONTRACT_VERSION,
  cuttingInputSchema,
  cuttingResultSchema,
  type CuttingInput,
  type CuttingResult,
} from "@/domain/cutting/schema";
import { compareWithSample, cuttingSampleSchema } from "@/domain/cutting/sample";
import legacySamples from "@/domain/cutting/fixtures/legacy-input-samples.json";
import { validateCuttingResult } from "@/domain/cutting/validate";

function baseInput(overrides: Partial<CuttingInput> = {}): CuttingInput {
  return cuttingInputSchema.parse({
    contractVersion: CUTTING_CONTRACT_VERSION,
    parts: [
      {
        id: "part-a",
        label: "측면 패널",
        widthMm: "500",
        lengthMm: "1000",
        quantity: 2,
        rotationAllowed: true,
        grainDirection: "NONE",
      },
    ],
    sheets: [
      {
        sheetItemId: "sheet-1",
        label: "알루미늄 1220×2440",
        widthMm: "1220",
        lengthMm: "2440",
        trimTopMm: "10",
        trimRightMm: "10",
        trimBottomMm: "10",
        trimLeftMm: "10",
        rotationPolicy: "FREE",
        grainAxis: "NONE",
        minRemnantWidthMm: "100",
        minRemnantLengthMm: "100",
        minRemnantAreaM2: "0.01",
        availableCount: null,
      },
    ],
    options: { bladeKerfMm: "3", objective: "SHEET_COUNT_FIRST", seed: null },
    ...overrides,
  });
}

function baseResult(overrides: Partial<CuttingResult> = {}): CuttingResult {
  return cuttingResultSchema.parse({
    contractVersion: CUTTING_CONTRACT_VERSION,
    engineVersion: "test-solver",
    seed: null,
    sheets: [
      {
        sheetIndex: 0,
        sheetItemId: "sheet-1",
        placements: [
          { partId: "part-a", xMm: "10", yMm: "10", rotated: false },
          { partId: "part-a", xMm: "513", yMm: "10", rotated: false },
        ],
        usedAreaM2: "1",
        remnants: [],
      },
    ],
    summary: {
      sheetCount: 1,
      totalAreaM2: "2.9768",
      usedAreaM2: "1",
      yieldPercent: "33.59",
      unplacedParts: [],
    },
    ...overrides,
  });
}

describe("cutting contract", () => {
  it("계약을 만족하는 배치는 위반이 없다", () => {
    expect(validateCuttingResult(baseInput(), baseResult())).toEqual([]);
  });

  it("Decimal 문자열을 정규화해 받는다", () => {
    const input = baseInput();
    expect(input.parts[0].widthMm).toBe("500");
    expect(cuttingInputSchema.parse({ ...input, options: { ...input.options, bladeKerfMm: "3.000" } }).options.bladeKerfMm).toBe("3");
  });

  it("사용 영역을 벗어난 배치를 잡는다", () => {
    const result = baseResult();
    result.sheets[0].placements[1] = { partId: "part-a", xMm: "800", yMm: "10", rotated: false };
    const violations = validateCuttingResult(baseInput(), result);
    expect(violations.map((item) => item.code)).toContain("OUT_OF_USABLE_AREA");
  });

  it("겹치는 배치를 잡는다", () => {
    const result = baseResult();
    result.sheets[0].placements[1] = { partId: "part-a", xMm: "400", yMm: "10", rotated: false };
    const violations = validateCuttingResult(baseInput(), result);
    expect(violations.map((item) => item.code)).toContain("OVERLAP");
  });

  it("칼날 두께가 확보되지 않은 배치를 잡는다", () => {
    const result = baseResult();
    // 500 에서 끝난 부품 바로 옆 511 은 간격이 1mm 라 3mm 칼날을 넣을 수 없다.
    result.sheets[0].placements[1] = { partId: "part-a", xMm: "511", yMm: "10", rotated: false };
    const violations = validateCuttingResult(baseInput(), result);
    expect(violations.map((item) => item.code)).toContain("KERF_NOT_KEPT");
  });

  it("허용하지 않은 회전을 잡는다", () => {
    const input = baseInput();
    input.parts[0].rotationAllowed = false;
    const result = baseResult();
    result.sheets[0].placements[0] = { partId: "part-a", xMm: "10", yMm: "10", rotated: true };
    const violations = validateCuttingResult(input, result);
    expect(violations.map((item) => item.code)).toContain("ROTATION_NOT_ALLOWED");
  });

  it("원판이 회전을 금지하면 부품이 허용해도 잡는다", () => {
    const input = baseInput();
    input.sheets[0].rotationPolicy = "FIXED";
    const result = baseResult();
    result.sheets[0].placements[0] = { partId: "part-a", xMm: "10", yMm: "10", rotated: true };
    expect(validateCuttingResult(input, result).map((item) => item.code)).toContain(
      "ROTATION_NOT_ALLOWED",
    );
  });

  it("결 방향이 어긋난 배치를 잡는다", () => {
    const input = baseInput();
    input.sheets[0].grainAxis = "LENGTH";
    input.parts[0].grainDirection = "LENGTH";
    const result = baseResult();
    // 회전하면 부품의 결이 폭 방향을 향해 원판 결과 어긋난다.
    result.sheets[0].placements[0] = { partId: "part-a", xMm: "10", yMm: "10", rotated: true };
    expect(validateCuttingResult(input, result).map((item) => item.code)).toContain(
      "GRAIN_CONFLICT",
    );
  });

  it("수량이 맞지 않으면 잡는다", () => {
    const result = baseResult();
    result.sheets[0].placements.pop();
    result.summary.usedAreaM2 = "0.5";
    result.sheets[0].usedAreaM2 = "0.5";
    expect(validateCuttingResult(baseInput(), result).map((item) => item.code)).toContain(
      "QUANTITY_MISMATCH",
    );
  });

  it("미배치로 보고하면 수량이 맞는다", () => {
    const result = baseResult();
    result.sheets[0].placements.pop();
    result.sheets[0].usedAreaM2 = "0.5";
    result.summary.usedAreaM2 = "0.5";
    result.summary.unplacedParts = [{ partId: "part-a", quantity: 1, reason: "TOO_LARGE" }];
    expect(validateCuttingResult(baseInput(), result)).toEqual([]);
  });

  it("직선 관통으로 자를 수 없는 배치를 잡는다", () => {
    const input = baseInput();
    input.options.bladeKerfMm = "0";
    input.parts = [
      { ...input.parts[0], id: "a", label: "A", widthMm: "600", lengthMm: "200", quantity: 1 },
      { ...input.parts[0], id: "b", label: "B", widthMm: "200", lengthMm: "600", quantity: 1 },
      { ...input.parts[0], id: "c", label: "C", widthMm: "600", lengthMm: "200", quantity: 1 },
      { ...input.parts[0], id: "d", label: "D", widthMm: "200", lengthMm: "600", quantity: 1 },
    ];
    const result = baseResult();
    // 가운데 구멍을 두고 네 조각이 서로 물린 pinwheel 배치다.
    // 어느 방향으로도 끝에서 끝까지 가르는 선이 없다.
    result.sheets[0].placements = [
      { partId: "a", xMm: "10", yMm: "10", rotated: false },
      { partId: "b", xMm: "610", yMm: "10", rotated: false },
      { partId: "c", xMm: "210", yMm: "610", rotated: false },
      { partId: "d", xMm: "10", yMm: "210", rotated: false },
    ];
    result.sheets[0].usedAreaM2 = "0.48";
    result.summary.usedAreaM2 = "0.48";
    expect(validateCuttingResult(input, result).map((item) => item.code)).toContain(
      "NOT_GUILLOTINE",
    );
  });

  it("줄 단위로 놓은 배치는 직선 관통으로 자를 수 있다", () => {
    expect(validateCuttingResult(baseInput(), baseResult()).map((item) => item.code)).not.toContain(
      "NOT_GUILLOTINE",
    );
  });

  it("기준에 못 미치는 잔재를 잡는다", () => {
    const result = baseResult();
    result.sheets[0].remnants = [
      { xMm: "1100", yMm: "10", widthMm: "50", lengthMm: "2000", areaM2: "0.1" },
    ];
    expect(validateCuttingResult(baseInput(), result).map((item) => item.code)).toContain(
      "REMNANT_TOO_SMALL",
    );
  });

  it("쓸 수 있는 장수를 넘기면 잡는다", () => {
    const input = baseInput();
    input.sheets[0].availableCount = 1;
    const result = baseResult();
    result.sheets.push({
      sheetIndex: 1,
      sheetItemId: "sheet-1",
      placements: [],
      usedAreaM2: "0",
      remnants: [],
    });
    result.summary.sheetCount = 2;
    expect(validateCuttingResult(input, result).map((item) => item.code)).toContain(
      "SHEET_LIMIT_EXCEEDED",
    );
  });

  it("사용 면적이 배치와 다르면 잡는다", () => {
    const result = baseResult();
    result.sheets[0].usedAreaM2 = "2";
    expect(validateCuttingResult(baseInput(), result).map((item) => item.code)).toContain(
      "AREA_MISMATCH",
    );
  });

  it("계약 버전이 다르면 더 보지 않는다", () => {
    const result = { ...baseResult(), contractVersion: "cutting-contract-v0" } as unknown as CuttingResult;
    const violations = validateCuttingResult(baseInput(), result);
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe("CONTRACT_VERSION_MISMATCH");
  });
});

describe("cutting sample", () => {
  const sample = cuttingSampleSchema.parse({
    name: "합성 표본 1",
    source: "SYNTHETIC",
    note: "MFC 표본 확보 전 계약 검증용",
    input: baseInput(),
    expected: { sheetCount: 1, yieldPercent: "33.59" },
  });

  it("원판 수가 같고 수율이 허용 편차 안이면 통과한다", () => {
    const comparison = compareWithSample(sample, baseResult());
    expect(comparison.passed).toBe(true);
  });

  it("수율이 2%p 넘게 낮으면 불합격이다", () => {
    const result = baseResult();
    result.summary.yieldPercent = "31.00";
    const comparison = compareWithSample(sample, result);
    expect(comparison.passed).toBe(false);
    expect(comparison.issues[0]).toContain("수율");
  });

  it("원판 수가 다르면 불합격이다", () => {
    const result = baseResult();
    result.summary.sheetCount = 2;
    const comparison = compareWithSample(sample, result);
    expect(comparison.passed).toBe(false);
    expect(comparison.issues[0]).toContain("원판 수");
  });
});

describe("legacy input samples", () => {
  const samples = legacySamples.map((entry) => cuttingSampleSchema.parse(entry));

  it("레거시 수주에서 뽑은 입력 표본을 계약으로 적재한다", () => {
    expect(samples.length).toBeGreaterThanOrEqual(3);
    for (const sample of samples) {
      expect(sample.source).toBe("MFC");
      expect(sample.input.parts.length).toBeGreaterThan(0);
      expect(sample.input.sheets.length).toBeGreaterThan(0);
    }
  });

  it("기대값이 없는 표본은 비교를 건너뛴다", () => {
    const comparison = compareWithSample(samples[0], baseResult());
    expect(comparison.compared).toBe(false);
    expect(comparison.issues).toEqual([]);
  });

  it("원판보다 긴 부품이 있어 회전이나 더 큰 원판이 필요하다", () => {
    // 실제 수주에는 1220×2440 에 그대로 들어가지 않는 부품이 섞여 있다.
    const sample = samples[0];
    const smallest = sample.input.sheets[0];
    const needsBiggerSheet = sample.input.parts.some(
      (part) =>
        Math.max(Number(part.widthMm), Number(part.lengthMm)) > Number(smallest.lengthMm),
    );
    expect(needsBiggerSheet).toBe(true);
  });
});

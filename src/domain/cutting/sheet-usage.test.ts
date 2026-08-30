import { describe, expect, it } from "vitest";

import {
  cuttingInputSchema,
  type CuttingInput,
  type CuttingResult,
  type CuttingSheet,
} from "@/domain/cutting/schema";
import { optimizeCutting } from "@/domain/cutting/solver/optimize";
import {
  readRemnantId,
  summarizeSheetUsage,
  toRemnantSheetKey,
} from "./sheet-usage";

function sheet(overrides: Partial<CuttingSheet> = {}): CuttingSheet {
  return {
    sheetItemId: "SHEET-1000x2000",
    label: "1000×2000",
    widthMm: "1000",
    lengthMm: "2000",
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
    parts: [
      {
        id: "part-1",
        label: "1. 본체",
        widthMm: "500",
        lengthMm: "1000",
        quantity: 2,
        rotationAllowed: true,
        grainDirection: "NONE",
      },
    ],
    sheets: [sheet()],
    options: { bladeKerfMm: "0", objective: "SHEET_COUNT_FIRST", seed: null },
    ...overrides,
  });
}

function result(overrides: Partial<CuttingResult> = {}): CuttingResult {
  return {
    contractVersion: "cutting-contract-v1",
    engineVersion: "test",
    seed: null,
    sheets: [],
    summary: {
      sheetCount: 0,
      totalAreaM2: "0",
      usedAreaM2: "0",
      yieldPercent: "0",
      unplacedParts: [],
    },
    ...overrides,
  };
}

describe("summarizeSheetUsage", () => {
  it("장수와 면적을 원판별로 접는다", () => {
    const breakdown = summarizeSheetUsage(
      input(),
      result({
        sheets: [
          {
            sheetIndex: 0,
            sheetItemId: "SHEET-1000x2000",
            placements: [],
            // 0.5m × 1m 두 장 = 1㎡
            usedAreaM2: "1",
            remnants: [],
          },
          {
            sheetIndex: 1,
            sheetItemId: "SHEET-1000x2000",
            placements: [],
            usedAreaM2: "0.5",
            remnants: [],
          },
        ],
      }),
    );

    expect(breakdown.items).toHaveLength(1);
    const [item] = breakdown.items;
    expect(item.sheetCount).toBe(2);
    // 원판 한 장이 2㎡ 이므로 두 장은 4㎡ 다.
    expect(item.totalAreaM2).toBe("4");
    expect(item.placedAreaM2).toBe("1.5");
    expect(item.lossAreaM2).toBe("2.5");
    expect(item.yieldPercent).toBe("37.5");
    expect(breakdown.totalSheetCount).toBe(2);
    expect(breakdown.yieldPercent).toBe("37.5");
  });

  it("잔재 면적을 손실에서 떼어 낸다", () => {
    const breakdown = summarizeSheetUsage(
      input(),
      result({
        sheets: [
          {
            sheetIndex: 0,
            sheetItemId: "SHEET-1000x2000",
            placements: [],
            usedAreaM2: "1",
            remnants: [
              { xMm: "0", yMm: "1000", widthMm: "1000", lengthMm: "500", areaM2: "0.5" },
            ],
          },
        ],
      }),
    );

    const [item] = breakdown.items;
    expect(item.remnantAreaM2).toBe("0.5");
    // 2㎡ 에서 배치 1㎡ 와 잔재 0.5㎡ 를 뺀 나머지가 손실이다.
    expect(item.lossAreaM2).toBe("0.5");
    expect(item.remnants).toEqual([
      { sheetIndex: 0, xMm: "0", yMm: "1000", widthMm: "1000", lengthMm: "500", areaM2: "0.5" },
    ]);
  });

  it("여러 규격을 쓰면 규격별로 나눠 센다", () => {
    const breakdown = summarizeSheetUsage(
      input({ sheets: [sheet(), sheet({ sheetItemId: "SHEET-1220x2440", label: "1220×2440", widthMm: "1220", lengthMm: "2440" })] }),
      result({
        sheets: [
          { sheetIndex: 0, sheetItemId: "SHEET-1220x2440", placements: [], usedAreaM2: "1", remnants: [] },
          { sheetIndex: 1, sheetItemId: "SHEET-1000x2000", placements: [], usedAreaM2: "1", remnants: [] },
          { sheetIndex: 2, sheetItemId: "SHEET-1000x2000", placements: [], usedAreaM2: "1", remnants: [] },
        ],
      }),
    );

    // 많이 쓴 원판이 앞에 온다.
    expect(breakdown.items.map((item) => [item.sheetKey, item.sheetCount])).toEqual([
      ["SHEET-1000x2000", 2],
      ["SHEET-1220x2440", 1],
    ]);
    expect(breakdown.totalSheetCount).toBe(3);
  });

  it("배치가 하나도 없으면 0 으로 답한다", () => {
    const breakdown = summarizeSheetUsage(input(), result());
    expect(breakdown.items).toEqual([]);
    expect(breakdown.totalSheetCount).toBe(0);
    expect(breakdown.yieldPercent).toBe("0");
    expect(breakdown.lossAreaM2).toBe("0");
  });

  it("입력에 없는 원판이 결과에 있으면 계산을 멈춘다", () => {
    expect(() =>
      summarizeSheetUsage(
        input(),
        result({
          sheets: [
            { sheetIndex: 0, sheetItemId: "SHEET-UNKNOWN", placements: [], usedAreaM2: "0", remnants: [] },
          ],
        }),
      ),
    ).toThrow(/입력에 없습니다/);
  });

  it("solver 가 낸 실제 결과와 총면적이 맞는다", () => {
    const built = input();
    const summary = summarizeSheetUsage(built, optimizeCutting(built));
    // 500×1000 두 장은 1000×2000 원판 한 장에 들어간다.
    expect(summary.totalSheetCount).toBe(1);
    expect(summary.totalAreaM2).toBe("2");
    expect(summary.placedAreaM2).toBe("1");
    expect(summary.yieldPercent).toBe("50");
  });
});

describe("잔재 원판 후보 id", () => {
  it("접두사를 붙였다 뗀다", () => {
    const key = toRemnantSheetKey("2f0e1b6e-0000-4000-8000-000000000000");
    expect(key).toBe("remnant:2f0e1b6e-0000-4000-8000-000000000000");
    expect(readRemnantId(key)).toBe("2f0e1b6e-0000-4000-8000-000000000000");
  });

  it("원판 품목 id 는 잔재가 아니다", () => {
    expect(readRemnantId("2f0e1b6e-0000-4000-8000-000000000000")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { emptyAnnotations, placementKey } from "@/domain/cutting/annotations";
import { buildManualEditResult, validateManualEdit } from "@/domain/cutting/manual-edit";
import type { CuttingInput, CuttingPlacement } from "@/domain/cutting/schema";
import { CUTTING_CONTRACT_VERSION } from "@/domain/cutting/schema";

// 1000×2000 원판, trim 없음, kerf 3. 부품 A 400×500 ×4, B 300×300 ×1.
const input: CuttingInput = {
  contractVersion: CUTTING_CONTRACT_VERSION,
  parts: [
    { id: "A", label: "1. A", widthMm: "400", lengthMm: "500", quantity: 4, rotationAllowed: true, grainDirection: "NONE" },
    { id: "B", label: "2. B", widthMm: "300", lengthMm: "300", quantity: 1, rotationAllowed: true, grainDirection: "NONE" },
  ],
  sheets: [
    {
      sheetItemId: "S1",
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
    },
  ],
  options: { bladeKerfMm: "3", objective: "SHEET_COUNT_FIRST", seed: null },
};

const at = (partId: string, xMm: string, yMm: string, rotated = false): CuttingPlacement => ({
  partId,
  xMm,
  yMm,
  rotated,
});

// A 를 2×2 격자로. kerf 3 을 띄운다.
const grid = [at("A", "0", "0"), at("A", "403", "0"), at("A", "0", "503"), at("A", "403", "503")];

describe("buildManualEditResult", () => {
  it("배치 수를 세어 미배치와 면적·수율을 서버가 채운다", () => {
    const result = buildManualEditResult(input, [{ sheetItemId: "S1", placements: grid.slice(0, 3) }]);

    expect(result.engineVersion).toBe("manual-edit-v1");
    expect(result.sheets[0].usedAreaM2).toBe("0.6");
    expect(result.sheets[0].remnants).toEqual([]);
    expect(result.summary).toMatchObject({
      sheetCount: 1,
      totalAreaM2: "2",
      usedAreaM2: "0.6",
      yieldPercent: "30",
      unplacedParts: [
        { partId: "A", quantity: 1, reason: "OTHER" },
        { partId: "B", quantity: 1, reason: "OTHER" },
      ],
    });
  });
});

describe("validateManualEdit", () => {
  it("guillotine·kerf 위반은 경고로 내리고 겹침은 거부한다", () => {
    // 풍차 모양: 직선 관통으로 자를 수 없다. 겹치지는 않는다.
    const pinwheel = [
      at("A", "0", "0", true), // 500×400 @ (0,0)
      at("A", "503", "0"), // 400×500 @ (503,0)
      at("A", "0", "403"), // 400×500 @ (0,403)
      at("A", "403", "503", true), // 500×400 @ (403,503)
    ];
    const result = buildManualEditResult(input, [{ sheetItemId: "S1", placements: pinwheel }]);
    const outcome = validateManualEdit(input, result, emptyAnnotations());

    expect(outcome.violations).toEqual([]);
    expect(outcome.warnings.map((w) => w.code)).toContain("NOT_GUILLOTINE");

    const overlapping = buildManualEditResult(input, [
      { sheetItemId: "S1", placements: [at("A", "0", "0"), at("A", "100", "100")] },
    ]);
    expect(validateManualEdit(input, overlapping, emptyAnnotations()).violations.map((v) => v.code)).toContain(
      "OVERLAP",
    );
  });

  it("부품을 수량보다 많이 놓으면 거부한다", () => {
    const result = buildManualEditResult(input, [
      { sheetItemId: "S1", placements: [...grid, at("A", "0", "1006")] },
    ]);
    const outcome = validateManualEdit(input, result, emptyAnnotations());
    expect(outcome.violations.map((v) => v.code)).toContain("QUANTITY_MISMATCH");
  });

  it("격자로 놓인 같은 부품만 레이저 그룹으로 묶고 bounds 를 다시 계산한다", () => {
    const result = buildManualEditResult(input, [{ sheetItemId: "S1", placements: grid }]);
    const annotations = {
      ...emptyAnnotations(),
      laserGroups: [
        {
          id: "g1",
          sheetIndex: 0,
          placementKeys: [0, 1, 2, 3].map((n) => placementKey("A", n)),
          boundsMm: { xMm: "999", yMm: "999", widthMm: "1", lengthMm: "1" },
        },
      ],
    };
    const outcome = validateManualEdit(input, result, annotations);

    expect(outcome.violations).toEqual([]);
    expect(outcome.normalizedAnnotations.laserGroups[0].boundsMm).toEqual({
      xMm: "0",
      yMm: "0",
      widthMm: "803",
      lengthMm: "1003",
    });
  });

  it("격자가 아니거나 다른 부품이 섞이면 레이저 그룹을 거부한다", () => {
    const result = buildManualEditResult(input, [
      { sheetItemId: "S1", placements: [...grid.slice(0, 3), at("B", "403", "503")] },
    ]);
    const lShape = {
      ...emptyAnnotations(),
      laserGroups: [
        { id: "g1", sheetIndex: 0, placementKeys: [0, 1, 2].map((n) => placementKey("A", n)), boundsMm: { xMm: "0", yMm: "0", widthMm: "1", lengthMm: "1" } },
      ],
    };
    expect(validateManualEdit(input, result, lShape).violations.map((v) => v.code)).toEqual([
      "LASER_GROUP_NOT_RECTANGLE",
    ]);

    const mixed = {
      ...emptyAnnotations(),
      laserGroups: [
        { id: "g2", sheetIndex: 0, placementKeys: [placementKey("A", 2), placementKey("B", 0)], boundsMm: { xMm: "0", yMm: "0", widthMm: "1", lengthMm: "1" } },
      ],
    };
    expect(validateManualEdit(input, result, mixed).violations.map((v) => v.code)).toEqual([
      "LASER_GROUP_MIXED_PART",
    ]);
  });

  it("한 배치를 두 그룹에 넣거나 없는 배치를 가리키면 거부한다", () => {
    const result = buildManualEditResult(input, [{ sheetItemId: "S1", placements: grid }]);
    const bounds = { xMm: "0", yMm: "0", widthMm: "1", lengthMm: "1" };
    const annotations = {
      ...emptyAnnotations(),
      laserGroups: [
        { id: "g1", sheetIndex: 0, placementKeys: [placementKey("A", 0), placementKey("A", 1)], boundsMm: bounds },
        { id: "g2", sheetIndex: 0, placementKeys: [placementKey("A", 1), placementKey("A", 3)], boundsMm: bounds },
        { id: "g3", sheetIndex: 1, placementKeys: [placementKey("A", 0)], boundsMm: bounds },
        { id: "g4", sheetIndex: 0, placementKeys: [placementKey("A", 9)], boundsMm: bounds },
      ],
    };
    const codes = validateManualEdit(input, result, annotations).violations.map((v) => v.code);
    expect(codes).toEqual(["LASER_GROUP_OVERLAP", "ANNOTATION_UNKNOWN_SHEET", "ANNOTATION_UNKNOWN_PLACEMENT"]);
  });

  it("가로 절단선은 부품을 가로지르거나 원판 밖이면 거부한다", () => {
    const result = buildManualEditResult(input, [{ sheetItemId: "S1", placements: grid }]);
    const lines = (yMm: string) => ({
      ...emptyAnnotations(),
      horizontalCutLines: [{ id: "l", sheetIndex: 0, yMm }],
    });
    expect(validateManualEdit(input, result, lines("250")).violations.map((v) => v.code)).toEqual([
      "CUT_LINE_CROSSES_PART",
    ]);
    expect(validateManualEdit(input, result, lines("2500")).violations.map((v) => v.code)).toEqual([
      "CUT_LINE_OUT_OF_SHEET",
    ]);
    // 경계(501.5 는 kerf 틈)와 빈 영역은 된다.
    expect(validateManualEdit(input, result, lines("501.5")).violations).toEqual([]);
    expect(validateManualEdit(input, result, lines("1500")).violations).toEqual([]);
  });
});

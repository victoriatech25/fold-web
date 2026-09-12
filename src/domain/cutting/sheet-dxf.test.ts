import { describe, expect, it } from "vitest";

import type { CuttingInput, CuttingSheetResult } from "@/domain/cutting/schema";
import { CUTTING_CONTRACT_VERSION } from "@/domain/cutting/schema";
import { alphaIndex, buildSheetDxf, dateKeyOf, laserGroupDxfFileName, sheetDxfFileName, type PartGeometry } from "@/domain/cutting/sheet-dxf";
import type { ManufacturingGeometry } from "@/domain/manufacturing-geometry";

const input: CuttingInput = {
  contractVersion: CUTTING_CONTRACT_VERSION,
  parts: [{ id: "A", label: "A", widthMm: "400", lengthMm: "500", quantity: 4, rotationAllowed: true, grainDirection: "NONE" }],
  sheets: [
    {
      sheetItemId: "S1",
      label: "S1",
      widthMm: "1000",
      lengthMm: "2000",
      trimTopMm: "0",
      trimRightMm: "0",
      trimBottomMm: "0",
      trimLeftMm: "10",
      rotationPolicy: "FREE",
      grainAxis: "NONE",
      minRemnantWidthMm: null,
      minRemnantLengthMm: null,
      minRemnantAreaM2: null,
      availableCount: null,
    },
  ],
  options: { bladeKerfMm: "0", objective: "SHEET_COUNT_FIRST", seed: null },
};

// 2×2 격자, kerf 0 이라 이웃 변이 겹친다.
const sheet: CuttingSheetResult = {
  sheetIndex: 0,
  sheetItemId: "S1",
  placements: [
    { partId: "A", xMm: "10", yMm: "0", rotated: false },
    { partId: "A", xMm: "410", yMm: "0", rotated: false },
    { partId: "A", xMm: "10", yMm: "500", rotated: false },
    { partId: "A", xMm: "410", yMm: "500", rotated: false },
  ],
  usedAreaM2: "0.8",
  remnants: [],
};

// 제작 geometry: x 가 제품 길이(500), y 가 전개 폭(400). 폭 150 자리에 V-cut.
const geometry: ManufacturingGeometry = {
  version: "manufacturing-geometry-v1",
  unit: "mm",
  profileId: "p",
  profileType: "normal",
  entities: [
    { kind: "line", id: "v", layer: "V_CUT", start: { x: 0, y: 150 }, end: { x: 500, y: 150 } },
    { kind: "line", id: "b", layer: "BEND", start: { x: 0, y: 300 }, end: { x: 500, y: 300 } },
  ],
  bounds: { minX: 0, minY: 0, maxX: 500, maxY: 400, width: 500, height: 400 },
};
const partGeometries = new Map<string, PartGeometry>([["A", { geometry, vCutDepthMm: 1.5, aCutDepthMm: 0.8 }]]);

const base = { input, sheet, sheetIndex: 0, partGeometries, thicknessMm: "1.2", colorCode: "AL1T" };

function lines(doc: ReturnType<typeof buildSheetDxf>, layer: string) {
  return doc.entities.filter((e) => e.layer === layer).map((e) => [e.start.x, e.start.y, e.end.x, e.end.y]);
}

describe("buildSheetDxf", () => {
  it("외곽·절단선·절곡선을 MFC 레이어 이름으로 내고 겹치는 절단선은 합친다", () => {
    const doc = buildSheetDxf({ ...base, annotations: null });
    expect(doc.layers.map((l) => l.name)).toEqual(["-b-1.20-AL1T", "-L-", "-X-", "- -", "-V-150"]);
    expect(lines(doc, "-b-1.20-AL1T")).toHaveLength(4);
    // 세로선: x=10, 410, 810 각 한 줄(0~1000). 8개가 아니라 3개로 합쳐진다.
    expect(lines(doc, "-L-")).toEqual([
      [10, 0, 10, 1000],
      [410, 0, 410, 1000],
      [810, 0, 810, 1000],
    ]);
    expect(lines(doc, "-X-")).toEqual([
      [10, 0, 810, 0],
      [10, 500, 810, 500],
      [10, 1000, 810, 1000],
    ]);
    // V-cut: 회전 없는 배치는 축을 맞바꿔 x = 배치x + 150, y 는 길이 방향 0~500.
    expect(lines(doc, "-V-150")).toHaveLength(4);
    expect(lines(doc, "-V-150")[0]).toEqual([160, 0, 160, 500]);
    expect(doc.entities.some((e) => e.layer.includes("BEND"))).toBe(false);
  });

  it("레이저 그룹 안쪽 선은 `- -` 로 빼고 외곽은 남긴다. 필름은 L1/X1 이다", () => {
    const doc = buildSheetDxf({
      ...base,
      annotations: {
        version: "cutting-annotations-v1",
        laserGroups: [
          { id: "g", sheetIndex: 0, placementKeys: ["A#0", "A#1", "A#2", "A#3"], boundsMm: { xMm: "10", yMm: "0", widthMm: "800", lengthMm: "1000" } },
        ],
        horizontalCutLines: [{ id: "l", sheetIndex: 0, yMm: "1500" }],
        sheets: [{ sheetIndex: 0, film: true }],
      },
    });
    expect(lines(doc, "- -")).toEqual([
      [410, 0, 410, 1000],
      [10, 500, 810, 500],
    ]);
    expect(lines(doc, "-L1-")).toEqual([
      [10, 0, 10, 1000],
      [810, 0, 810, 1000],
    ]);
    // 가로 절단선은 사용 영역(trim 10 제외) 폭 전체.
    expect(lines(doc, "-X1-")).toContainEqual([10, 1500, 1000, 1500]);
    expect(doc.entities.some((e) => e.layer === "-L-" || e.layer === "-X-")).toBe(false);
  });

  it("회전한 배치는 절곡선 축을 그대로 둔다", () => {
    const doc = buildSheetDxf({
      ...base,
      sheet: { ...sheet, placements: [{ partId: "A", xMm: "0", yMm: "0", rotated: true }] },
      annotations: null,
    });
    expect(lines(doc, "-V-150")).toEqual([[0, 150, 500, 150]]);
  });
});

describe("file names", () => {
  it("MFC 규칙대로 만든다", () => {
    expect(alphaIndex(0)).toBe("A");
    expect(alphaIndex(25)).toBe("Z");
    expect(alphaIndex(26)).toBe("AA");
    expect(sheetDxfFileName({ dateKey: "260912", sequence: 3, sheetIndex: 1, film: false })).toBe("260912-03-B.dxf");
    expect(sheetDxfFileName({ dateKey: "260912", sequence: 3, sheetIndex: 0, film: true })).toBe("F260912-03-A.dxf");
    expect(laserGroupDxfFileName({ dateKey: "260912", sequence: 12, sheetIndex: 0, groupOrdinal: 0, film: false })).toBe("260912-12-A-1.dxf");
    expect(dateKeyOf(new Date("2026-09-12T16:30:00Z"))).toBe("260913"); // KST 자정 넘김
  });
});

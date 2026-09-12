import { describe, expect, it } from "vitest";

import { placementKey } from "@/domain/cutting/annotations";
import {
  addSheet,
  createEditorState,
  deleteSheet,
  insertPlacement,
  movePlacement,
  placementIssue,
  redo,
  removePlacement,
  snapPosition,
  toSaveAnnotations,
  toSaveSheets,
  undo,
  unplacedCounts,
} from "@/domain/cutting/editor-state";
import type { CuttingInput, CuttingResult } from "@/domain/cutting/schema";
import { CUTTING_CONTRACT_VERSION } from "@/domain/cutting/schema";

const input: CuttingInput = {
  contractVersion: CUTTING_CONTRACT_VERSION,
  parts: [
    { id: "A", label: "A", widthMm: "400", lengthMm: "500", quantity: 3, rotationAllowed: true, grainDirection: "NONE" },
    { id: "B", label: "B", widthMm: "300", lengthMm: "300", quantity: 1, rotationAllowed: true, grainDirection: "NONE" },
  ],
  sheets: [
    {
      sheetItemId: "S1",
      label: "S1",
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

const result: CuttingResult = {
  contractVersion: CUTTING_CONTRACT_VERSION,
  engineVersion: "test",
  seed: null,
  sheets: [
    {
      sheetIndex: 0,
      sheetItemId: "S1",
      placements: [
        { partId: "A", xMm: "0", yMm: "0", rotated: false },
        { partId: "A", xMm: "403", yMm: "0", rotated: false },
        { partId: "B", xMm: "0", yMm: "503", rotated: false },
      ],
      usedAreaM2: "0",
      remnants: [],
    },
  ],
  summary: { sheetCount: 1, totalAreaM2: "2", usedAreaM2: "0", yieldPercent: "0", unplacedParts: [] },
};

describe("editor state", () => {
  it("저장된 지정을 편집기 키로 바꿔 들고 다시 저장 형식으로 돌린다", () => {
    const state = createEditorState(result, {
      version: "cutting-annotations-v1",
      laserGroups: [
        {
          id: "g1",
          sheetIndex: 0,
          placementKeys: [placementKey("A", 0), placementKey("A", 1)],
          boundsMm: { xMm: "0", yMm: "0", widthMm: "803", lengthMm: "500" },
        },
      ],
      horizontalCutLines: [{ id: "l1", sheetIndex: 0, yMm: "1500" }],
      sheets: [{ sheetIndex: 0, film: true }],
    });
    const [first, second] = state.sheets[0].placements;
    expect(state.annotations.laserGroups[0].placementKeys).toEqual([first.key, second.key]);
    expect(state.annotations.filmSheetKeys).toEqual([state.sheets[0].key]);

    const saved = toSaveAnnotations(state);
    expect(saved.laserGroups[0]).toMatchObject({ sheetIndex: 0, placementKeys: ["A#0", "A#1"] });
    expect(saved.horizontalCutLines).toEqual([{ id: "l1", sheetIndex: 0, yMm: "1500" }]);
    expect(saved.sheets).toEqual([{ sheetIndex: 0, film: true }]);
  });

  it("배치를 빼면 뒤 번호가 밀려도 저장 키가 남은 배치를 정확히 가리킨다", () => {
    let state = createEditorState(result, {
      version: "cutting-annotations-v1",
      laserGroups: [
        { id: "g1", sheetIndex: 0, placementKeys: [placementKey("A", 1)], boundsMm: { xMm: "0", yMm: "0", widthMm: "1", lengthMm: "1" } },
      ],
      horizontalCutLines: [],
      sheets: [],
    });
    const firstA = state.sheets[0].placements[0];
    state = removePlacement(state, firstA.key);
    // 남은 A 는 이제 0번째다. 그룹은 그 배치를 그대로 가리켜야 한다.
    expect(toSaveAnnotations(state).laserGroups[0].placementKeys).toEqual(["A#0"]);
    expect(unplacedCounts(input, state.sheets).get("A")).toBe(2);
  });

  it("옮긴 배치는 레이저 그룹에서 빠지고 실행취소로 되돌아온다", () => {
    let state = createEditorState(result, {
      version: "cutting-annotations-v1",
      laserGroups: [
        { id: "g1", sheetIndex: 0, placementKeys: ["A#0", "A#1"], boundsMm: { xMm: "0", yMm: "0", widthMm: "1", lengthMm: "1" } },
      ],
      horizontalCutLines: [],
      sheets: [],
    });
    const key = state.sheets[0].placements[1].key;
    state = movePlacement(state, key, { sheetIndex: 0, xMm: 0, yMm: 1000, rotated: true });
    expect(state.annotations.laserGroups).toEqual([]);
    expect(state.sheets[0].placements.find((p) => p.key === key)).toMatchObject({ xMm: 0, yMm: 1000, rotated: true });

    state = undo(state);
    expect(state.annotations.laserGroups).toHaveLength(1);
    state = redo(state);
    expect(state.annotations.laserGroups).toEqual([]);
  });

  it("원판을 더하고 빈 원판만 지운다", () => {
    let state = createEditorState(result, null);
    state = addSheet(state, "S1");
    expect(state.sheets).toHaveLength(2);
    state = deleteSheet(state, 0); // 배치가 있어 못 지운다
    expect(state.sheets).toHaveLength(2);
    state = deleteSheet(state, 1);
    expect(state.sheets).toHaveLength(1);
    state = deleteSheet(state, 0); // 마지막 한 장은 남긴다
    expect(state.sheets).toHaveLength(1);
  });

  it("미배치 부품은 남은 수량만큼만 놓는다", () => {
    let state = createEditorState(result, null);
    state = insertPlacement(state, input, "A", { sheetIndex: 0, xMm: 0, yMm: 1000, rotated: false });
    expect(state.sheets[0].placements).toHaveLength(4);
    const blocked = insertPlacement(state, input, "A", { sheetIndex: 0, xMm: 0, yMm: 1500, rotated: false });
    expect(blocked).toBe(state);
    expect(toSaveSheets(state.sheets)[0].placements[3]).toEqual({ partId: "A", xMm: "0", yMm: "1000", rotated: false });
  });

  it("이웃 변에 kerf 만큼 띄워 붙이고 겹침·이탈을 즉시 판정한다", () => {
    const usable = { x: 0, y: 0, width: 1000, height: 2000 };
    const neighbour = { x: 0, y: 0, width: 400, height: 500 };
    const snapped = snapPosition({ x: 407, y: 2, width: 400, height: 500 }, [neighbour], usable, {
      kerfMm: 3,
      thresholdMm: 10,
    });
    expect(snapped).toEqual({ x: 403, y: 0 });
    expect(placementIssue({ x: 403, y: 0, width: 400, height: 500 }, [neighbour], usable)).toBeNull();
    expect(placementIssue({ x: 100, y: 100, width: 400, height: 500 }, [neighbour], usable)).toBe("OVERLAP");
    expect(placementIssue({ x: 700, y: 0, width: 400, height: 500 }, [neighbour], usable)).toBe("OUT_OF_USABLE_AREA");
  });
});

describe("editor annotations", () => {
  const partById = new Map(input.parts.map((part) => [part.id, part]));

  it("격자로 놓인 같은 부품만 묶고, 섞이거나 이미 묶인 것은 거부한다", async () => {
    const { addLaserGroup, laserGroupIssue, removeLaserGroup } = await import("@/domain/cutting/editor-state");
    let state = createEditorState(result, null);
    const [a0, a1, b0] = state.sheets[0].placements;

    expect(laserGroupIssue(state, 0, [a0.key, a1.key], partById)).toBeNull();
    expect(laserGroupIssue(state, 0, [a0.key, b0.key], partById)).toBe("MIXED_PART");
    expect(laserGroupIssue(state, 0, [], partById)).toBe("EMPTY");

    state = addLaserGroup(state, 0, [a0.key, a1.key]);
    expect(state.annotations.laserGroups).toHaveLength(1);
    expect(laserGroupIssue(state, 0, [a1.key], partById)).toBe("OVERLAP");
    expect(toSaveAnnotations(state).laserGroups[0].placementKeys).toEqual(["A#0", "A#1"]);

    state = removeLaserGroup(state, state.annotations.laserGroups[0].id);
    expect(state.annotations.laserGroups).toEqual([]);
  });

  it("L자로 놓인 배치는 격자가 아니라 거부한다", async () => {
    const { laserGroupIssue } = await import("@/domain/cutting/editor-state");
    let state = createEditorState(result, null);
    state = insertPlacement(state, input, "A", { sheetIndex: 0, xMm: 0, yMm: 1000, rotated: false });
    const [a0, a1, , a2] = state.sheets[0].placements;
    expect(laserGroupIssue(state, 0, [a0.key, a1.key, a2.key], partById)).toBe("NOT_RECTANGLE");
  });

  it("절단선은 부품 사이에만 두고 필름은 원판 단위로 켠다", async () => {
    const { addCutLine, cutLineIssue, removeCutLine, toggleFilm } = await import("@/domain/cutting/editor-state");
    let state = createEditorState(result, null);
    const spec = input.sheets[0];
    expect(cutLineIssue(state, 0, 250, spec, partById)).toBe("CROSSES_PART");
    expect(cutLineIssue(state, 0, 2500, spec, partById)).toBe("OUT_OF_SHEET");
    expect(cutLineIssue(state, 0, 1500, spec, partById)).toBeNull();

    state = addCutLine(state, 0, 1500);
    state = toggleFilm(state, 0);
    const saved = toSaveAnnotations(state);
    expect(saved.horizontalCutLines).toEqual([{ id: state.annotations.horizontalCutLines[0].id, sheetIndex: 0, yMm: "1500" }]);
    expect(saved.sheets).toEqual([{ sheetIndex: 0, film: true }]);

    state = removeCutLine(state, state.annotations.horizontalCutLines[0].id);
    state = toggleFilm(state, 0);
    expect(toSaveAnnotations(state)).toMatchObject({ horizontalCutLines: [], sheets: [{ sheetIndex: 0, film: false }] });
    expect(undo(undo(state)).annotations.filmSheetKeys).toHaveLength(1);
  });
});

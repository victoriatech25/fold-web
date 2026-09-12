import { CUTTING_ANNOTATIONS_VERSION, assignPlacementKeys, type CuttingAnnotations } from "@/domain/cutting/annotations";
import type { CuttingInput, CuttingPart, CuttingResult, CuttingSheet } from "@/domain/cutting/schema";

/**
 * 재단 배치 편집기의 상태와 순수 조작(`P2-B11` 4.6). 화면 코드는 여기 함수만 부른다.
 *
 * 길이는 편집 중에는 mm 숫자로 다루고 저장 직전에 문자열로 돌린다. 드래그 산술을
 * bigint 로 하면 화면 코드가 무거워지고, 저장 값은 `toMm` 이 소수 셋째 자리에서
 * 잘라 계약의 소수 6자리 안에 들어간다.
 */

export type EditorPlacement = {
  /** 편집 세션 안에서만 쓰는 ID. 저장 시 버린다. */
  key: string;
  partId: string;
  xMm: number;
  yMm: number;
  rotated: boolean;
};

export type EditorSheet = {
  key: string;
  sheetItemId: string;
  placements: EditorPlacement[];
};

/**
 * 편집 중 지정은 원판·배치를 편집기 키로 가리킨다. 저장 형식(`sheetIndex`·`partId#n`)은
 * 배치를 하나 빼거나 원판을 지우면 뒤 번호가 밀려 어긋나므로 편집 중에는 쓰지 않는다.
 * `toSaveAnnotations` 가 저장 직전에 한 번 변환한다.
 */
export type EditorLaserGroup = { id: string; sheetKey: string; placementKeys: string[] };
export type EditorCutLine = { id: string; sheetKey: string; yMm: number };
export type EditorAnnotations = {
  laserGroups: EditorLaserGroup[];
  horizontalCutLines: EditorCutLine[];
  /** 필름을 켠 원판의 키. */
  filmSheetKeys: string[];
};

export type EditorSnapshot = {
  sheets: EditorSheet[];
  annotations: EditorAnnotations;
};

export type EditorState = EditorSnapshot & {
  past: EditorSnapshot[];
  future: EditorSnapshot[];
};

export type RectMm = { x: number; y: number; width: number; height: number };

const HISTORY_LIMIT = 100;

let sequence = 0;
export function nextKey(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

export function toMm(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

export function partSize(part: CuttingPart, rotated: boolean): { width: number; height: number } {
  const width = Number(part.widthMm);
  const length = Number(part.lengthMm);
  return rotated ? { width: length, height: width } : { width, height: length };
}

export function placementRect(part: CuttingPart, placement: EditorPlacement): RectMm {
  const size = partSize(part, placement.rotated);
  return { x: placement.xMm, y: placement.yMm, ...size };
}

export function usableRect(sheet: CuttingSheet): RectMm {
  const left = Number(sheet.trimLeftMm);
  const bottom = Number(sheet.trimBottomMm);
  return {
    x: left,
    y: bottom,
    width: Number(sheet.widthMm) - left - Number(sheet.trimRightMm),
    height: Number(sheet.lengthMm) - bottom - Number(sheet.trimTopMm),
  };
}

const EPSILON = 1e-6;

export function rectsOverlap(a: RectMm, b: RectMm): boolean {
  return (
    a.x < b.x + b.width - EPSILON &&
    b.x < a.x + a.width - EPSILON &&
    a.y < b.y + b.height - EPSILON &&
    b.y < a.y + a.height - EPSILON
  );
}

export function rectInside(inner: RectMm, outer: RectMm): boolean {
  return (
    inner.x >= outer.x - EPSILON &&
    inner.y >= outer.y - EPSILON &&
    inner.x + inner.width <= outer.x + outer.width + EPSILON &&
    inner.y + inner.height <= outer.y + outer.height + EPSILON
  );
}

/** 저장된 결과와 지정에서 편집 상태를 만든다. 저장 형식의 지정은 편집기 키로 바꿔 든다. */
export function createEditorState(result: CuttingResult, annotations: CuttingAnnotations | null): EditorState {
  const sheets: EditorSheet[] = result.sheets.map((sheet) => ({
    key: nextKey("sheet"),
    sheetItemId: sheet.sheetItemId,
    placements: sheet.placements.map((placement) => ({
      key: nextKey("piece"),
      partId: placement.partId,
      xMm: Number(placement.xMm),
      yMm: Number(placement.yMm),
      rotated: placement.rotated,
    })),
  }));
  // 저장 키(`partId#n`) → 편집기 키. 원판마다 `assignPlacementKeys` 와 같은 순서다.
  const keyMaps = result.sheets.map((sheet, sheetIndex) => {
    const saved = assignPlacementKeys(sheet);
    return new Map(saved.map((savedKey, index) => [savedKey, sheets[sheetIndex].placements[index].key]));
  });
  const sheetKeyAt = (sheetIndex: number) => sheets[sheetIndex]?.key ?? null;

  const editorAnnotations: EditorAnnotations = { laserGroups: [], horizontalCutLines: [], filmSheetKeys: [] };
  for (const group of annotations?.laserGroups ?? []) {
    const sheetKey = sheetKeyAt(group.sheetIndex);
    const keys = group.placementKeys.map((key) => keyMaps[group.sheetIndex]?.get(key)).filter((k): k is string => !!k);
    if (sheetKey && keys.length === group.placementKeys.length) {
      editorAnnotations.laserGroups.push({ id: group.id, sheetKey, placementKeys: keys });
    }
  }
  for (const line of annotations?.horizontalCutLines ?? []) {
    const sheetKey = sheetKeyAt(line.sheetIndex);
    if (sheetKey) editorAnnotations.horizontalCutLines.push({ id: line.id, sheetKey, yMm: Number(line.yMm) });
  }
  for (const sheet of annotations?.sheets ?? []) {
    const sheetKey = sheetKeyAt(sheet.sheetIndex);
    if (sheetKey && sheet.film) editorAnnotations.filmSheetKeys.push(sheetKey);
  }

  return { sheets, annotations: editorAnnotations, past: [], future: [] };
}

/** 부품별 미배치 수량. 입력 수량에서 놓인 수를 뺀다. 음수면 수량 초과다. */
export function unplacedCounts(input: CuttingInput, sheets: EditorSheet[]): Map<string, number> {
  const counts = new Map(input.parts.map((part) => [part.id, part.quantity]));
  for (const sheet of sheets) {
    for (const placement of sheet.placements) {
      counts.set(placement.partId, (counts.get(placement.partId) ?? 0) - 1);
    }
  }
  return counts;
}

function commit(state: EditorState, next: EditorSnapshot): EditorState {
  return {
    ...next,
    past: [...state.past.slice(-(HISTORY_LIMIT - 1)), { sheets: state.sheets, annotations: state.annotations }],
    future: [],
  };
}

export function undo(state: EditorState): EditorState {
  const previous = state.past[state.past.length - 1];
  if (!previous) return state;
  return {
    ...previous,
    past: state.past.slice(0, -1),
    future: [{ sheets: state.sheets, annotations: state.annotations }, ...state.future],
  };
}

export function redo(state: EditorState): EditorState {
  const [next, ...rest] = state.future;
  if (!next) return state;
  return {
    ...next,
    past: [...state.past, { sheets: state.sheets, annotations: state.annotations }],
    future: rest,
  };
}

/** 원판을 지우면 그 원판을 가리키던 지정도 같이 지운다. */
function dropSheetAnnotations(annotations: EditorAnnotations, sheetKey: string): EditorAnnotations {
  return {
    laserGroups: annotations.laserGroups.filter((group) => group.sheetKey !== sheetKey),
    horizontalCutLines: annotations.horizontalCutLines.filter((line) => line.sheetKey !== sheetKey),
    filmSheetKeys: annotations.filmSheetKeys.filter((key) => key !== sheetKey),
  };
}

/** 배치가 움직이거나 빠지면 그 배치를 담고 있던 레이저 그룹은 뜻을 잃으므로 그룹째 지운다. */
function dropGroupsWithPlacement(annotations: EditorAnnotations, placementKey: string): EditorAnnotations {
  return {
    ...annotations,
    laserGroups: annotations.laserGroups.filter((group) => !group.placementKeys.includes(placementKey)),
  };
}

export function addSheet(state: EditorState, sheetItemId: string): EditorState {
  return commit(state, {
    sheets: [...state.sheets, { key: nextKey("sheet"), sheetItemId, placements: [] }],
    annotations: state.annotations,
  });
}

/** 빈 원판만 지운다. 마지막 한 장은 남긴다. */
export function deleteSheet(state: EditorState, sheetIndex: number): EditorState {
  const target = state.sheets[sheetIndex];
  if (!target || target.placements.length > 0 || state.sheets.length <= 1) return state;
  return commit(state, {
    sheets: state.sheets.filter((_, index) => index !== sheetIndex),
    annotations: dropSheetAnnotations(state.annotations, target.key),
  });
}

export type PlaceTarget = { sheetIndex: number; xMm: number; yMm: number; rotated: boolean };

/** 미배치 부품을 원판에 놓는다. 수량이 남아 있을 때만. */
export function insertPlacement(
  state: EditorState,
  input: CuttingInput,
  partId: string,
  target: PlaceTarget,
): EditorState {
  if ((unplacedCounts(input, state.sheets).get(partId) ?? 0) <= 0) return state;
  if (!state.sheets[target.sheetIndex]) return state;
  const placement: EditorPlacement = {
    key: nextKey("piece"),
    partId,
    xMm: target.xMm,
    yMm: target.yMm,
    rotated: target.rotated,
  };
  return commit(state, {
    sheets: state.sheets.map((sheet, index) =>
      index === target.sheetIndex ? { ...sheet, placements: [...sheet.placements, placement] } : sheet,
    ),
    annotations: state.annotations,
  });
}

function locate(state: EditorState, key: string): { sheetIndex: number; placement: EditorPlacement } | null {
  for (let sheetIndex = 0; sheetIndex < state.sheets.length; sheetIndex += 1) {
    const placement = state.sheets[sheetIndex].placements.find((item) => item.key === key);
    if (placement) return { sheetIndex, placement };
  }
  return null;
}

/** 배치를 같은 원판 안이나 다른 원판으로 옮긴다. 옮기면 레이저 그룹에서 빠진다. */
export function movePlacement(state: EditorState, key: string, target: PlaceTarget): EditorState {
  const found = locate(state, key);
  if (!found || !state.sheets[target.sheetIndex]) return state;
  const moved: EditorPlacement = { ...found.placement, xMm: target.xMm, yMm: target.yMm, rotated: target.rotated };
  const sheets = state.sheets.map((sheet, index) => {
    const without = sheet.placements.filter((item) => item.key !== key);
    return index === target.sheetIndex
      ? { ...sheet, placements: [...without, moved] }
      : { ...sheet, placements: without };
  });
  return commit(state, { sheets, annotations: dropGroupsWithPlacement(state.annotations, key) });
}

/** 배치를 미배치로 되돌린다. */
export function removePlacement(state: EditorState, key: string): EditorState {
  const found = locate(state, key);
  if (!found) return state;
  return commit(state, {
    sheets: state.sheets.map((sheet) => ({
      ...sheet,
      placements: sheet.placements.filter((item) => item.key !== key),
    })),
    annotations: dropGroupsWithPlacement(state.annotations, key),
  });
}

/**
 * 편집기 키로 든 지정을 저장 형식으로 바꾼다. 배치 키는 `annotations.ts` 규칙
 * (같은 부품을 `placements` 순서대로 0부터)과 같아야 서버가 다시 찾을 수 있다.
 * `boundsMm` 는 서버가 다시 계산하므로 자리만 채운다.
 */
export function toSaveAnnotations(snapshot: EditorSnapshot): CuttingAnnotations {
  const sheetIndexByKey = new Map(snapshot.sheets.map((sheet, index) => [sheet.key, index]));
  const savedKeyByPlacement = new Map<string, string>();
  for (const sheet of snapshot.sheets) {
    const ordinal = new Map<string, number>();
    for (const placement of sheet.placements) {
      const n = ordinal.get(placement.partId) ?? 0;
      ordinal.set(placement.partId, n + 1);
      savedKeyByPlacement.set(placement.key, `${placement.partId}#${n}`);
    }
  }
  const placeholder = { xMm: "0", yMm: "0", widthMm: "1", lengthMm: "1" };
  return {
    version: CUTTING_ANNOTATIONS_VERSION,
    laserGroups: snapshot.annotations.laserGroups.flatMap((group) => {
      const sheetIndex = sheetIndexByKey.get(group.sheetKey);
      const keys = group.placementKeys.map((key) => savedKeyByPlacement.get(key)).filter((k): k is string => !!k);
      if (sheetIndex === undefined || keys.length === 0) return [];
      return [{ id: group.id, sheetIndex, placementKeys: keys, boundsMm: placeholder }];
    }),
    horizontalCutLines: snapshot.annotations.horizontalCutLines.flatMap((line) => {
      const sheetIndex = sheetIndexByKey.get(line.sheetKey);
      return sheetIndex === undefined ? [] : [{ id: line.id, sheetIndex, yMm: toMm(line.yMm) }];
    }),
    sheets: snapshot.sheets.map((sheet, sheetIndex) => ({
      sheetIndex,
      film: snapshot.annotations.filmSheetKeys.includes(sheet.key),
    })),
  };
}

/** 회전이 허용되는지. 부품과 원판 정책을 함께 본다(`D2-B03-G`). */
export function canRotate(part: CuttingPart, sheet: CuttingSheet): boolean {
  return part.rotationAllowed && sheet.rotationPolicy !== "FIXED";
}

export type SnapOptions = {
  kerfMm: number;
  /** 이 거리 안이면 이웃 변에 붙인다. mm. */
  thresholdMm: number;
};

/**
 * 놓을 자리를 이웃 변에 붙인다. 이웃 배치의 변에서 kerf 만큼 띄운 자리와 원판 사용
 * 영역의 변이 후보다. 축마다 가장 가까운 후보 하나를 고른다.
 */
export function snapPosition(
  proposed: RectMm,
  neighbours: RectMm[],
  usable: RectMm,
  options: SnapOptions,
): { x: number; y: number } {
  const candidatesX = [usable.x, usable.x + usable.width - proposed.width];
  const candidatesY = [usable.y, usable.y + usable.height - proposed.height];
  for (const rect of neighbours) {
    candidatesX.push(rect.x + rect.width + options.kerfMm, rect.x - options.kerfMm - proposed.width, rect.x);
    candidatesY.push(rect.y + rect.height + options.kerfMm, rect.y - options.kerfMm - proposed.height, rect.y);
  }
  const pick = (value: number, candidates: number[]) => {
    let best = value;
    let distance = options.thresholdMm;
    for (const candidate of candidates) {
      const gap = Math.abs(candidate - value);
      if (gap < distance) {
        distance = gap;
        best = candidate;
      }
    }
    return best;
  };
  return { x: pick(proposed.x, candidatesX), y: pick(proposed.y, candidatesY) };
}

/** 이 자리에 놓을 수 있는지 즉시 판정. 겹침·사용 영역 이탈만 본다. 나머지는 서버 검증이 한다. */
export function placementIssue(
  proposed: RectMm,
  neighbours: RectMm[],
  usable: RectMm,
): "OVERLAP" | "OUT_OF_USABLE_AREA" | null {
  if (!rectInside(proposed, usable)) return "OUT_OF_USABLE_AREA";
  if (neighbours.some((rect) => rectsOverlap(proposed, rect))) return "OVERLAP";
  return null;
}

/** 저장 요청 몸체. 좌표는 계약 좌표 그대로다. */
export function toSaveSheets(sheets: EditorSheet[]) {
  return sheets.map((sheet) => ({
    sheetItemId: sheet.sheetItemId,
    placements: sheet.placements.map((placement) => ({
      partId: placement.partId,
      xMm: toMm(placement.xMm),
      yMm: toMm(placement.yMm),
      rotated: placement.rotated,
    })),
  }));
}

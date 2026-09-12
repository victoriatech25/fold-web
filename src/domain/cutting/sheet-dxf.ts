import type { CuttingAnnotations } from "@/domain/cutting/annotations";
import type { CuttingInput, CuttingSheetResult } from "@/domain/cutting/schema";
import type { ManufacturingGeometry } from "@/domain/manufacturing-geometry";

/**
 * 재단 원판 한 장을 장비용 DXF entity 로 푼다(`P2-B11` 4.7). 레이어 이름·색은 MFC
 * `HiExportDxf` 규칙을 그대로 따른다(`D2-B11-B`). 실제 MFC 파일과 대조하기 전까지의
 * 가정은 문서 4.11 에 있다.
 *
 * 좌표는 재단 계약 그대로다 — 왼쪽 아래 원점, x 폭, y 길이, mm.
 */

export type SheetDxfLine = { kind: "line"; layer: string; start: { x: number; y: number }; end: { x: number; y: number } };

export type SheetDxfDocument = {
  entities: SheetDxfLine[];
  layers: { name: string; color: number }[];
};

/** 부품마다 절곡선을 그리기 위해 필요한 것. 제작 geometry 와 V/A 컷 깊이. */
export type PartGeometry = {
  geometry: ManufacturingGeometry;
  vCutDepthMm: number;
  aCutDepthMm: number;
};

export type SheetDxfInput = {
  input: CuttingInput;
  sheet: CuttingSheetResult;
  sheetIndex: number;
  annotations: CuttingAnnotations | null;
  partGeometries: Map<string, PartGeometry>;
  thicknessMm: string;
  /** MFC 는 원판 색상 문자열. 웹은 재질 변형 code 를 넣는다(4.11). */
  colorCode: string;
};

export const SHEET_DXF_LAYER_COLORS = {
  outline: 8,
  cut: 7,
  ignore: 9,
  vcut: 140,
  vcut1: 40,
} as const;

/** 레이저 그룹 안쪽이라 기계가 자르지 않는 선. MFC 가 쓰는 이름 그대로다. */
export const IGNORED_CUT_LAYER = "- -";

const EPSILON = 1e-6;

type Segment = { at: number; from: number; to: number };

function mergeSegments(segments: Segment[]): Segment[] {
  const byAt = new Map<number, Segment[]>();
  for (const segment of segments) {
    const lo = Math.min(segment.from, segment.to);
    const hi = Math.max(segment.from, segment.to);
    if (hi - lo < EPSILON) continue;
    byAt.set(segment.at, [...(byAt.get(segment.at) ?? []), { at: segment.at, from: lo, to: hi }]);
  }
  const merged: Segment[] = [];
  for (const list of byAt.values()) {
    list.sort((a, b) => a.from - b.from);
    let current = { ...list[0] };
    for (const next of list.slice(1)) {
      if (next.from <= current.to + EPSILON) {
        current.to = Math.max(current.to, next.to);
      } else {
        merged.push(current);
        current = { ...next };
      }
    }
    merged.push(current);
  }
  return merged.sort((a, b) => a.at - b.at || a.from - b.from);
}

type Rect = { x: number; y: number; width: number; height: number };

/**
 * 축에 나란한 선분이 사각형 안쪽(경계 제외)에 완전히 들어가는지. 경계 위의 선은 그룹
 * 외곽이라 기계가 잘라야 하고, 안쪽 선은 레이저가 딸 것이라 기계에서 뺀다.
 */
function strictlyInside(rect: Rect, p: { x: number; y: number }, q: { x: number; y: number }): boolean {
  const between = (value: number, lo: number, hi: number) => value > lo + EPSILON && value < hi - EPSILON;
  const within = (lo: number, hi: number, rangeLo: number, rangeHi: number) =>
    lo >= rangeLo - EPSILON && hi <= rangeHi + EPSILON;
  if (Math.abs(p.x - q.x) < EPSILON) {
    return between(p.x, rect.x, rect.x + rect.width) && within(Math.min(p.y, q.y), Math.max(p.y, q.y), rect.y, rect.y + rect.height);
  }
  if (Math.abs(p.y - q.y) < EPSILON) {
    return between(p.y, rect.y, rect.y + rect.height) && within(Math.min(p.x, q.x), Math.max(p.x, q.x), rect.x, rect.x + rect.width);
  }
  return false;
}

export function buildSheetDxf(params: SheetDxfInput): SheetDxfDocument {
  const { input, sheet, annotations, partGeometries } = params;
  const spec = input.sheets.find((item) => item.sheetItemId === sheet.sheetItemId);
  if (!spec) throw new Error(`원판 ${sheet.sheetItemId}이 입력에 없습니다.`);
  const partsById = new Map(input.parts.map((part) => [part.id, part]));
  const film = annotations?.sheets.some((item) => item.sheetIndex === params.sheetIndex && item.film) ?? false;
  const groupRects: Rect[] = (annotations?.laserGroups ?? [])
    .filter((group) => group.sheetIndex === params.sheetIndex)
    .map((group) => ({
      x: Number(group.boundsMm.xMm),
      y: Number(group.boundsMm.yMm),
      width: Number(group.boundsMm.widthMm),
      height: Number(group.boundsMm.lengthMm),
    }));

  const outlineLayer = `-b-${Number(params.thicknessMm).toFixed(2)}-${params.colorCode}`;
  const verticalLayer = film ? "-L1-" : "-L-";
  const horizontalLayer = film ? "-X1-" : "-X-";
  const layers = new Map<string, number>([
    [outlineLayer, SHEET_DXF_LAYER_COLORS.outline],
    [verticalLayer, SHEET_DXF_LAYER_COLORS.cut],
    [horizontalLayer, SHEET_DXF_LAYER_COLORS.cut],
    [IGNORED_CUT_LAYER, SHEET_DXF_LAYER_COLORS.ignore],
  ]);
  const entities: SheetDxfLine[] = [];
  const line = (layer: string, start: { x: number; y: number }, end: { x: number; y: number }) => {
    entities.push({ kind: "line", layer, start, end });
  };

  // 원판 외곽. trim 을 포함한 전체 크기(4.11 가정).
  const width = Number(spec.widthMm);
  const length = Number(spec.lengthMm);
  line(outlineLayer, { x: 0, y: 0 }, { x: width, y: 0 });
  line(outlineLayer, { x: width, y: 0 }, { x: width, y: length });
  line(outlineLayer, { x: width, y: length }, { x: 0, y: length });
  line(outlineLayer, { x: 0, y: length }, { x: 0, y: 0 });

  // 부품 외곽 절단선. 이웃과 겹치는 선은 합쳐 한 번만 낸다(MFC 옵션 0 "중복 라인 제거").
  const verticals: Segment[] = [];
  const horizontals: Segment[] = [];
  for (const placement of sheet.placements) {
    const part = partsById.get(placement.partId);
    if (!part) continue;
    const w = Number(placement.rotated ? part.lengthMm : part.widthMm);
    const h = Number(placement.rotated ? part.widthMm : part.lengthMm);
    const x = Number(placement.xMm);
    const y = Number(placement.yMm);
    verticals.push({ at: x, from: y, to: y + h }, { at: x + w, from: y, to: y + h });
    horizontals.push({ at: y, from: x, to: x + w }, { at: y + h, from: x, to: x + w });
  }
  const classify = (start: { x: number; y: number }, end: { x: number; y: number }, layer: string) =>
    groupRects.some((rect) => strictlyInside(rect, start, end)) ? IGNORED_CUT_LAYER : layer;
  for (const segment of mergeSegments(verticals)) {
    const start = { x: segment.at, y: segment.from };
    const end = { x: segment.at, y: segment.to };
    line(classify(start, end, verticalLayer), start, end);
  }
  for (const segment of mergeSegments(horizontals)) {
    const start = { x: segment.from, y: segment.at };
    const end = { x: segment.to, y: segment.at };
    line(classify(start, end, horizontalLayer), start, end);
  }

  // 가로 절단선. 사용 영역 폭 전체를 가로지른다.
  const usableX = Number(spec.trimLeftMm);
  const usableWidth = width - usableX - Number(spec.trimRightMm);
  for (const cut of annotations?.horizontalCutLines ?? []) {
    if (cut.sheetIndex !== params.sheetIndex) continue;
    const y = Number(cut.yMm);
    line(horizontalLayer, { x: usableX, y }, { x: usableX + usableWidth, y });
  }

  // 부품 안 절곡선(V-cut·A-cut). 제작 geometry 는 x 가 제품 길이, y 가 전개 폭이라
  // 회전하지 않은 배치에서는 축을 맞바꿔 놓는다(`D2-B11-F`).
  for (const placement of sheet.placements) {
    const part = partsById.get(placement.partId);
    const geometry = partGeometries.get(placement.partId);
    if (!part || !geometry) continue;
    const x = Number(placement.xMm);
    const y = Number(placement.yMm);
    const partWidth = Number(part.widthMm);
    const partLength = Number(part.lengthMm);
    const toSheet = (point: { x: number; y: number }) =>
      placement.rotated ? { x: x + point.x, y: y + point.y } : { x: x + point.y, y: y + point.x };
    for (const entity of geometry.geometry.entities) {
      if (entity.kind !== "line") continue;
      if (entity.layer !== "V_CUT" && entity.layer !== "A_CUT") continue;
      // 전개 사각형 밖(패널 등)은 부품 자리에 들어가지 않으므로 뺀다.
      const within = [entity.start, entity.end].every(
        (point) => point.x >= -EPSILON && point.x <= partLength + EPSILON && point.y >= -EPSILON && point.y <= partWidth + EPSILON,
      );
      if (!within) continue;
      const depth = entity.layer === "V_CUT" ? geometry.vCutDepthMm : geometry.aCutDepthMm;
      const layer = `${entity.layer === "V_CUT" ? "-V-" : "-V1-"}${Math.round(depth * 100)}`;
      layers.set(layer, entity.layer === "V_CUT" ? SHEET_DXF_LAYER_COLORS.vcut : SHEET_DXF_LAYER_COLORS.vcut1);
      line(layer, toSheet(entity.start), toSheet(entity.end));
    }
  }

  return {
    entities,
    layers: [...layers.entries()].map(([name, color]) => ({ name, color })),
  };
}

/** MFC 파일명 규칙(`D2-B11-B`). `{yymmdd}-{순번:02}-{A..Z,AA..}.dxf`, 필름이면 `F` 접두. */
export function sheetDxfFileName(input: { dateKey: string; sequence: number; sheetIndex: number; film: boolean }): string {
  return `${input.film ? "F" : ""}${input.dateKey}-${String(input.sequence).padStart(2, "0")}-${alphaIndex(input.sheetIndex)}.dxf`;
}

export function laserGroupDxfFileName(input: {
  dateKey: string;
  sequence: number;
  sheetIndex: number;
  groupOrdinal: number;
  film: boolean;
}): string {
  return `${input.film ? "F" : ""}${input.dateKey}-${String(input.sequence).padStart(2, "0")}-${alphaIndex(input.sheetIndex)}-${input.groupOrdinal + 1}.dxf`;
}

/** 0 → A, 25 → Z, 26 → AA. MFC `ToAlphaIndex` 와 같다. */
export function alphaIndex(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** `yymmdd`. 서버 시간대가 아니라 Asia/Seoul 기준이다(점검 H2 와 같은 이유). */
export function dateKeyOf(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}${get("month")}${get("day")}`;
}

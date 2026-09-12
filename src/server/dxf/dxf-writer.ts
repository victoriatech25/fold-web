import "server-only";

import { createHash } from "node:crypto";

import type {
  ManufacturingEntity,
  ManufacturingGeometry,
  ManufacturingLayer,
} from "@/domain/manufacturing-geometry";

export const DXF_WRITER_VERSION = "dxf-r2000-v1" as const;
export const DXF_ACAD_VERSION = "AC1015" as const;
export const DXF_UNIT = "mm" as const;

export type DxfDocument = {
  version: typeof DXF_WRITER_VERSION;
  acadVersion: typeof DXF_ACAD_VERSION;
  unit: typeof DXF_UNIT;
  content: string;
  sizeBytes: number;
  checksumSha256: string;
  entityCount: number;
  layers: string[];
};

/**
 * 레이어 이름을 정하지 않은 일반 entity(`P2-B11`). 재단 원판 DXF 는 MFC 규칙의 레이어
 * 이름(`-b-1.20-CODE`, `-L-`, `-V-150` …)을 그대로 쓰므로 제작 geometry 의 고정 6종으로는
 * 담을 수 없다. 전개도 DXF 도 이 형식을 거쳐 같은 writer 로 나간다.
 */
export type DxfLine = { kind: "line"; layer: string; start: { x: number; y: number }; end: { x: number; y: number } };
export type DxfArc = {
  kind: "arc";
  layer: string;
  center: { x: number; y: number };
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
};
export type DxfEntity = DxfLine | DxfArc;
export type DxfLayer = { name: string; color: number };

const layerColors: Record<ManufacturingLayer, number> = {
  CUT: 7,
  PANEL_CUT: 6,
  V_CUT: 1,
  A_CUT: 5,
  BEND: 8,
  PROFILE_REFERENCE: 3,
};

function dxfNumber(value: number) {
  if (!Number.isFinite(value)) throw new Error("DXF 좌표는 유한한 숫자여야 합니다.");
  const normalized = Number(value.toFixed(6));
  return String(Object.is(normalized, -0) ? 0 : normalized);
}

function pair(code: number, value: string | number) {
  return `${code}\r\n${value}\r\n`;
}

function lineEntity(entity: DxfLine) {
  return [
    pair(0, "LINE"),
    pair(8, entity.layer),
    pair(10, dxfNumber(entity.start.x)),
    pair(20, dxfNumber(entity.start.y)),
    pair(30, 0),
    pair(11, dxfNumber(entity.end.x)),
    pair(21, dxfNumber(entity.end.y)),
    pair(31, 0),
  ].join("");
}

function arcEntity(entity: DxfArc) {
  if (entity.radius <= 0) throw new Error("DXF 원호 반지름은 0보다 커야 합니다.");
  return [
    pair(0, "ARC"),
    pair(8, entity.layer),
    pair(10, dxfNumber(entity.center.x)),
    pair(20, dxfNumber(entity.center.y)),
    pair(30, 0),
    pair(40, dxfNumber(entity.radius)),
    pair(50, dxfNumber(entity.startAngleDeg)),
    pair(51, dxfNumber(entity.endAngleDeg)),
  ].join("");
}

function entityText(entity: DxfEntity) {
  return entity.kind === "line" ? lineEntity(entity) : arcEntity(entity);
}

function tableSection(layers: DxfLayer[]) {
  return [
    pair(0, "SECTION"),
    pair(2, "TABLES"),
    pair(0, "TABLE"),
    pair(2, "LTYPE"),
    pair(70, 1),
    pair(0, "LTYPE"),
    pair(2, "CONTINUOUS"),
    pair(70, 0),
    pair(3, "Solid line"),
    pair(72, 65),
    pair(73, 0),
    pair(40, 0),
    pair(0, "ENDTAB"),
    pair(0, "TABLE"),
    pair(2, "LAYER"),
    pair(70, layers.length + 1),
    pair(0, "LAYER"),
    pair(2, "0"),
    pair(70, 0),
    pair(62, 7),
    pair(6, "CONTINUOUS"),
    ...layers.flatMap((layer) => [
      pair(0, "LAYER"),
      pair(2, layer.name),
      pair(70, 0),
      pair(62, layer.color),
      pair(6, "CONTINUOUS"),
    ]),
    pair(0, "ENDTAB"),
    pair(0, "ENDSEC"),
  ].join("");
}

export function createDxfDocumentFromEntities(input: {
  entities: DxfEntity[];
  layers: DxfLayer[];
  /** ENTITIES 첫머리에 남기는 주석. 무엇으로 만들었는지 파일 안에서 알 수 있게 한다. */
  comment: string;
}): DxfDocument {
  if (input.entities.length === 0) throw new Error("DXF로 출력할 entity가 없습니다.");
  const declared = new Map(input.layers.map((layer) => [layer.name, layer.color]));
  for (const entity of input.entities) {
    if (!declared.has(entity.layer)) throw new Error(`DXF 레이어 ${entity.layer}의 색이 정해지지 않았습니다.`);
  }
  const used = new Set(input.entities.map((entity) => entity.layer));
  const layers = [...declared.entries()]
    .filter(([name]) => used.has(name))
    .map(([name, color]) => ({ name, color }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const header = [
    pair(0, "SECTION"),
    pair(2, "HEADER"),
    pair(9, "$ACADVER"),
    pair(1, DXF_ACAD_VERSION),
    pair(9, "$DWGCODEPAGE"),
    pair(3, "ANSI_949"),
    pair(9, "$INSUNITS"),
    pair(70, 4),
    pair(9, "$MEASUREMENT"),
    pair(70, 1),
    pair(0, "ENDSEC"),
  ].join("");
  const entities = [
    pair(0, "SECTION"),
    pair(2, "ENTITIES"),
    pair(999, `fold_web ${DXF_WRITER_VERSION}`),
    pair(999, input.comment),
    ...input.entities.map(entityText),
    pair(0, "ENDSEC"),
    pair(0, "EOF"),
  ].join("");
  const content = `${header}${tableSection(layers)}${entities}`;
  const bytes = new TextEncoder().encode(content);
  return {
    version: DXF_WRITER_VERSION,
    acadVersion: DXF_ACAD_VERSION,
    unit: DXF_UNIT,
    content,
    sizeBytes: bytes.byteLength,
    checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    entityCount: input.entities.length,
    layers: layers.map((layer) => layer.name),
  };
}

/** 제작 geometry(전개도)를 고정 레이어 6종으로 낸다. */
export function createDxfDocument(geometry: ManufacturingGeometry): DxfDocument {
  if (geometry.unit !== "mm") throw new Error("DXF writer는 mm geometry만 지원합니다.");
  return createDxfDocumentFromEntities({
    entities: geometry.entities.map(toDxfEntity),
    layers: (Object.keys(layerColors) as ManufacturingLayer[]).map((name) => ({ name, color: layerColors[name] })),
    comment: `${geometry.version}; unit=mm; profile=${geometry.profileId}`,
  });
}

export function toDxfEntity(entity: ManufacturingEntity): DxfEntity {
  return entity.kind === "line"
    ? { kind: "line", layer: entity.layer, start: entity.start, end: entity.end }
    : {
        kind: "arc",
        layer: entity.layer,
        center: entity.center,
        radius: entity.radius,
        startAngleDeg: entity.startAngleDeg,
        endAngleDeg: entity.endAngleDeg,
      };
}

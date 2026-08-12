import { calculateProfile } from "./fold-calculation";
import { createBoxDevelopedPattern, createNormalDevelopedPattern } from "./developed-pattern";
import type { DevelopedLineKind } from "./developed-pattern";
import { distanceMm, type FoldBlock, type FoldProfile, type PointMm } from "./fold-profile";
import { findBoxBaseSegments } from "./3d/box-solid-geometry";

export const MANUFACTURING_GEOMETRY_VERSION = "manufacturing-geometry-v1" as const;

export type ManufacturingLayer =
  | "CUT"
  | "PANEL_CUT"
  | "V_CUT"
  | "A_CUT"
  | "BEND"
  | "PROFILE_REFERENCE";

export type ManufacturingLineEntity = {
  kind: "line";
  id: string;
  layer: ManufacturingLayer;
  sourceSegmentId?: string;
  start: PointMm;
  end: PointMm;
};

export type ManufacturingArcEntity = {
  kind: "arc";
  id: string;
  layer: ManufacturingLayer;
  sourceSegmentId?: string;
  center: PointMm;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
};

export type ManufacturingEntity = ManufacturingLineEntity | ManufacturingArcEntity;

export type ManufacturingBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};

export type ManufacturingGeometry = {
  version: typeof MANUFACTURING_GEOMETRY_VERSION;
  unit: "mm";
  profileId: string;
  profileType: FoldProfile["profileType"];
  entities: ManufacturingEntity[];
  bounds: ManufacturingBounds;
};

export type ManufacturingGeometryIssue = {
  code: "INVALID_PROFILE" | "INVALID_PRODUCT_LENGTH" | "OPEN_OUTLINE" | "INVALID_ENTITY";
  message: string;
  path: string;
};

export type ManufacturingGeometryResult = {
  valid: boolean;
  issues: ManufacturingGeometryIssue[];
  geometry: ManufacturingGeometry | null;
};

const normalize = (value: number) => {
  const result = Number(value.toFixed(6));
  return Object.is(result, -0) ? 0 : result;
};

const point = (x: number, y: number): PointMm => ({ x: normalize(x), y: normalize(y) });

function line(
  id: string,
  layer: ManufacturingLayer,
  start: PointMm,
  end: PointMm,
  sourceSegmentId?: string,
): ManufacturingLineEntity {
  return {
    kind: "line",
    id,
    layer,
    ...(sourceSegmentId && { sourceSegmentId }),
    start: point(start.x, start.y),
    end: point(end.x, end.y),
  };
}

function foldLayer(kind: DevelopedLineKind): ManufacturingLayer {
  if (kind === "v-cut") return "V_CUT";
  if (kind === "a-cut") return "A_CUT";
  return "BEND";
}

function rectangleOutline(
  prefix: string,
  layer: ManufacturingLayer,
  x: number,
  y: number,
  width: number,
  height: number,
): ManufacturingLineEntity[] {
  const topLeft = point(x, y);
  const topRight = point(x + width, y);
  const bottomRight = point(x + width, y + height);
  const bottomLeft = point(x, y + height);
  return [
    line(`${prefix}-top`, layer, topLeft, topRight),
    line(`${prefix}-right`, layer, topRight, bottomRight),
    line(`${prefix}-bottom`, layer, bottomRight, bottomLeft),
    line(`${prefix}-left`, layer, bottomLeft, topLeft),
  ];
}

function normalEntities(profile: FoldProfile): ManufacturingEntity[] | null {
  const pattern = createNormalDevelopedPattern(profile);
  if (!pattern || pattern.width <= 0 || pattern.length <= 0) return null;
  return [
    ...rectangleOutline("main", "CUT", 0, 0, pattern.length, pattern.width),
    ...pattern.foldLines.map((fold, index) => line(
      `main-fold-${index + 1}`,
      foldLayer(fold.kind),
      point(0, fold.position),
      point(pattern.length, fold.position),
      fold.segmentId,
    )),
  ];
}

function boxEntities(profile: FoldProfile): ManufacturingEntity[] | null {
  const pattern = createBoxDevelopedPattern(profile);
  if (!pattern || pattern.width <= 0 || pattern.height <= 0 || pattern.outline.length < 3) return null;
  const outline = pattern.outline.map((value) => point(value.x, value.y));
  const entities: ManufacturingEntity[] = outline.map((start, index) => line(
    `box-cut-${index + 1}`,
    "CUT",
    start,
    outline[(index + 1) % outline.length],
  ));
  entities.push(...pattern.foldLines.map((fold, index) => line(
    `box-fold-${index + 1}`,
    foldLayer(fold.kind),
    point(fold.x1, fold.y1),
    point(fold.x2, fold.y2),
    fold.segmentId,
  )));
  return entities;
}

function panelEntities(
  profile: FoldProfile,
  startX: number,
): ManufacturingEntity[] {
  const entities: ManufacturingEntity[] = [];
  let y = 0;
  const boxBases = profile.profileType === "box" ? findBoxBaseSegments(profile.blocks) : null;
  profile.panelAttachments.forEach((panel, panelIndex) => {
    const calculation = calculateProfile(
      panel.block.segments,
      profile.material,
      profile.calculation,
    );
    const width = profile.profileType === "box" && boxBases
      ? panel.hostBlockId === profile.blocks[0]?.id
        ? distanceMm(boxBases[1].start, boxBases[1].end)
        : distanceMm(boxBases[0].start, boxBases[0].end)
      : profile.product.length;
    const height = calculation.calculatedWidth;
    if (width <= 0 || height <= 0) return;
    const prefix = `panel-${panelIndex + 1}`;
    entities.push(...rectangleOutline(prefix, "PANEL_CUT", startX, y, width, height));
    let position = 0;
    panel.block.segments.forEach((segment, index) => {
      position += calculation.segments[index]?.calculatedLength ?? 0;
      if (!segment.bendAfter || index === panel.block.segments.length - 1) return;
      const effectiveCutType = profile.calculation.vCutEnabled ? segment.bendAfter.cutType : "no-cut";
      const layer: ManufacturingLayer = effectiveCutType === "v-cut"
        ? "V_CUT"
        : effectiveCutType === "a-cut"
          ? "A_CUT"
          : "BEND";
      entities.push(line(
        `${prefix}-fold-${index + 1}`,
        layer,
        point(startX, y + position),
        point(startX + width, y + position),
        segment.id,
      ));
    });
    y += height + 20;
  });
  return entities;
}

function entityPoints(entity: ManufacturingEntity): PointMm[] {
  if (entity.kind === "line") return [entity.start, entity.end];
  return [
    point(entity.center.x - entity.radius, entity.center.y - entity.radius),
    point(entity.center.x + entity.radius, entity.center.y + entity.radius),
  ];
}

function geometryBounds(entities: ManufacturingEntity[]): ManufacturingBounds {
  const points = entities.flatMap(entityPoints);
  const minX = Math.min(...points.map((value) => value.x));
  const minY = Math.min(...points.map((value) => value.y));
  const maxX = Math.max(...points.map((value) => value.x));
  const maxY = Math.max(...points.map((value) => value.y));
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: normalize(maxX - minX),
    height: normalize(maxY - minY),
  };
}

function samePoint(left: PointMm, right: PointMm, tolerance = 0.000001) {
  return Math.hypot(left.x - right.x, left.y - right.y) <= tolerance;
}

function validateClosedLayer(entities: ManufacturingEntity[], layer: ManufacturingLayer) {
  const lines = entities.filter(
    (entity): entity is ManufacturingLineEntity => entity.kind === "line" && entity.layer === layer,
  );
  if (lines.length === 0) return false;
  const degree = new Map<string, number>();
  const key = (value: PointMm) => `${normalize(value.x)}:${normalize(value.y)}`;
  lines.forEach((entity) => {
    degree.set(key(entity.start), (degree.get(key(entity.start)) ?? 0) + 1);
    degree.set(key(entity.end), (degree.get(key(entity.end)) ?? 0) + 1);
  });
  return [...degree.values()].every((value) => value === 2)
    && lines.every((entity) => !samePoint(entity.start, entity.end));
}

export function createManufacturingGeometry(profile: FoldProfile): ManufacturingGeometryResult {
  const issues: ManufacturingGeometryIssue[] = [];
  if (profile.profileType !== "box" && (!Number.isFinite(profile.product.length) || profile.product.length <= 0)) {
    issues.push({
      code: "INVALID_PRODUCT_LENGTH",
      message: "제작 geometry에는 0보다 큰 제품 길이가 필요합니다.",
      path: "product.length",
    });
  }
  const primary = profile.profileType === "box" ? boxEntities(profile) : normalEntities(profile);
  if (!primary) {
    issues.push({
      code: "INVALID_PROFILE",
      message: profile.profileType === "box"
        ? "박스 제작 geometry에는 서로 교차하는 바닥 가로·세로 직선과 유효한 두 단면이 필요합니다."
        : "제작 geometry를 만들 유효한 단면이 없습니다.",
      path: "blocks",
    });
  }
  const primaryBounds = primary?.length ? geometryBounds(primary) : null;
  const entities = primary
    ? [...primary, ...panelEntities(profile, (primaryBounds?.maxX ?? 0) + 20)]
    : [];
  if (primary && !validateClosedLayer(primary, "CUT")) {
    issues.push({
      code: "OPEN_OUTLINE",
      message: "주 제작 외곽선이 닫혀 있지 않습니다.",
      path: "entities.CUT",
    });
  }
  for (const entity of entities) {
    const values = entity.kind === "line"
      ? [entity.start.x, entity.start.y, entity.end.x, entity.end.y]
      : [entity.center.x, entity.center.y, entity.radius, entity.startAngleDeg, entity.endAngleDeg];
    if (!values.every(Number.isFinite) || (entity.kind === "arc" && entity.radius <= 0)) {
      issues.push({ code: "INVALID_ENTITY", message: "제작 geometry 좌표가 올바르지 않습니다.", path: `entities.${entity.id}` });
    }
  }
  if (issues.length > 0 || entities.length === 0) return { valid: false, issues, geometry: null };
  return {
    valid: true,
    issues: [],
    geometry: {
      version: MANUFACTURING_GEOMETRY_VERSION,
      unit: "mm",
      profileId: profile.id,
      profileType: profile.profileType,
      entities,
      bounds: geometryBounds(entities),
    },
  };
}

export function blockDevelopedWidth(block: FoldBlock, profile: FoldProfile) {
  return calculateProfile(block.segments, profile.material, profile.calculation).calculatedWidth;
}

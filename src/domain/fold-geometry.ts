import {
  distanceMm,
  normalizeEditorLengthMm,
  type ArcSide,
  type FoldSegment,
  type PointMm,
} from "./fold-profile";

export type ArcMetrics = {
  chordLength: number;
  sagitta: number;
  radius: number;
  centralAngleRad: number;
  centralAngleDeg: number;
  arcLength: number;
};

export type CircularArcDefinition = ArcMetrics & {
  center: PointMm;
  startAngleDeg: number;
  endAngleDeg: number;
};

export function isArcSegment(segment: FoldSegment) {
  return segment.geometry?.kind === "arc";
}

export function arcMetrics(chordLength: number, sagitta: number): ArcMetrics | null {
  if (!Number.isFinite(chordLength) || chordLength <= 0 || !Number.isFinite(sagitta) || sagitta <= 0) {
    return null;
  }
  const radius = chordLength * chordLength / (8 * sagitta) + sagitta / 2;
  const centralAngleRad = 4 * Math.atan(2 * sagitta / chordLength);
  const arcLength = radius * centralAngleRad;
  if (![radius, centralAngleRad, arcLength].every(Number.isFinite)) return null;
  return {
    chordLength,
    sagitta,
    radius,
    centralAngleRad,
    centralAngleDeg: centralAngleRad * 180 / Math.PI,
    arcLength,
  };
}

export function arcBulgePoint(
  start: PointMm,
  end: PointMm,
  sagitta: number,
  side: ArcSide,
): PointMm {
  const chord = distanceMm(start, end);
  if (chord <= 0) return { ...start };
  const direction = { x: (end.x - start.x) / chord, y: (end.y - start.y) / chord };
  const sign = side === "left" ? 1 : -1;
  const normal = { x: -direction.y * sign, y: direction.x * sign };
  return {
    x: (start.x + end.x) / 2 + normal.x * sagitta,
    y: (start.y + end.y) / 2 + normal.y * sagitta,
  };
}

const normalizeAngleDeg = (value: number) => {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};

export function circularArcDefinition(segment: FoldSegment): CircularArcDefinition | null {
  if (segment.geometry?.kind !== "arc") return null;
  const chord = distanceMm(segment.start, segment.end);
  const metrics = arcMetrics(chord, segment.geometry.sagitta);
  if (!metrics) return null;
  const direction = {
    x: (segment.end.x - segment.start.x) / chord,
    y: (segment.end.y - segment.start.y) / chord,
  };
  const sideSign = segment.geometry.side === "left" ? 1 : -1;
  const normal = {
    x: -direction.y * sideSign,
    y: direction.x * sideSign,
  };
  const midpoint = {
    x: (segment.start.x + segment.end.x) / 2,
    y: (segment.start.y + segment.end.y) / 2,
  };
  const centerOffset = segment.geometry.sagitta - metrics.radius;
  const center = {
    x: midpoint.x + normal.x * centerOffset,
    y: midpoint.y + normal.y * centerOffset,
  };
  const angle = (point: PointMm) => normalizeAngleDeg(
    Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI,
  );
  const sourceStart = angle(segment.start);
  const sourceEnd = angle(segment.end);
  return {
    ...metrics,
    center,
    // DXF ARC is always counter-clockwise. A left bulge traverses the
    // source chord clockwise, so its endpoints are intentionally swapped.
    startAngleDeg: segment.geometry.side === "left" ? sourceEnd : sourceStart,
    endAngleDeg: segment.geometry.side === "left" ? sourceStart : sourceEnd,
  };
}

export function sampleSegmentPoints(segment: FoldSegment, maximumStepDeg = 8): PointMm[] {
  if (!isArcSegment(segment)) return [{ ...segment.start }, { ...segment.end }];
  const geometry = segment.geometry!;
  if (geometry.kind !== "arc") return [{ ...segment.start }, { ...segment.end }];
  const chord = distanceMm(segment.start, segment.end);
  const metrics = arcMetrics(chord, geometry.sagitta);
  if (!metrics) return [{ ...segment.start }, { ...segment.end }];

  const u = {
    x: (segment.end.x - segment.start.x) / chord,
    y: (segment.end.y - segment.start.y) / chord,
  };
  const sign = geometry.side === "left" ? 1 : -1;
  const n = { x: -u.y * sign, y: u.x * sign };
  const midpoint = {
    x: (segment.start.x + segment.end.x) / 2,
    y: (segment.start.y + segment.end.y) / 2,
  };
  const centerOffset = geometry.sagitta - metrics.radius;
  const center = {
    x: midpoint.x + n.x * centerOffset,
    y: midpoint.y + n.y * centerOffset,
  };
  const startRelative = {
    x: (segment.start.x - center.x) * u.x + (segment.start.y - center.y) * u.y,
    y: (segment.start.x - center.x) * n.x + (segment.start.y - center.y) * n.y,
  };
  const startAngle = Math.atan2(startRelative.y, startRelative.x);
  const steps = Math.max(2, 2 * Math.ceil(metrics.centralAngleDeg / maximumStepDeg / 2));
  const points = Array.from({ length: steps + 1 }, (_, index) => {
    const angle = startAngle - metrics.centralAngleRad * index / steps;
    const localX = Math.cos(angle) * metrics.radius;
    const localY = Math.sin(angle) * metrics.radius;
    return {
      x: center.x + u.x * localX + n.x * localY,
      y: center.y + u.y * localX + n.y * localY,
    };
  });
  points[0] = { ...segment.start };
  points[points.length - 1] = { ...segment.end };
  return points;
}

export function normalizedArcSagitta(value: number) {
  return normalizeEditorLengthMm(Math.max(0.000001, value));
}

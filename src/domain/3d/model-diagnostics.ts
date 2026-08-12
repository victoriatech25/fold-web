import type { FoldModelInput } from "./fold-model-input";
import type { ModelGeometryWarning } from "./surface-geometry";

const EPSILON = 0.000001;

function cross(ax: number, ay: number, bx: number, by: number) {
  return ax * by - ay * bx;
}

function intersects(
  a: { start: { x: number; y: number }; end: { x: number; y: number } },
  b: { start: { x: number; y: number }; end: { x: number; y: number } },
) {
  const rx = a.end.x - a.start.x;
  const ry = a.end.y - a.start.y;
  const sx = b.end.x - b.start.x;
  const sy = b.end.y - b.start.y;
  const denominator = cross(rx, ry, sx, sy);
  if (Math.abs(denominator) <= EPSILON) return false;
  const qpx = b.start.x - a.start.x;
  const qpy = b.start.y - a.start.y;
  const t = cross(qpx, qpy, sx, sy) / denominator;
  const u = cross(qpx, qpy, rx, ry) / denominator;
  return t > EPSILON && t < 1 - EPSILON && u > EPSILON && u < 1 - EPSILON;
}

export function diagnoseModelGeometry(input: FoldModelInput): ModelGeometryWarning[] {
  const warnings: ModelGeometryWarning[] = [];
  input.blocks.forEach((block) => {
    for (let left = 0; left < block.segments.length; left += 1) {
      for (let right = left + 2; right < block.segments.length; right += 1) {
        if (block.closed && left === 0 && right === block.segments.length - 1) continue;
        const first = block.segments[left];
        const second = block.segments[right];
        if (!intersects(first, second)) continue;
        warnings.push({
          code: "PROFILE_SELF_INTERSECTION",
          message: `${block.name}의 형상이 교차합니다. 제작 전 도면을 확인하세요.`,
          blockId: block.id,
          segmentId: first.id,
          otherSegmentId: second.id,
        });
      }
    }
  });
  return warnings;
}

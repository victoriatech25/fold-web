import type { FoldProfile } from "../fold-profile";
import { createRoundedFoldModelInput } from "./bend-radius";
import { createFoldModelInput, type FoldModelBlockInput, type FoldModelInput } from "./fold-model-input";
import {
  boundsFromPositions,
  type FoldSurfaceBlock,
  type FoldSurfaceModel,
  type SurfaceSegmentRange,
} from "./surface-geometry";

type Point2D = { x: number; y: number };
type JointOffset = { left: Point2D; right: Point2D };

const modelY = (value: number) => value === 0 ? 0 : -value;
const add = (point: Point2D, vector: Point2D, scale: number): Point2D => ({
  x: point.x + vector.x * scale,
  y: point.y + vector.y * scale,
});
const direction = (start: Point2D, end: Point2D): Point2D => {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  return { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
};
const normal = (vector: Point2D): Point2D => ({ x: -vector.y, y: vector.x });

function jointOffset(points: Point2D[], index: number, closed: boolean, halfThickness: number): JointOffset {
  const last = points.length - 1;
  const point = points[index];
  const previousPoint = index > 0 ? points[index - 1] : closed ? points[last - 1] : null;
  const nextPoint = index < last ? points[index + 1] : closed ? points[1] : null;

  if (!previousPoint && nextPoint) {
    const offset = normal(direction(point, nextPoint));
    return { left: add(point, offset, halfThickness), right: add(point, offset, -halfThickness) };
  }
  if (previousPoint && !nextPoint) {
    const offset = normal(direction(previousPoint, point));
    return { left: add(point, offset, halfThickness), right: add(point, offset, -halfThickness) };
  }

  const previousNormal = normal(direction(previousPoint!, point));
  const nextNormal = normal(direction(point, nextPoint!));
  const sum = { x: previousNormal.x + nextNormal.x, y: previousNormal.y + nextNormal.y };
  const sumLength = Math.hypot(sum.x, sum.y);
  if (sumLength < 0.000001) {
    return { left: add(point, nextNormal, halfThickness), right: add(point, nextNormal, -halfThickness) };
  }

  const miter = { x: sum.x / sumLength, y: sum.y / sumLength };
  const denominator = miter.x * nextNormal.x + miter.y * nextNormal.y;
  const rawLength = Math.abs(denominator) < 0.000001 ? halfThickness : halfThickness / denominator;
  const miterLength = Math.max(-halfThickness * 4, Math.min(halfThickness * 4, rawLength));
  return { left: add(point, miter, miterLength), right: add(point, miter, -miterLength) };
}

function blockPoints(block: FoldModelBlockInput): Point2D[] {
  const first = block.segments[0]?.start;
  if (!first) return [];
  return [
    { x: first.x, y: modelY(first.y) },
    ...block.segments.map((segment) => ({ x: segment.end.x, y: modelY(segment.end.y) })),
  ];
}

function pushPoint(positions: number[], point: Point2D, z: number) {
  positions.push(point.x, point.y, z);
}

function createSolidBlock(block: FoldModelBlockInput, input: FoldModelInput): FoldSurfaceBlock {
  const points = blockPoints(block);
  const offsets = points.map((_, index) => jointOffset(points, index, block.closed, input.thickness / 2));
  const positions: number[] = [];
  const indices: number[] = [];
  const segmentRanges: SurfaceSegmentRange[] = [];

  block.segments.forEach((segment, segmentIndex) => {
    const startOffset = offsets[segmentIndex];
    const endOffset = offsets[segmentIndex + 1];
    const vertexStart = positions.length / 3;
    const indexStart = indices.length;
    pushPoint(positions, startOffset.left, 0);
    pushPoint(positions, startOffset.right, 0);
    pushPoint(positions, endOffset.right, 0);
    pushPoint(positions, endOffset.left, 0);
    pushPoint(positions, startOffset.left, input.productLength);
    pushPoint(positions, startOffset.right, input.productLength);
    pushPoint(positions, endOffset.right, input.productLength);
    pushPoint(positions, endOffset.left, input.productLength);
    indices.push(
      vertexStart, vertexStart + 1, vertexStart + 2, vertexStart, vertexStart + 2, vertexStart + 3,
      vertexStart + 4, vertexStart + 6, vertexStart + 5, vertexStart + 4, vertexStart + 7, vertexStart + 6,
      vertexStart + 1, vertexStart + 5, vertexStart + 6, vertexStart + 1, vertexStart + 6, vertexStart + 2,
      vertexStart + 3, vertexStart + 7, vertexStart + 4, vertexStart + 3, vertexStart + 4, vertexStart,
    );
    if (!block.closed && segmentIndex === 0) {
      indices.push(vertexStart, vertexStart + 4, vertexStart + 5, vertexStart, vertexStart + 5, vertexStart + 1);
    }
    if (!block.closed && segmentIndex === block.segments.length - 1) {
      indices.push(vertexStart + 2, vertexStart + 6, vertexStart + 7, vertexStart + 2, vertexStart + 7, vertexStart + 3);
    }
    segmentRanges.push({
      segmentId: segment.id,
      vertexStart,
      vertexCount: 8,
      indexStart,
      indexCount: indices.length - indexStart,
    });
  });

  return {
    blockId: block.id,
    name: block.name,
    order: block.order,
    closed: block.closed,
    positions,
    indices,
    segmentRanges,
    bounds: boundsFromPositions(positions),
  };
}

export function createSolidGeometry(input: FoldModelInput): FoldSurfaceBlock[] {
  return input.blocks.map((block) => createSolidBlock(block, input));
}

export function createFoldSolidModel(profile: FoldProfile): FoldSurfaceModel {
  const result = createFoldModelInput(profile);
  const rounded = createRoundedFoldModelInput(result.input);
  const blocks = result.valid ? createSolidGeometry(rounded.input) : [];
  return {
    profileId: profile.id,
    valid: result.valid,
    issues: result.issues,
    warnings: rounded.warnings,
    blocks,
    bounds: boundsFromPositions(blocks.flatMap((block) => block.positions)),
  };
}

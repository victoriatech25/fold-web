import { distanceMm, type FoldBlock, type FoldProfile, type FoldSegment, type PointMm } from "../fold-profile";
import { createRoundedFoldModelInput } from "./bend-radius";
import { createFoldModelInput, type FoldModelBlockInput, type FoldModelInput } from "./fold-model-input";
import { createSolidGeometry } from "./solid-geometry";
import {
  boundsFromPositions,
  type FoldSurfaceBlock,
  type FoldSurfaceModel,
  type SurfaceSegmentRange,
} from "./surface-geometry";

type BoxAxis = "x" | "y";

const orientation = (a: PointMm, b: PointMm, c: PointMm) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const onSegment = (a: PointMm, b: PointMm, point: PointMm) =>
  point.x >= Math.min(a.x, b.x) - 0.001 && point.x <= Math.max(a.x, b.x) + 0.001 &&
  point.y >= Math.min(a.y, b.y) - 0.001 && point.y <= Math.max(a.y, b.y) + 0.001;

function segmentsIntersect(left: FoldSegment, right: FoldSegment) {
  const leftVector = { x: left.end.x - left.start.x, y: left.end.y - left.start.y };
  const rightVector = { x: right.end.x - right.start.x, y: right.end.y - right.start.y };
  const lengthProduct = Math.hypot(leftVector.x, leftVector.y) * Math.hypot(rightVector.x, rightVector.y);
  const directionCross = leftVector.x * rightVector.y - leftVector.y * rightVector.x;
  if (lengthProduct <= 0.000001 || Math.abs(directionCross) / lengthProduct <= 0.0001) return false;
  const o1 = orientation(left.start, left.end, right.start);
  const o2 = orientation(left.start, left.end, right.end);
  const o3 = orientation(right.start, right.end, left.start);
  const o4 = orientation(right.start, right.end, left.end);
  if ((o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0)) return true;
  return (Math.abs(o1) <= 0.001 && onSegment(left.start, left.end, right.start)) ||
    (Math.abs(o2) <= 0.001 && onSegment(left.start, left.end, right.end)) ||
    (Math.abs(o3) <= 0.001 && onSegment(right.start, right.end, left.start)) ||
    (Math.abs(o4) <= 0.001 && onSegment(right.start, right.end, left.end));
}

export function findBoxBaseSegments(
  blocks: FoldBlock[],
): [FoldSegment, FoldSegment] | null {
  const [first, second] = blocks;
  if (!first || !second || first.segments.length === 0 || second.segments.length === 0) return null;
  const firstLines = first.segments.filter((segment) => segment.geometry?.kind !== "arc");
  const secondLines = second.segments.filter((segment) => segment.geometry?.kind !== "arc");
  const pairs = firstLines.flatMap((width) => secondLines
    .filter((depth) => segmentsIntersect(width, depth))
    .map((depth) => ({ width, depth })));
  pairs.sort((left, right) => {
    const lengthDifference = right.width.inputLength + right.depth.inputLength
      - left.width.inputLength - left.depth.inputLength;
    if (Math.abs(lengthDifference) > 0.000001) return lengthDifference;
    return `${left.width.id}:${left.depth.id}`.localeCompare(`${right.width.id}:${right.depth.id}`);
  });
  return pairs[0] ? [pairs[0].width, pairs[0].depth] : null;
}

function normalizeBlock(block: FoldModelBlockInput, base: FoldSegment): FoldModelBlockInput {
  const length = distanceMm(base.start, base.end);
  const axis = { x: (base.end.x - base.start.x) / length, y: (base.end.y - base.start.y) / length };
  const height = (value: PointMm) => orientation(base.start, base.end, value) / length;
  const heightValues = block.segments.flatMap((segment) => [height(segment.start), height(segment.end)]);
  const heightSign = heightValues.reduce((sum, value) => sum + value, 0) < 0 ? -1 : 1;
  const transform = (value: PointMm): PointMm => {
    const relative = { x: value.x - base.start.x, y: value.y - base.start.y };
    return {
      x: relative.x * axis.x + relative.y * axis.y,
      y: -height(value) * heightSign,
    };
  };
  return {
    ...block,
    closed: false,
    segments: block.segments.map((segment) => ({
      ...segment,
      start: transform(segment.start),
      end: transform(segment.end),
    })),
  };
}

function filterDuplicateFloor(block: FoldSurfaceBlock, roundedBlock: FoldModelBlockInput, baseSegmentId: string) {
  const positions: number[] = [];
  const indices: number[] = [];
  const segmentRanges: SurfaceSegmentRange[] = [];
  block.segmentRanges.forEach((range, rangeIndex) => {
    const segment = roundedBlock.segments[rangeIndex];
    const isFlatBase = segment.id === baseSegmentId && Math.abs(segment.start.y) <= 0.001 && Math.abs(segment.end.y) <= 0.001;
    if (isFlatBase) return;
    const vertexStart = positions.length / 3;
    const indexStart = indices.length;
    positions.push(...block.positions.slice(range.vertexStart * 3, (range.vertexStart + range.vertexCount) * 3));
    indices.push(...block.indices.slice(range.indexStart, range.indexStart + range.indexCount).map((index) => index - range.vertexStart + vertexStart));
    segmentRanges.push({ ...range, vertexStart, indexStart });
  });
  return { ...block, positions, indices, segmentRanges, bounds: boundsFromPositions(positions) };
}

function orientBlock(block: FoldSurfaceBlock, axis: BoxAxis, width: number, depth: number): FoldSurfaceBlock {
  const positions: number[] = [];
  for (let index = 0; index < block.positions.length; index += 3) {
    const crossAxis = block.positions[index];
    const height = block.positions[index + 1];
    const sweep = block.positions[index + 2];
    if (axis === "x") positions.push(crossAxis - width / 2, sweep - depth / 2, height);
    else positions.push(sweep - width / 2, crossAxis - depth / 2, height);
  }
  return { ...block, positions, bounds: boundsFromPositions(positions) };
}

function createAxisSolid(
  source: FoldModelInput,
  block: FoldModelBlockInput,
  base: FoldSegment,
  axis: BoxAxis,
  width: number,
  depth: number,
  removeFloor: boolean,
) {
  const normalized = normalizeBlock(block, base);
  const axisInput: FoldModelInput = {
    ...source,
    blocks: [normalized],
    productLength: axis === "x" ? depth : width,
  };
  const rounded = createRoundedFoldModelInput(axisInput);
  let solid = createSolidGeometry(rounded.input)[0];
  if (removeFloor) solid = filterDuplicateFloor(solid, rounded.input.blocks[0], base.id);
  return { block: orientBlock(solid, axis, width, depth), warnings: rounded.warnings };
}

export function createBoxSolidModel(profile: FoldProfile): FoldSurfaceModel {
  const baseSegments = findBoxBaseSegments(profile.blocks);
  if (!baseSegments) return {
    profileId: profile.id,
    valid: false,
    issues: [{
      code: "MISSING_BOX_INTERSECTION",
      message: "두 박스 단면에서 서로 교차하는 바닥 가로·세로 직선을 그려 주세요.",
      path: "blocks",
    }],
    warnings: [],
    blocks: [],
    bounds: null,
  };
  const result = createFoldModelInput(profile, 0.001, { requireProductLength: false });
  if (!result.valid) return { profileId: profile.id, valid: false, issues: result.issues, warnings: [], blocks: [], bounds: null };
  const width = distanceMm(baseSegments[0].start, baseSegments[0].end);
  const depth = distanceMm(baseSegments[1].start, baseSegments[1].end);
  const horizontal = createAxisSolid(result.input, result.input.blocks[0], baseSegments[0], "x", width, depth, false);
  const vertical = createAxisSolid(result.input, result.input.blocks[1], baseSegments[1], "y", width, depth, true);
  const blocks = [horizontal.block, vertical.block];
  return {
    profileId: profile.id,
    valid: true,
    issues: [],
    warnings: [...horizontal.warnings, ...vertical.warnings],
    blocks,
    bounds: boundsFromPositions(blocks.flatMap((block) => block.positions)),
  };
}

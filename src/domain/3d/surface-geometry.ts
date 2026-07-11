import { createFoldModelInput, type FoldModelInput, type FoldModelIssue } from "./fold-model-input";
import type { FoldProfile } from "../fold-profile";

export type Bounds3D = {
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
  size: [number, number, number];
};

export type SurfaceSegmentRange = {
  segmentId: string;
  vertexStart: number;
  vertexCount: number;
  indexStart: number;
  indexCount: number;
};

export type FoldSurfaceBlock = {
  blockId: string;
  name: string;
  order: number;
  closed: boolean;
  positions: number[];
  indices: number[];
  segmentRanges: SurfaceSegmentRange[];
  bounds: Bounds3D | null;
};

export type FoldSurfaceModel = {
  profileId: string;
  valid: boolean;
  issues: FoldModelIssue[];
  warnings: ModelGeometryWarning[];
  blocks: FoldSurfaceBlock[];
  bounds: Bounds3D | null;
};

export type ModelGeometryWarning = {
  code: "BEND_RADIUS_CLAMPED";
  message: string;
  blockId: string;
  segmentId: string;
  requestedRadius: number;
  appliedRadius: number;
};

const modelY = (value: number) => value === 0 ? 0 : -value;

export function boundsFromPositions(positions: number[]): Bounds3D | null {
  if (positions.length === 0) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[index + axis]);
      max[axis] = Math.max(max[axis], positions[index + axis]);
    }
  }
  const size: [number, number, number] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  return {
    min,
    max,
    size,
    center: [min[0] + size[0] / 2, min[1] + size[1] / 2, min[2] + size[2] / 2],
  };
}

export function createSurfaceGeometry(input: FoldModelInput): FoldSurfaceBlock[] {
  return input.blocks.map((block) => {
    const positions: number[] = [];
    const indices: number[] = [];
    const segmentRanges: SurfaceSegmentRange[] = [];

    block.segments.forEach((segment) => {
      const vertexStart = positions.length / 3;
      const indexStart = indices.length;
      positions.push(
        segment.start.x, modelY(segment.start.y), 0,
        segment.end.x, modelY(segment.end.y), 0,
        segment.end.x, modelY(segment.end.y), input.productLength,
        segment.start.x, modelY(segment.start.y), input.productLength,
      );
      indices.push(
        vertexStart, vertexStart + 1, vertexStart + 2,
        vertexStart, vertexStart + 2, vertexStart + 3,
      );
      segmentRanges.push({ segmentId: segment.id, vertexStart, vertexCount: 4, indexStart, indexCount: 6 });
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
  });
}

export function createFoldSurfaceModel(profile: FoldProfile): FoldSurfaceModel {
  const result = createFoldModelInput(profile);
  const blocks = result.valid ? createSurfaceGeometry(result.input) : [];
  const positions = blocks.flatMap((block) => block.positions);
  return {
    profileId: profile.id,
    valid: result.valid,
    issues: result.issues,
    warnings: [],
    blocks,
    bounds: boundsFromPositions(positions),
  };
}

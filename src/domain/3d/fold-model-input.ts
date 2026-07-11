import { distanceMm, type Bend, type FoldProfile, type PointMm } from "../fold-profile";

export type FoldModelSegmentInput = {
  id: string;
  start: PointMm;
  end: PointMm;
  bendAfter?: Bend;
};

export type FoldModelBlockInput = {
  id: string;
  name: string;
  order: number;
  segments: FoldModelSegmentInput[];
  closed: boolean;
};

export type FoldModelInput = {
  profileId: string;
  profileType: FoldProfile["profileType"];
  blocks: FoldModelBlockInput[];
  thickness: number;
  insideBendRadius: number;
  productLength: number;
};

export type FoldModelIssueCode =
  | "EMPTY_MODEL"
  | "INVALID_PRODUCT_LENGTH"
  | "INVALID_THICKNESS"
  | "INVALID_POINT"
  | "ZERO_LENGTH_SEGMENT"
  | "DISCONNECTED_SEGMENT";

export type FoldModelIssue = {
  code: FoldModelIssueCode;
  message: string;
  path: string;
  blockId?: string;
  segmentId?: string;
};

export type FoldModelInputResult = {
  input: FoldModelInput;
  valid: boolean;
  issues: FoldModelIssue[];
};

const finitePoint = (point: PointMm) => Number.isFinite(point.x) && Number.isFinite(point.y);

export function createFoldModelInput(profile: FoldProfile, tolerance = 0.001): FoldModelInputResult {
  const issues: FoldModelIssue[] = [];
  const blocks = profile.blocks.map((block, blockIndex) => {
    const segments = block.segments.map((segment, segmentIndex) => {
      const path = `blocks[${blockIndex}].segments[${segmentIndex}]`;
      if (!finitePoint(segment.start) || !finitePoint(segment.end)) {
        issues.push({
          code: "INVALID_POINT",
          message: "3D 좌표는 유한한 숫자여야 합니다.",
          path,
          blockId: block.id,
          segmentId: segment.id,
        });
      }
      if (distanceMm(segment.start, segment.end) <= tolerance) {
        issues.push({
          code: "ZERO_LENGTH_SEGMENT",
          message: "길이가 없는 선은 3D 표면을 만들 수 없습니다.",
          path,
          blockId: block.id,
          segmentId: segment.id,
        });
      }
      const previous = block.segments[segmentIndex - 1];
      if (previous && distanceMm(previous.end, segment.start) > tolerance) {
        issues.push({
          code: "DISCONNECTED_SEGMENT",
          message: "연결되지 않은 선은 하나의 절곡 면으로 만들 수 없습니다.",
          path: `${path}.start`,
          blockId: block.id,
          segmentId: segment.id,
        });
      }
      return {
        id: segment.id,
        start: { ...segment.start },
        end: { ...segment.end },
        ...(segment.bendAfter && { bendAfter: { ...segment.bendAfter } }),
      };
    });
    const first = segments[0]?.start;
    const last = segments.at(-1)?.end;
    return {
      id: block.id,
      name: block.name,
      order: block.order,
      segments,
      closed: Boolean(first && last && segments.length >= 3 && distanceMm(first, last) <= tolerance),
    };
  });

  if (blocks.every((block) => block.segments.length === 0)) {
    issues.push({ code: "EMPTY_MODEL", message: "3D로 표시할 선이 없습니다.", path: "blocks" });
  }
  if (!Number.isFinite(profile.product.length) || profile.product.length <= 0) {
    issues.push({
      code: "INVALID_PRODUCT_LENGTH",
      message: "3D 모델에는 0보다 큰 제품 길이가 필요합니다.",
      path: "product.length",
    });
  }
  if (!Number.isFinite(profile.material.thickness) || profile.material.thickness <= 0) {
    issues.push({
      code: "INVALID_THICKNESS",
      message: "3D 모델에는 0보다 큰 판 두께가 필요합니다.",
      path: "material.thickness",
    });
  }

  return {
    input: {
      profileId: profile.id,
      profileType: profile.profileType,
      blocks,
      thickness: profile.material.thickness,
      insideBendRadius: profile.material.insideBendRadius,
      productLength: profile.product.length,
    },
    valid: issues.length === 0,
    issues,
  };
}

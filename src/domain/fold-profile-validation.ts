import type { FoldProfile, PointMm } from "./fold-profile";

export type ProfileIssueCode =
  | "EMPTY_NAME"
  | "INVALID_MATERIAL"
  | "INVALID_PRODUCT_LENGTH"
  | "INVALID_QUANTITY"
  | "EMPTY_PROFILE"
  | "DUPLICATE_SEGMENT_ID"
  | "INVALID_SEGMENT_LENGTH"
  | "INVALID_ELONGATION_OVERRIDE"
  | "INVALID_POINT"
  | "DISCONNECTED_SEGMENT"
  | "INVALID_BEND_ANGLE";

export type ProfileIssue = {
  code: ProfileIssueCode;
  message: string;
  path: string;
  severity: "error" | "warning";
};

export type ProfileValidation = {
  valid: boolean;
  issues: ProfileIssue[];
};

const finitePoint = (point: PointMm) => Number.isFinite(point.x) && Number.isFinite(point.y);
const samePoint = (left: PointMm, right: PointMm, tolerance: number) =>
  Math.abs(left.x - right.x) <= tolerance && Math.abs(left.y - right.y) <= tolerance;

export function validateFoldProfile(profile: FoldProfile, tolerance = 0.001): ProfileValidation {
  const issues: ProfileIssue[] = [];
  const add = (issue: ProfileIssue) => issues.push(issue);

  if (!profile.name.trim()) {
    add({ code: "EMPTY_NAME", message: "도면 이름이 필요합니다.", path: "name", severity: "error" });
  }
  if (!profile.material.name.trim() || profile.material.thickness <= 0 || profile.material.insideBendRadius < 0) {
    add({
      code: "INVALID_MATERIAL",
      message: "재질명, 0보다 큰 두께와 0 이상의 내부 절곡 반경이 필요합니다.",
      path: "material",
      severity: "error",
    });
  }
  if (!Number.isFinite(profile.product.length) || profile.product.length < 0) {
    add({
      code: "INVALID_PRODUCT_LENGTH",
      message: "제품 길이는 0 이상의 값이어야 합니다.",
      path: "product.length",
      severity: "error",
    });
  }
  if (!Number.isInteger(profile.product.quantity) || profile.product.quantity < 1) {
    add({
      code: "INVALID_QUANTITY",
      message: "수량은 1 이상의 정수여야 합니다.",
      path: "product.quantity",
      severity: "error",
    });
  }
  if (profile.blocks.length === 0 || profile.blocks.every((block) => block.segments.length === 0)) {
    add({
      code: "EMPTY_PROFILE",
      message: "하나 이상의 선을 입력하세요.",
      path: "blocks",
      severity: "warning",
    });
  }

  if (profile.profileType === "normal" && profile.blocks.length !== 1) {
    add({ code: "INVALID_MATERIAL", message: "일반 절곡은 하나의 면만 가질 수 있습니다.", path: "blocks", severity: "error" });
  }
  if (profile.profileType === "box" && profile.blocks.length !== 2) {
    add({ code: "INVALID_MATERIAL", message: "박스 절곡은 두 개의 면이 필요합니다.", path: "blocks", severity: "error" });
  }

  const ids = new Set<string>();
  profile.blocks.forEach((block, blockIndex) => block.segments.forEach((segment, index) => {
    const path = `blocks[${blockIndex}].segments[${index}]`;
    if (ids.has(segment.id)) {
      add({
        code: "DUPLICATE_SEGMENT_ID",
        message: "선 ID가 중복되었습니다.",
        path: `${path}.id`,
        severity: "error",
      });
    }
    ids.add(segment.id);

    if (!finitePoint(segment.start) || !finitePoint(segment.end)) {
      add({
        code: "INVALID_POINT",
        message: "선 좌표는 유한한 숫자여야 합니다.",
        path,
        severity: "error",
      });
    }
    if (!Number.isFinite(segment.inputLength) || segment.inputLength <= 0) {
      add({
        code: "INVALID_SEGMENT_LENGTH",
        message: "선 길이는 0보다 커야 합니다.",
        path: `${path}.inputLength`,
        severity: "error",
      });
    }
    if (segment.elongationOverride !== undefined && !Number.isFinite(segment.elongationOverride)) {
      add({
        code: "INVALID_ELONGATION_OVERRIDE",
        message: "선의 수동 연신율은 유한한 숫자여야 합니다.",
        path: `${path}.elongationOverride`,
        severity: "error",
      });
    }
    if (index > 0 && !samePoint(block.segments[index - 1].end, segment.start, tolerance)) {
      add({
        code: "DISCONNECTED_SEGMENT",
        message: "이전 선의 끝점과 현재 선의 시작점이 연결되지 않았습니다.",
        path: `${path}.start`,
        severity: "error",
      });
    }
    if (segment.bendAfter && (segment.bendAfter.angle < 0 || segment.bendAfter.angle > 180)) {
      add({
        code: "INVALID_BEND_ANGLE",
        message: "절곡 각도는 0도에서 180도 사이여야 합니다.",
        path: `${path}.bendAfter.angle`,
        severity: "error",
      });
    }
  }));

  return { valid: issues.every((issue) => issue.severity !== "error"), issues };
}

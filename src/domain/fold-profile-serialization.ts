import { FOLD_PROFILE_SCHEMA_VERSION, type FoldProfile } from "./fold-profile";
import { validateFoldProfile } from "./fold-profile-validation";

export class FoldProfileParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FoldProfileParseError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function migrateDocument(value: unknown): unknown {
  if (!isRecord(value)) return value;
  let migrated = value;
  if (migrated.schemaVersion === 1 && Array.isArray(migrated.segments)) {
    const { segments, ...rest } = migrated;
    migrated = {
      ...rest,
      schemaVersion: 2,
      profileType: "normal",
      blocks: [{ id: "block-migrated-1", name: "면 1", order: 1, segments }],
    };
  }
  if (migrated.schemaVersion === 2 && isRecord(migrated.material)) {
    migrated = {
      ...migrated,
      schemaVersion: FOLD_PROFILE_SCHEMA_VERSION,
      material: {
        ...migrated.material,
        insideBendRadius: typeof migrated.material.insideBendRadius === "number"
          ? migrated.material.insideBendRadius
          : migrated.material.thickness,
      },
    };
  }
  return migrated;
}

function assertDocumentShape(value: unknown): asserts value is FoldProfile {
  if (!isRecord(value)) throw new FoldProfileParseError("도면 JSON 객체가 필요합니다.");
  if (value.schemaVersion !== FOLD_PROFILE_SCHEMA_VERSION) {
    throw new FoldProfileParseError(`지원하지 않는 도면 버전입니다: ${String(value.schemaVersion)}`);
  }
  if (typeof value.id !== "string" || typeof value.name !== "string") {
    throw new FoldProfileParseError("도면 ID 또는 이름이 올바르지 않습니다.");
  }
  if (value.profileType !== "normal" && value.profileType !== "box") {
    throw new FoldProfileParseError("절곡 도면 타입이 올바르지 않습니다.");
  }
  if (!isRecord(value.material) || !isRecord(value.product) || !isRecord(value.calculation)) {
    throw new FoldProfileParseError("재질, 제품 또는 계산 설정이 올바르지 않습니다.");
  }
  if (
    typeof value.material.id !== "string" ||
    typeof value.material.name !== "string" ||
    typeof value.material.thickness !== "number" ||
    typeof value.material.insideBendRadius !== "number" ||
    typeof value.material.cutAngle !== "number" ||
    !isRecord(value.material.elongation) ||
    !isRecord(value.material.cutDepth) ||
    typeof value.product.length !== "number" ||
    typeof value.product.quantity !== "number" ||
    typeof value.calculation.mode !== "string" ||
    typeof value.calculation.vCutEnabled !== "boolean" ||
    typeof value.calculation.decimalPlaces !== "number" ||
    typeof value.calculation.decimalOperation !== "string"
  ) {
    throw new FoldProfileParseError("재질, 제품 또는 계산 설정의 필드가 누락되었습니다.");
  }
  if (!Array.isArray(value.blocks)) {
    throw new FoldProfileParseError("절곡 면 목록이 올바르지 않습니다.");
  }
  for (const block of value.blocks) {
    if (!isRecord(block) || typeof block.id !== "string" || !Array.isArray(block.segments)) {
      throw new FoldProfileParseError("절곡 면 데이터가 올바르지 않습니다.");
    }
    for (const segment of block.segments) {
      if (
        !isRecord(segment) ||
        typeof segment.id !== "string" ||
        typeof segment.inputLength !== "number" ||
        !isRecord(segment.start) ||
        !isRecord(segment.end) ||
        typeof segment.start.x !== "number" ||
        typeof segment.start.y !== "number" ||
        typeof segment.end.x !== "number" ||
        typeof segment.end.y !== "number"
      ) {
        throw new FoldProfileParseError("선 데이터의 필드가 누락되었습니다.");
      }
    }
  }
  if (typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") {
    throw new FoldProfileParseError("생성 또는 수정 시간이 올바르지 않습니다.");
  }
}

export function serializeFoldProfile(profile: FoldProfile): string {
  return JSON.stringify(profile, null, 2);
}

export function deserializeFoldProfile(json: string): FoldProfile {
  let value: unknown;
  try {
    value = migrateDocument(JSON.parse(json));
  } catch {
    throw new FoldProfileParseError("올바른 JSON 형식이 아닙니다.");
  }

  assertDocumentShape(value);
  const validation = validateFoldProfile(value);
  const errors = validation.issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new FoldProfileParseError(errors.map((issue) => issue.message).join(" "));
  }
  return value;
}

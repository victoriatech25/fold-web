import { createHash } from "node:crypto";

import { projectCanonicalJsonV1 } from "@/domain/fold-document/canonical";
import { normalizeDecimalString } from "@/domain/fold-document/decimal";
import { MaterialError } from "@/server/materials/material-error";

import type { MaterialRuleFields } from "./material-rule-types";

const NON_NEGATIVE = { precision: 18, scale: 6, min: "0" } as const;
const ANGLE = { precision: 9, scale: 4, min: "0.0001", max: "180" } as const;
const modes = new Set(["FIXED", "RATIO"]);
const options = new Set(["STANDARD", "TWO_LINE", "DIAGONAL", "EXT1"]);
const operations = new Set(["NONE", "ROUND", "FLOOR", "CEIL"]);

function text(value: string | null | undefined) {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  if (normalized.length > 500) throw new MaterialError("INVALID_REQUEST", "변경 요약은 500자 이하여야 합니다.");
  return normalized || null;
}

export function normalizeMaterialRuleFields(input: MaterialRuleFields): MaterialRuleFields {
  if (!modes.has(input.calculationMode)) throw new MaterialError("INVALID_REQUEST", "계산 방식을 확인해 주세요.");
  if (!options.has(input.elongationOption)) throw new MaterialError("INVALID_REQUEST", "연신 적용 옵션을 확인해 주세요.");
  if (!operations.has(input.decimalOperation)) throw new MaterialError("INVALID_REQUEST", "소수 처리 방식을 확인해 주세요.");
  if (!Number.isInteger(input.decimalPlaces) || input.decimalPlaces < 0 || input.decimalPlaces > 6) {
    throw new MaterialError("INVALID_REQUEST", "계산 소수 자릿수는 0~6이어야 합니다.");
  }
  try {
    return {
      calculationMode: input.calculationMode,
      elongationOption: input.elongationOption,
      vCutEnabled: Boolean(input.vCutEnabled),
      decimalPlaces: input.decimalPlaces,
      decimalOperation: input.decimalOperation,
      cutAngleDeg: normalizeDecimalString(input.cutAngleDeg, ANGLE),
      insideBendRadiusMm: normalizeDecimalString(input.insideBendRadiusMm, NON_NEGATIVE),
      elongationVCutMm: normalizeDecimalString(input.elongationVCutMm, NON_NEGATIVE),
      elongationACutMm: normalizeDecimalString(input.elongationACutMm, NON_NEGATIVE),
      elongationNoCutMm: normalizeDecimalString(input.elongationNoCutMm, NON_NEGATIVE),
      cutDepthVCutMm: normalizeDecimalString(input.cutDepthVCutMm, NON_NEGATIVE),
      cutDepthACutMm: normalizeDecimalString(input.cutDepthACutMm, NON_NEGATIVE),
      cutDepthNoCutMm: normalizeDecimalString(input.cutDepthNoCutMm, NON_NEGATIVE),
      changeSummary: text(input.changeSummary),
    };
  } catch (error) {
    if (error instanceof MaterialError) throw error;
    throw new MaterialError("INVALID_REQUEST", "계산값은 허용 범위 안의 소수 6자리 이하 숫자여야 합니다.");
  }
}

export function calculateMaterialRuleChecksum(fields: MaterialRuleFields) {
  const normalized = normalizeMaterialRuleFields(fields);
  const content = {
    calculationMode: normalized.calculationMode,
    cutAngleDeg: normalized.cutAngleDeg,
    cutDepthACutMm: normalized.cutDepthACutMm,
    cutDepthNoCutMm: normalized.cutDepthNoCutMm,
    cutDepthVCutMm: normalized.cutDepthVCutMm,
    decimalOperation: normalized.decimalOperation,
    decimalPlaces: normalized.decimalPlaces,
    elongationACutMm: normalized.elongationACutMm,
    elongationNoCutMm: normalized.elongationNoCutMm,
    elongationOption: normalized.elongationOption,
    elongationVCutMm: normalized.elongationVCutMm,
    insideBendRadiusMm: normalized.insideBendRadiusMm,
    vCutEnabled: normalized.vCutEnabled,
  };
  return createHash("sha256").update(projectCanonicalJsonV1(content), "utf8").digest("hex");
}

export function parseEffectiveFrom(value: string | null | undefined) {
  if (!value) throw new MaterialError("INVALID_REQUEST", "효력 시작 시각을 입력해 주세요.");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new MaterialError("INVALID_REQUEST", "효력 시작 시각이 올바르지 않습니다.");
  return date;
}

export function normalizeTransitionReason(value: string | null | undefined, required: boolean) {
  const normalized = text(value);
  if (required && !normalized) throw new MaterialError("INVALID_REQUEST", "처리 사유를 입력해 주세요.");
  return normalized;
}

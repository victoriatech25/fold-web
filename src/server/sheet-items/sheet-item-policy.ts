import {
  divideCanonicalDecimalByPowerOfTen,
  multiplyCanonicalDecimals,
  quantizeCanonicalDecimal,
  subtractCanonicalDecimals,
} from "@/domain/calculation-decimal";
import { normalizeDecimalString } from "@/domain/fold-document/decimal";
import {
  isValidMaterialCode,
  normalizeMaterialCode,
  normalizeOptionalText,
  normalizePositiveDecimal,
} from "@/server/materials/material-policy";
import { MaterialError } from "@/server/materials/material-error";
import type {
  SheetItemCalculationDto,
  SheetItemFields,
} from "./sheet-item-types";

const NON_NEGATIVE = { precision: 18, scale: 6, min: "0" } as const;
const MONEY = { precision: 20, scale: 2, min: "0" } as const;

function positive(value: string) {
  return value !== "0" && !value.startsWith("-");
}

function optionalPositive(value: string | null) {
  return value ? normalizePositiveDecimal(value) : null;
}

export function normalizeSheetItemFields(input: SheetItemFields): SheetItemFields {
  const code = normalizeMaterialCode(input.code);
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!isValidMaterialCode(code)) {
    throw new MaterialError("INVALID_REQUEST", "원판 코드는 영문 대문자·숫자·-·_ 조합 2~50자여야 합니다.");
  }
  if (!name) throw new MaterialError("INVALID_REQUEST", "원판 품목명을 입력해 주세요.");
  if (input.rotationPolicy === "FREE" && input.grainAxis !== "NONE") {
    throw new MaterialError("INVALID_REQUEST", "자유 회전 원판은 결 방향을 지정하지 않습니다.");
  }
  if (input.rotationPolicy === "KEEP_GRAIN" && input.grainAxis === "NONE") {
    throw new MaterialError("INVALID_REQUEST", "결 방향 유지 원판은 폭 또는 길이 방향을 지정해야 합니다.");
  }
  try {
    const result: SheetItemFields = {
      code,
      name,
      finishName: normalizeOptionalText(input.finishName),
      widthMm: normalizePositiveDecimal(input.widthMm),
      lengthMm: normalizePositiveDecimal(input.lengthMm),
      trimTopMm: normalizeDecimalString(input.trimTopMm, NON_NEGATIVE),
      trimRightMm: normalizeDecimalString(input.trimRightMm, NON_NEGATIVE),
      trimBottomMm: normalizeDecimalString(input.trimBottomMm, NON_NEGATIVE),
      trimLeftMm: normalizeDecimalString(input.trimLeftMm, NON_NEGATIVE),
      weightOverrideKg: optionalPositive(input.weightOverrideKg),
      weightOverrideReason: normalizeOptionalText(input.weightOverrideReason),
      standardPurchaseCostKrw: input.standardPurchaseCostKrw
        ? normalizeDecimalString(input.standardPurchaseCostKrw, MONEY)
        : null,
      minRemnantWidthMm: optionalPositive(input.minRemnantWidthMm),
      minRemnantLengthMm: optionalPositive(input.minRemnantLengthMm),
      minRemnantAreaM2: optionalPositive(input.minRemnantAreaM2),
      rotationPolicy: input.rotationPolicy,
      grainAxis: input.grainAxis,
      sortOrder: input.sortOrder,
      memo: normalizeOptionalText(input.memo),
    };
    if (Boolean(result.weightOverrideKg) !== Boolean(result.weightOverrideReason)) {
      throw new MaterialError("INVALID_REQUEST", "중량을 보정하려면 보정 중량과 사유를 함께 입력해 주세요.");
    }
    calculateSheetItem(result, null, "1");
    return result;
  } catch (error) {
    if (error instanceof MaterialError) throw error;
    throw new MaterialError("INVALID_REQUEST", "원판 수치에는 0 이상 또는 0보다 큰 올바른 숫자를 입력해 주세요.");
  }
}

export function calculateSheetItem(
  fields: Pick<SheetItemFields,
    "widthMm" | "lengthMm" | "trimTopMm" | "trimRightMm" | "trimBottomMm" | "trimLeftMm" | "weightOverrideKg">,
  densityKgPerM3: string | null,
  thicknessMm: string,
): SheetItemCalculationDto {
  const usableWidthMm = subtractCanonicalDecimals(
    subtractCanonicalDecimals(fields.widthMm, fields.trimLeftMm),
    fields.trimRightMm,
  );
  const usableLengthMm = subtractCanonicalDecimals(
    subtractCanonicalDecimals(fields.lengthMm, fields.trimTopMm),
    fields.trimBottomMm,
  );
  if (!positive(usableWidthMm) || !positive(usableLengthMm)) {
    throw new MaterialError("INVALID_REQUEST", "가공 여유의 합은 원판 폭과 길이보다 작아야 합니다.");
  }
  const nominalAreaM2 = quantizeCanonicalDecimal(
    divideCanonicalDecimalByPowerOfTen(
      multiplyCanonicalDecimals(fields.widthMm, fields.lengthMm),
      6,
    ),
    6,
    "round",
  );
  const usableAreaM2 = quantizeCanonicalDecimal(
    divideCanonicalDecimalByPowerOfTen(
      multiplyCanonicalDecimals(usableWidthMm, usableLengthMm),
      6,
    ),
    6,
    "round",
  );
  const calculatedWeightKg = densityKgPerM3
    ? quantizeCanonicalDecimal(
        divideCanonicalDecimalByPowerOfTen(
          multiplyCanonicalDecimals(
            multiplyCanonicalDecimals(
              multiplyCanonicalDecimals(fields.widthMm, fields.lengthMm),
              thicknessMm,
            ),
            densityKgPerM3,
          ),
          9,
        ),
        6,
        "round",
      )
    : null;
  const override = fields.weightOverrideKg;
  return {
    nominalAreaM2,
    usableWidthMm,
    usableLengthMm,
    usableAreaM2,
    calculatedWeightKg,
    effectiveWeightKg: override ?? calculatedWeightKg,
    weightSource: override ? "OVERRIDE" : calculatedWeightKg ? "CALCULATED" : "UNAVAILABLE",
  };
}

export function normalizeFinishName(value: string | null) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}

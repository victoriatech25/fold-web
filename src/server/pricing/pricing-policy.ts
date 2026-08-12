import { createHash } from "node:crypto";

import { projectCanonicalJsonV1 } from "@/domain/fold-document/canonical";
import { normalizeDecimalString } from "@/domain/fold-document/decimal";

import { PricingError } from "./pricing-error";
import type { PriceRevisionFields } from "./pricing-types";

const RATE = { precision: 20, scale: 4, min: "0" } as const;
const PERCENT = { precision: 9, scale: 4, min: "0", max: "100" } as const;
const CODE = /^[A-Z0-9][A-Z0-9._-]{0,49}$/;

export function normalizePriceCode(value: string) {
  const code = value.trim().toUpperCase();
  if (!CODE.test(code)) throw new PricingError("INVALID_REQUEST", "코드는 영문 대문자·숫자·점·밑줄·하이픈 1~50자로 입력해 주세요.");
  return code;
}

export function normalizePriceText(value: string | null | undefined, label: string, maximum: number, required = false) {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  if (required && !normalized) throw new PricingError("INVALID_REQUEST", `${label}을(를) 입력해 주세요.`);
  if (normalized.length > maximum) throw new PricingError("INVALID_REQUEST", `${label}은(는) ${maximum}자 이하여야 합니다.`);
  return normalized || null;
}

function rate(value: string, label: string) {
  try {
    return normalizeDecimalString(value, RATE);
  } catch {
    throw new PricingError("PRICE_INPUT_INVALID", `${label}은 0 이상의 소수 4자리 금액이어야 합니다.`);
  }
}

export function normalizePriceRevisionFields(input: PriceRevisionFields): PriceRevisionFields {
  const seenVariants = new Set<string>();
  const seenSheets = new Set<string>();
  const foldRates = input.foldRates.map((item) => {
    if (seenVariants.has(item.materialVariantId)) throw new PricingError("INVALID_REQUEST", "같은 재질·두께 가격 행이 중복되었습니다.");
    seenVariants.add(item.materialVariantId);
    return {
      materialVariantId: item.materialVariantId,
      materialRatePerM2Krw: rate(item.materialRatePerM2Krw, "㎡ 재질단가"),
      bendRatePerOperationKrw: rate(item.bendRatePerOperationKrw, "절곡단가"),
      vCutRatePerMeterKrw: rate(item.vCutRatePerMeterKrw, "V-CUT 단가"),
    };
  }).sort((a, b) => a.materialVariantId.localeCompare(b.materialVariantId));
  const sheetRates = input.sheetRates.map((item) => {
    if (seenSheets.has(item.sheetItemId)) throw new PricingError("INVALID_REQUEST", "같은 원판 가격 행이 중복되었습니다.");
    seenSheets.add(item.sheetItemId);
    return {
      sheetItemId: item.sheetItemId,
      materialPricePerSheetKrw: rate(item.materialPricePerSheetKrw, "원판 재료 판매가"),
      processingPricePerSheetKrw: item.processingPricePerSheetKrw === null ? null : rate(item.processingPricePerSheetKrw, "원판 가공 판매가"),
    };
  }).sort((a, b) => a.sheetItemId.localeCompare(b.sheetItemId));
  let surchargePolicy = null;
  if (input.surchargePolicy) {
    if (input.surchargePolicy.baseType !== "PROCESSING_ONLY") throw new PricingError("INVALID_REQUEST", "할증 기준을 확인해 주세요.");
    if (!Number.isInteger(input.surchargePolicy.minimumBendOperations) || input.surchargePolicy.minimumBendOperations < 0 || input.surchargePolicy.minimumBendOperations > 999) {
      throw new PricingError("PRICE_INPUT_INVALID", "최소 절곡 횟수는 0~999여야 합니다.");
    }
    try {
      surchargePolicy = {
        minimumBendOperations: input.surchargePolicy.minimumBendOperations,
        ratePercent: normalizeDecimalString(input.surchargePolicy.ratePercent, PERCENT),
        baseType: "PROCESSING_ONLY" as const,
      };
    } catch {
      throw new PricingError("PRICE_INPUT_INVALID", "할증률은 0~100의 소수 4자리 이하여야 합니다.");
    }
  }
  return {
    changeSummary: normalizePriceText(input.changeSummary, "변경 요약", 500),
    foldRates,
    sheetRates,
    surchargePolicy,
  };
}

export function calculatePriceRevisionChecksum(input: PriceRevisionFields) {
  const normalized = normalizePriceRevisionFields(input);
  return createHash("sha256").update(projectCanonicalJsonV1({
    currency: "KRW",
    taxIncluded: false,
    foldRates: normalized.foldRates,
    sheetRates: normalized.sheetRates,
    surchargePolicy: normalized.surchargePolicy,
  }), "utf8").digest("hex");
}

export function parsePriceEffectiveAt(value: string | null | undefined, label = "효력 시각") {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) throw new PricingError("INVALID_REQUEST", `${label}이 올바르지 않습니다.`);
  return date;
}

import {
  addCanonicalDecimals,
  divideCanonicalDecimalByPowerOfTen,
  lengthNumberToCanonical,
  multiplyCanonicalDecimalByInteger,
  multiplyCanonicalDecimals,
  quantizeCanonicalDecimal,
  squareMillimetresToSquareMetres,
} from "./calculation-decimal";
import { createBoxDevelopedPattern, createNormalDevelopedPattern } from "./developed-pattern";
import { normalizeDecimalString } from "./fold-document/decimal";
import { calculateProfile } from "./fold-calculation";
import { bendOperations, distanceMm, type FoldProfile } from "./fold-profile";
import { createManufacturingGeometry } from "./manufacturing-geometry";
import { findBoxBaseSegments } from "./3d/box-solid-geometry";

export const PRICING_METRICS_VERSION = "pricing-metrics-v1" as const;
export const PRICING_ENGINE_VERSION = "pricing-engine-v1" as const;

const METRIC = { precision: 24, scale: 8, min: "0" } as const;
const RATE = { precision: 20, scale: 4, min: "0" } as const;
const PERCENT = { precision: 9, scale: 4, min: "0", max: "100" } as const;

export class PricingCalculationError extends Error {
  constructor(
    readonly code: "PRICE_INPUT_INVALID" | "PRICE_GEOMETRY_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "PricingCalculationError";
  }
}

export type FoldPricingMetrics = {
  version: typeof PRICING_METRICS_VERSION;
  areaEachM2: string;
  bendOperationsEach: number;
  vCutLengthEachM: string;
  quantity: number;
};

export type PriceSourceTrace = {
  scopeType: "STANDARD" | "TIER" | "CUSTOMER" | "PREVIEW";
  priceBookId: string;
  revisionId: string;
  rateId: string | null;
  contentChecksumSha256: string | null;
  effectiveAt: string;
};

export type FoldPriceRate = {
  materialRatePerM2Krw: string;
  bendRatePerOperationKrw: string;
  vCutRatePerMeterKrw: string;
};

export type SurchargePolicy = {
  minimumBendOperations: number;
  ratePercent: string;
  baseType: "PROCESSING_ONLY";
};

export type FoldPriceResult = {
  engineVersion: typeof PRICING_ENGINE_VERSION;
  metrics: FoldPricingMetrics;
  rates: FoldPriceRate;
  surchargePolicy: SurchargePolicy | null;
  surchargeApplied: boolean;
  raw: {
    materialKrw: string;
    bendKrw: string;
    vCutKrw: string;
    surchargeKrw: string;
  };
  amounts: {
    materialKrw: string;
    bendKrw: string;
    vCutKrw: string;
    surchargeKrw: string;
    supplyKrw: string;
  };
  trace: {
    foldRate: PriceSourceTrace;
    surcharge: PriceSourceTrace | null;
  };
};

function normalizedMetric(value: string, label: string) {
  try {
    return normalizeDecimalString(value, METRIC);
  } catch {
    throw new PricingCalculationError("PRICE_INPUT_INVALID", `${label} 값을 확인해 주세요.`);
  }
}

function normalizedRate(value: string, label: string) {
  try {
    return normalizeDecimalString(value, RATE);
  } catch {
    throw new PricingCalculationError("PRICE_INPUT_INVALID", `${label}은 0 이상의 소수 4자리 금액이어야 합니다.`);
  }
}

function areaFromMillimetres(width: number, height: number) {
  return squareMillimetresToSquareMetres(multiplyCanonicalDecimals(
    lengthNumberToCanonical(width),
    lengthNumberToCanonical(height),
  ));
}

function primaryArea(profile: FoldProfile) {
  if (profile.profileType === "normal") {
    const pattern = createNormalDevelopedPattern(profile);
    if (!pattern || pattern.width <= 0 || pattern.length <= 0) {
      throw new PricingCalculationError("PRICE_GEOMETRY_INVALID", "일반 제품의 전개 면적을 계산할 수 없습니다.");
    }
    return areaFromMillimetres(pattern.width, pattern.length);
  }

  const pattern = createBoxDevelopedPattern(profile);
  if (!pattern) {
    throw new PricingCalculationError("PRICE_GEOMETRY_INVALID", "박스의 교차 기준과 전개 면적을 계산할 수 없습니다.");
  }
  return pattern.panels.reduce(
    (sum, panel) => addCanonicalDecimals(sum, areaFromMillimetres(panel.width, panel.height)),
    "0",
  );
}

function attachmentArea(profile: FoldProfile) {
  const boxBases = profile.profileType === "box" ? findBoxBaseSegments(profile.blocks) : null;
  return profile.panelAttachments.reduce((sum, panel) => {
    const calculation = calculateProfile(panel.block.segments, profile.material, profile.calculation);
    const width = profile.profileType === "box" && boxBases
      ? panel.hostBlockId === profile.blocks[0]?.id
        ? distanceMm(boxBases[1].start, boxBases[1].end)
        : distanceMm(boxBases[0].start, boxBases[0].end)
      : profile.product.length;
    if (width <= 0 || calculation.calculatedWidth <= 0) {
      throw new PricingCalculationError("PRICE_GEOMETRY_INVALID", `부착 패널 '${panel.name}'의 면적을 계산할 수 없습니다.`);
    }
    return addCanonicalDecimals(sum, areaFromMillimetres(width, calculation.calculatedWidth));
  }, "0");
}

export function extractFoldPricingMetrics(profile: FoldProfile): FoldPricingMetrics {
  if (!Number.isInteger(profile.product.quantity) || profile.product.quantity < 1 || profile.product.quantity > 1_000_000) {
    throw new PricingCalculationError("PRICE_INPUT_INVALID", "제품 수량은 1~1,000,000의 정수여야 합니다.");
  }
  const manufacturing = createManufacturingGeometry(profile);
  if (!manufacturing.valid || !manufacturing.geometry) {
    throw new PricingCalculationError(
      "PRICE_GEOMETRY_INVALID",
      manufacturing.issues[0]?.message ?? "가격 계산용 제조 형상을 만들 수 없습니다.",
    );
  }
  const areaEachM2 = quantizeCanonicalDecimal(
    addCanonicalDecimals(primaryArea(profile), attachmentArea(profile)),
    8,
    "round",
  );
  const bendOperationsEach = [...profile.blocks, ...profile.panelAttachments.map((panel) => panel.block)]
    .flatMap((block) => block.segments)
    .reduce((count, segment) => count + (segment.bendAfter ? bendOperations(segment.bendAfter).length : 0), 0);
  const vCutLengthMm = manufacturing.geometry.entities.reduce((sum, entity) => {
    if (entity.layer !== "V_CUT" || entity.kind !== "line") return sum;
    return addCanonicalDecimals(sum, lengthNumberToCanonical(distanceMm(entity.start, entity.end)));
  }, "0");
  return {
    version: PRICING_METRICS_VERSION,
    areaEachM2,
    bendOperationsEach,
    vCutLengthEachM: quantizeCanonicalDecimal(divideCanonicalDecimalByPowerOfTen(vCutLengthMm, 3), 8, "round"),
    quantity: profile.product.quantity,
  };
}

function normalizeMetrics(metrics: FoldPricingMetrics): FoldPricingMetrics {
  if (metrics.version !== PRICING_METRICS_VERSION) {
    throw new PricingCalculationError("PRICE_INPUT_INVALID", "가격 지표 버전을 확인해 주세요.");
  }
  if (!Number.isInteger(metrics.bendOperationsEach) || metrics.bendOperationsEach < 0 || metrics.bendOperationsEach > 999) {
    throw new PricingCalculationError("PRICE_INPUT_INVALID", "절곡 횟수는 0~999의 정수여야 합니다.");
  }
  if (!Number.isInteger(metrics.quantity) || metrics.quantity < 1 || metrics.quantity > 1_000_000) {
    throw new PricingCalculationError("PRICE_INPUT_INVALID", "제품 수량은 1~1,000,000의 정수여야 합니다.");
  }
  return {
    ...metrics,
    areaEachM2: normalizedMetric(metrics.areaEachM2, "제품 면적"),
    vCutLengthEachM: normalizedMetric(metrics.vCutLengthEachM, "V-CUT 길이"),
  };
}

function normalizePolicy(policy: SurchargePolicy | null): SurchargePolicy | null {
  if (!policy) return null;
  if (policy.baseType !== "PROCESSING_ONLY") {
    throw new PricingCalculationError("PRICE_INPUT_INVALID", "할증 기준을 확인해 주세요.");
  }
  if (!Number.isInteger(policy.minimumBendOperations) || policy.minimumBendOperations < 0 || policy.minimumBendOperations > 999) {
    throw new PricingCalculationError("PRICE_INPUT_INVALID", "최소 절곡 횟수는 0~999여야 합니다.");
  }
  try {
    return { ...policy, ratePercent: normalizeDecimalString(policy.ratePercent, PERCENT) };
  } catch {
    throw new PricingCalculationError("PRICE_INPUT_INVALID", "할증률은 0~100의 소수 4자리 이하여야 합니다.");
  }
}

const roundedKrw = (value: string) => quantizeCanonicalDecimal(value, 0, "round");

export function calculateFoldPrice(input: {
  metrics: FoldPricingMetrics;
  rate: FoldPriceRate;
  surchargePolicy: SurchargePolicy | null;
  trace: FoldPriceResult["trace"];
}): FoldPriceResult {
  const metrics = normalizeMetrics(input.metrics);
  const rates = {
    materialRatePerM2Krw: normalizedRate(input.rate.materialRatePerM2Krw, "㎡ 재질단가"),
    bendRatePerOperationKrw: normalizedRate(input.rate.bendRatePerOperationKrw, "절곡단가"),
    vCutRatePerMeterKrw: normalizedRate(input.rate.vCutRatePerMeterKrw, "V-CUT 단가"),
  };
  const surchargePolicy = normalizePolicy(input.surchargePolicy);
  const materialRaw = multiplyCanonicalDecimalByInteger(
    multiplyCanonicalDecimals(metrics.areaEachM2, rates.materialRatePerM2Krw),
    metrics.quantity,
  );
  const bendRaw = multiplyCanonicalDecimalByInteger(
    multiplyCanonicalDecimalByInteger(rates.bendRatePerOperationKrw, metrics.bendOperationsEach),
    metrics.quantity,
  );
  const vCutRaw = multiplyCanonicalDecimalByInteger(
    multiplyCanonicalDecimals(metrics.vCutLengthEachM, rates.vCutRatePerMeterKrw),
    metrics.quantity,
  );
  const surchargeApplied = Boolean(
    surchargePolicy
      && metrics.bendOperationsEach < surchargePolicy.minimumBendOperations
      && surchargePolicy.ratePercent !== "0",
  );
  const surchargeRaw = surchargeApplied && surchargePolicy
    ? divideCanonicalDecimalByPowerOfTen(
        multiplyCanonicalDecimals(addCanonicalDecimals(bendRaw, vCutRaw), surchargePolicy.ratePercent),
        2,
      )
    : "0";
  const amounts = {
    materialKrw: roundedKrw(materialRaw),
    bendKrw: roundedKrw(bendRaw),
    vCutKrw: roundedKrw(vCutRaw),
    surchargeKrw: roundedKrw(surchargeRaw),
    supplyKrw: "0",
  };
  amounts.supplyKrw = [amounts.materialKrw, amounts.bendKrw, amounts.vCutKrw, amounts.surchargeKrw]
    .reduce(addCanonicalDecimals, "0");
  return {
    engineVersion: PRICING_ENGINE_VERSION,
    metrics,
    rates,
    surchargePolicy,
    surchargeApplied,
    raw: { materialKrw: materialRaw, bendKrw: bendRaw, vCutKrw: vCutRaw, surchargeKrw: surchargeRaw },
    amounts,
    trace: input.trace,
  };
}

export function calculateSheetPrice(input: {
  materialPricePerSheetKrw: string;
  processingPricePerSheetKrw: string | null;
  quantity: number;
}) {
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 1_000_000) {
    throw new PricingCalculationError("PRICE_INPUT_INVALID", "원판 수량은 1~1,000,000의 정수여야 합니다.");
  }
  const materialRate = normalizedRate(input.materialPricePerSheetKrw, "원판 재료 판매가");
  const processingRate = input.processingPricePerSheetKrw === null
    ? "0"
    : normalizedRate(input.processingPricePerSheetKrw, "원판 가공 판매가");
  const materialKrw = roundedKrw(multiplyCanonicalDecimalByInteger(materialRate, input.quantity));
  const processingKrw = roundedKrw(multiplyCanonicalDecimalByInteger(processingRate, input.quantity));
  return {
    engineVersion: PRICING_ENGINE_VERSION,
    rates: { materialPricePerSheetKrw: materialRate, processingPricePerSheetKrw: input.processingPricePerSheetKrw === null ? null : processingRate },
    quantity: input.quantity,
    amounts: { materialKrw, processingKrw, supplyKrw: addCanonicalDecimals(materialKrw, processingKrw) },
  };
}

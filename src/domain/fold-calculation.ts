import type {
  Bend,
  BendDirection,
  CalculationSettings,
  CutType,
  FoldProfile,
  FoldSegment,
  MaterialRule,
} from "./fold-profile";
import { bendOperations } from "./fold-profile";
import { arcMetrics, isArcSegment } from "./fold-geometry";
import {
  AREA_DECIMAL_PLACES,
  FOLD_CALCULATION_ENGINE_VERSION,
  addCanonicalDecimals,
  canonicalDecimalToNumber,
  lengthNumberToCanonical,
  multiplyCanonicalDecimalByInteger,
  multiplyCanonicalDecimals,
  quantizeCanonicalDecimal,
  squareMillimetresToSquareMetres,
  subtractCanonicalDecimals,
} from "./calculation-decimal";
import {
  resolveFoldProfileExpressions,
  type FoldExpressionIssue,
} from "./fold-expression";

export type {
  Bend,
  BendDirection,
  CalculationSettings,
  CutType,
  DecimalOperation,
  FoldSegment,
  MaterialRule,
} from "./fold-profile";

export type SegmentCalculation = {
  id: string;
  inputLength: number;
  inputLengthDecimal: string;
  throughLength: number;
  throughLengthDecimal: string;
  baseLength: number;
  baseLengthDecimal: string;
  calculatedLength: number;
  calculatedLengthDecimal: string;
  automaticCorrection: number;
  automaticCorrectionDecimal: string;
  previousJunctionCorrectionDecimal: string;
  nextJunctionCorrectionDecimal: string;
  appliedCorrection: number;
  appliedCorrectionDecimal: string;
  correctionSource: "automatic" | "manual" | "disabled";
};

export type ProfileCalculation = {
  engineVersion: typeof FOLD_CALCULATION_ENGINE_VERSION;
  segments: SegmentCalculation[];
  inputLengthTotal: number;
  inputLengthTotalDecimal: string;
  calculatedWidth: number;
  calculatedWidthDecimal: string;
  appliedCorrectionTotal: number;
  appliedCorrectionTotalDecimal: string;
};

export type ProductCalculation = ProfileCalculation & {
  productLength: number;
  productLengthDecimal: string;
  quantity: number;
  size: { width: number; length: number };
  sizeDecimal: { width: string; length: string };
  areaEachM2: number;
  areaEachM2Decimal: string;
  areaTotalM2: number;
  areaTotalM2Decimal: string;
  resolvedVariables: Record<string, string>;
  expressionIssues: FoldExpressionIssue[];
  panelSpanMm: number | null;
  panelSpanDecimal: string | null;
};

const effectiveCutType = (bend: Bend, vCutEnabled: boolean): CutType =>
  vCutEnabled ? bend.cutType : "no-cut";

const signedCanonicalValue = (direction: BendDirection, value: number) => {
  const canonical = lengthNumberToCanonical(value);
  return direction === "front"
    ? canonical
    : subtractCanonicalDecimals("0", canonical);
};

// MFC Gn_MathRound(a, b): b=1 rounds to an integer, b=2 to one decimal place.
export function legacyRound(value: number, parameter: number): number {
  const factor = 10 ** (parameter - 1);
  const scaled = value * factor;
  const rounded = scaled > 0 ? Math.floor(scaled + 0.5) : Math.ceil(scaled - 0.5);
  return rounded === 0 ? 0 : rounded / factor;
}

function fixedContribution(bend: Bend | undefined, rule: MaterialRule, vCutEnabled: boolean) {
  if (!bend) return "0";
  const cutType = effectiveCutType(bend, vCutEnabled);
  return sumDecimals(
    bendOperations(bend).map((operation) =>
      signedCanonicalValue(operation.direction, rule.elongation[cutType]),
    ),
  );
}

function ratioContribution(bend: Bend | undefined, rule: MaterialRule, vCutEnabled: boolean) {
  if (!bend || bend.angle >= rule.cutAngle) return "0";
  const cutType = effectiveCutType(bend, vCutEnabled);
  const depth = lengthNumberToCanonical(rule.cutDepth[cutType]);
  return sumDecimals(
    bendOperations(bend).map((operation) =>
      operation.direction === "front"
        ? subtractCanonicalDecimals(lengthNumberToCanonical(rule.thickness), depth)
        : subtractCanonicalDecimals("0", depth),
    ),
  );
}

const sumDecimals = (values: string[]) =>
  values.reduce(addCanonicalDecimals, "0");

function isDiagonalSegment(segment: FoldSegment) {
  return Math.abs(segment.end.x - segment.start.x) > 1e-9
    && Math.abs(segment.end.y - segment.start.y) > 1e-9;
}

function fixedJunctionContribution(
  bend: Bend | undefined,
  rule: MaterialRule,
  settings: CalculationSettings,
  applyAngleLimit: boolean,
) {
  if (applyAngleLimit && bend && bend.angle >= rule.cutAngle) return "0";
  return fixedContribution(bend, rule, settings.vCutEnabled);
}

function ext1Contributions(
  previousBend: Bend | undefined,
  nextBend: Bend | undefined,
  rule: MaterialRule,
  settings: CalculationSettings,
) {
  const bends = [previousBend, nextBend];
  const operations = bends.flatMap((bend) => bend ? bendOperations(bend) : []);
  const bothJunctionsAreBack = previousBend !== undefined
    && nextBend !== undefined
    && operations.every((operation) => operation.direction === "back");
  if (bothJunctionsAreBack) return ["0", "0"] as const;

  const frontPriority = operations.some((operation) => operation.direction === "front");
  const contribution = (bend: Bend | undefined) => {
    if (!bend) return "0";
    if (!frontPriority) return fixedContribution(bend, rule, settings.vCutEnabled);
    const cutType = effectiveCutType(bend, settings.vCutEnabled);
    return sumDecimals(
      bendOperations(bend).map(() => lengthNumberToCanonical(rule.elongation[cutType])),
    );
  };
  return [contribution(previousBend), contribution(nextBend)] as const;
}

function segmentJunctionContributions(
  segment: FoldSegment,
  previousBend: Bend | undefined,
  nextBend: Bend | undefined,
  rule: MaterialRule,
  settings: CalculationSettings,
) {
  if (settings.mode === "ratio") {
    return [
      ratioContribution(previousBend, rule, settings.vCutEnabled),
      ratioContribution(nextBend, rule, settings.vCutEnabled),
    ] as const;
  }

  if (settings.elongationOption === "ext1") {
    return ext1Contributions(previousBend, nextBend, rule, settings);
  }

  const applyAngleLimit = settings.elongationOption === "two-line"
    || (settings.elongationOption === "diagonal" && !isDiagonalSegment(segment));
  return [
    fixedJunctionContribution(previousBend, rule, settings, applyAngleLimit),
    fixedJunctionContribution(nextBend, rule, settings, applyAngleLimit),
  ] as const;
}

export function calculateProfile(
  segments: FoldSegment[],
  rule: MaterialRule,
  settings: CalculationSettings,
  resolvedLengths: Record<string, string> = {},
): ProfileCalculation {
  const calculated = segments.map((segment, index) => {
    const previousSegment = segments[index - 1];
    const previousBend =
      previousSegment?.calculateElongation === false ? undefined : previousSegment?.bendAfter;
    const nextBend = segment.calculateElongation === false ? undefined : segment.bendAfter;
    const [previousJunctionCorrectionDecimal, nextJunctionCorrectionDecimal] =
      segmentJunctionContributions(segment, previousBend, nextBend, rule, settings);
    const automaticCorrectionDecimal = addCanonicalDecimals(
      previousJunctionCorrectionDecimal,
      nextJunctionCorrectionDecimal,
    );
    const correctionDecimal = segment.elongationOverride === undefined
      ? automaticCorrectionDecimal
      : lengthNumberToCanonical(segment.elongationOverride);
    const inputLengthDecimal = resolvedLengths[segment.id]
      ?? lengthNumberToCanonical(segment.inputLength);
    const resolvedInputLength = canonicalDecimalToNumber(inputLengthDecimal);
    const metrics = isArcSegment(segment) && segment.geometry?.kind === "arc"
      ? arcMetrics(resolvedInputLength, segment.geometry.sagitta)
      : null;
    const baseLengthDecimal = metrics
      ? lengthNumberToCanonical(Number(metrics.arcLength.toFixed(6)))
      : inputLengthDecimal;
    const rawLengthDecimal = subtractCanonicalDecimals(baseLengthDecimal, correctionDecimal);
    const calculatedLengthDecimal = quantizeCanonicalDecimal(
      rawLengthDecimal,
      settings.decimalPlaces,
      settings.decimalOperation,
    );
    const appliedCorrectionDecimal = subtractCanonicalDecimals(
      baseLengthDecimal,
      calculatedLengthDecimal,
    );

    return {
      id: segment.id,
      inputLength: segment.inputLength,
      inputLengthDecimal,
      throughLength: resolvedInputLength,
      throughLengthDecimal: inputLengthDecimal,
      baseLength: canonicalDecimalToNumber(baseLengthDecimal),
      baseLengthDecimal,
      calculatedLength: canonicalDecimalToNumber(calculatedLengthDecimal),
      calculatedLengthDecimal,
      automaticCorrection: canonicalDecimalToNumber(automaticCorrectionDecimal),
      automaticCorrectionDecimal,
      previousJunctionCorrectionDecimal,
      nextJunctionCorrectionDecimal,
      appliedCorrection: canonicalDecimalToNumber(appliedCorrectionDecimal),
      appliedCorrectionDecimal,
      correctionSource:
        segment.elongationOverride !== undefined
          ? "manual" as const
          : segment.calculateElongation === false && previousBend === undefined
            ? "disabled" as const
            : "automatic" as const,
    };
  });

  const inputLengthTotalDecimal = sumDecimals(
    calculated.map((item) => item.baseLengthDecimal),
  );
  const calculatedWidthDecimal = sumDecimals(
    calculated.map((item) => item.calculatedLengthDecimal),
  );
  const appliedCorrectionTotalDecimal = subtractCanonicalDecimals(
    inputLengthTotalDecimal,
    calculatedWidthDecimal,
  );

  return {
    engineVersion: FOLD_CALCULATION_ENGINE_VERSION,
    segments: calculated,
    inputLengthTotal: canonicalDecimalToNumber(inputLengthTotalDecimal),
    inputLengthTotalDecimal,
    calculatedWidth: canonicalDecimalToNumber(calculatedWidthDecimal),
    calculatedWidthDecimal,
    appliedCorrectionTotal: canonicalDecimalToNumber(appliedCorrectionTotalDecimal),
    appliedCorrectionTotalDecimal,
  };
}

function productResult(
  profile: ProfileCalculation,
  productLengthDecimal: string,
  quantity: number,
  resolvedVariables: Record<string, string> = {},
  expressionIssues: FoldExpressionIssue[] = [],
  panelSpanDecimal: string | null = null,
): ProductCalculation {
  const productLength = canonicalDecimalToNumber(productLengthDecimal);
  const areaEachRaw = squareMillimetresToSquareMetres(
    multiplyCanonicalDecimals(profile.calculatedWidthDecimal, productLengthDecimal),
  );
  const areaTotalRaw = multiplyCanonicalDecimalByInteger(areaEachRaw, quantity);
  const areaEachM2Decimal = quantizeCanonicalDecimal(
    areaEachRaw,
    AREA_DECIMAL_PLACES,
    "round",
  );
  const areaTotalM2Decimal = quantizeCanonicalDecimal(
    areaTotalRaw,
    AREA_DECIMAL_PLACES,
    "round",
  );

  return {
    ...profile,
    productLength,
    productLengthDecimal,
    quantity,
    size: { width: profile.calculatedWidth, length: productLength },
    sizeDecimal: { width: profile.calculatedWidthDecimal, length: productLengthDecimal },
    areaEachM2: canonicalDecimalToNumber(areaEachM2Decimal),
    areaEachM2Decimal,
    areaTotalM2: canonicalDecimalToNumber(areaTotalM2Decimal),
    areaTotalM2Decimal,
    resolvedVariables,
    expressionIssues,
    panelSpanMm: panelSpanDecimal === null ? null : canonicalDecimalToNumber(panelSpanDecimal),
    panelSpanDecimal,
  };
}

export function calculateProduct(
  segments: FoldSegment[],
  rule: MaterialRule,
  settings: CalculationSettings,
  productLength: number,
  quantity: number,
): ProductCalculation {
  const profile = calculateProfile(segments, rule, settings);
  return productResult(profile, lengthNumberToCanonical(productLength), quantity);
}

export function calculateFoldProfileDocument(profile: FoldProfile): ProductCalculation {
  const expressionResolution = resolveFoldProfileExpressions(profile);
  const blocks = profile.blocks.map((block) =>
    calculateProfile(
      block.segments,
      profile.material,
      profile.calculation,
      expressionResolution.segmentLengths,
    ),
  );
  const segments = blocks.flatMap((block) => block.segments);
  const inputLengthTotalDecimal = sumDecimals(
    blocks.map((block) => block.inputLengthTotalDecimal),
  );
  const calculatedWidthDecimal = sumDecimals(
    blocks.map((block) => block.calculatedWidthDecimal),
  );
  const appliedCorrectionTotalDecimal = subtractCanonicalDecimals(
    inputLengthTotalDecimal,
    calculatedWidthDecimal,
  );

  const dimensionPanel = profile.panelAttachments.find(
    (panel) => panel.dimensionRole === "secondary-product-dimension",
  );
  const panelSpanDecimal = dimensionPanel
    ? dimensionPanel.block.segments.reduce((maximum, segment) => {
        const value = lengthNumberToCanonical(segment.inputLength);
        return canonicalDecimalToNumber(value) > canonicalDecimalToNumber(maximum) ? value : maximum;
      }, "0")
    : null;

  return productResult({
    engineVersion: FOLD_CALCULATION_ENGINE_VERSION,
    segments,
    inputLengthTotal: canonicalDecimalToNumber(inputLengthTotalDecimal),
    inputLengthTotalDecimal,
    calculatedWidth: canonicalDecimalToNumber(calculatedWidthDecimal),
    calculatedWidthDecimal,
    appliedCorrectionTotal: canonicalDecimalToNumber(appliedCorrectionTotalDecimal),
    appliedCorrectionTotalDecimal,
  }, expressionResolution.productLengthDecimal, profile.product.quantity,
  expressionResolution.variableValues, expressionResolution.issues, panelSpanDecimal);
}

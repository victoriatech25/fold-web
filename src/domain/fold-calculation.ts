import type {
  Bend,
  BendDirection,
  CalculationSettings,
  CutType,
  DecimalOperation,
  FoldProfile,
  FoldSegment,
  MaterialRule,
} from "./fold-profile";

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
  calculatedLength: number;
  automaticCorrection: number;
  appliedCorrection: number;
  correctionSource: "automatic" | "manual" | "disabled";
};

export type ProfileCalculation = {
  segments: SegmentCalculation[];
  inputLengthTotal: number;
  calculatedWidth: number;
  appliedCorrectionTotal: number;
};

export type ProductCalculation = ProfileCalculation & {
  productLength: number;
  quantity: number;
  size: { width: number; length: number };
  areaEachM2: number;
  areaTotalM2: number;
};

const effectiveCutType = (bend: Bend, vCutEnabled: boolean): CutType =>
  vCutEnabled ? bend.cutType : "no-cut";

const signedFixedValue = (direction: BendDirection, value: number) =>
  direction === "front" ? value : -value;

// MFC Gn_MathRound(a, b): b=1 rounds to an integer, b=2 to one decimal place.
export function legacyRound(value: number, parameter: number): number {
  const factor = 10 ** (parameter - 1);
  const scaled = value * factor;
  const rounded = scaled > 0 ? Math.floor(scaled + 0.5) : Math.ceil(scaled - 0.5);
  return rounded === 0 ? 0 : rounded / factor;
}

function legacyDecimal(value: number, places: number, operation: DecimalOperation) {
  if (operation === "none") return value;

  const factor = 10 ** places;
  if (operation === "round") return legacyRound(value, places + 1);
  if (operation === "floor") {
    return (value >= 0 ? Math.floor(value * factor) : Math.ceil(value * factor)) / factor;
  }

  return (value >= 0 ? Math.ceil(value * factor) : Math.floor(value * factor)) / factor;
}

function fixedContribution(bend: Bend | undefined, rule: MaterialRule, vCutEnabled: boolean) {
  if (!bend) return 0;
  const cutType = effectiveCutType(bend, vCutEnabled);
  return signedFixedValue(bend.direction, rule.elongation[cutType]);
}

function ratioContribution(bend: Bend | undefined, rule: MaterialRule, vCutEnabled: boolean) {
  if (!bend || bend.angle >= rule.cutAngle) return 0;
  const cutType = effectiveCutType(bend, vCutEnabled);
  const depth = rule.cutDepth[cutType];
  return bend.direction === "front" ? rule.thickness - depth : -depth;
}

export function calculateProfile(
  segments: FoldSegment[],
  rule: MaterialRule,
  settings: CalculationSettings,
): ProfileCalculation {
  const calculated = segments.map((segment, index) => {
    const previousSegment = segments[index - 1];
    const previousBend =
      previousSegment?.calculateElongation === false ? undefined : previousSegment?.bendAfter;
    const nextBend = segment.calculateElongation === false ? undefined : segment.bendAfter;
    const contribution = settings.mode === "fixed" ? fixedContribution : ratioContribution;
    const rawCorrection =
      contribution(previousBend, rule, settings.vCutEnabled) +
      contribution(nextBend, rule, settings.vCutEnabled);
    const automaticCorrection =
      settings.mode === "fixed" ? legacyRound(rawCorrection, 5) : rawCorrection;
    const correction = segment.elongationOverride ?? automaticCorrection;
    const rawLength = segment.inputLength - correction;
    const calculatedLength = legacyDecimal(
      rawLength,
      settings.decimalPlaces,
      settings.decimalOperation,
    );

    return {
      id: segment.id,
      inputLength: segment.inputLength,
      calculatedLength,
      automaticCorrection,
      appliedCorrection: segment.inputLength - calculatedLength,
      correctionSource:
        segment.elongationOverride !== undefined
          ? "manual" as const
          : segment.calculateElongation === false && previousBend === undefined
            ? "disabled" as const
            : "automatic" as const,
    };
  });

  const inputLengthTotal = calculated.reduce((sum, item) => sum + item.inputLength, 0);
  const calculatedWidth = calculated.reduce((sum, item) => sum + item.calculatedLength, 0);

  return {
    segments: calculated,
    inputLengthTotal,
    calculatedWidth,
    appliedCorrectionTotal: inputLengthTotal - calculatedWidth,
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
  const areaEachM2 = (profile.calculatedWidth * productLength) / 1_000_000;

  return {
    ...profile,
    productLength,
    quantity,
    size: { width: profile.calculatedWidth, length: productLength },
    areaEachM2,
    areaTotalM2: areaEachM2 * quantity,
  };
}

export function calculateFoldProfileDocument(profile: FoldProfile): ProductCalculation {
  const blocks = profile.blocks.map((block) =>
    calculateProfile(block.segments, profile.material, profile.calculation),
  );
  const segments = blocks.flatMap((block) => block.segments);
  const inputLengthTotal = blocks.reduce((sum, block) => sum + block.inputLengthTotal, 0);
  const calculatedWidth = blocks.reduce((sum, block) => sum + block.calculatedWidth, 0);
  const appliedCorrectionTotal = inputLengthTotal - calculatedWidth;
  const areaEachM2 = (calculatedWidth * profile.product.length) / 1_000_000;

  return {
    segments,
    inputLengthTotal,
    calculatedWidth,
    appliedCorrectionTotal,
    productLength: profile.product.length,
    quantity: profile.product.quantity,
    size: { width: calculatedWidth, length: profile.product.length },
    areaEachM2,
    areaTotalM2: areaEachM2 * profile.product.quantity,
  };
}

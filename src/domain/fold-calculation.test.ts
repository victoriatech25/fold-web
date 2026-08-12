import { describe, expect, it } from "vitest";

import {
  calculateFoldProfileDocument,
  calculateProduct,
  calculateProfile,
  legacyRound,
  type CalculationSettings,
  type FoldSegment,
  type MaterialRule,
} from "./fold-calculation";
import { createFoldBlock, createFoldProfile, createFoldSegment, type Bend } from "./fold-profile";

const segment = (id: string, inputLength: number, bendAfter?: Bend): FoldSegment =>
  createFoldSegment(
    { x: 0, y: 0 },
    { x: inputLength, y: 0 },
    { id, inputLength, bendAfter },
  );

const material: MaterialRule = {
  thickness: 2,
  insideBendRadius: 2,
  cutAngle: 135,
  elongation: { "v-cut": 1.2, "a-cut": 0.8, "no-cut": 2 },
  cutDepth: { "v-cut": 0.5, "a-cut": 0.8, "no-cut": 0 },
};

const fixed: CalculationSettings = {
  mode: "fixed",
  elongationOption: "standard",
  vCutEnabled: true,
  decimalPlaces: 0,
  decimalOperation: "round",
};

describe("MFC-compatible rounding", () => {
  it("rounds half away from zero using the legacy parameter", () => {
    expect(legacyRound(1.5, 1)).toBe(2);
    expect(legacyRound(-1.5, 1)).toBe(-2);
    expect(legacyRound(2.84, 2)).toBe(2.8);
    expect(legacyRound(2.85, 2)).toBe(2.9);
  });
});

describe("fixed elongation", () => {
  it("keeps a straight profile unchanged", () => {
    const result = calculateProfile([segment("s1", 100)], material, fixed);
    expect(result.calculatedWidth).toBe(100);
  });

  it("uses arc length as the calculation baseline while retaining the chord length", () => {
    const arc = segment("arc-1", 100);
    arc.geometry = { kind: "arc", side: "left", sagitta: 50 };

    const result = calculateProfile(
      [arc],
      material,
      { ...fixed, decimalPlaces: 6 },
    );

    expect(result.segments[0].throughLengthDecimal).toBe("100");
    expect(result.segments[0].baseLengthDecimal).toBe("157.079633");
    expect(result.inputLengthTotalDecimal).toBe("157.079633");
    expect(result.calculatedWidthDecimal).toBe("157.079633");
    expect(result.appliedCorrectionTotalDecimal).toBe("0");
  });

  it("subtracts a front bend from both adjacent segments", () => {
    const segments: FoldSegment[] = [
      segment("s1", 100, { direction: "front", cutType: "v-cut", angle: 90 }),
      segment("s2", 50),
    ];
    const result = calculateProfile(segments, material, fixed);
    expect(result.segments.map((item) => item.calculatedLength)).toEqual([99, 49]);
    expect(result.calculatedWidth).toBe(148);
  });

  it("adds a back bend to both adjacent segments", () => {
    const segments: FoldSegment[] = [
      segment("s1", 100, { direction: "back", cutType: "v-cut", angle: 90 }),
      segment("s2", 50),
    ];
    expect(calculateProfile(segments, material, fixed).calculatedWidth).toBe(152);
  });

  it("uses no-cut values when V-cut is disabled", () => {
    const segments: FoldSegment[] = [
      segment("s1", 100, { direction: "front", cutType: "v-cut", angle: 90 }),
      segment("s2", 50),
    ];
    const result = calculateProfile(segments, material, { ...fixed, vCutEnabled: false });
    expect(result.calculatedWidth).toBe(146);
  });

  it("reports the automatic correction and supports a per-segment manual value", () => {
    const first = segment("s1", 100, { direction: "front", cutType: "v-cut", angle: 90 });
    first.elongationOverride = 3;
    const result = calculateProfile([first, segment("s2", 50)], material, fixed);

    expect(result.segments[0]).toMatchObject({
      automaticCorrection: 1.2,
      appliedCorrection: 3,
      correctionSource: "manual",
      calculatedLength: 97,
    });
    expect(result.segments[1].correctionSource).toBe("automatic");
  });

  it("preserves fractional fixed corrections", () => {
    const segments: FoldSegment[] = [
      segment("s1", 100, { direction: "front", cutType: "a-cut", angle: 90 }),
      segment("s2", 50),
    ];
    const result = calculateProfile(segments, material, { ...fixed, decimalPlaces: 1 });

    expect(result.segments.map((item) => item.automaticCorrection)).toEqual([0.8, 0.8]);
    expect(result.segments.map((item) => item.calculatedLength)).toEqual([99.2, 49.2]);
    expect(result.calculatedWidth).toBe(148.4);
  });

  it("preserves six-place FIX corrections until the final segment quantization", () => {
    const preciseMaterial: MaterialRule = {
      ...material,
      elongation: { ...material.elongation, "v-cut": 1.005001 },
    };
    const segments: FoldSegment[] = [
      segment("s1", 100, { direction: "front", cutType: "v-cut", angle: 90 }),
      segment("s2", 50),
    ];
    const result = calculateProfile(segments, preciseMaterial, {
      ...fixed,
      decimalPlaces: 2,
    });

    expect(result.engineVersion).toBe("decimal-v1");
    expect(result.segments.map((item) => item.automaticCorrectionDecimal)).toEqual([
      "1.005001",
      "1.005001",
    ]);
    expect(result.segments.map((item) => item.calculatedLengthDecimal)).toEqual([
      "98.99",
      "48.99",
    ]);
    expect(result.calculatedWidthDecimal).toBe("147.98");
  });

  it("excludes a disabled bend from both adjacent segments", () => {
    const first = segment("s1", 100, { direction: "front", cutType: "v-cut", angle: 90 });
    first.calculateElongation = false;
    const result = calculateProfile([first, segment("s2", 50)], material, fixed);

    expect(result.segments).toEqual([
      expect.objectContaining({
        id: "s1",
        calculatedLength: 100,
        automaticCorrection: 0,
        correctionSource: "disabled",
      }),
      expect.objectContaining({
        id: "s2",
        calculatedLength: 50,
        automaticCorrection: 0,
        correctionSource: "automatic",
      }),
    ]);
    expect(result.calculatedWidth).toBe(150);
  });

  it.each(["standard", "a", "zero", "u"] as const)(
    "uses direction for %s form correction while preserving the form as manufacturing data",
    (form) => {
      const segments = [
        segment("s1", 100, { direction: "front", form, cutType: "v-cut", angle: 90 }),
        segment("s2", 50),
      ];
      expect(calculateProfile(segments, material, { ...fixed, decimalPlaces: 1 }).calculatedWidthDecimal)
        .toBe("147.6");
    },
  );

  it("adds ordered composite operations and lets opposite FIX directions cancel", () => {
    const segments = [
      segment("s1", 100, {
        direction: "front",
        form: "u",
        secondaryOperation: { direction: "back", form: "u" },
        cutType: "v-cut",
        angle: 90,
      }),
      segment("s2", 50),
    ];
    const result = calculateProfile(segments, material, { ...fixed, decimalPlaces: 1 });
    expect(result.segments.map((item) => item.automaticCorrectionDecimal)).toEqual(["0", "0"]);
    expect(result.calculatedWidthDecimal).toBe("150");
  });
});

describe("fixed elongation options", () => {
  const aboveLimit = [
    segment("s1", 100, { direction: "front", cutType: "v-cut", angle: 140 }),
    createFoldSegment({ x: 100, y: 0 }, { x: 150, y: 0 }, { id: "s2", inputLength: 50 }),
  ];

  it("applies standard regardless of angle and gates two-line at the strict boundary", () => {
    expect(calculateProfile(aboveLimit, material, { ...fixed, decimalPlaces: 1 }).calculatedWidthDecimal).toBe("147.6");
    expect(calculateProfile(aboveLimit, material, { ...fixed, elongationOption: "two-line", decimalPlaces: 1 }).calculatedWidthDecimal).toBe("150");
    const below = structuredClone(aboveLimit);
    below[0].bendAfter!.angle = 134.9999;
    expect(calculateProfile(below, material, { ...fixed, elongationOption: "two-line", decimalPlaces: 1 }).calculatedWidthDecimal).toBe("147.6");
  });

  it("always applies to diagonal segments but angle-gates orthogonal segments", () => {
    const diagonal = structuredClone(aboveLimit);
    diagonal[0].end = { x: 70, y: 70 };
    expect(calculateProfile(diagonal, material, { ...fixed, elongationOption: "diagonal", decimalPlaces: 1 }).segments[0].calculatedLengthDecimal).toBe("98.8");
    expect(calculateProfile(aboveLimit, material, { ...fixed, elongationOption: "diagonal", decimalPlaces: 1 }).segments[0].calculatedLengthDecimal).toBe("100");
  });

  it("uses front priority and skips a segment bordered only by back bends in ext1", () => {
    const backBack = [
      segment("s1", 100, { direction: "back", cutType: "v-cut", angle: 90 }),
      segment("s2", 50, { direction: "back", cutType: "v-cut", angle: 90 }),
      segment("s3", 80),
    ];
    const skipped = calculateProfile(backBack, material, { ...fixed, elongationOption: "ext1", decimalPlaces: 1 });
    expect(skipped.segments[1].automaticCorrectionDecimal).toBe("0");

    backBack[1].bendAfter!.direction = "front";
    const prioritized = calculateProfile(backBack, material, { ...fixed, elongationOption: "ext1", decimalPlaces: 1 });
    expect(prioritized.segments[1].automaticCorrectionDecimal).toBe("2.4");
  });
});

describe("ratio elongation", () => {
  const ratio: CalculationSettings = { ...fixed, mode: "ratio", decimalPlaces: 1 };
  const profile: FoldSegment[] = [
    segment("s1", 100, { direction: "front", cutType: "v-cut", angle: 90 }),
    segment("s2", 50),
  ];

  it("uses thickness minus cut depth for a front bend", () => {
    expect(calculateProfile(profile, material, ratio).calculatedWidth).toBe(147);
  });

  it("does not apply a bend at or above the configured cut angle", () => {
    const boundary = profile.map((segment) => ({
      ...segment,
      bendAfter: segment.bendAfter ? { ...segment.bendAfter, angle: 135 } : undefined,
    }));
    expect(calculateProfile(boundary, material, ratio).calculatedWidth).toBe(150);
  });

  it("sums both operations and ignores fixed-only elongation options", () => {
    const composite = [
      segment("s1", 100, {
        direction: "front",
        secondaryOperation: { direction: "back", form: "standard" },
        cutType: "v-cut",
        angle: 90,
      }),
      segment("s2", 50),
    ];
    const result = calculateProfile(composite, material, { ...ratio, elongationOption: "ext1" });
    expect(result.segments[0].automaticCorrectionDecimal).toBe("1");
    expect(result.calculatedWidthDecimal).toBe("148");
  });
});

describe("product size", () => {
  it("calculates unfolded size and quantity area in square metres", () => {
    const result = calculateProduct([segment("s1", 239)], material, fixed, 2400, 10);
    expect(result.size).toEqual({ width: 239, length: 2400 });
    expect(result.areaEachM2).toBeCloseTo(0.5736);
    expect(result.areaTotalM2).toBeCloseTo(5.736);
    expect(result.areaEachM2Decimal).toBe("0.5736");
    expect(result.areaTotalM2Decimal).toBe("5.736");
  });

  it("aggregates box faces without treating their boundary as a bend connection", () => {
    const profile = createFoldProfile({
      profileType: "box",
      material,
      product: { length: 2000, quantity: 3 },
    });
    profile.blocks = [createFoldBlock(1), createFoldBlock(2)];
    profile.blocks[0].segments = [segment("face-1", 100, { direction: "front", cutType: "v-cut", angle: 90 })];
    profile.blocks[1].segments = [segment("face-2", 50)];

    const result = calculateFoldProfileDocument(profile);
    expect(result.inputLengthTotal).toBe(150);
    expect(result.appliedCorrectionTotal).toBe(1);
    expect(result.calculatedWidth).toBe(149);
    expect(result.size).toEqual({ width: 149, length: 2000 });
    expect(result.areaEachM2).toBeCloseTo(0.298);
    expect(result.areaTotalM2).toBeCloseTo(0.894);
  });
});

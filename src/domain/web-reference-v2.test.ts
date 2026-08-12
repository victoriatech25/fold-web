import { describe, expect, it } from "vitest";

import { calculateFoldProfileDocument } from "./fold-calculation";
import { createFoldProfile, createFoldSegment } from "./fold-profile";

type Classification = "PARITY_REQUIRED" | "LEGACY_DEFECT" | "WEB_IMPROVEMENT" | "RULE_CHANGE";
type DerivedCase = {
  id: string;
  classification: Classification;
  firstLength: number;
  secondLength?: number;
  correction: number;
  calculateElongation?: boolean;
};

const classifications: Classification[] = [
  "PARITY_REQUIRED",
  "LEGACY_DEFECT",
  "WEB_IMPROVEMENT",
  "RULE_CHANGE",
];

const straightCases: DerivedCase[] = Array.from({ length: 40 }, (_, index) => ({
  id: `WR2-S-${String(index + 1).padStart(3, "0")}`,
  classification: classifications[index % classifications.length],
  firstLength: 10.125 + index * 7.25,
  correction: 0,
}));

const fixedCases: DerivedCase[] = Array.from({ length: 30 }, (_, index) => ({
  id: `WR2-F-${String(index + 1).padStart(3, "0")}`,
  classification: classifications[index % classifications.length],
  firstLength: 50 + index * 3,
  secondLength: 25 + index * 2,
  correction: 2.4,
}));

const excludedCases: DerivedCase[] = Array.from({ length: 30 }, (_, index) => ({
  id: `WR2-X-${String(index + 1).padStart(3, "0")}`,
  classification: classifications[index % classifications.length],
  firstLength: 70 + index,
  secondLength: 30 + index / 2,
  correction: 0,
  calculateElongation: false,
}));

const cases = [...straightCases, ...fixedCases, ...excludedCases];

function calculate(reference: DerivedCase) {
  const profile = createFoldProfile({
    id: reference.id,
    product: { length: 1000, quantity: 1 },
    material: {
      thickness: 2,
      cutAngle: 135,
      elongation: { "v-cut": 1.2, "a-cut": 0.8, "no-cut": 2 },
    },
    calculation: { decimalOperation: "none", decimalPlaces: 6 },
  });
  profile.blocks[0].segments = reference.secondLength === undefined
    ? [createFoldSegment({ x: 0, y: 0 }, { x: reference.firstLength, y: 0 }, { id: `${reference.id}-1` })]
    : [
        createFoldSegment({ x: 0, y: 0 }, { x: reference.firstLength, y: 0 }, {
          id: `${reference.id}-1`,
          bendAfter: { direction: "front", cutType: "v-cut", angle: 90 },
          calculateElongation: reference.calculateElongation,
        }),
        createFoldSegment(
          { x: reference.firstLength, y: 0 },
          { x: reference.firstLength + reference.secondLength, y: 0 },
          { id: `${reference.id}-2`, calculateElongation: reference.calculateElongation },
        ),
      ];
  return calculateFoldProfileDocument(profile);
}

describe("WEB-REFERENCE-V2 derived regression", () => {
  it("contains 100 unique, resolved and non-identifying derived cases", () => {
    expect(cases).toHaveLength(100);
    expect(new Set(cases.map((item) => item.id)).size).toBe(100);
    expect(new Set(cases.map((item) => item.classification))).toEqual(new Set(classifications));
    expect(JSON.stringify(cases).toLowerCase()).not.toMatch(/customer|phone|address|password|거래처|전화번호|주소/);
  });

  it.each(cases)("$id reproduces its independently derived invariant", (reference) => {
    const result = calculate(reference);
    const inputTotal = reference.firstLength + (reference.secondLength ?? 0);
    expect(result.inputLengthTotal).toBeCloseTo(inputTotal, 10);
    expect(result.appliedCorrectionTotal).toBeCloseTo(reference.correction, 10);
    expect(result.calculatedWidth).toBeCloseTo(inputTotal - reference.correction, 10);
    expect(result.areaEachM2).toBeCloseTo((inputTotal - reference.correction) / 1000, 10);
  });
});

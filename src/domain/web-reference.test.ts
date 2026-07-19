import { describe, expect, it } from "vitest";

import fixture from "./fixtures/web-reference-v1.json";
import { calculateFoldProfileDocument } from "./fold-calculation";
import {
  createFoldBlock,
  createFoldProfile,
  createFoldSegment,
  type Bend,
  type CalculationSettings,
  type FoldProfile,
  type MaterialSnapshot,
  type ProductSpec,
} from "./fold-profile";

type SegmentInput = {
  id: string;
  length: number;
  bendAfter?: Bend;
  calculateElongation?: boolean;
  elongationOverride?: number;
};

type ExpectedSegment = {
  id: string;
  calculatedLength: number;
  automaticCorrection: number;
  appliedCorrection: number;
  correctionSource: "automatic" | "manual" | "disabled";
};

type ReferenceCase = {
  caseId: string;
  title: string;
  verification: {
    status: "approved";
    classification:
      | "PARITY_REQUIRED"
      | "LEGACY_DEFECT"
      | "WEB_IMPROVEMENT"
      | "RULE_CHANGE"
      | "UNRESOLVED";
  };
  input: {
    profileType?: "normal" | "box";
    material?: Partial<MaterialSnapshot> & {
      elongation?: Partial<MaterialSnapshot["elongation"]>;
      cutDepth?: Partial<MaterialSnapshot["cutDepth"]>;
    };
    calculation?: Partial<CalculationSettings>;
    product?: Partial<ProductSpec>;
    blocks: SegmentInput[][];
  };
  approvedExpected: {
    segments: ExpectedSegment[];
    inputLengthTotal: number;
    calculatedWidth: number;
    appliedCorrectionTotal: number;
    areaEachM2: number;
    areaTotalM2: number;
  };
};

const cases = fixture.cases as ReferenceCase[];

function createProfile(reference: ReferenceCase): FoldProfile {
  const defaults = fixture.defaults;
  const material: MaterialSnapshot = {
    id: "web-reference-material",
    name: "비식별 기준 재질",
    ...defaults.material,
    ...reference.input.material,
    elongation: {
      ...defaults.material.elongation,
      ...reference.input.material?.elongation,
    },
    cutDepth: {
      ...defaults.material.cutDepth,
      ...reference.input.material?.cutDepth,
    },
  };
  const calculation: CalculationSettings = {
    ...defaults.calculation,
    ...reference.input.calculation,
  } as CalculationSettings;
  const product: ProductSpec = {
    ...defaults.product,
    ...reference.input.product,
  };
  const profile = createFoldProfile({
    id: reference.caseId,
    name: reference.title,
    profileType: reference.input.profileType,
    material,
    calculation,
    product,
    now: "2026-07-19T00:00:00.000Z",
  });

  profile.blocks = reference.input.blocks.map((segments, blockIndex) => {
    const block = createFoldBlock(blockIndex + 1, `면 ${blockIndex + 1}`);
    let x = 0;
    block.segments = segments.map((segment) => {
      const start = { x, y: blockIndex * 100 };
      x += segment.length;
      return createFoldSegment(start, { x, y: start.y }, {
        id: segment.id,
        inputLength: segment.length,
        bendAfter: segment.bendAfter,
        calculateElongation: segment.calculateElongation,
        elongationOverride: segment.elongationOverride,
      });
    });
    return block;
  });

  return profile;
}

describe("WEB-REFERENCE-V1 fixture contract", () => {
  it("contains exactly 20 unique, non-identifying approved cases", () => {
    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.suiteId).toBe("WEB-REFERENCE-V1");
    expect(fixture.source.legacyExecutableObserved).toBe(false);
    expect(fixture.source.containsPersonalData).toBe(false);
    expect(cases).toHaveLength(20);
    expect(new Set(cases.map((item) => item.caseId)).size).toBe(20);
    expect(cases.every((item) => item.verification.status === "approved")).toBe(true);
    expect(cases.every((item) => item.verification.classification !== "UNRESOLVED")).toBe(true);

    const serialized = JSON.stringify(fixture).toLowerCase();
    for (const forbidden of ["customer", "phone", "address", "password", "거래처", "전화번호", "주소"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it.each(cases)("$caseId $title reproduces its approved expected result", (reference) => {
    const result = calculateFoldProfileDocument(createProfile(reference));
    const expected = reference.approvedExpected;

    expect(result.segments).toHaveLength(expected.segments.length);
    result.segments.forEach((segment, index) => {
      const expectedSegment = expected.segments[index];
      expect(segment.id).toBe(expectedSegment.id);
      expect(segment.calculatedLength).toBeCloseTo(expectedSegment.calculatedLength, 10);
      expect(segment.automaticCorrection).toBeCloseTo(expectedSegment.automaticCorrection, 10);
      expect(segment.appliedCorrection).toBeCloseTo(expectedSegment.appliedCorrection, 10);
      expect(segment.correctionSource).toBe(expectedSegment.correctionSource);
    });
    expect(result.inputLengthTotal).toBeCloseTo(expected.inputLengthTotal, 10);
    expect(result.calculatedWidth).toBeCloseTo(expected.calculatedWidth, 10);
    expect(result.appliedCorrectionTotal).toBeCloseTo(expected.appliedCorrectionTotal, 10);
    expect(result.areaEachM2).toBeCloseTo(expected.areaEachM2, 10);
    expect(result.areaTotalM2).toBeCloseTo(expected.areaTotalM2, 10);
  });
});

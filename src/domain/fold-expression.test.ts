import { describe, expect, it } from "vitest";

import { calculateFoldProfileDocument } from "./fold-calculation";
import { resolveFoldProfileExpressions } from "./fold-expression";
import { createFoldProfile, createFoldSegment } from "./fold-profile";

function expressionProfile() {
  const profile = createFoldProfile({
    product: { length: 1000, quantity: 2 },
    calculation: { decimalPlaces: 2 },
  });
  profile.variables = [
    { name: "B", value: 100 },
    { name: "G", value: 20 },
    { name: "T", value: 2 },
  ];
  profile.blocks[0].segments = [
    createFoldSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, {
      id: "s1",
      inputLength: 10,
      formula: "B-26-(T*2+1)",
    }),
    createFoldSegment({ x: 10, y: 0 }, { x: 10, y: 10 }, {
      id: "s2",
      inputLength: 10,
      formula: "(B-G)/2",
    }),
  ];
  return profile;
}

describe("fold-expression-v1", () => {
  it("evaluates legacy arithmetic samples with precedence and parentheses", () => {
    const resolution = resolveFoldProfileExpressions(expressionProfile());
    expect(resolution.issues).toEqual([]);
    expect(resolution.segmentLengths).toEqual({ s1: "69", s2: "40" });
  });

  it("supports unary signs and computed variable dependencies", () => {
    const profile = expressionProfile();
    profile.variables.push(
      { name: "HALF", value: 0, formula: "B/2" },
      { name: "OFFSET", value: 0, formula: "-(G-5)" },
    );
    profile.blocks[0].segments[0].formula = "HALF+OFFSET";
    const resolution = resolveFoldProfileExpressions(profile);

    expect(resolution.variableValues).toMatchObject({ HALF: "50", OFFSET: "-15" });
    expect(resolution.segmentLengths.s1).toBe("35");
  });

  it("rounds repeating final results to six Decimal places", () => {
    const profile = expressionProfile();
    profile.blocks[0].segments[0].formula = "B/3";
    expect(resolveFoldProfileExpressions(profile).segmentLengths.s1).toBe("33.333333");
  });

  it.each([
    ["UNKNOWN_VARIABLE", "NO_VALUE+1"],
    ["DIVISION_BY_ZERO", "B/(G-G)"],
    ["SYNTAX_ERROR", "B+*2"],
    ["NON_POSITIVE_LENGTH", "B-B"],
  ] as const)("reports %s without replacing the segment fallback", (code, formula) => {
    const profile = expressionProfile();
    profile.blocks[0].segments[0].formula = formula;
    const resolution = resolveFoldProfileExpressions(profile);
    expect(resolution.segmentLengths.s1).toBeUndefined();
    expect(resolution.issues).toContainEqual(expect.objectContaining({ code }));
  });

  it("detects computed-variable cycles explicitly", () => {
    const profile = expressionProfile();
    profile.variables = [
      { name: "A", value: 1, formula: "B+1" },
      { name: "B", value: 1, formula: "A+1" },
    ];
    const resolution = resolveFoldProfileExpressions(profile);
    expect(resolution.variableValues).toEqual({});
    expect(resolution.issues.some((issue) => issue.code === "CIRCULAR_REFERENCE")).toBe(true);
  });

  it("calculates product length and profile width from expressions", () => {
    const profile = expressionProfile();
    profile.product.formula = "B*20";
    profile.product.formulaEnabled = true;
    const result = calculateFoldProfileDocument(profile);

    expect(result.inputLengthTotalDecimal).toBe("109");
    expect(result.productLengthDecimal).toBe("2000");
    expect(result.areaEachM2Decimal).toBe("0.218");
    expect(result.expressionIssues).toEqual([]);
    expect(result.resolvedVariables).toMatchObject({ B: "100", G: "20", T: "2" });
  });
});

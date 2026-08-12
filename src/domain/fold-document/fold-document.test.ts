import { describe, expect, it } from "vitest";

import type { FoldProfile } from "@/domain/fold-profile";

import {
  browserFoldProfileV4ToServerDocumentV2,
  serverDocumentToBrowserFoldProfileV4,
  browserFoldProfileV3ToServerDocumentV1,
  serverDocumentV1ToBrowserFoldProfileV3,
} from "./adapter";
import { projectCanonicalJsonV1 } from "./canonical";
import { validateFoldDocumentCapability } from "./capabilities";
import {
  ANGLE_DECIMAL_POLICY,
  LENGTH_DECIMAL_POLICY,
  DecimalContractError,
  canonicalDecimalToLosslessNumber,
  normalizeDecimalString,
  numberToCanonicalDecimal,
} from "./decimal";
import {
  migrateFoldDocumentToCurrent,
  parseServerFoldDocumentV1,
  safeParseServerFoldDocumentV1,
  type ServerFoldDocumentV1,
} from "./schema";

const RULE_REVISION_ID = "00000000-0000-4000-8000-000000000001";

function validDocument(): ServerFoldDocumentV1 {
  return parseServerFoldDocumentV1({
    schemaVersion: 1,
    documentType: "normal",
    name: "정규화 시험",
    product: { lengthMm: "1000", quantity: 2 },
    material: {
      ruleRevisionId: RULE_REVISION_ID,
      name: "알루미늄 1T",
      thicknessMm: "1",
      insideBendRadiusMm: "1",
      cutAngleDeg: "135",
      elongationMm: { vCut: "0.6", aCut: "0.4", noCut: "1" },
      cutDepthMm: { vCut: "0.5", aCut: "0.5", noCut: "0" },
    },
    calculation: {
      mode: "fixed",
      elongationOption: "standard",
      vCutEnabled: true,
      decimalPlaces: 1,
      decimalOperation: "round",
    },
    variables: [],
    blocks: [{
      id: "block-1",
      name: "면 1",
      order: 1,
      segments: [{
        id: "segment-1",
        order: 1,
        geometry: {
          kind: "line",
          start: { xMm: "0", yMm: "0" },
          end: { xMm: "100", yMm: "0" },
          direction: "e",
        },
        nominalLengthMm: "100",
        junctionAfter: {
          angleDeg: "90",
          calculateElongation: true,
          cutType: "v-cut",
          operations: [{ direction: "front", form: "standard" }],
        },
      }, {
        id: "segment-2",
        order: 2,
        geometry: {
          kind: "line",
          start: { xMm: "100", yMm: "0" },
          end: { xMm: "100", yMm: "50" },
          direction: "s",
        },
        nominalLengthMm: "50",
      }],
    }],
  });
}

describe("fold document Decimal contract", () => {
  it("normalizes decimal strings without rounding", () => {
    expect(normalizeDecimalString("001.2300", LENGTH_DECIMAL_POLICY)).toBe("1.23");
    expect(normalizeDecimalString("-0.0", LENGTH_DECIMAL_POLICY)).toBe("0");
    expect(normalizeDecimalString("-001.200", LENGTH_DECIMAL_POLICY)).toBe("-1.2");
  });

  it("rejects exponent, excess scale and excess integer precision", () => {
    expect(() => normalizeDecimalString("1e-3", LENGTH_DECIMAL_POLICY)).toThrowError(
      expect.objectContaining({ code: "INVALID_DECIMAL" }),
    );
    expect(() => normalizeDecimalString("1.1234567", LENGTH_DECIMAL_POLICY)).toThrowError(
      expect.objectContaining({ code: "DECIMAL_SCALE_EXCEEDED" }),
    );
    expect(() => normalizeDecimalString("1234567890123", LENGTH_DECIMAL_POLICY)).toThrowError(
      expect.objectContaining({ code: "DECIMAL_PRECISION_EXCEEDED" }),
    );
    expect(() => normalizeDecimalString("180.0001", ANGLE_DECIMAL_POLICY)).toThrowError(
      expect.objectContaining({ code: "DECIMAL_OUT_OF_RANGE" }),
    );
  });

  it("refuses lossy conversion across the number adapter", () => {
    expect(numberToCanonicalDecimal(1.25, LENGTH_DECIMAL_POLICY)).toBe("1.25");
    expect(canonicalDecimalToLosslessNumber("1.25", LENGTH_DECIMAL_POLICY)).toBe(1.25);
    expect(() => canonicalDecimalToLosslessNumber("999999999999.999999", LENGTH_DECIMAL_POLICY))
      .toThrowError(expect.objectContaining({ code: "LOSSY_NUMBER_CONVERSION" }));
    expect(() => numberToCanonicalDecimal(Number.POSITIVE_INFINITY, LENGTH_DECIMAL_POLICY))
      .toThrowError(DecimalContractError);
  });
});

describe("fold document v1 schema", () => {
  it("returns a strict canonical document", () => {
    const input = structuredClone(validDocument()) as unknown as Record<string, unknown>;
    const product = input.product as Record<string, unknown>;
    product.lengthMm = "001000.000";
    const parsed = parseServerFoldDocumentV1(input);
    expect(parsed.product.lengthMm).toBe("1000");
    expect(parsed.schemaVersion).toBe(1);
  });

  it("reports unknown fields with a stable code and path", () => {
    const input = structuredClone(validDocument()) as unknown as Record<string, unknown>;
    input.ownerId = "must-not-be-in-document";
    const result = safeParseServerFoldDocumentV1(input);
    expect(result).toEqual({
      success: false,
      issues: [expect.objectContaining({ code: "UNKNOWN_FIELD", path: ["ownerId"] })],
    });
  });

  it("rejects duplicate IDs, disconnected segments and a final junction", () => {
    const input = structuredClone(validDocument());
    input.blocks[0].segments[1].id = "segment-1";
    input.blocks[0].segments[1].geometry.start.xMm = "99";
    input.blocks[0].segments[1].junctionAfter = {
      angleDeg: "90",
      calculateElongation: true,
      cutType: "v-cut",
      operations: [{ direction: "back", form: "standard" }],
    };
    const result = safeParseServerFoldDocumentV1(input);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "DUPLICATE_ID",
      "DISCONNECTED_SEGMENT",
      "INVALID_LAST_JUNCTION",
    ]));
  });

  it("dispatches v1 and rejects unknown server document versions", () => {
    expect(migrateFoldDocumentToCurrent(validDocument())).toMatchObject({ schemaVersion: 3, panelAttachments: [] });
    expect(() => migrateFoldDocumentToCurrent({ schemaVersion: 4 })).toThrowError(
      expect.objectContaining({
        issues: [expect.objectContaining({ code: "UNSUPPORTED_SCHEMA_VERSION" })],
      }),
    );
  });
});

describe("fold document capabilities", () => {
  it("supports the current normal line document", () => {
    expect(validateFoldDocumentCapability(validDocument(), "calculate")).toEqual({
      supported: true,
      issues: [],
    });
  });

  it("calculates, publishes and exports the P1 special forms", () => {
    const input = structuredClone(validDocument());
    input.blocks[0].segments[0].junctionAfter!.operations[0].form = "zero";
    const document = parseServerFoldDocumentV1(input);
    expect(validateFoldDocumentCapability(document, "calculate").supported).toBe(true);
    expect(validateFoldDocumentCapability(document, "publish").supported).toBe(true);
    expect(validateFoldDocumentCapability(document, "dxf").supported).toBe(true);
  });
});

describe("fold document canonical JSON", () => {
  it("sorts object keys while preserving array order", () => {
    expect(projectCanonicalJsonV1({ z: 1, a: { d: true, c: "값" }, list: [2, 1] }))
      .toBe('{"a":{"c":"값","d":true},"list":[2,1],"z":1}');
    expect(projectCanonicalJsonV1({ b: 2, a: 1 })).toBe(projectCanonicalJsonV1({ a: 1, b: 2 }));
    expect(projectCanonicalJsonV1([1, 2])).not.toBe(projectCanonicalJsonV1([2, 1]));
  });

  it("rejects unsafe numbers and sparse arrays", () => {
    expect(() => projectCanonicalJsonV1({ value: 0.1 })).toThrow("안전한 정수");
    const sparse = Array(2);
    sparse[1] = "x";
    expect(() => projectCanonicalJsonV1(sparse)).toThrow("sparse array");
  });
});

describe("browser FoldProfile v3 adapter", () => {
  const profile: FoldProfile = {
    schemaVersion: 4,
    panelAttachments: [],
    id: "profile-browser",
    name: "브라우저 호환",
    profileType: "normal",
    material: {
      id: "material-browser",
      name: "알루미늄 1T",
      thickness: 1,
      insideBendRadius: 1,
      cutAngle: 135,
      elongation: { "v-cut": 0.6, "a-cut": 0.4, "no-cut": 1 },
      cutDepth: { "v-cut": 0.5, "a-cut": 0.5, "no-cut": 0 },
    },
    product: { length: 1000, quantity: 2 },
    calculation: { mode: "fixed", elongationOption: "standard", vCutEnabled: true, decimalPlaces: 1, decimalOperation: "round" },
    variables: [],
    blocks: [{
      id: "block-browser",
      name: "면 1",
      order: 1,
      segments: [{
        id: "segment-browser-1",
        start: { x: 0, y: 0 },
        end: { x: 100, y: 0 },
        inputLength: 100,
        geometry: { kind: "line" },
        formula: "W-D1",
        bendAfter: { direction: "front", cutType: "no-cut", angle: 90 },
        calculateElongation: false,
        elongationOverride: 0.25,
      }, {
        id: "segment-browser-2",
        start: { x: 100, y: 0 },
        end: { x: 100, y: 50 },
        inputLength: 50,
        geometry: { kind: "line" },
      }],
    }],
    createdAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T00:00:00.000Z",
  };

  it("keeps cut type separate from the standard bend form", () => {
    const document = browserFoldProfileV3ToServerDocumentV1(profile, RULE_REVISION_ID);
    expect(document.blocks[0].segments[0].junctionAfter).toMatchObject({
      cutType: "no-cut",
      calculateElongation: false,
      operations: [{ direction: "front", form: "standard" }],
    });
    expect(document.material.elongationMm).toEqual({ vCut: "0.6", aCut: "0.4", noCut: "1" });
  });

  it("round-trips the subset represented by the current editor", () => {
    const document = browserFoldProfileV3ToServerDocumentV1(profile, RULE_REVISION_ID);
    const restored = serverDocumentV1ToBrowserFoldProfileV3(document, {
      id: profile.id,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    });
    expect(restored).toEqual({
      ...profile,
      material: { ...profile.material, id: RULE_REVISION_ID },
      blocks: [{
        ...profile.blocks[0],
        segments: [
          { ...profile.blocks[0].segments[0], calculateElongation: false },
          profile.blocks[0].segments[1],
        ],
      }],
    });
  });

  it("round-trips a two-block box document", () => {
    const box: FoldProfile = {
      ...profile,
      profileType: "box",
      blocks: [profile.blocks[0], {
        ...profile.blocks[0],
        id: "block-browser-2",
        name: "면 2",
        order: 2,
        segments: profile.blocks[0].segments.map((segment, index) => ({
          ...segment,
          id: `segment-box-${index + 1}`,
        })),
      }],
    };
    const document = browserFoldProfileV3ToServerDocumentV1(box, RULE_REVISION_ID);
    const restored = serverDocumentV1ToBrowserFoldProfileV3(document, {
      id: box.id,
      createdAt: box.createdAt,
      updatedAt: box.updatedAt,
    });
    expect(document.documentType).toBe("box");
    expect(restored.profileType).toBe("box");
    expect(restored.blocks).toHaveLength(2);
  });

  it("round-trips variables, computed variables, segment and product expressions", () => {
    const variant: FoldProfile = structuredClone(profile);
    variant.variables = [
      { name: "W", value: 120 },
      { name: "HALF", value: 60, formula: "W/2" },
    ];
    variant.product.formula = "W*10";
    variant.product.formulaEnabled = true;
    variant.blocks[0].segments[0].formula = "HALF+10";

    const document = browserFoldProfileV3ToServerDocumentV1(variant, RULE_REVISION_ID);
    expect(document.variables).toEqual([
      { name: "W", valueMm: "120" },
      {
        name: "HALF",
        valueMm: "60",
        expression: { grammarVersion: "fold-expression-v1", source: "W/2" },
      },
    ]);
    expect(document.product).toEqual({ lengthMm: "1200", quantity: 2 });
    expect(document.productExpression).toEqual({
      enabled: true,
      grammarVersion: "fold-expression-v1",
      source: "W*10",
    });
    expect(document.blocks[0].segments[0]).toMatchObject({
      nominalLengthMm: "70",
      lengthExpression: { grammarVersion: "fold-expression-v1", source: "HALF+10" },
    });

    const restored = serverDocumentV1ToBrowserFoldProfileV3(document, {
      id: variant.id,
      createdAt: variant.createdAt,
      updatedAt: variant.updatedAt,
    });
    expect(restored.variables).toEqual(variant.variables);
    expect(restored.product).toEqual({
      length: 1200,
      quantity: 2,
      formula: "W*10",
      formulaEnabled: true,
    });
    expect(restored.blocks[0].segments[0].formula).toBe("HALF+10");
  });

  it("round-trips all 16 MFC bend operation types", () => {
    const operationTypes = [
      ["front", "standard"], ["back", "standard"],
      ["front", "a"], ["back", "a"],
      ["front", "zero"], ["back", "zero"],
      ["front", "u"], ["back", "u"],
      ["back-front", "standard"], ["back-front", "a"],
      ["back-front", "zero"], ["back-front", "u"],
      ["front-back", "standard"], ["front-back", "a"],
      ["front-back", "zero"], ["front-back", "u"],
    ] as const;

    for (const [directionType, form] of operationTypes) {
      const first = directionType === "front-back" ? "front" : directionType === "back-front" ? "back" : directionType;
      const second = directionType === "front-back" ? "back" : directionType === "back-front" ? "front" : undefined;
      const variant: FoldProfile = structuredClone(profile);
      variant.calculation.elongationOption = "diagonal";
      variant.blocks[0].segments[0].bendAfter = {
        direction: first,
        ...(form !== "standard" && { form }),
        ...(second && { secondaryOperation: { direction: second, form } }),
        cutType: "v-cut",
        angle: 90,
      };
      const document = browserFoldProfileV3ToServerDocumentV1(variant, RULE_REVISION_ID);
      const restored = serverDocumentV1ToBrowserFoldProfileV3(document, {
        id: variant.id,
        createdAt: variant.createdAt,
        updatedAt: variant.updatedAt,
      });
      expect(restored.calculation.elongationOption).toBe("diagonal");
      expect(restored.blocks[0].segments[0].bendAfter).toEqual(
        variant.blocks[0].segments[0].bendAfter,
      );
    }
  });

  it("round-trips v2 arcs and embedded panel attachments", () => {
    const variant: FoldProfile = structuredClone(profile);
    variant.blocks[0].segments[0].geometry = { kind: "arc", side: "right", sagitta: 75 };
    variant.panelAttachments = [{
      id: "panel-attachment-1",
      name: "측면 패널",
      hostBlockId: variant.blocks[0].id,
      hostSegmentId: variant.blocks[0].segments[0].id,
      direction: "counterclockwise",
      dimensionRole: "secondary-product-dimension",
      block: {
        id: "panel-block-1",
        name: "패널 단면",
        order: 1,
        segments: [{
          id: "panel-segment-1",
          start: { x: 0, y: 0 },
          end: { x: 320, y: 0 },
          inputLength: 320,
          geometry: { kind: "line" },
        }],
      },
    }];

    const document = browserFoldProfileV4ToServerDocumentV2(variant, RULE_REVISION_ID);
    expect(document.schemaVersion).toBe(2);
    expect(document.blocks[0].segments[0].geometry).toMatchObject({ kind: "arc", side: "right", sagittaMm: "75" });
    expect(document.panelAttachments[0]).toMatchObject({ direction: "counterclockwise", dimensionRole: "secondary-product-dimension" });

    const restored = serverDocumentToBrowserFoldProfileV4(document, {
      id: variant.id,
      createdAt: variant.createdAt,
      updatedAt: variant.updatedAt,
    });
    expect(restored.blocks[0].segments[0].geometry).toEqual(variant.blocks[0].segments[0].geometry);
    expect(restored.panelAttachments).toEqual(variant.panelAttachments);
  });
});

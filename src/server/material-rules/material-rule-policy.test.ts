import { describe, expect, it } from "vitest";

import { MaterialError } from "@/server/materials/material-error";

import { calculateMaterialRuleChecksum, normalizeMaterialRuleFields } from "./material-rule-policy";
import type { MaterialRuleFields } from "./material-rule-types";

const fields: MaterialRuleFields = {
  calculationMode: "FIXED",
  elongationOption: "STANDARD",
  vCutEnabled: true,
  decimalPlaces: 2,
  decimalOperation: "ROUND",
  cutAngleDeg: "135.0000",
  insideBendRadiusMm: "1.000000",
  elongationVCutMm: "0.600000",
  elongationACutMm: "0.4",
  elongationNoCutMm: "1",
  cutDepthVCutMm: "0.5",
  cutDepthACutMm: "0.5",
  cutDepthNoCutMm: "0",
  changeSummary: "  첫   규칙  ",
};

describe("material rule policy", () => {
  it("normalizes decimals without confusing zero and missing values", () => {
    expect(normalizeMaterialRuleFields(fields)).toMatchObject({ cutAngleDeg: "135", cutDepthNoCutMm: "0", changeSummary: "첫 규칙" });
  });

  it("creates the same checksum for equivalent decimal spellings", () => {
    expect(calculateMaterialRuleChecksum(fields)).toBe(calculateMaterialRuleChecksum({ ...fields, cutAngleDeg: "135", insideBendRadiusMm: "1" }));
    expect(calculateMaterialRuleChecksum(fields)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects negative values and the excluded cut-angle boundary", () => {
    expect(() => normalizeMaterialRuleFields({ ...fields, elongationVCutMm: "-0.1" })).toThrow(MaterialError);
    expect(() => normalizeMaterialRuleFields({ ...fields, cutAngleDeg: "0" })).toThrow(MaterialError);
    expect(() => normalizeMaterialRuleFields({ ...fields, cutAngleDeg: "180.0001" })).toThrow(MaterialError);
  });
});

import { describe, expect, it } from "vitest";
import { calculateSheetItem, normalizeSheetItemFields } from "./sheet-item-policy";
import type { SheetItemFields } from "./sheet-item-types";

const fields: SheetItemFields = {
  code: "AL-2T-SHEET-1220X2440",
  name: "알루미늄 2T 기본 원판",
  finishName: " 평판 ",
  widthMm: "1220",
  lengthMm: "2440",
  rotationPolicy: "FREE",
  grainAxis: "NONE",
  trimTopMm: "10",
  trimRightMm: "5",
  trimBottomMm: "10",
  trimLeftMm: "5",
  weightOverrideKg: null,
  weightOverrideReason: null,
  standardPurchaseCostKrw: null,
  minRemnantWidthMm: null,
  minRemnantLengthMm: null,
  minRemnantAreaM2: null,
  sortOrder: 0,
  memo: null,
};

describe("sheet item policy", () => {
  it("calculates canonical areas and material weight without binary floating point", () => {
    expect(calculateSheetItem(fields, "2700", "2")).toEqual({
      nominalAreaM2: "2.9768",
      usableWidthMm: "1210",
      usableLengthMm: "2420",
      usableAreaM2: "2.9282",
      calculatedWeightKg: "16.07472",
      effectiveWeightKg: "16.07472",
      weightSource: "CALCULATED",
    });
  });

  it("uses an explicit weight override as the effective weight", () => {
    const value = calculateSheetItem({ ...fields, weightOverrideKg: "16.5" }, "2700", "2");
    expect(value.effectiveWeightKg).toBe("16.5");
    expect(value.weightSource).toBe("OVERRIDE");
  });

  it("normalizes fields and requires an override reason", () => {
    expect(normalizeSheetItemFields(fields).finishName).toBe("평판");
    expect(() => normalizeSheetItemFields({ ...fields, weightOverrideKg: "16.5" })).toThrow("함께 입력");
  });

  it("rejects trims that consume the sheet", () => {
    expect(() => calculateSheetItem({ ...fields, trimLeftMm: "610", trimRightMm: "610" }, "2700", "2")).toThrow("작아야");
  });

  it("requires a grain axis when rotation is restricted", () => {
    expect(() => normalizeSheetItemFields({ ...fields, rotationPolicy: "KEEP_GRAIN" })).toThrow("결 방향");
  });
});

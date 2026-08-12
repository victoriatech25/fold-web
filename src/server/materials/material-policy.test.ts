import { describe, expect, it } from "vitest";
import { decodeMaterialCursor, encodeMaterialCursor, isValidMaterialCode, normalizeMaterialCode, normalizeMaterialName, normalizeNonNegativeDecimal, normalizePositiveDecimal } from "./material-policy";
describe("material policy",()=>{
  it("normalizes codes and names",()=>{expect(normalizeMaterialCode(" al-01 ")).toBe("AL-01");expect(isValidMaterialCode("AL_01")).toBe(true);expect(isValidMaterialCode("알루미늄")).toBe(false);expect(normalizeMaterialName("  알루미늄   판재 ")).toBe("알루미늄 판재");});
  it("keeps canonical Decimal strings",()=>{expect(normalizePositiveDecimal("001.200000")).toBe("1.2");expect(normalizeNonNegativeDecimal("0.000")).toBe("0");expect(()=>normalizePositiveDecimal("0")).toThrow();expect(()=>normalizePositiveDecimal("1.0000001")).toThrow();});
  it("round-trips the sorted cursor",()=>{const value=encodeMaterialCursor(2,"알루미늄","id");expect(decodeMaterialCursor(value)).toEqual({sortOrder:2,normalizedName:"알루미늄",id:"id"});expect(()=>decodeMaterialCursor("bad")).toThrow();});
});

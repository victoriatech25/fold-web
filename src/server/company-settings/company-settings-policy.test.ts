import { describe, expect, it } from "vitest";

import {
  isValidBusinessSiteCode,
  normalizeBusinessSiteCode,
  normalizeOptionalText,
} from "@/server/company-settings/company-settings-policy";

describe("company settings policy", () => {
  it("normalizes business site codes", () => {
    expect(normalizeBusinessSiteCode(" main-office ")).toBe("MAIN-OFFICE");
    expect(isValidBusinessSiteCode("MAIN_01")).toBe(true);
    expect(isValidBusinessSiteCode("한글")).toBe(false);
    expect(isValidBusinessSiteCode("A")).toBe(false);
  });

  it("stores blank optional values as null", () => {
    expect(normalizeOptionalText("  서울  ")).toBe("서울");
    expect(normalizeOptionalText("   ")).toBeNull();
    expect(normalizeOptionalText(undefined)).toBeNull();
  });
});

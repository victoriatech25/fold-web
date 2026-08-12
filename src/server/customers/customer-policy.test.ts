import { describe, expect, it } from "vitest";

import {
  decodeCustomerCursor,
  encodeCustomerCursor,
  formatCustomerCode,
  isValidCustomerSiteCode,
  normalizeBusinessRegistrationNumber,
  normalizeCustomerName,
  normalizeCustomerSiteCode,
} from "@/server/customers/customer-policy";

describe("customer policy", () => {
  it("normalizes searchable customer data", () => {
    expect(normalizeCustomerName("  빅토리아   테크  ")).toBe("빅토리아 테크");
    expect(normalizeBusinessRegistrationNumber("123-45-67890")).toBe("1234567890");
    expect(normalizeBusinessRegistrationNumber("  ")).toBeNull();
  });

  it("normalizes and validates customer site codes", () => {
    expect(normalizeCustomerSiteCode(" site-01 ")).toBe("SITE-01");
    expect(isValidCustomerSiteCode("SITE_01")).toBe(true);
    expect(isValidCustomerSiteCode("현장01")).toBe(false);
  });

  it("formats automatic customer codes within the supported range", () => {
    expect(formatCustomerCode(1)).toBe("C000001");
    expect(formatCustomerCode(999_999)).toBe("C999999");
    expect(() => formatCustomerCode(0)).toThrow();
  });

  it("round-trips a stable list cursor and rejects malformed input", () => {
    const encoded = encodeCustomerCursor("가나다", "customer-id");
    expect(decodeCustomerCursor(encoded)).toEqual({
      normalizedName: "가나다",
      id: "customer-id",
    });
    expect(() => decodeCustomerCursor("not-a-cursor")).toThrow(
      "INVALID_CUSTOMER_CURSOR",
    );
  });
});

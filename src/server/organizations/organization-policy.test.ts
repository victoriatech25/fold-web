import { describe, expect, it } from "vitest";

import {
  canChangeOrganizationStatus,
  isValidOrganizationCode,
  normalizeOrganizationCode,
} from "@/server/organizations/organization-policy";

describe("organization policy", () => {
  it("코드는 대문자·숫자·-·_ 2~50자만 받는다", () => {
    expect(normalizeOrganizationCode(" acme-1 ")).toBe("ACME-1");
    expect(isValidOrganizationCode("ACME-1")).toBe(true);
    expect(isValidOrganizationCode("LOCAL_DEV")).toBe(true);
    expect(isValidOrganizationCode("A")).toBe(false);
    expect(isValidOrganizationCode("-ACME")).toBe(false);
    expect(isValidOrganizationCode("회사")).toBe(false);
    expect(isValidOrganizationCode("A".repeat(51))).toBe(false);
  });

  it("자기 조직은 정지할 수 없다", () => {
    expect(
      canChangeOrganizationStatus({ own: true, current: "ACTIVE", next: "SUSPENDED" }),
    ).toBe(false);
    expect(
      canChangeOrganizationStatus({ own: false, current: "ACTIVE", next: "SUSPENDED" }),
    ).toBe(true);
    expect(
      canChangeOrganizationStatus({ own: true, current: "ACTIVE", next: "ACTIVE" }),
    ).toBe(true);
    expect(
      canChangeOrganizationStatus({ own: false, current: "SUSPENDED", next: "ACTIVE" }),
    ).toBe(true);
  });
});

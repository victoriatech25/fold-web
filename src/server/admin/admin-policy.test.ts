import { describe, expect, it } from "vitest";

import {
  canChangeUserStatus,
  isValidCustomRoleKey,
  isValidDepartmentCode,
  normalizeRoleKey,
} from "@/server/admin/admin-policy";

describe("admin policy", () => {
  it("allows only approved user status transitions", () => {
    expect(canChangeUserStatus("INVITED", "ACTIVE")).toBe(false);
    expect(canChangeUserStatus("INVITED", "DISABLED")).toBe(true);
    expect(canChangeUserStatus("ACTIVE", "SUSPENDED")).toBe(true);
    expect(canChangeUserStatus("SUSPENDED", "ACTIVE")).toBe(true);
    expect(canChangeUserStatus("DISABLED", "SUSPENDED")).toBe(false);
  });

  it("normalizes and validates custom keys", () => {
    expect(normalizeRoleKey("shop-manager")).toBe("SHOP_MANAGER");
    expect(isValidCustomRoleKey("SHOP_MANAGER")).toBe(true);
    expect(isValidCustomRoleKey("ADMIN!")).toBe(false);
    expect(isValidDepartmentCode("DESIGN-1")).toBe(true);
    expect(isValidDepartmentCode("설계")).toBe(false);
  });
});

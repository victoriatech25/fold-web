import { describe, expect, it } from "vitest";

import {
  isPermissionKey,
  isSystemRoleKey,
  permissionCatalog,
  permissionUnion,
  systemRoleDefinitions,
} from "@/domain/permission";

describe("permission catalog", () => {
  it("contains stable unique permission and system role keys", () => {
    expect(new Set(permissionCatalog.map(({ key }) => key)).size).toBe(18);
    expect(new Set(systemRoleDefinitions.map(({ key }) => key)).size).toBe(4);
    expect(isPermissionKey("admin.manage")).toBe(true);
    expect(isPermissionKey("unknown")).toBe(false);
    expect(isSystemRoleKey("ADMINISTRATOR")).toBe(true);
    expect(isSystemRoleKey("CUSTOM")).toBe(false);
  });

  it("creates a sorted permission union without unknown keys", () => {
    expect(
      permissionUnion([
        { permissions: ["order.read", "customer.read"] },
        { permissions: ["order.read", "unknown"] },
      ]),
    ).toEqual(["customer.read", "order.read"]);
  });

  it("reserves administration and audit read for the administrator role", () => {
    for (const reservedPermission of ["admin.manage", "audit.read"]) {
      const rolesWithPermission = systemRoleDefinitions.filter(
        ({ permissions }) =>
          (permissions as readonly string[]).includes(reservedPermission),
      );
      expect(rolesWithPermission.map(({ key }) => key)).toEqual([
        "ADMINISTRATOR",
      ]);
    }
  });
});

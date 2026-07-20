import { describe, expect, it } from "vitest";

import type { AuthenticatedContext } from "@/server/auth/auth-types";
import {
  hasPermission,
  PermissionDeniedError,
  requirePermission,
  requireSameOrganization,
} from "@/server/authorization/authorization";

const context: AuthenticatedContext = {
  sessionId: "session",
  userId: "user",
  displayName: "테스트",
  membershipId: "membership",
  departmentId: null,
  organizationId: "organization",
  organizationCode: "LOCAL_DEV",
  organizationName: "로컬 개발 조직",
  roleKeys: ["VIEWER"],
  permissions: ["customer.read"],
  expiresAt: new Date("2026-07-19T12:00:00.000Z"),
};

describe("authorization guard", () => {
  it("allows only explicit permissions", () => {
    expect(hasPermission(context, "customer.read")).toBe(true);
    expect(hasPermission(context, "admin.manage")).toBe(false);
    expect(requirePermission(context, "customer.read")).toBe(context);
    expect(() => requirePermission(context, "admin.manage")).toThrow(
      PermissionDeniedError,
    );
  });

  it("rejects organization mismatches", () => {
    expect(() =>
      requireSameOrganization(context, "organization"),
    ).not.toThrow();
    expect(() => requireSameOrganization(context, "other")).toThrow(
      PermissionDeniedError,
    );
  });
});

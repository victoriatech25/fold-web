import { describe, expect, it } from "vitest";

import {
  AuditPayloadError,
  auditActionLabel,
  isAuditAction,
  validateAuditPayload,
} from "@/server/audit/audit-core";

describe("audit core", () => {
  it("recognizes catalog actions and Korean labels", () => {
    expect(isAuditAction("admin.user_updated")).toBe(true);
    expect(isAuditAction("admin.unknown")).toBe(false);
    expect(auditActionLabel("admin.user_updated")).toBe("사용자 정보 변경");
  });

  it.each([
    { password: "forbidden" },
    { nested: { resetToken: "forbidden" } },
    { items: [{ Authorization: "forbidden" }] },
    { clientSecret: "forbidden" },
  ])("rejects sensitive keys at any depth", (metadata) => {
    expect(() => validateAuditPayload({ metadata })).toThrow(
      AuditPayloadError,
    );
  });

  it("rejects oversized and unsupported payloads", () => {
    expect(() =>
      validateAuditPayload({ metadata: { note: "x".repeat(17_000) } }),
    ).toThrow("exceeds");
    expect(() =>
      validateAuditPayload({ metadata: { invalid: undefined } }),
    ).toThrow("undefined");
  });

  it("accepts an allow-listed before and after payload", () => {
    expect(
      validateAuditPayload({
        before: { status: "ACTIVE", roleKeys: ["VIEWER"] },
        after: { status: "SUSPENDED", roleKeys: ["DESIGNER"] },
        metadata: { route: "/api/v1/admin/users/:userId" },
      }),
    ).toEqual({
      before: { status: "ACTIVE", roleKeys: ["VIEWER"] },
      after: { status: "SUSPENDED", roleKeys: ["DESIGNER"] },
      metadata: { route: "/api/v1/admin/users/:userId" },
    });
  });
});

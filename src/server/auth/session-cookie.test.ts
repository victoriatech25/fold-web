import { describe, expect, it } from "vitest";

import {
  readAuthRuntimeConfig,
  type AuthRuntimeConfig,
} from "@/server/auth/auth-config";
import {
  clearSessionCookie,
  createSessionCookie,
  readSessionCookie,
} from "@/server/auth/session-cookie";

const localConfig = readAuthRuntimeConfig({
  APP_ORIGIN: "http://localhost:3000",
  AUTH_RATE_LIMIT_SECRET: "cookie-test-secret-000000000000000",
});

describe("authentication session cookie", () => {
  it("creates a local HttpOnly SameSite cookie without Secure", () => {
    const cookie = createSessionCookie("token", localConfig);
    expect(cookie).toContain("fw.sid=token");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=28800");
    expect(cookie).not.toContain("Secure");
  });

  it("uses the __Host prefix and Secure in production", () => {
    const productionConfig: AuthRuntimeConfig = {
      ...localConfig,
      appOrigin: "https://fold.example.com",
      production: true,
    };
    const cookie = createSessionCookie("token", productionConfig);
    expect(cookie).toContain("__Host-fw.sid=token");
    expect(cookie).toContain("Secure");
    expect(cookie).not.toContain("Domain=");
  });

  it("reads and clears only the configured cookie", () => {
    expect(readSessionCookie("other=1; fw.sid=session-token", localConfig)).toBe(
      "session-token",
    );
    expect(clearSessionCookie(localConfig)).toContain("Max-Age=0");
  });
});

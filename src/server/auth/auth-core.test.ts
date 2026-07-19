import { describe, expect, it } from "vitest";

import {
  AuthEnvironmentError,
  readAuthRuntimeConfig,
  sessionCookieName,
} from "@/server/auth/auth-config";
import { normalizeEmail } from "@/server/auth/email";
import {
  hashPassword,
  validatePasswordPolicy,
  verifyPasswordHash,
  verifyPasswordOrDummy,
} from "@/server/auth/password";
import {
  hasAllowedMutationOrigin,
  readTrustedSource,
} from "@/server/auth/request-security";
import {
  createOpaqueToken,
  createThrottleKey,
  hashOpaqueToken,
  isOpaqueToken,
} from "@/server/auth/token";

const environment = {
  APP_ORIGIN: "http://localhost:3000",
  AUTH_RATE_LIMIT_SECRET: "test-rate-limit-secret-000000000000",
};

describe("authentication core", () => {
  it("normalizes login email without retaining surrounding whitespace", () => {
    expect(normalizeEmail("  User@EXAMPLE.COM ")).toBe("user@example.com");
  });

  it("enforces length and common-password checks without composition rules", () => {
    expect(validatePasswordPolicy("short")).toMatchObject({
      valid: false,
      reason: "TOO_SHORT",
    });
    expect(validatePasswordPolicy("passwordpassword")).toMatchObject({
      valid: false,
      reason: "COMMON_PASSWORD",
    });
    expect(
      validatePasswordPolicy("긴 문장으로 만든 안전한 암호 문구입니다"),
    ).toEqual({ valid: true });
  });

  it("hashes and verifies passwords with Argon2id", async () => {
    const password = "correct horse battery staple 2026";
    const passwordHash = await hashPassword(password);

    expect(passwordHash).toContain("$argon2id$v=19$m=19456,t=2,p=1$");
    await expect(verifyPasswordHash(passwordHash, password)).resolves.toBe(true);
    await expect(verifyPasswordHash(passwordHash, "wrong password")).resolves.toBe(
      false,
    );
    await expect(verifyPasswordOrDummy(null, "wrong password")).resolves.toBe(
      false,
    );
  });

  it("creates 256-bit opaque tokens and stable one-way hashes", () => {
    const token = createOpaqueToken();
    expect(isOpaqueToken(token)).toBe(true);
    expect(hashOpaqueToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(createOpaqueToken()).not.toBe(token);
  });

  it("separates account and source throttle keys", () => {
    const secret = environment.AUTH_RATE_LIMIT_SECRET;
    expect(createThrottleKey(secret, "ACCOUNT", "user@example.com")).not.toBe(
      createThrottleKey(secret, "SOURCE", "user@example.com"),
    );
  });

  it("validates runtime lifetime and production-origin rules", () => {
    const config = readAuthRuntimeConfig(environment);
    expect(config).toMatchObject({
      sessionAbsoluteMinutes: 480,
      sessionIdleMinutes: 120,
      sessionTouchMinutes: 5,
      trustProxy: false,
    });
    expect(sessionCookieName(config)).toBe("fw.sid");

    expect(() =>
      readAuthRuntimeConfig({
        ...environment,
        NODE_ENV: "production",
      }),
    ).toThrow("APP_ORIGIN must use HTTPS in production.");
    expect(() => readAuthRuntimeConfig({ APP_ORIGIN: environment.APP_ORIGIN })).toThrow(
      AuthEnvironmentError,
    );
  });

  it("requires exact mutation origin and trusts source headers only by policy", () => {
    const config = readAuthRuntimeConfig(environment);
    const request = new Request("http://localhost:3000/api/v1/auth/sessions", {
      headers: {
        origin: "http://localhost:3000",
        "x-forwarded-for": "203.0.113.10",
      },
    });

    expect(hasAllowedMutationOrigin(request, config)).toBe(true);
    expect(
      hasAllowedMutationOrigin(
        new Request("http://internal.example/api/v1/auth/sessions", {
          headers: { origin: "http://localhost:3000" },
        }),
        config,
      ),
    ).toBe(false);
    expect(readTrustedSource(request, config)).toBeNull();
    expect(
      readTrustedSource(request, { ...config, trustProxy: true }),
    ).toBe("203.0.113.10");
  });
});

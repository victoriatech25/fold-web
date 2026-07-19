import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { readAuthRuntimeConfig } from "@/server/auth/auth-config";
import { getAuthenticatedContext, login } from "@/server/auth/auth-service";
import {
  hashPassword,
  passwordHashAlgorithm,
  verifyPasswordHash,
} from "@/server/auth/password";
import { completePasswordReset } from "@/server/auth/password-reset-service";
import {
  createOpaqueToken,
  createThrottleKey,
  hashOpaqueToken,
} from "@/server/auth/token";
import { disconnectPrisma, getPrisma } from "@/server/db/prisma";

const runIntegration = process.env.RUN_DB_INTEGRATION === "1";
const integration = runIntegration ? describe : describe.skip;
const origin = "http://localhost:3000";
const secret = "integration-rate-limit-secret-000000000";
const password = "Integration test phrase 2026!";
const email = "auth-integration@example.test";
let prisma: PrismaClient;
let userId: string;

function runtimeConfig() {
  return readAuthRuntimeConfig({
    APP_ORIGIN: origin,
    AUTH_RATE_LIMIT_SECRET: secret,
  });
}

integration.sequential("authentication and session PostgreSQL integration", () => {
  beforeAll(async () => {
    process.env.APP_ORIGIN = origin;
    process.env.AUTH_RATE_LIMIT_SECRET = secret;
    prisma = getPrisma();
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { code: "LOCAL_DEV" },
      select: { id: true },
    });
    const administratorRole = await prisma.role.findUniqueOrThrow({
      where: {
        organizationId_key: {
          organizationId: organization.id,
          key: "ADMINISTRATOR",
        },
      },
      select: { id: true },
    });
    const created = await prisma.user.create({
      data: {
        email,
        normalizedEmail: email,
        displayName: "인증 통합 테스트",
        status: "ACTIVE",
        passwordCredential: {
          create: {
            algorithm: passwordHashAlgorithm,
            passwordHash: await hashPassword(password),
          },
        },
        memberships: {
          create: {
            organizationId: organization.id,
            roles: { create: { roleId: administratorRole.id } },
          },
        },
      },
      select: { id: true },
    });
    userId = created.id;
  });

  afterAll(async () => {
    delete process.env.APP_ORIGIN;
    delete process.env.AUTH_RATE_LIMIT_SECRET;
    await disconnectPrisma();
  });

  it("rejects a cross-origin login mutation before database authentication", async () => {
    const { POST } = await import("@/app/api/v1/auth/sessions/route");
    const response = await POST(
      new Request(`${origin}/api/v1/auth/sessions`, {
        method: "POST",
        headers: {
          origin: "https://attacker.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      }),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });

  it("returns the same public response for unknown users and wrong passwords", async () => {
    const { POST } = await import("@/app/api/v1/auth/sessions/route");
    async function failedLogin(targetEmail: string) {
      const response = await POST(
        new Request(`${origin}/api/v1/auth/sessions`, {
          method: "POST",
          headers: {
            origin,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            email: targetEmail,
            password: "incorrect password",
          }),
        }),
      );
      const body = await response.json();
      return {
        status: response.status,
        code: body.error.code,
        message: body.error.message,
      };
    }

    await expect(failedLogin(email)).resolves.toEqual(
      await failedLogin("unknown-user@example.test"),
    );
  });

  it("logs in, returns a safe DTO, retains the session, and logs out", async () => {
    const sessionsRoute = await import("@/app/api/v1/auth/sessions/route");
    const sessionRoute = await import("@/app/api/v1/auth/session/route");
    const loginResponse = await sessionsRoute.POST(
      new Request(`${origin}/api/v1/auth/sessions`, {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          "x-request-id": "auth-login-integration",
        },
        body: JSON.stringify({ email: email.toUpperCase(), password }),
      }),
    );
    expect(loginResponse.status).toBe(200);
    const loginBody = await loginResponse.json();
    expect(loginBody).toMatchObject({
      data: {
        user: {
          displayName: "인증 통합 테스트",
          organization: { code: "LOCAL_DEV" },
        },
      },
    });
    expect(JSON.stringify(loginBody)).not.toContain("password");
    expect(JSON.stringify(loginBody)).not.toContain("token");

    const setCookie = loginResponse.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("fw.sid=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    const cookie = setCookie.split(";")[0];
    const rawToken = cookie.split("=")[1];
    expect(
      await prisma.authSession.findUnique({
        where: { tokenHash: rawToken },
      }),
    ).toBeNull();
    expect(
      await prisma.authSession.findUnique({
        where: { tokenHash: hashOpaqueToken(rawToken) },
      }),
    ).not.toBeNull();

    const currentResponse = await sessionRoute.GET(
      new Request(`${origin}/api/v1/auth/session`, {
        headers: { cookie },
      }),
    );
    expect(currentResponse.status).toBe(200);

    const logoutResponse = await sessionRoute.DELETE(
      new Request(`${origin}/api/v1/auth/session`, {
        method: "DELETE",
        headers: { cookie, origin },
      }),
    );
    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.headers.get("set-cookie")).toContain("Max-Age=0");

    const afterLogout = await sessionRoute.GET(
      new Request(`${origin}/api/v1/auth/session`, {
        headers: { cookie },
      }),
    );
    expect(afterLogout.status).toBe(401);
  });

  it("atomically counts concurrent login failures and blocks at the boundary", async () => {
    const targetEmail = "missing-concurrent@example.test";
    const now = new Date("2026-07-19T12:00:00.000Z");
    const attempts = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        login(prisma, {
          email: targetEmail,
          password: `incorrect-${index}`,
          source: null,
          requestId: `throttle-${index}`,
          config: runtimeConfig(),
          now,
        }),
      ),
    );
    expect(attempts.filter((result) => !result.ok).length).toBe(5);
    expect(attempts.some((result) => !result.ok && result.reason === "RATE_LIMITED"))
      .toBe(true);

    const throttle = await prisma.authThrottle.findUniqueOrThrow({
      where: {
        scope_keyHash: {
          scope: "ACCOUNT",
          keyHash: createThrottleKey(secret, "ACCOUNT", targetEmail),
        },
      },
    });
    expect(throttle.failureCount).toBe(5);
    expect(throttle.blockedUntil).toEqual(
      new Date("2026-07-19T12:15:00.000Z"),
    );
  });

  it("touches active sessions and revokes idle sessions", async () => {
    const issuedAt = new Date("2026-07-19T10:00:00.000Z");
    const result = await login(prisma, {
      email,
      password,
      source: null,
      requestId: "session-lifetime",
      config: runtimeConfig(),
      now: issuedAt,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const touched = await getAuthenticatedContext(prisma, {
      token: result.token,
      config: runtimeConfig(),
      now: new Date("2026-07-19T10:06:00.000Z"),
    });
    expect(touched).not.toBeNull();
    const row = await prisma.authSession.findUniqueOrThrow({
      where: { id: result.context.sessionId },
    });
    expect(row.lastSeenAt).toEqual(new Date("2026-07-19T10:06:00.000Z"));

    const expired = await getAuthenticatedContext(prisma, {
      token: result.token,
      config: runtimeConfig(),
      now: new Date("2026-07-19T12:07:00.000Z"),
    });
    expect(expired).toBeNull();
    const revoked = await prisma.authSession.findUniqueOrThrow({
      where: { id: result.context.sessionId },
    });
    expect(revoked.revokedAt).toEqual(new Date("2026-07-19T12:07:00.000Z"));

    const absoluteToken = createOpaqueToken();
    const absoluteSession = await prisma.authSession.create({
      data: {
        userId,
        tokenHash: hashOpaqueToken(absoluteToken),
        expiresAt: new Date("2026-07-19T18:00:00.000Z"),
        lastSeenAt: new Date("2026-07-19T17:59:00.000Z"),
      },
    });
    await expect(
      getAuthenticatedContext(prisma, {
        token: absoluteToken,
        config: runtimeConfig(),
        now: new Date("2026-07-19T18:00:00.000Z"),
      }),
    ).resolves.toBeNull();
    await expect(
      prisma.authSession.findUniqueOrThrow({
        where: { id: absoluteSession.id },
      }),
    ).resolves.toMatchObject({
      revokedAt: new Date("2026-07-19T18:00:00.000Z"),
    });
  });

  it("consumes a reset token once, changes the password, and revokes sessions", async () => {
    const token = createOpaqueToken();
    const now = new Date();
    const reset = await prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hashOpaqueToken(token),
        expiresAt: new Date(now.getTime() + 30 * 60_000),
      },
    });
    const activeSession = await prisma.authSession.create({
      data: {
        userId,
        tokenHash: hashOpaqueToken(createOpaqueToken()),
        expiresAt: new Date(now.getTime() + 60 * 60_000),
        lastSeenAt: now,
      },
    });
    const nextPassword = "Changed integration phrase 2026!";
    await expect(
      completePasswordReset(prisma, {
        token,
        password: nextPassword,
        requestId: "reset-integration",
        now,
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      completePasswordReset(prisma, {
        token,
        password: nextPassword,
        requestId: "reset-integration-repeat",
        now,
      }),
    ).resolves.toEqual({ ok: false, reason: "INVALID_TOKEN" });

    const [credential, usedReset, revokedSession] = await Promise.all([
      prisma.passwordCredential.findUniqueOrThrow({ where: { userId } }),
      prisma.passwordResetToken.findUniqueOrThrow({ where: { id: reset.id } }),
      prisma.authSession.findUniqueOrThrow({ where: { id: activeSession.id } }),
    ]);
    await expect(
      verifyPasswordHash(credential.passwordHash, nextPassword),
    ).resolves.toBe(true);
    expect(usedReset.usedAt).toEqual(now);
    expect(revokedSession.revokedAt).toEqual(now);
  });
});

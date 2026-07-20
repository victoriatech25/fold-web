import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthRuntimeConfig } from "@/server/auth/auth-config";
import {
  clearThrottle,
  createAuthAudit,
  findDefaultOrganizationId,
  findLoginPrincipal,
  findSessionPrincipal,
  findThrottle,
  recordThrottleFailure,
} from "@/server/auth/auth-repository";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { normalizeEmail } from "@/server/auth/email";
import {
  passwordHashAlgorithm,
  verifyPasswordOrDummy,
} from "@/server/auth/password";
import {
  createOpaqueToken,
  createThrottleKey,
  hashOpaqueToken,
  isOpaqueToken,
} from "@/server/auth/token";

type LoginFailure =
  | { ok: false; reason: "INVALID_CREDENTIALS" }
  | { ok: false; reason: "RATE_LIMITED"; retryAfterSeconds: number };

export type LoginResult =
  | {
      ok: true;
      token: string;
      context: AuthenticatedContext;
    }
  | LoginFailure;

function isBlocked(
  throttle: { blockedUntil: Date | null } | null,
  now: Date,
): throttle is { blockedUntil: Date } {
  return Boolean(throttle?.blockedUntil && throttle.blockedUntil > now);
}

function retryAfterSeconds(blockedUntil: Date, now: Date): number {
  return Math.max(1, Math.ceil((blockedUntil.getTime() - now.getTime()) / 1_000));
}

async function recordLoginFailure(
  prisma: PrismaClient,
  input: {
    accountKeyHash: string;
    sourceKeyHash: string | null;
    config: AuthRuntimeConfig;
    now: Date;
  },
): Promise<{ blockedUntil: Date | null }> {
  const updates = [
    recordThrottleFailure(prisma, {
      scope: "ACCOUNT",
      keyHash: input.accountKeyHash,
      now: input.now,
      windowMinutes: input.config.throttleWindowMinutes,
      failureLimit: input.config.accountFailureLimit,
    }),
  ];
  if (input.sourceKeyHash) {
    updates.push(
      recordThrottleFailure(prisma, {
        scope: "SOURCE",
        keyHash: input.sourceKeyHash,
        now: input.now,
        windowMinutes: input.config.throttleWindowMinutes,
        failureLimit: input.config.sourceFailureLimit,
      }),
    );
  }

  const results = await Promise.all(updates);
  const blockedUntil = results
    .map((result) => result.blockedUntil)
    .filter((value): value is Date => value !== null)
    .sort((left, right) => right.getTime() - left.getTime())[0];
  return { blockedUntil: blockedUntil ?? null };
}

export async function login(
  prisma: PrismaClient,
  input: {
    email: string;
    password: string;
    source: string | null;
    requestId: string;
    config: AuthRuntimeConfig;
    now?: Date;
  },
): Promise<LoginResult> {
  const now = input.now ?? new Date();
  const normalizedEmail = normalizeEmail(input.email);
  const accountKeyHash = createThrottleKey(
    input.config.rateLimitSecret,
    "ACCOUNT",
    normalizedEmail,
  );
  const sourceKeyHash = input.source
    ? createThrottleKey(input.config.rateLimitSecret, "SOURCE", input.source)
    : null;

  const [accountThrottle, sourceThrottle] = await Promise.all([
    findThrottle(prisma, "ACCOUNT", accountKeyHash),
    sourceKeyHash ? findThrottle(prisma, "SOURCE", sourceKeyHash) : null,
  ]);
  const activeBlock = [accountThrottle, sourceThrottle].find((throttle) =>
    isBlocked(throttle, now),
  );
  if (activeBlock?.blockedUntil) {
    return {
      ok: false,
      reason: "RATE_LIMITED",
      retryAfterSeconds: retryAfterSeconds(activeBlock.blockedUntil, now),
    };
  }

  const principal = await findLoginPrincipal(prisma, normalizedEmail);
  const passwordMatches = await verifyPasswordOrDummy(
    principal?.passwordHash ?? null,
    input.password,
  );
  const accepted =
    passwordMatches &&
    principal?.status === "ACTIVE" &&
    principal.passwordAlgorithm === passwordHashAlgorithm &&
    principal.membership !== null;

  if (!accepted || !principal?.membership) {
    const throttle = await recordLoginFailure(prisma, {
      accountKeyHash,
      sourceKeyHash,
      config: input.config,
      now,
    });
    const organizationId =
      principal?.membership?.organizationId ??
      (await findDefaultOrganizationId(
        prisma,
        input.config.defaultOrganizationCode,
      ));
    if (organizationId) {
      await createAuthAudit(prisma, {
        organizationId,
        actorUserId: principal?.userId,
        action: "auth.login_failed",
        entityId: principal?.userId,
        requestId: input.requestId,
        metadata: { throttled: throttle.blockedUntil !== null },
      });
    }

    return throttle.blockedUntil
      ? {
          ok: false,
          reason: "RATE_LIMITED",
          retryAfterSeconds: retryAfterSeconds(throttle.blockedUntil, now),
        }
      : { ok: false, reason: "INVALID_CREDENTIALS" };
  }

  const membership = principal.membership;
  const token = createOpaqueToken();
  const tokenHash = hashOpaqueToken(token);
  const expiresAt = new Date(
    now.getTime() + input.config.sessionAbsoluteMinutes * 60_000,
  );

  const session = await prisma.$transaction(async (transaction) => {
    const created = await transaction.authSession.create({
      data: {
        userId: principal.userId,
        tokenHash,
        expiresAt,
        lastSeenAt: now,
      },
      select: { id: true },
    });
    await transaction.user.update({
      where: { id: principal.userId },
      data: { lastLoginAt: now },
    });
    await clearThrottle(transaction, "ACCOUNT", accountKeyHash);
    await createAuthAudit(transaction, {
      organizationId: membership.organizationId,
      actorUserId: principal.userId,
      action: "auth.login_succeeded",
      entityId: principal.userId,
      requestId: input.requestId,
    });
    return created;
  });

  return {
    ok: true,
    token,
    context: {
      sessionId: session.id,
      userId: principal.userId,
      displayName: principal.displayName,
      membershipId: membership.membershipId,
      departmentId: membership.departmentId,
      organizationId: membership.organizationId,
      organizationCode: membership.organizationCode,
      organizationName: membership.organizationName,
      roleKeys: membership.roleKeys,
      permissions: membership.permissions,
      expiresAt,
    },
  };
}

export async function getAuthenticatedContext(
  prisma: PrismaClient,
  input: {
    token: string | null;
    config: AuthRuntimeConfig;
    now?: Date;
  },
): Promise<AuthenticatedContext | null> {
  if (!input.token || !isOpaqueToken(input.token)) return null;

  const now = input.now ?? new Date();
  const principal = await findSessionPrincipal(
    prisma,
    hashOpaqueToken(input.token),
  );
  if (!principal) return null;

  const lastActivity = principal.lastSeenAt ?? principal.createdAt;
  const idleExpiresAt = new Date(
    lastActivity.getTime() + input.config.sessionIdleMinutes * 60_000,
  );
  const accepted =
    !principal.revokedAt &&
    principal.expiresAt > now &&
    idleExpiresAt > now &&
    principal.userStatus === "ACTIVE" &&
    principal.membership !== null;
  if (!accepted || !principal.membership) {
    if (!principal.revokedAt) {
      await prisma.authSession.updateMany({
        where: { id: principal.sessionId, revokedAt: null },
        data: { revokedAt: now },
      });
    }
    return null;
  }

  const touchCutoff = new Date(
    now.getTime() - input.config.sessionTouchMinutes * 60_000,
  );
  if (lastActivity <= touchCutoff) {
    await prisma.authSession.updateMany({
      where: {
        id: principal.sessionId,
        revokedAt: null,
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lte: touchCutoff } }],
      },
      data: { lastSeenAt: now },
    });
  }

  return {
    sessionId: principal.sessionId,
    userId: principal.userId,
    displayName: principal.displayName,
    membershipId: principal.membership.membershipId,
    departmentId: principal.membership.departmentId,
    organizationId: principal.membership.organizationId,
    organizationCode: principal.membership.organizationCode,
    organizationName: principal.membership.organizationName,
    roleKeys: principal.membership.roleKeys,
    permissions: principal.membership.permissions,
    expiresAt: principal.expiresAt,
  };
}

export async function logout(
  prisma: PrismaClient,
  input: {
    token: string | null;
    requestId: string;
    config: AuthRuntimeConfig;
    now?: Date;
  },
): Promise<void> {
  if (!input.token || !isOpaqueToken(input.token)) return;
  const now = input.now ?? new Date();
  const principal = await findSessionPrincipal(
    prisma,
    hashOpaqueToken(input.token),
  );
  if (!principal) return;

  await prisma.$transaction(async (transaction) => {
    await transaction.authSession.updateMany({
      where: { id: principal.sessionId, revokedAt: null },
      data: { revokedAt: now },
    });
    if (principal.membership) {
      await createAuthAudit(transaction, {
        organizationId: principal.membership.organizationId,
        actorUserId: principal.userId,
        action: "auth.logout",
        entityId: principal.userId,
        requestId: input.requestId,
      });
    }
  });
}

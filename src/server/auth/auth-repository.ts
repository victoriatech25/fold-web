import "server-only";

import type {
  AuthThrottleScope,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

export type LoginPrincipal = {
  userId: string;
  displayName: string;
  status: "INVITED" | "ACTIVE" | "SUSPENDED" | "DISABLED";
  passwordAlgorithm: string | null;
  passwordHash: string | null;
  membership: {
    organizationId: string;
    organizationCode: string;
    organizationName: string;
  } | null;
};

export type SessionPrincipal = {
  sessionId: string;
  userId: string;
  displayName: string;
  userStatus: "INVITED" | "ACTIVE" | "SUSPENDED" | "DISABLED";
  expiresAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  membership: {
    organizationId: string;
    organizationCode: string;
    organizationName: string;
  } | null;
};

export async function findLoginPrincipal(
  database: DatabaseClient,
  normalizedEmail: string,
): Promise<LoginPrincipal | null> {
  const user = await database.user.findUnique({
    where: { normalizedEmail },
    select: {
      id: true,
      displayName: true,
      status: true,
      passwordCredential: {
        select: {
          algorithm: true,
          passwordHash: true,
        },
      },
      memberships: {
        where: {
          status: "ACTIVE",
          organization: { status: "ACTIVE" },
        },
        orderBy: { joinedAt: "asc" },
        take: 1,
        select: {
          organization: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
        },
      },
    },
  });
  if (!user) return null;

  const membership = user.memberships[0]?.organization;
  return {
    userId: user.id,
    displayName: user.displayName,
    status: user.status,
    passwordAlgorithm: user.passwordCredential?.algorithm ?? null,
    passwordHash: user.passwordCredential?.passwordHash ?? null,
    membership: membership
      ? {
          organizationId: membership.id,
          organizationCode: membership.code,
          organizationName: membership.name,
        }
      : null,
  };
}

export async function findSessionPrincipal(
  database: DatabaseClient,
  tokenHash: string,
): Promise<SessionPrincipal | null> {
  const session = await database.authSession.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      lastSeenAt: true,
      revokedAt: true,
      createdAt: true,
      user: {
        select: {
          displayName: true,
          status: true,
          memberships: {
            where: {
              status: "ACTIVE",
              organization: { status: "ACTIVE" },
            },
            orderBy: { joinedAt: "asc" },
            take: 1,
            select: {
              organization: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!session) return null;

  const membership = session.user.memberships[0]?.organization;
  return {
    sessionId: session.id,
    userId: session.userId,
    displayName: session.user.displayName,
    userStatus: session.user.status,
    expiresAt: session.expiresAt,
    lastSeenAt: session.lastSeenAt,
    revokedAt: session.revokedAt,
    createdAt: session.createdAt,
    membership: membership
      ? {
          organizationId: membership.id,
          organizationCode: membership.code,
          organizationName: membership.name,
        }
      : null,
  };
}

export async function findDefaultOrganizationId(
  database: DatabaseClient,
  organizationCode: string,
): Promise<string | null> {
  const organization = await database.organization.findUnique({
    where: { code: organizationCode },
    select: { id: true },
  });
  return organization?.id ?? null;
}

export async function findThrottle(
  database: DatabaseClient,
  scope: AuthThrottleScope,
  keyHash: string,
): Promise<{ blockedUntil: Date | null; failureCount: number } | null> {
  return database.authThrottle.findUnique({
    where: {
      scope_keyHash: {
        scope,
        keyHash,
      },
    },
    select: {
      blockedUntil: true,
      failureCount: true,
    },
  });
}

export async function recordThrottleFailure(
  database: PrismaClient,
  input: {
    scope: AuthThrottleScope;
    keyHash: string;
    now: Date;
    windowMinutes: number;
    failureLimit: number;
  },
): Promise<{ blockedUntil: Date | null; failureCount: number }> {
  const windowStartedAtCutoff = new Date(
    input.now.getTime() - input.windowMinutes * 60_000,
  );
  const nextBlockedUntil = new Date(
    input.now.getTime() + input.windowMinutes * 60_000,
  );

  const rows = await database.$queryRaw<
    Array<{ blockedUntil: Date | null; failureCount: number }>
  >`
    INSERT INTO "AuthThrottle" (
      "scope",
      "keyHash",
      "windowStartedAt",
      "failureCount",
      "blockedUntil",
      "updatedAt"
    )
    VALUES (
      ${input.scope}::"AuthThrottleScope",
      ${input.keyHash},
      ${input.now}::timestamptz,
      1,
      CASE
        WHEN 1 >= ${input.failureLimit}
          THEN ${nextBlockedUntil}::timestamptz
        ELSE NULL::timestamptz
      END,
      ${input.now}::timestamptz
    )
    ON CONFLICT ("scope", "keyHash")
    DO UPDATE SET
      "windowStartedAt" = CASE
        WHEN "AuthThrottle"."windowStartedAt" <= ${windowStartedAtCutoff}::timestamptz
          THEN ${input.now}::timestamptz
        ELSE "AuthThrottle"."windowStartedAt"
      END,
      "failureCount" = CASE
        WHEN "AuthThrottle"."windowStartedAt" <= ${windowStartedAtCutoff}::timestamptz
          THEN 1
        ELSE "AuthThrottle"."failureCount" + 1
      END,
      "blockedUntil" = CASE
        WHEN "AuthThrottle"."blockedUntil" > ${input.now}::timestamptz
          THEN "AuthThrottle"."blockedUntil"
        WHEN (
          CASE
            WHEN "AuthThrottle"."windowStartedAt" <= ${windowStartedAtCutoff}::timestamptz
              THEN 1
            ELSE "AuthThrottle"."failureCount" + 1
          END
        ) >= ${input.failureLimit}
          THEN ${nextBlockedUntil}::timestamptz
        ELSE NULL::timestamptz
      END,
      "updatedAt" = ${input.now}::timestamptz
    RETURNING
      "blockedUntil" AS "blockedUntil",
      "failureCount" AS "failureCount"
  `;

  const result = rows[0];
  if (!result) throw new Error("Failed to update authentication throttle.");
  return result;
}

export function clearThrottle(
  database: DatabaseClient,
  scope: AuthThrottleScope,
  keyHash: string,
): Promise<{ count: number }> {
  return database.authThrottle.deleteMany({
    where: { scope, keyHash },
  });
}

export function createAuthAudit(
  database: DatabaseClient,
  input: {
    organizationId: string;
    actorUserId?: string;
    action: string;
    entityId?: string;
    requestId: string;
    metadata?: Prisma.InputJsonValue;
  },
): Promise<unknown> {
  return database.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: "User",
      entityId: input.entityId,
      requestId: input.requestId,
      metadata: input.metadata,
    },
    select: { id: true },
  });
}

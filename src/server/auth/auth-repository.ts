import "server-only";

import type {
  AuthThrottleScope,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import {
  permissionUnion,
  type PermissionKey,
} from "@/domain/permission";

export type DatabaseClient = PrismaClient | Prisma.TransactionClient;

export type PrincipalMembership = {
  membershipId: string;
  departmentId: string | null;
  organizationId: string;
  organizationCode: string;
  organizationName: string;
  roleKeys: string[];
  permissions: PermissionKey[];
};

export type LoginPrincipal = {
  userId: string;
  displayName: string;
  status: "INVITED" | "ACTIVE" | "SUSPENDED" | "DISABLED";
  passwordAlgorithm: string | null;
  passwordHash: string | null;
  membership: PrincipalMembership | null;
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
  membership: PrincipalMembership | null;
};

type MembershipRow = {
  id: string;
  departmentId: string | null;
  organization: {
    id: string;
    code: string;
    name: string;
  };
  roles: Array<{
    role: {
      organizationId: string;
      key: string;
      permissions: Array<{
        permission: { key: string };
      }>;
    };
  }>;
};

function toPrincipalMembership(
  memberships: MembershipRow[],
): PrincipalMembership | null {
  if (memberships.length !== 1) return null;
  const membership = memberships[0];
  const roles = membership.roles
    .map(({ role }) => role)
    .filter(
      ({ organizationId }) => organizationId === membership.organization.id,
    );

  return {
    membershipId: membership.id,
    departmentId: membership.departmentId,
    organizationId: membership.organization.id,
    organizationCode: membership.organization.code,
    organizationName: membership.organization.name,
    roleKeys: roles.map(({ key }) => key).sort(),
    permissions: permissionUnion(
      roles.map((role) => ({
        permissions: role.permissions.map(
          ({ permission }) => permission.key,
        ),
      })),
    ),
  };
}

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
        take: 2,
        select: {
          id: true,
          departmentId: true,
          organization: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
          roles: {
            where: { role: { active: true } },
            select: {
              role: {
                select: {
                  organizationId: true,
                  key: true,
                  permissions: {
                    select: {
                      permission: { select: { key: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!user) return null;

  const membership = toPrincipalMembership(user.memberships);
  return {
    userId: user.id,
    displayName: user.displayName,
    status: user.status,
    passwordAlgorithm: user.passwordCredential?.algorithm ?? null,
    passwordHash: user.passwordCredential?.passwordHash ?? null,
    membership,
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
            take: 2,
            select: {
              id: true,
              departmentId: true,
              organization: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                },
              },
              roles: {
                where: { role: { active: true } },
                select: {
                  role: {
                    select: {
                      organizationId: true,
                      key: true,
                      permissions: {
                        select: {
                          permission: { select: { key: true } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!session) return null;

  const membership = toPrincipalMembership(session.user.memberships);
  return {
    sessionId: session.id,
    userId: session.userId,
    displayName: session.user.displayName,
    userStatus: session.user.status,
    expiresAt: session.expiresAt,
    lastSeenAt: session.lastSeenAt,
    revokedAt: session.revokedAt,
    createdAt: session.createdAt,
    membership,
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

import { resolve } from "node:path";

import { config as loadEnvironment } from "dotenv";
import { z } from "zod";

loadEnvironment({ path: resolve(process.cwd(), ".env.local"), quiet: true });
loadEnvironment({ quiet: true });

import { createCliPrisma } from "./auth-cli-support";
import { normalizeEmail } from "../src/server/auth/email-core";
import {
  hashPassword,
  passwordHashAlgorithm,
  validatePasswordPolicy,
} from "../src/server/auth/password-core";
import { writeAuditEvent } from "../src/server/audit/audit-writer";

const configurationSchema = z.object({
  LOCAL_SCREEN_TEST_ACCOUNT_ENABLED: z.literal("true"),
  LOCAL_SCREEN_TEST_EMAIL: z.email().max(320),
  LOCAL_SCREEN_TEST_PASSWORD: z.string().min(15).max(128),
  LOCAL_SCREEN_TEST_DISPLAY_NAME: z.string().trim().min(1).max(100),
  AUTH_DEFAULT_ORGANIZATION_CODE: z
    .string()
    .regex(/^[A-Z0-9_-]{2,50}$/)
    .default("LOCAL_DEV"),
  APP_ORIGIN: z.url(),
  DATABASE_URL: z.url(),
  NODE_ENV: z.string().optional(),
});

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function readLocalConfiguration() {
  const input = configurationSchema.parse(process.env);
  const databaseUrl = new URL(input.DATABASE_URL);
  const appOrigin = new URL(input.APP_ORIGIN);

  if (input.NODE_ENV === "production") {
    throw new Error("Local screen-test accounts are forbidden in production.");
  }
  if (
    !["postgresql:", "postgres:"].includes(databaseUrl.protocol) ||
    !isLoopbackHost(databaseUrl.hostname) ||
    !databaseUrl.pathname.endsWith("_dev")
  ) {
    throw new Error(
      "LOCAL_SCREEN_TEST_ACCOUNT requires a loopback PostgreSQL *_dev database.",
    );
  }
  if (!isLoopbackHost(appOrigin.hostname)) {
    throw new Error("LOCAL_SCREEN_TEST_ACCOUNT requires a loopback APP_ORIGIN.");
  }
  if (!input.LOCAL_SCREEN_TEST_EMAIL.endsWith(".test")) {
    throw new Error("LOCAL_SCREEN_TEST_EMAIL must use the reserved .test domain.");
  }

  return input;
}

async function main(): Promise<void> {
  const input = readLocalConfiguration();
  const normalizedEmail = normalizeEmail(input.LOCAL_SCREEN_TEST_EMAIL);
  const passwordPolicy = validatePasswordPolicy(input.LOCAL_SCREEN_TEST_PASSWORD, [
    normalizedEmail,
    input.LOCAL_SCREEN_TEST_DISPLAY_NAME,
  ]);
  if (!passwordPolicy.valid) {
    throw new Error(
      `Local screen-test password policy rejected the input: ${passwordPolicy.reason}`,
    );
  }

  const passwordHash = await hashPassword(input.LOCAL_SCREEN_TEST_PASSWORD);
  const prisma = createCliPrisma();

  try {
    const result = await prisma.$transaction(async (transaction) => {
      const organization = await transaction.organization.findUnique({
        where: { code: input.AUTH_DEFAULT_ORGANIZATION_CODE },
        select: { id: true },
      });
      if (!organization) {
        throw new Error(
          `Organization ${input.AUTH_DEFAULT_ORGANIZATION_CODE} is missing. Run db:seed first.`,
        );
      }
      const administratorRole = await transaction.role.findUnique({
        where: {
          organizationId_key: {
            organizationId: organization.id,
            key: "ADMINISTRATOR",
          },
        },
        select: { id: true },
      });
      if (!administratorRole) {
        throw new Error("ADMINISTRATOR role is missing. Run db:seed first.");
      }

      const existingUser = await transaction.user.findUnique({
        where: { normalizedEmail },
        select: { id: true, status: true },
      });
      if (!existingUser) {
        const user = await transaction.user.create({
          data: {
            email: input.LOCAL_SCREEN_TEST_EMAIL,
            normalizedEmail,
            displayName: input.LOCAL_SCREEN_TEST_DISPLAY_NAME,
            status: "ACTIVE",
            passwordCredential: {
              create: {
                algorithm: passwordHashAlgorithm,
                passwordHash,
              },
            },
            memberships: {
              create: {
                organizationId: organization.id,
                status: "ACTIVE",
                roles: { create: { roleId: administratorRole.id } },
              },
            },
          },
          select: { id: true },
        });
        await writeAuditEvent(transaction, {
          organizationId: organization.id,
          actorUserId: user.id,
          actorSnapshot: {
            displayName: input.LOCAL_SCREEN_TEST_DISPLAY_NAME,
            email: input.LOCAL_SCREEN_TEST_EMAIL,
          },
          action: "auth.admin_bootstrapped",
          entityId: user.id,
          requestId: "local-screen-test-account",
          after: { status: "ACTIVE", roleKeys: ["ADMINISTRATOR"] },
        });
        return { userId: user.id, operation: "created" as const };
      }

      await transaction.user.update({
        where: { id: existingUser.id },
        data: {
          email: input.LOCAL_SCREEN_TEST_EMAIL,
          displayName: input.LOCAL_SCREEN_TEST_DISPLAY_NAME,
          status: "ACTIVE",
          passwordCredential: {
            upsert: {
              create: {
                algorithm: passwordHashAlgorithm,
                passwordHash,
              },
              update: {
                algorithm: passwordHashAlgorithm,
                passwordHash,
                passwordChangedAt: new Date(),
              },
            },
          },
        },
      });
      const membership = await transaction.organizationMembership.upsert({
        where: {
          organizationId_userId: {
            organizationId: organization.id,
            userId: existingUser.id,
          },
        },
        create: {
          organizationId: organization.id,
          userId: existingUser.id,
          status: "ACTIVE",
        },
        update: { status: "ACTIVE" },
        select: { id: true },
      });
      await transaction.membershipRole.upsert({
        where: {
          membershipId_roleId: {
            membershipId: membership.id,
            roleId: administratorRole.id,
          },
        },
        create: {
          membershipId: membership.id,
          roleId: administratorRole.id,
        },
        update: {},
      });
      await Promise.all([
        transaction.authSession.updateMany({
          where: { userId: existingUser.id, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
        transaction.passwordResetToken.updateMany({
          where: { userId: existingUser.id, usedAt: null },
          data: { usedAt: new Date() },
        }),
      ]);
      await writeAuditEvent(transaction, {
        organizationId: organization.id,
        actorUserId: existingUser.id,
        actorSnapshot: {
          displayName: input.LOCAL_SCREEN_TEST_DISPLAY_NAME,
          email: input.LOCAL_SCREEN_TEST_EMAIL,
        },
        action: "auth.password_reset_completed",
        entityId: existingUser.id,
        requestId: "local-screen-test-account",
        source: "CLI",
        before: { status: existingUser.status },
        after: { status: "ACTIVE", sessionsRevoked: true },
      });
      return { userId: existingUser.id, operation: "updated" as const };
    });

    process.stdout.write(
      `로컬 화면 테스트 계정을 보장했습니다. operation=${result.operation} userId=${result.userId}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`로컬 화면 테스트 계정 보장 실패: ${message}\n`);
  process.exitCode = 1;
});

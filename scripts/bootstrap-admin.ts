import "dotenv/config";

import { z } from "zod";

import {
  createCliPrisma,
  readNamedArguments,
  readPasswordFromStdin,
  requireArgument,
} from "./auth-cli-support";
import { normalizeEmail } from "../src/server/auth/email-core";
import {
  hashPassword,
  passwordHashAlgorithm,
  validatePasswordPolicy,
} from "../src/server/auth/password-core";
import { writeAuditEvent } from "../src/server/audit/audit-writer";

const argumentsSchema = z.object({
  email: z.email().max(320),
  name: z.string().trim().min(1).max(100),
  organization: z.string().regex(/^[A-Z0-9_-]{2,50}$/),
});

async function main(): Promise<void> {
  const values = readNamedArguments(process.argv.slice(2), [
    "email",
    "name",
    "organization",
  ]);
  const input = argumentsSchema.parse({
    email: requireArgument(values, "email"),
    name: requireArgument(values, "name"),
    organization:
      values.get("organization") ??
      process.env.AUTH_DEFAULT_ORGANIZATION_CODE ??
      "LOCAL_DEV",
  });
  const normalizedEmail = normalizeEmail(input.email);
  const password = await readPasswordFromStdin();
  const policy = validatePasswordPolicy(password, [
    normalizedEmail,
    input.name,
  ]);
  if (!policy.valid) {
    throw new Error(`Password policy rejected the input: ${policy.reason}`);
  }
  const passwordHash = await hashPassword(password);
  const prisma = createCliPrisma();

  try {
    const result = await prisma.$transaction(async (transaction) => {
      const [organization, existingUser] = await Promise.all([
        transaction.organization.findUnique({
          where: { code: input.organization },
          select: { id: true },
        }),
        transaction.user.findUnique({
          where: { normalizedEmail },
          select: { id: true },
        }),
      ]);
      if (!organization) {
        throw new Error(
          `Organization ${input.organization} is missing. Run db:seed first.`,
        );
      }
      if (existingUser) {
        throw new Error("A user with this email already exists.");
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

      const user = await transaction.user.create({
        data: {
          email: input.email.trim(),
          normalizedEmail,
          displayName: input.name,
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
              roles: {
                create: { roleId: administratorRole.id },
              },
            },
          },
        },
        select: { id: true },
      });
      await writeAuditEvent(transaction, {
        organizationId: organization.id,
        actorUserId: user.id,
        actorSnapshot: {
          displayName: input.name,
          email: input.email.trim(),
        },
        action: "auth.admin_bootstrapped",
        entityId: user.id,
        requestId: "auth-cli",
        after: {
          status: "ACTIVE",
          roleKeys: ["ADMINISTRATOR"],
        },
      });
      return user;
    });
    process.stdout.write(`관리자 계정을 생성했습니다. userId=${result.id}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`관리자 생성 실패: ${message}\n`);
  process.exitCode = 1;
});

import "dotenv/config";

import { z } from "zod";

import {
  createCliPrisma,
  readNamedArguments,
  requireArgument,
} from "./auth-cli-support";
import { normalizeEmail } from "../src/server/auth/email-core";
import {
  createOpaqueToken,
  hashOpaqueToken,
} from "../src/server/auth/token-core";

const argumentsSchema = z.object({
  email: z.email().max(320),
  origin: z.url(),
  minutes: z.coerce.number().int().positive().max(1_440),
});

async function main(): Promise<void> {
  const values = readNamedArguments(process.argv.slice(2), [
    "email",
    "origin",
    "minutes",
  ]);
  const input = argumentsSchema.parse({
    email: requireArgument(values, "email"),
    origin: values.get("origin") ?? process.env.APP_ORIGIN,
    minutes:
      values.get("minutes") ?? process.env.AUTH_RESET_TOKEN_MINUTES ?? "30",
  });
  const origin = new URL(input.origin);
  if (origin.origin !== input.origin) {
    throw new Error("--origin must contain only scheme, host, and optional port.");
  }

  const prisma = createCliPrisma();
  const token = createOpaqueToken();
  const tokenHash = hashOpaqueToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.minutes * 60_000);

  try {
    await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.findUnique({
        where: { normalizedEmail: normalizeEmail(input.email) },
        select: {
          id: true,
          memberships: {
            where: {
              status: "ACTIVE",
              organization: { status: "ACTIVE" },
            },
            orderBy: { joinedAt: "asc" },
            take: 1,
            select: { organizationId: true },
          },
        },
      });
      const membership = user?.memberships[0];
      if (!user || !membership) {
        throw new Error("Active user and organization membership not found.");
      }

      await transaction.passwordResetToken.updateMany({
        where: {
          userId: user.id,
          usedAt: null,
        },
        data: { usedAt: now },
      });
      await transaction.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: membership.organizationId,
          action: "auth.password_reset_issued",
          entityType: "User",
          entityId: user.id,
          requestId: "auth-cli",
          metadata: { expiresAt: expiresAt.toISOString() },
        },
      });
    });

    const resetUrl = new URL("/reset-password", origin);
    resetUrl.searchParams.set("token", token);
    process.stdout.write(
      `일회성 재설정 URL(다시 표시되지 않음, ${input.minutes}분 유효):\n${resetUrl.toString()}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`재설정 토큰 발급 실패: ${message}\n`);
  process.exitCode = 1;
});

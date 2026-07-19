import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  hashPassword,
  passwordHashAlgorithm,
  validatePasswordPolicy,
  type PasswordPolicyResult,
} from "@/server/auth/password";
import { createAuthAudit } from "@/server/auth/auth-repository";
import { hashOpaqueToken, isOpaqueToken } from "@/server/auth/token";

export type CompletePasswordResetResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "INVALID_TOKEN"
        | Extract<PasswordPolicyResult, { valid: false }>["reason"];
    };

export async function completePasswordReset(
  prisma: PrismaClient,
  input: {
    token: string;
    password: string;
    requestId: string;
    now?: Date;
  },
): Promise<CompletePasswordResetResult> {
  if (!isOpaqueToken(input.token)) {
    return { ok: false, reason: "INVALID_TOKEN" };
  }

  const now = input.now ?? new Date();
  const tokenHash = hashOpaqueToken(input.token);
  const reset = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      expiresAt: true,
      usedAt: true,
      user: {
        select: {
          id: true,
          normalizedEmail: true,
          displayName: true,
          status: true,
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
      },
    },
  });
  const membership = reset?.user.memberships[0];
  if (
    !reset ||
    reset.usedAt ||
    reset.expiresAt <= now ||
    !membership ||
    (reset.user.status !== "INVITED" && reset.user.status !== "ACTIVE")
  ) {
    return { ok: false, reason: "INVALID_TOKEN" };
  }

  const policy = validatePasswordPolicy(input.password, [
    reset.user.normalizedEmail,
    reset.user.displayName,
  ]);
  if (!policy.valid) return { ok: false, reason: policy.reason };
  const passwordHash = await hashPassword(input.password);

  const updated = await prisma.$transaction(async (transaction) => {
    const consumed = await transaction.passwordResetToken.updateMany({
      where: {
        id: reset.id,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });
    if (consumed.count !== 1) return false;

    await transaction.passwordCredential.upsert({
      where: { userId: reset.user.id },
      update: {
        algorithm: passwordHashAlgorithm,
        passwordHash,
        passwordChangedAt: now,
      },
      create: {
        userId: reset.user.id,
        algorithm: passwordHashAlgorithm,
        passwordHash,
        passwordChangedAt: now,
      },
    });
    await transaction.user.update({
      where: { id: reset.user.id },
      data: reset.user.status === "INVITED" ? { status: "ACTIVE" } : {},
    });
    await transaction.authSession.updateMany({
      where: {
        userId: reset.user.id,
        revokedAt: null,
      },
      data: { revokedAt: now },
    });
    await createAuthAudit(transaction, {
      organizationId: membership.organizationId,
      actorUserId: reset.user.id,
      action: "auth.password_reset_completed",
      entityId: reset.user.id,
      requestId: input.requestId,
    });
    return true;
  });

  return updated
    ? { ok: true }
    : { ok: false, reason: "INVALID_TOKEN" };
}

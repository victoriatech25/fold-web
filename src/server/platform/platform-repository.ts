import type {
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import { writeAuditEvent } from "@/server/audit/audit-writer";

export async function findOrganizationIdByCode(
  transaction: Prisma.TransactionClient,
  organizationCode: string,
): Promise<string | null> {
  const organization = await transaction.organization.findUnique({
    where: { code: organizationCode },
    select: { id: true },
  });
  return organization?.id ?? null;
}

export async function createDatabaseSmokeAudit(
  transaction: Prisma.TransactionClient,
  input: {
    organizationId: string;
    requestId: string;
    mode: "commit" | "rollback";
  },
): Promise<void> {
  await writeAuditEvent(transaction, {
    organizationId: input.organizationId,
    action: "platform.database_smoke",
    requestId: input.requestId,
    metadata: {
      mode: input.mode,
    },
  });
}

export function countDatabaseSmokeAudits(
  prisma: PrismaClient,
  requestId: string,
): Promise<number> {
  return prisma.auditEvent.count({
    where: {
      requestId,
      action: "platform.database_smoke",
    },
  });
}

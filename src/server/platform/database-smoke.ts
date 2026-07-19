import type { PrismaClient } from "@/generated/prisma/client";
import {
  countDatabaseSmokeAudits,
  createDatabaseSmokeAudit,
  findOrganizationIdByCode,
} from "@/server/platform/platform-repository";

class RollbackRequested extends Error {}

export type DatabaseSmokeMode = "commit" | "rollback";

export type DatabaseSmokeResult = {
  mode: DatabaseSmokeMode;
  transaction: "committed" | "rolled-back";
  persistedAuditEvents: number;
};

export async function runDatabaseSmoke(
  prisma: PrismaClient,
  input: {
    mode: DatabaseSmokeMode;
    requestId: string;
  },
): Promise<DatabaseSmokeResult> {
  try {
    await prisma.$transaction(async (transaction) => {
      const organizationId = await findOrganizationIdByCode(
        transaction,
        "LOCAL_DEV",
      );
      if (!organizationId) {
        throw new Error("Seed organization is missing.");
      }

      await createDatabaseSmokeAudit(transaction, {
        organizationId,
        requestId: input.requestId,
        mode: input.mode,
      });

      if (input.mode === "rollback") {
        throw new RollbackRequested();
      }
    });
  } catch (error) {
    if (!(error instanceof RollbackRequested)) throw error;
  }

  const persistedAuditEvents = await countDatabaseSmokeAudits(
    prisma,
    input.requestId,
  );

  return {
    mode: input.mode,
    transaction: input.mode === "commit" ? "committed" : "rolled-back",
    persistedAuditEvents,
  };
}

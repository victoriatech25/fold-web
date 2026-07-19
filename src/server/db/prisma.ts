import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { readDatabaseRuntimeConfig } from "@/server/config/database-env";

type PrismaGlobal = typeof globalThis & {
  foldWebPrisma?: PrismaClient;
};

const prismaGlobal = globalThis as PrismaGlobal;

function createPrismaClient(): PrismaClient {
  const config = readDatabaseRuntimeConfig();
  const adapter = new PrismaPg({
    connectionString: config.connectionString,
    max: config.connectionLimit,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    idleTimeoutMillis: config.idleTimeoutMs,
    statement_timeout: config.statementTimeoutMs,
    application_name: "fold_web",
  });

  return new PrismaClient({
    adapter,
    transactionOptions: {
      maxWait: 2_000,
      timeout: 5_000,
    },
  });
}

export function getPrisma(): PrismaClient {
  prismaGlobal.foldWebPrisma ??= createPrismaClient();
  return prismaGlobal.foldWebPrisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (!prismaGlobal.foldWebPrisma) return;

  await prismaGlobal.foldWebPrisma.$disconnect();
  delete prismaGlobal.foldWebPrisma;
}

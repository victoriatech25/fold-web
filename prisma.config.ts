import "dotenv/config";

import { defineConfig } from "prisma/config";

const localMigrationUrl =
  "postgresql://fold_web_migrator@127.0.0.1:5432/fold_web_dev?schema=public";
const localShadowUrl =
  "postgresql://fold_web_migrator@127.0.0.1:5432/fold_web_shadow?schema=public";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url:
      process.env.MIGRATION_DATABASE_URL ??
      process.env.DATABASE_URL ??
      localMigrationUrl,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL ?? localShadowUrl,
  },
});

import { spawnSync } from "node:child_process";
import pg from "pg";

const migrationUrl =
  process.env.TEST_MIGRATION_DATABASE_URL ??
  "postgresql://fold_web_migrator@127.0.0.1:5432/fold_web_test?schema=public";
const applicationUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://fold_web_app@127.0.0.1:5432/fold_web_test?schema=public";
const shadowUrl =
  process.env.SHADOW_DATABASE_URL ??
  "postgresql://fold_web_migrator@127.0.0.1:5432/fold_web_shadow?schema=public";

const databaseName = new URL(migrationUrl).pathname.slice(1);
if (databaseName !== "fold_web_test") {
  throw new Error(
    `Refusing to reset unexpected database: ${databaseName || "(empty)"}`,
  );
}

const environment = {
  ...process.env,
  MIGRATION_DATABASE_URL: migrationUrl,
  DATABASE_URL: applicationUrl,
  SHADOW_DATABASE_URL: shadowUrl,
};

function runPrisma(arguments_) {
  const result = spawnSync("npm", ["exec", "--", "prisma", ...arguments_], {
    env: {
      ...environment,
    },
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

runPrisma(["migrate", "reset", "--force"]);

const administrativeUrl = new URL(migrationUrl);
administrativeUrl.searchParams.delete("schema");
const client = new pg.Client({ connectionString: administrativeUrl.toString() });

try {
  await client.connect();
  await client.query(`
    GRANT USAGE ON SCHEMA public TO fold_web_app, fold_web_readonly;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fold_web_app;
    REVOKE UPDATE, DELETE ON TABLE "AuditEvent" FROM fold_web_app;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO fold_web_readonly;
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO fold_web_app;
    GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO fold_web_readonly;
  `);
} finally {
  await client.end();
}

runPrisma(["db", "seed"]);

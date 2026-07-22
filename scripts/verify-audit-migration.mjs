import { readFile } from "node:fs/promises";
import pg from "pg";

const connectionString =
  process.env.TEST_MIGRATION_DATABASE_URL ??
  "postgresql://fold_web_migrator@127.0.0.1:5432/fold_web_test?schema=public";
const databaseName = new URL(connectionString).pathname.slice(1);
const schema = "audit_upgrade_verification";

if (databaseName !== "fold_web_test") {
  throw new Error(
    `Refusing to run audit migration verification on ${databaseName || "(empty)"}.`,
  );
}

const administrativeUrl = new URL(connectionString);
administrativeUrl.searchParams.delete("schema");
const client = new pg.Client({ connectionString: administrativeUrl.toString() });
const migrations = [
  "prisma/migrations/20260719095500_init/migration.sql",
  "prisma/migrations/20260719134355_auth_throttle/migration.sql",
];

async function main() {
  await client.connect();
  await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET search_path TO ${schema}`);

  try {
    for (const migration of migrations) {
      await client.query(await readFile(migration, "utf8"));
    }
    await client.query(`
      INSERT INTO "Organization" (id, code, name, "updatedAt")
      VALUES ('10000000-0000-4000-8000-000000000001', 'AUDIT_UPGRADE', '감사 업그레이드 검증', NOW());
      INSERT INTO "User" (id, email, "normalizedEmail", "displayName", status, "updatedAt")
      VALUES (
        '10000000-0000-4000-8000-000000000002',
        'legacy-actor@example.test',
        'legacy-actor@example.test',
        '기존 행위자',
        'ACTIVE',
        NOW()
      );
      INSERT INTO "AuditEvent" (
        id, "organizationId", "actorUserId", action, "entityType", "requestId", metadata
      ) VALUES (
        '10000000-0000-4000-8000-000000000003',
        '10000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000002',
        'auth.login_failed',
        'User',
        'legacy-request',
        '{"legacy":true}'::jsonb
      );
    `);
    await client.query(
      await readFile(
        "prisma/migrations/20260720090000_audit_event_v2/migration.sql",
        "utf8",
      ),
    );

    const result = await client.query(`
      SELECT
        "schemaVersion",
        category::text,
        outcome::text,
        source::text,
        "actorDisplayName",
        "actorEmail",
        metadata
      FROM "AuditEvent"
      WHERE id = '10000000-0000-4000-8000-000000000003'
    `);
    const row = result.rows[0];
    if (
      !row ||
      row.schemaVersion !== 1 ||
      row.category !== "AUTHENTICATION" ||
      row.outcome !== "DENIED" ||
      row.source !== "WEB" ||
      row.actorDisplayName !== "기존 행위자" ||
      row.actorEmail !== "legacy-actor@example.test" ||
      row.metadata?.legacy !== true
    ) {
      throw new Error(`Unexpected audit backfill result: ${JSON.stringify(row)}`);
    }

    try {
      await client.query(`
        UPDATE "AuditEvent"
        SET "requestId" = 'tampered'
        WHERE id = '10000000-0000-4000-8000-000000000003'
      `);
      throw new Error("Audit append-only trigger did not reject the update.");
    } catch (error) {
      if (error instanceof Error && error.message.includes("did not reject")) {
        throw error;
      }
      if (typeof error !== "object" || error === null || error.code !== "55000") {
        throw error;
      }
    }
    process.stdout.write("Audit v1 to v2 migration verification passed.\n");
  } finally {
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
}

main().catch((error) => {
  console.error("Audit migration verification failed.", error);
  process.exitCode = 1;
});

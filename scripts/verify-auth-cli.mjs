import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

import pg from "pg";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://fold_web_app@127.0.0.1:5432/fold_web_test?schema=public";
const environment = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  APP_ORIGIN: "http://127.0.0.1:3100",
};
const email = "cli-admin@example.test";
const password = "CLI verification phrase 2026!";

function runNpm(arguments_, options = {}) {
  return spawnSync("npm", arguments_, {
    cwd: process.cwd(),
    env: environment,
    encoding: "utf8",
    ...options,
  });
}

const bootstrap = runNpm(
  [
    "run",
    "auth:bootstrap-admin",
    "--",
    "--email",
    email,
    "--name",
    "CLI 검증 관리자",
  ],
  { input: password },
);
if (bootstrap.status !== 0 || bootstrap.stdout.includes(password)) {
  throw new Error(`Bootstrap CLI verification failed: ${bootstrap.stderr}`);
}

const duplicate = runNpm(
  [
    "run",
    "auth:bootstrap-admin",
    "--",
    "--email",
    email,
    "--name",
    "CLI 검증 관리자",
  ],
  { input: password },
);
if (duplicate.status === 0 || !duplicate.stderr.includes("already exists")) {
  throw new Error("Bootstrap CLI did not reject an existing account.");
}

const issue = runNpm([
  "run",
  "auth:issue-password-reset",
  "--",
  "--email",
  email,
]);
if (issue.status !== 0) {
  throw new Error(`Reset CLI verification failed: ${issue.stderr}`);
}
const resetUrlMatch = issue.stdout.match(/http:\/\/127\.0\.0\.1:3100\/reset-password\?token=([A-Za-z0-9_-]{43})/);
if (!resetUrlMatch) throw new Error("Reset CLI did not emit one valid URL.");
const rawToken = resetUrlMatch[1];
const expectedHash = createHash("sha256").update(rawToken).digest("hex");

const client = new pg.Client({ connectionString: databaseUrl });
try {
  await client.connect();
  const result = await client.query(
    `SELECT prt."tokenHash", u."normalizedEmail"
       FROM "PasswordResetToken" prt
       JOIN "User" u ON u.id = prt."userId"
      WHERE u."normalizedEmail" = $1`,
    [email],
  );
  if (
    result.rowCount !== 1 ||
    result.rows[0].tokenHash !== expectedHash ||
    result.rows[0].tokenHash === rawToken
  ) {
    throw new Error("Reset token was not stored exclusively as its hash.");
  }
} finally {
  await client.end();
}

process.stdout.write(
  "Authentication CLI verification passed without exposing stored secrets.\n",
);

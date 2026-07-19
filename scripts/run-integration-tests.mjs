import { spawnSync } from "node:child_process";

const applicationUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://fold_web_app@127.0.0.1:5432/fold_web_test?schema=public";

function run(command, arguments_, environment = process.env) {
  const result = spawnSync(command, arguments_, {
    env: environment,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("npm", ["run", "db:test:reset"]);
run("node", ["scripts/verify-auth-cli.mjs"], {
  ...process.env,
  TEST_DATABASE_URL: applicationUrl,
});
run(
  "npm",
  [
    "exec",
    "--",
    "vitest",
    "run",
    "src/server/platform/database-smoke.integration.test.ts",
    "src/server/auth/auth.integration.test.ts",
    "src/server/admin/admin.integration.test.ts",
  ],
  {
    ...process.env,
    RUN_DB_INTEGRATION: "1",
    DATABASE_URL: applicationUrl,
  },
);

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
run("node", ["scripts/verify-audit-migration.mjs"]);
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
    "src/server/company-settings/company-settings.integration.test.ts",
    "src/server/customers/customer.integration.test.ts",
    "src/server/orders/order.integration.test.ts",
    "src/server/orders/order-fold.integration.test.ts",
    "src/server/materials/material.integration.test.ts",
    "src/server/material-rules/material-rule.integration.test.ts",
    "src/server/pricing/pricing.integration.test.ts",
    "src/server/sheet-items/sheet-item.integration.test.ts",
    "src/server/audit/audit.integration.test.ts",
    "src/server/fold-document/fold-document.integration.test.ts",
    "src/server/fold-draft/fold-draft.integration.test.ts",
    "src/server/fold-library/fold-library.integration.test.ts",
    "src/server/jobs/job.integration.test.ts",
  ],
  {
    ...process.env,
    RUN_DB_INTEGRATION: "1",
    DATABASE_URL: applicationUrl,
  },
);

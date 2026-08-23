import { spawnSync } from "node:child_process";

const applicationUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://fold_web_app@127.0.0.1:5432/fold_web_test?schema=public";

// 저장소 통합 테스트는 compose 의 `storage` 서비스를 기본값으로 본다.
const storageEnvironment = {
  STORAGE_ENDPOINT: process.env.STORAGE_ENDPOINT ?? "http://127.0.0.1:9000",
  STORAGE_REGION: process.env.STORAGE_REGION ?? "us-east-1",
  STORAGE_BUCKET: process.env.STORAGE_BUCKET ?? "fold-web-test",
  STORAGE_ACCESS_KEY_ID: process.env.STORAGE_ACCESS_KEY_ID ?? "fold-web-local",
  STORAGE_SECRET_ACCESS_KEY: process.env.STORAGE_SECRET_ACCESS_KEY ?? "fold-web-local-secret",
  STORAGE_FORCE_PATH_STYLE: process.env.STORAGE_FORCE_PATH_STYLE ?? "true",
};

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
    "src/server/files/file.integration.test.ts",
    "src/server/storage/storage.integration.test.ts",
  ],
  {
    ...process.env,
    RUN_DB_INTEGRATION: "1",
    // 저장소 통합은 compose 의 `storage` 서비스가 떠 있을 때만 돈다.
    RUN_STORAGE_INTEGRATION: process.env.RUN_STORAGE_INTEGRATION ?? "1",
    ...storageEnvironment,
    DATABASE_URL: applicationUrl,
  },
);

// 작업 queue 는 조직을 가리지 않는 전역 자원이다. `processNextJob` 을 쓰는 파일을
// 병렬로 돌리면 서로의 작업을 집어 간다. 이 묶음만 파일 병렬 없이 따로 돌린다.
run(
  "npm",
  [
    "exec",
    "--",
    "vitest",
    "run",
    "--no-file-parallelism",
    "src/server/jobs/job.integration.test.ts",
    "src/server/cutting/cutting-plan.integration.test.ts",
  ],
  {
    ...process.env,
    RUN_DB_INTEGRATION: "1",
    RUN_STORAGE_INTEGRATION: process.env.RUN_STORAGE_INTEGRATION ?? "1",
    ...storageEnvironment,
    DATABASE_URL: applicationUrl,
  },
);

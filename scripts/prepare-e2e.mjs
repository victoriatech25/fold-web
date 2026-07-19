import { spawnSync } from "node:child_process";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://fold_web_app@127.0.0.1:5432/fold_web_test?schema=public";
const environment = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  TEST_DATABASE_URL: databaseUrl,
};

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: process.cwd(),
    env: environment,
    encoding: "utf8",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
}

run("npm", ["run", "db:test:reset"]);
run(
  "npm",
  [
    "run",
    "auth:bootstrap-admin",
    "--",
    "--email",
    "e2e-admin@example.test",
    "--name",
    "브라우저 검증 관리자",
  ],
  { input: "Browser verification phrase 2026!" },
);

process.stdout.write("Playwright test database and account are ready.\n");

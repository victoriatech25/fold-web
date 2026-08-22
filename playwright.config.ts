import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3100";
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://fold_web_app@127.0.0.1:5432/fold_web_test?schema=public";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    url: `${baseURL}/api/health`,
    // Never attach the suite to an unrelated local app that happens to own
    // the test port and expose a health endpoint.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: testDatabaseUrl,
      APP_ORIGIN: baseURL,
      AUTH_RATE_LIMIT_SECRET:
        "playwright-rate-limit-secret-000000000000",
      AUTH_TRUST_PROXY: "false",
      // 파일 저장소(P2-B02). compose 의 `storage` 서비스를 그대로 쓴다.
      STORAGE_ENDPOINT: process.env.STORAGE_ENDPOINT ?? "http://127.0.0.1:9000",
      STORAGE_REGION: process.env.STORAGE_REGION ?? "us-east-1",
      STORAGE_BUCKET: process.env.STORAGE_BUCKET ?? "fold-web-e2e",
      STORAGE_ACCESS_KEY_ID: process.env.STORAGE_ACCESS_KEY_ID ?? "fold-web-local",
      STORAGE_SECRET_ACCESS_KEY: process.env.STORAGE_SECRET_ACCESS_KEY ?? "fold-web-local-secret",
      STORAGE_FORCE_PATH_STYLE: "true",
    },
  },
});

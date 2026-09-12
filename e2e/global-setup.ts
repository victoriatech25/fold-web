import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";

/**
 * E2E 동안 작업 worker 를 함께 띄운다(`P2-B11`). 재단 결과가 있어야 편집기를 검증할
 * 수 있는데, 재단 계산은 큐를 타므로 worker 가 없으면 영원히 `계산 중`이다.
 * 웹 서버와 같은 테스트 DB 를 본다. dotenv 는 이미 있는 값을 덮어쓰지 않는다.
 */
export default async function globalSetup() {
  const databaseUrl =
    process.env.TEST_DATABASE_URL ??
    "postgresql://fold_web_app@127.0.0.1:5432/fold_web_test?schema=public";
  mkdirSync("test-results", { recursive: true });
  const log = openSync("test-results/e2e-worker.log", "w");
  const worker = spawn("npm", ["run", "worker"], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      WORKER_ID: "e2e-worker",
      WORKER_IDLE_POLL_MS: "500",
    },
    stdio: ["ignore", log, log],
    shell: process.platform === "win32",
  });

  return async () => {
    if (worker.exitCode === null) {
      worker.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          worker.kill("SIGKILL");
          resolve();
        }, 10_000);
        worker.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  };
}

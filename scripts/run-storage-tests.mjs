import { spawnSync } from "node:child_process";

// `RUN_STORAGE_INTEGRATION=1 vitest …` 는 POSIX 셸 문법이라 Windows cmd 에서 깨진다
// (2026-09-08 점검 M1). 환경변수를 여기서 넣고 vitest 를 부른다.
const result = spawnSync("npm", ["exec", "--", "vitest", "run", "src/server/storage"], {
  env: { ...process.env, RUN_STORAGE_INTEGRATION: "1" },
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);

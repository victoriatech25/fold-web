import { hostname } from "node:os";

import { disconnectPrisma, getPrisma } from "@/server/db/prisma";
import { purgeFinishedJobs, reclaimExpiredLeases } from "@/server/jobs/job-runtime";
import { jobTypes } from "@/server/jobs/job-registry";
import { processNextJob } from "@/server/jobs/job-worker";

let running = true;
let activeJob = false;
let workerId = "worker";

function log(event: string, fields: Record<string, unknown> = {}) {
  // 구조화 로그. 운영 로그 수집 제품은 P2-C10에서 정한다.
  console.log(JSON.stringify({ at: new Date().toISOString(), worker: workerId, event, ...fields }));
}

function sleep(ms: number) {
  // unref 하지 않는다. DB 접속이 실패해 열린 핸들이 없으면 대기 타이머만이 프로세스를
  // 붙들어 두는데, unref 하면 첫 오류 뒤 아무 로그 없이 종료 코드 0 으로 사라졌다.
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * 운영 컨테이너는 환경변수를 직접 받고 번들에 dotenv를 담지 않는다. 로컬에서만
 * Next.js와 같은 파일을 읽어 웹과 worker가 같은 DB를 보게 한다.
 *
 * top-level await로 부르지 않는다. 개발 실행 경로(tsx)가 CJS로 변환해서 top-level
 * await를 지원하지 않기 때문이다.
 */
async function loadLocalEnvironment() {
  if (process.env.NODE_ENV === "production") return;
  const { config } = await import("dotenv");
  config({ path: [".env.local", ".env"], quiet: true });
}

/**
 * 종료 신호를 받으면 새 작업을 잡지 않고, 지금 돌고 있는 작업이 끝날 때까지
 * 기다린 뒤 내려간다. 중간에 끊긴 작업은 lease 만료로 회수되므로 유실되지 않는다.
 */
function installShutdownHandlers() {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      if (!running) return;
      running = false;
      log("shutdown_requested", { signal, activeJob });
    });
  }
}

async function main() {
  await loadLocalEnvironment();

  const idlePollMs = Number(process.env.WORKER_IDLE_POLL_MS ?? 2_000);
  const maintenanceIntervalMs = Number(process.env.WORKER_MAINTENANCE_INTERVAL_MS ?? 60_000);
  // 반복문 오류(대개 DB 접속 실패)가 이만큼 잇따르면 내려간다. 컨테이너 restart 정책이
  // 다시 띄우고, `docker ps` 에서도 문제가 보인다. 영원히 `Up` 인 채 아무것도 못 하는
  // 상태를 막는다(2026-09-08 점검 M3). 0 이면 끄지 않는다.
  const maxConsecutiveErrors = Number(process.env.WORKER_MAX_CONSECUTIVE_ERRORS ?? 10);
  const retentionDays = Number(process.env.WORKER_JOB_RETENTION_DAYS ?? 90);
  workerId = `${process.env.WORKER_ID ?? hostname()}-${process.pid}`;
  // 비워 두면 등록된 종류를 전부 잡는다. 종류를 나눠 띄울 때(예: 재단 전용 worker) 쓴다.
  const types = (process.env.WORKER_JOB_TYPES ?? "")
    .split(",")
    .map((type) => type.trim())
    .filter((type) => type.length > 0);
  const unknown = types.filter((type) => !jobTypes.includes(type));
  if (unknown.length > 0) throw new Error(`알 수 없는 작업 종류: ${unknown.join(", ")}`);

  installShutdownHandlers();
  log("worker_started", { types: types.length > 0 ? types : jobTypes, idlePollMs, retentionDays });

  let lastMaintenance = 0;
  let consecutiveErrors = 0;
  while (running) {
    try {
      if (Date.now() - lastMaintenance >= maintenanceIntervalMs) {
        const reclaimed = await reclaimExpiredLeases(getPrisma());
        if (reclaimed > 0) log("leases_reclaimed", { count: reclaimed });
        const purged = await purgeFinishedJobs(getPrisma(), { retentionDays });
        if (purged > 0) log("jobs_purged", { count: purged, retentionDays });
        lastMaintenance = Date.now();
      }
      activeJob = true;
      const processed = await processNextJob(getPrisma(), workerId, { types });
      activeJob = false;
      consecutiveErrors = 0;
      if (processed) {
        log("job_processed", processed);
        continue;
      }
    } catch (error) {
      activeJob = false;
      consecutiveErrors += 1;
      // DB가 잠시 끊긴 정도는 다음 주기에 다시 시도한다. 계속 실패하면 내려간다.
      log("worker_loop_error", {
        message: error instanceof Error ? error.message : String(error),
        consecutiveErrors,
      });
      if (maxConsecutiveErrors > 0 && consecutiveErrors >= maxConsecutiveErrors) {
        log("worker_giving_up", { consecutiveErrors });
        await disconnectPrisma().catch(() => undefined);
        process.exit(1);
      }
    }
    if (running) await sleep(idlePollMs);
  }

  log("worker_stopped");
  await disconnectPrisma();
}

main().catch(async (error) => {
  log("worker_fatal", { message: error instanceof Error ? error.message : String(error) });
  await disconnectPrisma().catch(() => undefined);
  process.exitCode = 1;
});

import { readdir } from "node:fs/promises";
import path from "node:path";

import type { PrismaClient } from "@/generated/prisma/client";

// 컨테이너 헬스체크가 실제로 DB 를 보게 하는 검사다. 이전에는 `/api/health` 가
// 무조건 ok 를 돌려줘서 DB 접속 실패·마이그레이션 미적용을 배포 게이트가
// 하나도 잡지 못했다(2026-09-08 점검 H4).

export type HealthCheckStatus = "ok" | "error";

export type HealthCheckResult = {
  status: HealthCheckStatus;
  checks: {
    database: { status: HealthCheckStatus; message?: string };
    migrations: {
      status: HealthCheckStatus;
      // 이미지에 들어 있는 마이그레이션 수. DB 에 적용된 것과 같아야 한다.
      expected: number;
      applied: number;
      pending: number;
      failed: number;
      message?: string;
    };
  };
};

export type MigrationRow = {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};

export function resolveMigrationsDirectory(): string {
  return (
    process.env.PRISMA_MIGRATIONS_DIR ??
    path.join(process.cwd(), "prisma", "migrations")
  );
}

export async function listLocalMigrations(
  directory = resolveMigrationsDirectory(),
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

// 이미지의 마이그레이션 목록과 `_prisma_migrations` 를 대조한다.
// 순수 함수라 DB 없이 검증한다. 이름은 응답에 싣지 않고 호출자가 로그로 남긴다.
export function compareMigrations(
  local: readonly string[],
  rows: readonly MigrationRow[],
): HealthCheckResult["checks"]["migrations"] & {
  pendingNames: string[];
  failedNames: string[];
} {
  const applied = new Set<string>();
  const failedNames: string[] = [];
  for (const row of rows) {
    if (row.rolled_back_at) continue;
    if (row.finished_at) applied.add(row.migration_name);
    else failedNames.push(row.migration_name);
  }

  const pendingNames = local.filter((name) => !applied.has(name));
  const status: HealthCheckStatus =
    pendingNames.length === 0 && failedNames.length === 0 ? "ok" : "error";

  return {
    status,
    expected: local.length,
    applied: local.filter((name) => applied.has(name)).length,
    pending: pendingNames.length,
    failed: failedNames.length,
    pendingNames,
    failedNames,
    ...(status === "ok"
      ? {}
      : {
          message:
            "적용되지 않았거나 실패한 마이그레이션이 있습니다. `prisma migrate deploy` 를 먼저 실행해 주세요.",
        }),
  };
}

// Prisma 오류 메시지는 여러 줄이라 로그 한 줄에 맞게 접는다.
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim();
}

export async function runHealthCheck(
  prisma: PrismaClient,
  options: { migrationsDirectory?: string; log?: (message: string) => void } = {},
): Promise<HealthCheckResult> {
  const log = options.log ?? ((message) => console.error(message));

  let database: HealthCheckResult["checks"]["database"];
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = { status: "ok" };
  } catch (error) {
    database = { status: "error", message: describeError(error) };
    log(`[health] database check failed: ${database.message}`);
  }

  let migrations: HealthCheckResult["checks"]["migrations"];
  if (database.status !== "ok") {
    migrations = {
      status: "error",
      expected: 0,
      applied: 0,
      pending: 0,
      failed: 0,
      message: "DB 에 접속하지 못해 마이그레이션 상태를 확인할 수 없습니다.",
    };
  } else {
    try {
      const local = await listLocalMigrations(options.migrationsDirectory);
      const rows = await prisma.$queryRaw<MigrationRow[]>`
        SELECT "migration_name", "finished_at", "rolled_back_at"
        FROM "_prisma_migrations"
      `;
      const { pendingNames, failedNames, ...comparison } = compareMigrations(
        local,
        rows,
      );
      migrations = comparison;
      if (pendingNames.length > 0) {
        log(`[health] pending migrations: ${pendingNames.join(", ")}`);
      }
      if (failedNames.length > 0) {
        log(`[health] failed migrations: ${failedNames.join(", ")}`);
      }
    } catch (error) {
      migrations = {
        status: "error",
        expected: 0,
        applied: 0,
        pending: 0,
        failed: 0,
        message: describeError(error),
      };
      log(`[health] migration check failed: ${migrations.message}`);
    }
  }

  return {
    status:
      database.status === "ok" && migrations.status === "ok" ? "ok" : "error",
    checks: { database, migrations },
  };
}

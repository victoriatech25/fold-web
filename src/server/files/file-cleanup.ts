import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { writeAuditEvent } from "@/server/audit/audit-writer";
import { fileKindPolicies } from "@/server/files/file-kind";
import { deleteGraceDays, regenerableRetentionDays } from "@/server/files/file-service";
import type { FileStorage } from "@/server/storage/file-storage";
import { getFileStorage } from "@/server/storage/s3-file-storage";

export type StorageCleanupInput = {
  organizationId: string;
  requestId: string;
  now?: Date;
  graceDays?: number;
  retentionDays?: number;
  /** 한 번에 지울 최대 건수. 큐가 한 작업에 오래 붙잡히지 않게 한다. */
  limit?: number;
};

export type StorageCleanupResult = {
  purgedDeleted: number;
  purgedExpired: number;
  failed: number;
  scanned: number;
};

function isPurged(metadata: unknown): boolean {
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    !Array.isArray(metadata) &&
    "purgedAt" in (metadata as Record<string, unknown>)
  );
}

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1_000);
}

const regenerableKinds = Object.entries(fileKindPolicies)
  .filter(([, policy]) => policy.regenerable)
  .map(([kind]) => kind as keyof typeof fileKindPolicies);

/**
 * 유예가 끝난 soft delete 와 보존 기간이 지난 재생성 가능 산출물을 실제로 지운다
 * (`D2-B02-I`, `D2-B02-J`). 원본밖에 없는 업로드본은 자동으로 지우지 않는다.
 */
export async function runStorageCleanup(
  database: PrismaClient,
  input: StorageCleanupInput,
  storage: FileStorage = getFileStorage(),
): Promise<StorageCleanupResult> {
  const now = input.now ?? new Date();
  const graceDays = input.graceDays ?? deleteGraceDays;
  const retentionDays = input.retentionDays ?? regenerableRetentionDays;
  const limit = input.limit ?? 200;

  // Prisma 의 JSON 경로 필터로는 "키가 없음"을 표현할 수 없어 코드에서 거른다.
  // 이미 정리한 행을 다시 지우려 하면 저장소 호출만 낭비된다.
  const deletedCandidates = await database.fileAsset.findMany({
    where: {
      organizationId: input.organizationId,
      deletedAt: { not: null, lt: daysAgo(now, graceDays) },
    },
    select: { id: true, kind: true, storageKey: true, metadata: true },
    take: limit * 2,
    orderBy: { deletedAt: "asc" },
  });
  const deletedTargets = deletedCandidates
    .filter((row) => !isPurged(row.metadata))
    .slice(0, limit);

  const expiredTargets = await database.fileAsset.findMany({
    where: {
      organizationId: input.organizationId,
      deletedAt: null,
      status: "READY",
      kind: { in: regenerableKinds },
      createdAt: { lt: daysAgo(now, retentionDays) },
    },
    select: { id: true, kind: true, storageKey: true, metadata: true },
    take: Math.max(0, limit - deletedTargets.length),
    orderBy: { createdAt: "asc" },
  });

  const result: StorageCleanupResult = {
    purgedDeleted: 0,
    purgedExpired: 0,
    failed: 0,
    scanned: deletedTargets.length + expiredTargets.length,
  };

  for (const [targets, reason] of [
    [deletedTargets, "DELETED_GRACE_EXPIRED"] as const,
    [expiredTargets, "RETENTION_EXPIRED"] as const,
  ]) {
    for (const target of targets) {
      try {
        await storage.delete(target.storageKey);
      } catch {
        // 객체 삭제가 실패하면 행은 그대로 두고 다음 실행에서 다시 시도한다.
        result.failed += 1;
        continue;
      }
      const metadata =
        target.metadata && typeof target.metadata === "object" && !Array.isArray(target.metadata)
          ? (target.metadata as Record<string, unknown>)
          : {};
      await database.fileAsset.update({
        where: { id: target.id },
        data: {
          status: "DELETED",
          deletedAt: reason === "RETENTION_EXPIRED" ? now : undefined,
          // 행은 남긴다. 무엇이 있었는지 추적할 수 있어야 한다.
          metadata: { ...metadata, purgedAt: now.toISOString(), purgeReason: reason },
        },
      });
      await writeAuditEvent(database, {
        organizationId: input.organizationId,
        actorUserId: null,
        action: "file.purged",
        entityId: target.id,
        requestId: input.requestId,
        source: "SYSTEM",
        metadata: { kind: target.kind, reason },
      });
      if (reason === "DELETED_GRACE_EXPIRED") result.purgedDeleted += 1;
      else result.purgedExpired += 1;
    }
  }

  return result;
}

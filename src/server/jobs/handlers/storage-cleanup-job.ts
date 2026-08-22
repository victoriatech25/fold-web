import "server-only";

import { z } from "zod";

import { runStorageCleanup } from "@/server/files/file-cleanup";
import { JobExecutionError } from "../job-error";
import { defineJob } from "../job-registry";

const payloadSchema = z.strictObject({
  graceDays: z.number().int().min(0).max(365).optional(),
  retentionDays: z.number().int().min(1).max(3650).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});

/**
 * 종료된 파일 정리를 queue 자신의 작업으로 돌린다(`D2-B02-K`).
 * 별도 cron 을 만들면 재시도·감사·관측을 다시 만들어야 한다.
 */
export const storageCleanupJob = defineJob({
  type: "storage.cleanup",
  label: "파일 저장소 정리",
  permission: "admin.manage",
  payloadSchema,
  maxAttempts: 3,
  leaseSeconds: 300,
  summarize: (payload) =>
    `유예 ${payload.graceDays ?? 30}일 · 보존 ${payload.retentionDays ?? 90}일`,
  run: async (database, context, payload) => {
    try {
      const result = await runStorageCleanup(database, {
        organizationId: context.actor.organizationId,
        requestId: context.requestId,
        graceDays: payload.graceDays,
        retentionDays: payload.retentionDays,
        limit: payload.limit,
      });
      await context.reportProgress(100);
      return { ...result };
    } catch (error) {
      // 저장소 장애는 일시적일 수 있으므로 재시도 대상으로 둔다.
      throw new JobExecutionError("파일 저장소를 정리하지 못했습니다.", true, error);
    }
  },
});

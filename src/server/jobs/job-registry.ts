import "server-only";

import { z } from "zod";

import type { PermissionKey } from "@/domain/permission";
import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/server/auth/auth-types";

/**
 * 작업이 실행되는 동안 handler가 쓸 수 있는 것들. 진행률 보고와 취소 확인은
 * handler가 스스로 호출한다. 밖에서 실행을 끊지 않는다(`D2-B01-G`).
 */
export type JobRunContext = {
  jobId: string;
  attempt: number;
  requestId: string;
  actor: AuthenticatedContext;
  reportProgress: (percent: number) => Promise<void>;
  isCancelRequested: () => Promise<boolean>;
};

export type JobDefinition<TPayload> = {
  type: string;
  label: string;
  /** 작업 등록과 실행 시점 모두에서 요구하는 업무 권한 (`D2-B01-J`). */
  permission: PermissionKey;
  payloadSchema: z.ZodType<TPayload>;
  maxAttempts: number;
  leaseSeconds: number;
  /** API 응답과 화면에 보여줄 안전한 요약. payload 원문은 내보내지 않는다. */
  summarize: (payload: TPayload) => string;
  run: (
    database: PrismaClient,
    context: JobRunContext,
    payload: TPayload,
  ) => Promise<Record<string, unknown>>;
};

export function defineJob<TPayload>(definition: JobDefinition<TPayload>) {
  return definition;
}

// 모든 작업 종류를 여기에서 명시적으로 모은다. side-effect 등록에 기대면
// import 순서나 tree-shaking에 따라 worker가 종류를 모르는 채로 뜰 수 있다.
// 새 작업 종류는 이 목록에 직접 추가한다.
import { cuttingOptimizeJob } from "./handlers/cutting-optimize-job";
import { dxfExportJob } from "./handlers/dxf-export-job";
import { storageCleanupJob } from "./handlers/storage-cleanup-job";

const catalog = [cuttingOptimizeJob, dxfExportJob, storageCleanupJob] as const;

type AnyJobDefinition = JobDefinition<never>;

const byType = new Map<string, AnyJobDefinition>(
  catalog.map((definition) => [definition.type, definition as unknown as AnyJobDefinition]),
);

export const jobTypes = catalog.map((definition) => definition.type);

export function findJobDefinition(type: string): AnyJobDefinition | null {
  return byType.get(type) ?? null;
}

export function requireJobDefinition(type: string): AnyJobDefinition {
  const definition = byType.get(type);
  if (!definition) throw new Error(`Unknown job type: ${type}`);
  return definition;
}

export function jobTypeLabel(type: string): string {
  return byType.get(type)?.label ?? type;
}

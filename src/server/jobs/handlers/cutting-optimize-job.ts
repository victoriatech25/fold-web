import "server-only";

import { z } from "zod";

import { cuttingInputSchema, type CuttingInput } from "@/domain/cutting/schema";
import {
  CuttingPinError,
  DEFAULT_TIME_BUDGET_MS,
  optimizeCutting,
  type CuttingPin,
} from "@/domain/cutting/solver/optimize";
import { validateCuttingResult } from "@/domain/cutting/validate";
import {
  recordCuttingRevisionFailure,
  recordCuttingRevisionResult,
} from "@/server/cutting/cutting-plan-service";
import type { PrismaClient } from "@/generated/prisma/client";
import { JobExecutionError } from "../job-error";
import { defineJob } from "../job-registry";

const pinSchema = z.strictObject({
  partId: z.string().trim().min(1).max(100),
  sheetIndex: z.number().int().min(0).max(9_999),
});

/**
 * 두 가지로 들어온다.
 *
 * - `cuttingPlanRevisionId`: 재단 작업 화면에서 만든 개정. 입력과 고정 지시는
 *   저장된 개정에서 읽고 결과도 개정에 돌려 쓴다(`P2-B05`).
 * - `input`: 화면 없이 계약만으로 돌리는 형태. `P2-B04` 부터 쓰던 것이고
 *   결과는 작업에만 남는다.
 */
const payloadSchema = z.union([
  z.strictObject({
    cuttingPlanRevisionId: z.uuid(),
    timeBudgetMs: z.number().int().min(100).max(600_000).optional(),
  }),
  z.strictObject({
    input: cuttingInputSchema,
    pins: z.array(pinSchema).max(1_000).optional(),
    timeBudgetMs: z.number().int().min(100).max(600_000).optional(),
  }),
]);

type Payload = z.infer<typeof payloadSchema>;

async function loadRevision(database: PrismaClient, revisionId: string) {
  const revision = await database.cuttingPlanRevision.findUnique({
    where: { id: revisionId },
    select: { id: true, pins: true, cuttingPlan: { select: { input: true } } },
  });
  if (!revision) {
    throw new JobExecutionError("재단 개정을 찾을 수 없습니다.", false);
  }
  const input = cuttingInputSchema.safeParse(revision.cuttingPlan.input);
  if (!input.success) {
    throw new JobExecutionError("재단 입력이 계약과 맞지 않습니다.", false);
  }
  const pins = z.array(pinSchema).safeParse(revision.pins);
  if (!pins.success) {
    throw new JobExecutionError("고정 지시를 읽을 수 없습니다.", false);
  }
  return { input: input.data, pins: pins.data };
}

/**
 * 재단 최적화 작업(`D2-B04-G`).
 *
 * solver 는 결정론이라 같은 입력을 다시 돌려도 결과가 같다. 실패는 입력이
 * 잘못됐다는 뜻이므로 재시도하지 않는다.
 */
export const cuttingOptimizeJob = defineJob({
  type: "cutting.optimize",
  label: "재단 최적화",
  permission: "cutting.optimize",
  payloadSchema,
  maxAttempts: 1,
  leaseSeconds: 300,
  summarize: (payload: Payload) =>
    "cuttingPlanRevisionId" in payload
      ? `재단 개정 ${payload.cuttingPlanRevisionId.slice(0, 8)}…`
      : `부품 ${payload.input.parts.length}종 · 원판 후보 ${payload.input.sheets.length}종`,
  run: async (database, context, payload: Payload) => {
    await context.reportProgress(10);

    let revisionId: string | null = null;
    let input: CuttingInput;
    let pins: CuttingPin[];
    if ("cuttingPlanRevisionId" in payload) {
      revisionId = payload.cuttingPlanRevisionId;
      const loaded = await loadRevision(database as PrismaClient, revisionId);
      input = loaded.input;
      pins = loaded.pins;
    } else {
      input = payload.input;
      pins = payload.pins ?? [];
    }

    let result;
    try {
      result = optimizeCutting(input, {
        timeBudgetMs: payload.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS,
        pins,
      });
    } catch (error) {
      if (error instanceof CuttingPinError) {
        if (revisionId) {
          await recordCuttingRevisionFailure(database, { revisionId, reason: error.message });
        }
        throw new JobExecutionError(error.message, false, error);
      }
      throw error;
    }

    // 합격 기준이 제약 위반 0건이다(`D2-B04-H`). 자동이든 고정 지시가 붙었든 같다.
    const violations = validateCuttingResult(input, result);
    if (violations.length > 0) {
      const reason = `재단 결과가 제약을 위반했습니다: ${violations.map((item) => item.code).join(", ")}`;
      if (revisionId) {
        await recordCuttingRevisionFailure(database, { revisionId, reason });
      }
      throw new JobExecutionError(reason, false);
    }

    if (revisionId) {
      await recordCuttingRevisionResult(database, { revisionId, result });
    }
    await context.reportProgress(100);
    return { ...result };
  },
});

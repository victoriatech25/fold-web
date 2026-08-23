import "server-only";

import { z } from "zod";

import { cuttingInputSchema } from "@/domain/cutting/schema";
import { DEFAULT_TIME_BUDGET_MS, optimizeCutting } from "@/domain/cutting/solver/optimize";
import { validateCuttingResult } from "@/domain/cutting/validate";
import { JobExecutionError } from "../job-error";
import { defineJob } from "../job-registry";

const payloadSchema = z.strictObject({
  input: cuttingInputSchema,
  /** 탐색 시간 상한(`D2-B04-I`). 생략하면 30초를 쓴다. */
  timeBudgetMs: z.number().int().min(100).max(600_000).optional(),
});

/**
 * 재단 최적화 작업(`D2-B04-G`).
 *
 * 결과는 `JobQueue.result` 에만 남긴다. 재단 결과 전용 모델은 화면 요구가
 * 정해지는 `P2-B05` 에서 함께 만든다(`D2-B04-J`).
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
  summarize: (payload) =>
    `부품 ${payload.input.parts.length}종 · 원판 후보 ${payload.input.sheets.length}종`,
  run: async (_database, context, payload) => {
    await context.reportProgress(10);

    const result = optimizeCutting(payload.input, {
      timeBudgetMs: payload.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS,
    });

    // 합격 기준이 제약 위반 0건이다(`D2-B04-H`). 잘못된 배치를 성공으로 남기면
    // 현장에서 발견된다.
    const violations = validateCuttingResult(payload.input, result);
    if (violations.length > 0) {
      throw new JobExecutionError(
        `재단 결과가 제약을 위반했습니다: ${violations.map((item) => item.code).join(", ")}`,
        false,
      );
    }

    await context.reportProgress(100);
    return { ...result };
  },
});

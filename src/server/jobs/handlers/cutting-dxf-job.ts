import "server-only";

import { z } from "zod";

import { CuttingError } from "@/server/cutting/cutting-error";
import { generateCuttingRevisionDxf } from "@/server/cutting/cutting-dxf-service";
import { JobExecutionError } from "../job-error";
import { defineJob } from "../job-registry";

const payloadSchema = z.strictObject({
  cuttingPlanId: z.uuid(),
  cuttingPlanRevisionId: z.uuid(),
});

/**
 * 재단 개정의 원판별 장비용 DXF 를 만들어 보관한다(`P2-B11` 4.7). 원판 수십 장 ×
 * 부품 절곡선이라 동기 응답 대신 큐로 돈다. 같은 개정은 파일이 이미 있으면 다시 만들지 않는다.
 */
export const cuttingDxfJob = defineJob({
  type: "cutting.dxf",
  label: "재단 DXF 생성",
  permission: "cutting.optimize",
  payloadSchema,
  maxAttempts: 3,
  leaseSeconds: 300,
  summarize: (payload) => `재단 개정 ${payload.cuttingPlanRevisionId.slice(0, 8)}…`,
  run: async (database, context, payload) => {
    try {
      const result = await generateCuttingRevisionDxf(database, context.actor, {
        planId: payload.cuttingPlanId,
        revisionId: payload.cuttingPlanRevisionId,
        requestId: context.requestId,
      });
      await context.reportProgress(100);
      return {
        dateKey: result.dateKey,
        sequence: result.sequence,
        fileCount: result.files.length,
        reused: result.reused,
        contentRetained: result.files.every((file) => file.status === "READY"),
      };
    } catch (error) {
      // 개정이 없거나 결과가 없는 것은 다시 시도해도 같다. 저장소 장애는 재시도한다.
      if (error instanceof CuttingError) {
        throw new JobExecutionError(error.message, false, error);
      }
      throw error;
    }
  },
});

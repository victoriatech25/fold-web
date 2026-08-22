import "server-only";

import { z } from "zod";

import { exportFoldRevisionDxf } from "@/server/dxf/dxf-export-service";
import { FoldDraftServiceError } from "@/server/fold-draft/fold-draft-error";
import { JobExecutionError } from "../job-error";
import { defineJob } from "../job-registry";

const payloadSchema = z.strictObject({
  revisionId: z.uuid(),
});

/**
 * 첫 실증 작업(`D2-B01-I`). 기존 동기 DXF 생성을 그대로 호출해 queue 계약이
 * 실제 업무에서 성립하는지 확인한다. 생성한 바이트 보관은 `P2-B02` 범위이므로
 * 여기서는 checksum·크기·entity 수만 결과로 남긴다.
 */
export const dxfExportJob = defineJob({
  type: "dxf.export",
  label: "제작 DXF 생성",
  permission: "output.print",
  payloadSchema,
  maxAttempts: 3,
  leaseSeconds: 120,
  summarize: (payload) => `절곡 개정 ${payload.revisionId.slice(0, 8)}…`,
  run: async (database, context, payload) => {
    try {
      const result = await exportFoldRevisionDxf(database, context.actor, {
        revisionId: payload.revisionId,
        requestId: context.requestId,
      });
      await context.reportProgress(100);
      return {
        assetId: result.assetId,
        fileName: result.fileName,
        checksumSha256: result.checksumSha256,
        sizeBytes: result.sizeBytes,
        entityCount: result.entityCount,
        contentRetained: result.contentRetained,
      };
    } catch (error) {
      // 문서가 없거나 DXF로 만들 수 없는 형상이면 다시 시도해도 같은 결과다.
      if (error instanceof FoldDraftServiceError) {
        throw new JobExecutionError(error.message, false, error);
      }
      throw error;
    }
  },
});

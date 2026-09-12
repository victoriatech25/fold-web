import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";
import { authorizeCuttingRequest, cuttingRouteErrorResponse } from "@/server/cutting/cutting-route";
import { validateManualRevision } from "@/server/cutting/cutting-plan-service";
import {
  MANUAL_REVISION_BODY_LIMIT,
  manualRevisionBodySchema,
} from "@/server/cutting/manual-revision-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 저장 없이 검증만 한다. 편집기가 이동을 멈출 때마다 부른다(`P2-B11` 4.5). */
export async function POST(request: Request, { params }: { params: Promise<{ planId: string }> }) {
  const requestId = getRequestId(request);
  try {
    // 아무것도 바꾸지 않지만 몸체가 크고 DB 를 읽으므로 변경과 같은 출처 검사를 건다.
    const auth = await authorizeCuttingRequest(request, requestId, "cutting.optimize", true);
    if (!auth.ok) return auth.response;
    const body = await readJsonBody(request, MANUAL_REVISION_BODY_LIMIT);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = manualRevisionBodySchema.safeParse(body.value);
    if (!parsed.success) {
      return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "검증 요청을 확인해 주세요.");
    }
    const { planId } = await params;
    const outcome = await validateManualRevision(getPrisma(), auth.context, { planId, ...parsed.data });
    return jsonResponse(
      {
        data: {
          violations: outcome.violations,
          warnings: outcome.warnings,
          summary: outcome.result.summary,
          annotations: outcome.annotations,
        },
      },
      requestId,
    );
  } catch (error) {
    return cuttingRouteErrorResponse(error, requestId);
  }
}

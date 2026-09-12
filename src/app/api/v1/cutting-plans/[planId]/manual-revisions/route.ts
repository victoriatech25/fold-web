import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";
import { authorizeCuttingRequest, cuttingRouteErrorResponse } from "@/server/cutting/cutting-route";
import { createManualRevision } from "@/server/cutting/cutting-plan-service";
import {
  MANUAL_REVISION_BODY_LIMIT,
  manualRevisionSaveSchema,
} from "@/server/cutting/manual-revision-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 편집한 배치를 새 개정으로 저장한다(`P2-B11` 4.5). */
export async function POST(request: Request, { params }: { params: Promise<{ planId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeCuttingRequest(request, requestId, "cutting.optimize", true);
    if (!auth.ok) return auth.response;
    const body = await readJsonBody(request, MANUAL_REVISION_BODY_LIMIT);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = manualRevisionSaveSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "편집 저장 요청을 확인해 주세요.");
    }
    const { planId } = await params;
    const saved = await createManualRevision(getPrisma(), auth.context, {
      planId,
      ...parsed.data,
      requestId,
    });
    return jsonResponse({ data: saved }, requestId, 201);
  } catch (error) {
    return cuttingRouteErrorResponse(error, requestId);
  }
}

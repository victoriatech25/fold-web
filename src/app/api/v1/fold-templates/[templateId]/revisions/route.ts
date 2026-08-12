import { z } from "zod";

import { getPrisma } from "@/server/db/prisma";
import { createNextFoldRevision } from "@/server/fold-library/fold-library-service";
import { authorizeFoldDraftRequest, foldDraftRouteErrorResponse } from "@/server/fold-draft/fold-draft-route";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.strictObject({ sourceRevisionId: z.uuid(), draftId: z.uuid() });
type RouteContext = { params: Promise<{ templateId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeFoldDraftRequest(request, requestId, "template.fold.edit", true);
    if (!authorization.ok) return authorization.response;
    const { templateId } = await context.params;
    if (!z.uuid().safeParse(templateId).success) return apiErrorResponse(requestId, 404, "NOT_FOUND", "절곡 템플릿을 찾을 수 없습니다.");
    const body = await readJsonBody(request, 16_384);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = schema.safeParse(body.value);
    if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "새 개정 생성 값을 확인해 주세요.");
    const data = await createNextFoldRevision(getPrisma(), authorization.context, { templateId, ...parsed.data, requestId });
    return jsonResponse({ data }, requestId, 201);
  } catch (error) {
    return foldDraftRouteErrorResponse(error, requestId, "create fold revision");
  }
}

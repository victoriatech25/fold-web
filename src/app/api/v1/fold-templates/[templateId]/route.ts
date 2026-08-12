import { z } from "zod";

import { getPrisma } from "@/server/db/prisma";
import { getFoldTemplate, updateFoldTemplateMetadata } from "@/server/fold-library/fold-library-service";
import { authorizeFoldDraftRequest, foldDraftRouteErrorResponse } from "@/server/fold-draft/fold-draft-route";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  categoryId: z.uuid().nullable(),
  expectedLockVersion: z.number().int().positive(),
});
type RouteContext = { params: Promise<{ templateId: string }> };

async function readId(context: RouteContext): Promise<string | null> {
  const { templateId } = await context.params;
  return z.uuid().safeParse(templateId).success ? templateId : null;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeFoldDraftRequest(request, requestId, "template.fold.read", false);
    if (!authorization.ok) return authorization.response;
    const templateId = await readId(context);
    if (!templateId) return apiErrorResponse(requestId, 404, "NOT_FOUND", "절곡 템플릿을 찾을 수 없습니다.");
    const data = await getFoldTemplate(getPrisma(), authorization.context, templateId);
    return jsonResponse({ data }, requestId);
  } catch (error) {
    return foldDraftRouteErrorResponse(error, requestId, "get fold template");
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeFoldDraftRequest(request, requestId, "template.fold.edit", true);
    if (!authorization.ok) return authorization.response;
    const templateId = await readId(context);
    if (!templateId) return apiErrorResponse(requestId, 404, "NOT_FOUND", "절곡 템플릿을 찾을 수 없습니다.");
    const body = await readJsonBody(request, 16_384);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = updateSchema.safeParse(body.value);
    if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "템플릿 변경 값을 확인해 주세요.");
    const data = await updateFoldTemplateMetadata(getPrisma(), authorization.context, { templateId, ...parsed.data, requestId });
    return jsonResponse({ data }, requestId);
  } catch (error) {
    return foldDraftRouteErrorResponse(error, requestId, "update fold template");
  }
}

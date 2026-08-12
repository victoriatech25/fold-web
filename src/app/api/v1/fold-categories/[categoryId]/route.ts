import { z } from "zod";

import { getPrisma } from "@/server/db/prisma";
import { updateFoldCategory } from "@/server/fold-library/fold-library-service";
import { authorizeFoldDraftRequest, foldDraftRouteErrorResponse } from "@/server/fold-draft/fold-draft-route";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  sortOrder: z.number().int().min(0).max(1_000_000),
  active: z.boolean(),
  expectedLockVersion: z.number().int().positive(),
});

type RouteContext = { params: Promise<{ categoryId: string }> };

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeFoldDraftRequest(request, requestId, "template.fold.edit", true);
    if (!authorization.ok) return authorization.response;
    const { categoryId } = await context.params;
    if (!z.uuid().safeParse(categoryId).success) return apiErrorResponse(requestId, 404, "NOT_FOUND", "절곡 분류를 찾을 수 없습니다.");
    const body = await readJsonBody(request, 16_384);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = updateSchema.safeParse(body.value);
    if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "분류 변경 값을 확인해 주세요.");
    const data = await updateFoldCategory(getPrisma(), authorization.context, { categoryId, ...parsed.data, requestId });
    return jsonResponse({ data }, requestId);
  } catch (error) {
    return foldDraftRouteErrorResponse(error, requestId, "update fold category");
  }
}

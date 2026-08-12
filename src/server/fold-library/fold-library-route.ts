import "server-only";

import { z } from "zod";

import { getPrisma } from "@/server/db/prisma";
import { transitionFoldRevision } from "@/server/fold-library/fold-library-service";
import { authorizeFoldDraftRequest, foldDraftRouteErrorResponse } from "@/server/fold-draft/fold-draft-route";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";

const transitionSchema = z.strictObject({ expectedLockVersion: z.number().int().positive() });

export type FoldRevisionRouteContext = { params: Promise<{ revisionId: string }> };
export type FoldRevisionTransitionAction = "review" | "return" | "publish" | "retire" | "discard";

export async function handleFoldRevisionTransition(
  request: Request,
  context: FoldRevisionRouteContext,
  action: FoldRevisionTransitionAction,
): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const permission = action === "review" || action === "discard" ? "template.fold.edit" : "template.fold.publish";
    const authorization = await authorizeFoldDraftRequest(request, requestId, permission, true);
    if (!authorization.ok) return authorization.response;
    const { revisionId } = await context.params;
    if (!z.uuid().safeParse(revisionId).success) return apiErrorResponse(requestId, 404, "NOT_FOUND", "절곡 개정을 찾을 수 없습니다.");
    const body = await readJsonBody(request, 16_384);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = transitionSchema.safeParse(body.value);
    if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "개정 상태 변경 값을 확인해 주세요.");
    const data = await transitionFoldRevision(getPrisma(), authorization.context, {
      revisionId,
      action,
      expectedLockVersion: parsed.data.expectedLockVersion,
      requestId,
    });
    return jsonResponse({ data }, requestId);
  } catch (error) {
    return foldDraftRouteErrorResponse(error, requestId, `transition fold revision: ${action}`);
  }
}

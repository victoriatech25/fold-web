import { z } from "zod";

import { getPrisma } from "@/server/db/prisma";
import { getFoldRevision } from "@/server/fold-library/fold-library-service";
import { handleFoldRevisionTransition, type FoldRevisionRouteContext } from "@/server/fold-library/fold-library-route";
import { authorizeFoldDraftRequest, foldDraftRouteErrorResponse } from "@/server/fold-draft/fold-draft-route";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: FoldRevisionRouteContext): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeFoldDraftRequest(request, requestId, "template.fold.read", false);
    if (!authorization.ok) return authorization.response;
    const { revisionId } = await context.params;
    if (!z.uuid().safeParse(revisionId).success) return apiErrorResponse(requestId, 404, "NOT_FOUND", "절곡 개정을 찾을 수 없습니다.");
    const data = await getFoldRevision(getPrisma(), authorization.context, revisionId);
    return jsonResponse({ data }, requestId);
  } catch (error) {
    return foldDraftRouteErrorResponse(error, requestId, "get fold revision");
  }
}

export async function DELETE(request: Request, context: FoldRevisionRouteContext): Promise<Response> {
  return handleFoldRevisionTransition(request, context, "discard");
}

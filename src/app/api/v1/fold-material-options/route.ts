import { getPrisma } from "@/server/db/prisma";
import { listFoldMaterialOptions } from "@/server/fold-draft/fold-draft-service";
import {
  authorizeFoldDraftRequest,
  foldDraftRouteErrorResponse,
} from "@/server/fold-draft/fold-draft-route";
import { getRequestId, jsonResponse } from "@/server/http/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeFoldDraftRequest(
      request,
      requestId,
      "material.read",
      false,
    );
    if (!authorization.ok) return authorization.response;
    const data = await listFoldMaterialOptions(
      getPrisma(),
      authorization.context,
    );
    return jsonResponse({ data }, requestId);
  } catch (error) {
    return foldDraftRouteErrorResponse(
      error,
      requestId,
      "list fold material options",
    );
  }
}

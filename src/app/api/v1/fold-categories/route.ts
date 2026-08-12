import { z } from "zod";

import { getPrisma } from "@/server/db/prisma";
import { createFoldCategory, listFoldCategories } from "@/server/fold-library/fold-library-service";
import { authorizeFoldDraftRequest, foldDraftRouteErrorResponse } from "@/server/fold-draft/fold-draft-route";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  sortOrder: z.number().int().min(0).max(1_000_000),
});

export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeFoldDraftRequest(request, requestId, "template.fold.read", false);
    if (!authorization.ok) return authorization.response;
    const includeInactive = new URL(request.url).searchParams.get("includeInactive") === "true";
    const data = await listFoldCategories(getPrisma(), authorization.context, includeInactive);
    return jsonResponse({ data }, requestId);
  } catch (error) {
    return foldDraftRouteErrorResponse(error, requestId, "list fold categories");
  }
}

export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeFoldDraftRequest(request, requestId, "template.fold.edit", true);
    if (!authorization.ok) return authorization.response;
    const body = await readJsonBody(request, 16_384);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = createSchema.safeParse(body.value);
    if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "분류 생성 값을 확인해 주세요.");
    const data = await createFoldCategory(getPrisma(), authorization.context, { ...parsed.data, requestId });
    return jsonResponse({ data }, requestId, 201);
  } catch (error) {
    return foldDraftRouteErrorResponse(error, requestId, "create fold category");
  }
}

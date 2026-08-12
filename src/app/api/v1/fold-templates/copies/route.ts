import { z } from "zod";

import { getPrisma } from "@/server/db/prisma";
import { copyFoldTemplate } from "@/server/fold-library/fold-library-service";
import { authorizeFoldDraftRequest, foldDraftRouteErrorResponse } from "@/server/fold-draft/fold-draft-route";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.strictObject({
  sourceRevisionId: z.uuid(),
  draftId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  categoryId: z.uuid().nullable(),
  targetDocumentType: z.literal("panel").optional(),
});

export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeFoldDraftRequest(request, requestId, "template.fold.edit", true);
    if (!authorization.ok) return authorization.response;
    const body = await readJsonBody(request, 16_384);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = schema.safeParse(body.value);
    if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "템플릿 복사 값을 확인해 주세요.");
    const data = await copyFoldTemplate(getPrisma(), authorization.context, { ...parsed.data, requestId });
    return jsonResponse({ data }, requestId, 201);
  } catch (error) {
    return foldDraftRouteErrorResponse(error, requestId, "copy fold template");
  }
}

import { z } from "zod";

import { getPrisma } from "@/server/db/prisma";
import { listFoldTemplates } from "@/server/fold-library/fold-library-service";
import { authorizeFoldDraftRequest, foldDraftRouteErrorResponse } from "@/server/fold-draft/fold-draft-route";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const listSchema = z.object({
  q: z.string().trim().max(120).optional(),
  categoryId: z.union([z.uuid(), z.literal("uncategorized")]).optional(),
  status: z.enum(["DRAFT", "REVIEW", "PUBLISHED", "RETIRED"]).optional(),
  documentType: z.enum(["NORMAL", "BOX", "PANEL"]).optional(),
  cursor: z.string().max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeFoldDraftRequest(request, requestId, "template.fold.read", false);
    if (!authorization.ok) return authorization.response;
    const search = new URL(request.url).searchParams;
    const parsed = listSchema.safeParse(Object.fromEntries(search.entries()));
    if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "템플릿 검색 조건을 확인해 주세요.");
    const data = await listFoldTemplates(getPrisma(), authorization.context, parsed.data);
    return jsonResponse({ data }, requestId);
  } catch (error) {
    return foldDraftRouteErrorResponse(error, requestId, "list fold templates");
  }
}

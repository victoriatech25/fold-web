import { z } from "zod";

import { getPrisma } from "@/server/db/prisma";
import {
  createFoldDraft,
  listFoldDrafts,
} from "@/server/fold-draft/fold-draft-service";
import {
  authorizeFoldDraftRequest,
  foldDraftRouteErrorResponse,
} from "@/server/fold-draft/fold-draft-route";
import {
  apiErrorResponse,
  getRequestId,
  jsonResponse,
} from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_DRAFT_REQUEST_BYTES = 2 * 1024 * 1024 + 64 * 1024;

const listSchema = z.object({
  cursor: z.string().max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const createSchema = z.strictObject({
  draftId: z.uuid(),
  document: z.any().refine((value) => value !== undefined),
});

export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeFoldDraftRequest(
      request,
      requestId,
      "template.fold.read",
      false,
    );
    if (!authorization.ok) return authorization.response;
    const url = new URL(request.url);
    const parsed = listSchema.safeParse({
      cursor: url.searchParams.get("cursor") || undefined,
      limit: url.searchParams.get("limit") || undefined,
    });
    if (!parsed.success) {
      return apiErrorResponse(
        requestId,
        400,
        "INVALID_REQUEST",
        "초안 목록 조건을 확인해 주세요.",
      );
    }
    const data = await listFoldDrafts(
      getPrisma(),
      authorization.context,
      parsed.data,
    );
    return jsonResponse({ data }, requestId);
  } catch (error) {
    return foldDraftRouteErrorResponse(error, requestId, "list drafts");
  }
}

export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeFoldDraftRequest(
      request,
      requestId,
      "template.fold.edit",
      true,
    );
    if (!authorization.ok) return authorization.response;
    const body = await readJsonBody(request, MAX_DRAFT_REQUEST_BYTES);
    if (!body.ok) {
      return apiErrorResponse(
        requestId,
        body.status,
        body.code,
        body.message,
      );
    }
    const parsed = createSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiErrorResponse(
        requestId,
        400,
        "INVALID_REQUEST",
        "초안 생성 요청을 확인해 주세요.",
      );
    }
    const data = await createFoldDraft(
      getPrisma(),
      authorization.context,
      { ...parsed.data, requestId },
    );
    return jsonResponse({ data }, requestId, 201);
  } catch (error) {
    return foldDraftRouteErrorResponse(error, requestId, "create draft");
  }
}

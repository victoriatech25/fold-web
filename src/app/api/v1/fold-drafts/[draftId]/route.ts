import { z } from "zod";

import { getPrisma } from "@/server/db/prisma";
import {
  deleteFoldDraft,
  getFoldDraft,
  updateFoldDraft,
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

const updateSchema = z.strictObject({
  expectedLockVersion: z.number().int().positive(),
  document: z.any().refine((value) => value !== undefined),
});

const deleteSchema = z.strictObject({
  expectedLockVersion: z.number().int().positive(),
});

type DraftRouteContext = {
  params: Promise<{ draftId: string }>;
};

async function readDraftId(context: DraftRouteContext): Promise<string | null> {
  const { draftId } = await context.params;
  return z.uuid().safeParse(draftId).success ? draftId : null;
}

export async function GET(
  request: Request,
  context: DraftRouteContext,
): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeFoldDraftRequest(
      request,
      requestId,
      "template.fold.read",
      false,
    );
    if (!authorization.ok) return authorization.response;
    const draftId = await readDraftId(context);
    if (!draftId) {
      return apiErrorResponse(
        requestId,
        404,
        "NOT_FOUND",
        "절곡 초안을 찾을 수 없습니다.",
      );
    }
    const data = await getFoldDraft(
      getPrisma(),
      authorization.context,
      draftId,
    );
    return jsonResponse({ data }, requestId);
  } catch (error) {
    return foldDraftRouteErrorResponse(error, requestId, "get draft");
  }
}

export async function PUT(
  request: Request,
  context: DraftRouteContext,
): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeFoldDraftRequest(
      request,
      requestId,
      "template.fold.edit",
      true,
    );
    if (!authorization.ok) return authorization.response;
    const draftId = await readDraftId(context);
    if (!draftId) {
      return apiErrorResponse(
        requestId,
        404,
        "NOT_FOUND",
        "절곡 초안을 찾을 수 없습니다.",
      );
    }
    const body = await readJsonBody(request, MAX_DRAFT_REQUEST_BYTES);
    if (!body.ok) {
      return apiErrorResponse(
        requestId,
        body.status,
        body.code,
        body.message,
      );
    }
    const parsed = updateSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiErrorResponse(
        requestId,
        400,
        "INVALID_REQUEST",
        "초안 저장 요청을 확인해 주세요.",
      );
    }
    const data = await updateFoldDraft(
      getPrisma(),
      authorization.context,
      { draftId, ...parsed.data, requestId },
    );
    return jsonResponse({ data }, requestId);
  } catch (error) {
    return foldDraftRouteErrorResponse(error, requestId, "update draft");
  }
}

export async function DELETE(
  request: Request,
  context: DraftRouteContext,
): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeFoldDraftRequest(
      request,
      requestId,
      "template.fold.edit",
      true,
    );
    if (!authorization.ok) return authorization.response;
    const draftId = await readDraftId(context);
    if (!draftId) {
      return apiErrorResponse(
        requestId,
        404,
        "NOT_FOUND",
        "절곡 초안을 찾을 수 없습니다.",
      );
    }
    const body = await readJsonBody(request, 16_384);
    if (!body.ok) {
      return apiErrorResponse(
        requestId,
        body.status,
        body.code,
        body.message,
      );
    }
    const parsed = deleteSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiErrorResponse(
        requestId,
        400,
        "INVALID_REQUEST",
        "초안 삭제 요청을 확인해 주세요.",
      );
    }
    const data = await deleteFoldDraft(
      getPrisma(),
      authorization.context,
      { draftId, ...parsed.data, requestId },
    );
    return jsonResponse({ data }, requestId);
  } catch (error) {
    return foldDraftRouteErrorResponse(error, requestId, "delete draft");
  }
}

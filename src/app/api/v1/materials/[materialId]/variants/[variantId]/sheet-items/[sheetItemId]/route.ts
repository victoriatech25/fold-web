import { z } from "zod";
import { getRequestId, apiErrorResponse, jsonResponse } from "@/server/http/api-response";
import { getPrisma } from "@/server/db/prisma";
import { readJsonBody } from "@/server/http/read-json-body";
import { authorizeMaterialRequest, materialRouteErrorResponse } from "@/server/materials/material-route";
import { sheetItemFieldsSchema, validSheetIds } from "@/server/sheet-items/sheet-item-route";
import { getSheetItemWorkspace, updateSheetItem } from "@/server/sheet-items/sheet-item-service";

type Context = { params: Promise<{ materialId: string; variantId: string; sheetItemId: string }> };

export async function GET(request: Request, context: Context) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeMaterialRequest(request, requestId, "material.read", false);
    if (!auth.ok) return auth.response;
    const ids = await context.params;
    if (!validSheetIds(ids)) return apiErrorResponse(requestId, 404, "NOT_FOUND", "원판 품목을 찾을 수 없습니다.");
    const workspace = await getSheetItemWorkspace(getPrisma(), auth.context, ids.materialId, ids.variantId);
    const item = workspace.items.find((candidate) => candidate.id === ids.sheetItemId);
    if (!item) return apiErrorResponse(requestId, 404, "NOT_FOUND", "원판 품목을 찾을 수 없습니다.");
    return jsonResponse({ data: item }, requestId);
  } catch (error) { return materialRouteErrorResponse(error, requestId, "get sheet item"); }
}

const updateSchema = sheetItemFieldsSchema.extend({ expectedLockVersion: z.number().int().positive() }).strict();

export async function PATCH(request: Request, context: Context) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeMaterialRequest(request, requestId, "material.write", true);
    if (!auth.ok) return auth.response;
    const ids = await context.params;
    if (!validSheetIds(ids)) return apiErrorResponse(requestId, 404, "NOT_FOUND", "원판 품목을 찾을 수 없습니다.");
    const body = await readJsonBody(request, 65536);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = updateSchema.safeParse(body.value);
    if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "원판 품목 입력값을 확인해 주세요.");
    return jsonResponse({ data: await updateSheetItem(getPrisma(), auth.context, { ...parsed.data, ...ids, requestId }) }, requestId);
  } catch (error) { return materialRouteErrorResponse(error, requestId, "update sheet item"); }
}

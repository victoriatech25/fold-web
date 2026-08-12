import { z } from "zod";
import { getRequestId, apiErrorResponse, jsonResponse } from "@/server/http/api-response";
import { getPrisma } from "@/server/db/prisma";
import { readJsonBody } from "@/server/http/read-json-body";
import { authorizeMaterialRequest, materialRouteErrorResponse } from "@/server/materials/material-route";
import { sheetItemFieldsSchema, validSheetIds } from "@/server/sheet-items/sheet-item-route";
import { createSheetItem, getSheetItemWorkspace } from "@/server/sheet-items/sheet-item-service";

type Context = { params: Promise<{ materialId: string; variantId: string }> };

export async function GET(request: Request, context: Context) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeMaterialRequest(request, requestId, "material.read", false);
    if (!auth.ok) return auth.response;
    const ids = await context.params;
    if (!validSheetIds(ids)) return apiErrorResponse(requestId, 404, "NOT_FOUND", "재질 두께 항목을 찾을 수 없습니다.");
    return jsonResponse({ data: await getSheetItemWorkspace(getPrisma(), auth.context, ids.materialId, ids.variantId) }, requestId);
  } catch (error) { return materialRouteErrorResponse(error, requestId, "get sheet items"); }
}

const createSchema = sheetItemFieldsSchema.extend({ isDefault: z.boolean().default(false) }).strict();

export async function POST(request: Request, context: Context) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeMaterialRequest(request, requestId, "material.write", true);
    if (!auth.ok) return auth.response;
    const ids = await context.params;
    if (!validSheetIds(ids)) return apiErrorResponse(requestId, 404, "NOT_FOUND", "재질 두께 항목을 찾을 수 없습니다.");
    const body = await readJsonBody(request, 65536);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = createSchema.safeParse(body.value);
    if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "원판 품목 입력값을 확인해 주세요.");
    return jsonResponse({ data: await createSheetItem(getPrisma(), auth.context, { ...parsed.data, ...ids, requestId }) }, requestId, 201);
  } catch (error) { return materialRouteErrorResponse(error, requestId, "create sheet item"); }
}

import { z } from "zod";
import { getRequestId, apiErrorResponse, jsonResponse } from "@/server/http/api-response";
import { getPrisma } from "@/server/db/prisma";
import { readJsonBody } from "@/server/http/read-json-body";
import { authorizeMaterialRequest, materialRouteErrorResponse } from "@/server/materials/material-route";
import { validSheetIds } from "@/server/sheet-items/sheet-item-route";
import { transitionSheetItem } from "@/server/sheet-items/sheet-item-service";

type Context = { params: Promise<{ materialId: string; variantId: string; sheetItemId: string }> };
const transitionSchema = z.object({
  action: z.enum(["set_default", "deactivate", "reactivate"]),
  expectedLockVersion: z.number().int().positive(),
}).strict();

export async function POST(request: Request, context: Context) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeMaterialRequest(request, requestId, "material.write", true);
    if (!auth.ok) return auth.response;
    const ids = await context.params;
    if (!validSheetIds(ids)) return apiErrorResponse(requestId, 404, "NOT_FOUND", "원판 품목을 찾을 수 없습니다.");
    const body = await readJsonBody(request, 8192);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = transitionSchema.safeParse(body.value);
    if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "원판 상태 변경 요청을 확인해 주세요.");
    return jsonResponse({ data: await transitionSheetItem(getPrisma(), auth.context, { ...parsed.data, ...ids, requestId }) }, requestId);
  } catch (error) { return materialRouteErrorResponse(error, requestId, "transition sheet item"); }
}

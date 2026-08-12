import { getRequestId } from "@/server/http/api-response";
import { apiErrorResponse, jsonResponse } from "@/server/http/api-response";
import { getPrisma } from "@/server/db/prisma";
import { authorizeMaterialRequest, materialRouteErrorResponse } from "@/server/materials/material-route";
import { createMaterialRule, getMaterialRuleWorkspace } from "@/server/material-rules/material-rule-service";
import { materialRuleFieldsSchema, validRuleIds } from "@/server/material-rules/material-rule-route";
import { readJsonBody } from "@/server/http/read-json-body";
import { z } from "zod";

type Context = { params: Promise<{ materialId: string; variantId: string }> };

export async function GET(request: Request, context: Context) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeMaterialRequest(request, requestId, "material.read", false);
    if (!auth.ok) return auth.response;
    const ids = await context.params;
    if (!validRuleIds(ids)) return apiErrorResponse(requestId, 404, "NOT_FOUND", "재질 두께 항목을 찾을 수 없습니다.");
    return jsonResponse({ data: await getMaterialRuleWorkspace(getPrisma(), auth.context, ids.materialId, ids.variantId) }, requestId);
  } catch (error) { return materialRouteErrorResponse(error, requestId, "get material rules"); }
}

const createSchema = materialRuleFieldsSchema.extend({ sourceRuleRevisionId: z.uuid().nullable().optional() }).strict();

export async function POST(request: Request, context: Context) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeMaterialRequest(request, requestId, "material.write", true);
    if (!auth.ok) return auth.response;
    const ids = await context.params;
    if (!validRuleIds(ids)) return apiErrorResponse(requestId, 404, "NOT_FOUND", "재질 두께 항목을 찾을 수 없습니다.");
    const body = await readJsonBody(request, 65536);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = createSchema.safeParse(body.value);
    if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "계산 규칙 입력값을 확인해 주세요.");
    return jsonResponse({ data: await createMaterialRule(getPrisma(), auth.context, { ...parsed.data, ...ids, requestId }) }, requestId, 201);
  } catch (error) { return materialRouteErrorResponse(error, requestId, "create material rule"); }
}

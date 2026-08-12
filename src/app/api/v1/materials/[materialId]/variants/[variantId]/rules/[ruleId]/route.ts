import { z } from "zod";

import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";
import { authorizeMaterialRequest, materialRouteErrorResponse } from "@/server/materials/material-route";
import { getMaterialRuleWorkspace, updateMaterialRule } from "@/server/material-rules/material-rule-service";
import { materialRuleFieldsSchema, validRuleIds } from "@/server/material-rules/material-rule-route";

type Context = { params: Promise<{ materialId: string; variantId: string; ruleId: string }> };

export async function GET(request: Request, context: Context) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeMaterialRequest(request, requestId, "material.read", false);
    if (!auth.ok) return auth.response;
    const ids = await context.params;
    if (!validRuleIds(ids)) return apiErrorResponse(requestId, 404, "NOT_FOUND", "계산 규칙을 찾을 수 없습니다.");
    const workspace = await getMaterialRuleWorkspace(getPrisma(), auth.context, ids.materialId, ids.variantId);
    const rule = workspace.revisions.find((item) => item.id === ids.ruleId);
    if (!rule) return apiErrorResponse(requestId, 404, "NOT_FOUND", "계산 규칙을 찾을 수 없습니다.");
    return jsonResponse({ data: rule }, requestId);
  } catch (error) { return materialRouteErrorResponse(error, requestId, "get material rule"); }
}

const updateSchema = materialRuleFieldsSchema.extend({ expectedLockVersion: z.number().int().positive() }).strict();

export async function PATCH(request: Request, context: Context) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeMaterialRequest(request, requestId, "material.write", true);
    if (!auth.ok) return auth.response;
    const ids = await context.params;
    if (!validRuleIds(ids)) return apiErrorResponse(requestId, 404, "NOT_FOUND", "계산 규칙을 찾을 수 없습니다.");
    const body = await readJsonBody(request, 65536);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = updateSchema.safeParse(body.value);
    if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "계산 규칙 입력값을 확인해 주세요.");
    return jsonResponse({ data: await updateMaterialRule(getPrisma(), auth.context, { ...parsed.data, ...ids, requestId }) }, requestId);
  } catch (error) { return materialRouteErrorResponse(error, requestId, "update material rule"); }
}

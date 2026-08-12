import { z } from "zod";

import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";
import { authorizeMaterialRequest, materialRouteErrorResponse } from "@/server/materials/material-route";
import { validRuleIds } from "@/server/material-rules/material-rule-route";
import { transitionMaterialRule } from "@/server/material-rules/material-rule-service";

type Context = { params: Promise<{ materialId: string; variantId: string; ruleId: string }> };
const schema = z.object({
  action: z.enum(["review", "return", "publish", "retire", "discard"]),
  expectedLockVersion: z.number().int().positive(),
  effectiveFrom: z.string().max(100).nullable().optional(),
  reason: z.string().max(500).nullable().optional(),
}).strict();

export async function POST(request: Request, context: Context) {
  const requestId = getRequestId(request);
  try {
    const ids = await context.params;
    if (!validRuleIds(ids)) return apiErrorResponse(requestId, 404, "NOT_FOUND", "계산 규칙을 찾을 수 없습니다.");
    const body = await readJsonBody(request, 65536);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = schema.safeParse(body.value);
    if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "상태 변경 요청을 확인해 주세요.");
    const permission = parsed.data.action === "review" || parsed.data.action === "discard" ? "material.write" : "material.approve";
    const auth = await authorizeMaterialRequest(request, requestId, permission, true);
    if (!auth.ok) return auth.response;
    return jsonResponse({ data: await transitionMaterialRule(getPrisma(), auth.context, { ...parsed.data, ...ids, requestId }) }, requestId);
  } catch (error) { return materialRouteErrorResponse(error, requestId, "transition material rule"); }
}

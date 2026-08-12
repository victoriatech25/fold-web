import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { authorizeMaterialRequest, materialRouteErrorResponse } from "@/server/materials/material-route";
import { validRuleIds } from "@/server/material-rules/material-rule-route";
import { previewMaterialRule } from "@/server/material-rules/material-rule-service";

type Context = { params: Promise<{ materialId: string; variantId: string; ruleId: string }> };

export async function POST(request: Request, context: Context) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeMaterialRequest(request, requestId, "material.read", true);
    if (!auth.ok) return auth.response;
    const ids = await context.params;
    if (!validRuleIds(ids)) return apiErrorResponse(requestId, 404, "NOT_FOUND", "계산 규칙을 찾을 수 없습니다.");
    return jsonResponse({ data: await previewMaterialRule(getPrisma(), auth.context, ids) }, requestId);
  } catch (error) { return materialRouteErrorResponse(error, requestId, "preview material rule"); }
}

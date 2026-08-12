import { z } from "zod";

import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";
import { authorizePricingRequest, pricingRouteErrorResponse } from "@/server/pricing/pricing-route";
import { uuidParam } from "@/server/pricing/pricing-route-schema";
import { transitionPriceTier } from "@/server/pricing/pricing-service";

type Context = { params: Promise<{ tierId: string }> };
const schema = z.object({ action: z.enum(["set_default", "deactivate", "reactivate"]), expectedLockVersion: z.number().int().positive() }).strict();

export async function POST(request: Request, context: Context) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizePricingRequest(request, requestId, "pricing.write", true);
    if (!auth.ok) return auth.response;
    const tierId = (await context.params).tierId;
    if (!uuidParam.safeParse(tierId).success) return apiErrorResponse(requestId, 404, "NOT_FOUND", "가격등급을 찾을 수 없습니다.");
    const body = await readJsonBody(request, 65536);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = schema.safeParse(body.value);
    if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "가격등급 상태 변경을 확인해 주세요.");
    return jsonResponse({ data: await transitionPriceTier(getPrisma(), auth.context, { ...parsed.data, tierId, requestId }) }, requestId);
  } catch (error) { return pricingRouteErrorResponse(error, requestId, "transition price tier"); }
}

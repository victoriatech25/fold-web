import { z } from "zod";

import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";
import { authorizePricingRequest, pricingRouteErrorResponse } from "@/server/pricing/pricing-route";
import { uuidParam } from "@/server/pricing/pricing-route-schema";
import { assignCustomerPriceTier } from "@/server/pricing/pricing-service";

type Context = { params: Promise<{ customerId: string }> };
const schema = z.object({ priceTierId: z.uuid().nullable(), expectedLockVersion: z.number().int().positive() }).strict();

export async function POST(request: Request, context: Context) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizePricingRequest(request, requestId, "pricing.write", true);
    if (!auth.ok) return auth.response;
    const customerId = (await context.params).customerId;
    if (!uuidParam.safeParse(customerId).success) return apiErrorResponse(requestId, 404, "NOT_FOUND", "거래처를 찾을 수 없습니다.");
    const body = await readJsonBody(request, 65536);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = schema.safeParse(body.value);
    if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "가격등급 배정값을 확인해 주세요.");
    return jsonResponse({ data: await assignCustomerPriceTier(getPrisma(), auth.context, { ...parsed.data, customerId, requestId }) }, requestId);
  } catch (error) { return pricingRouteErrorResponse(error, requestId, "assign customer price tier"); }
}

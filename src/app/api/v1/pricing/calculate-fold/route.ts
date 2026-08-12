import { z } from "zod";

import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";
import { authorizePricingRequest, pricingRouteErrorResponse } from "@/server/pricing/pricing-route";
import { calculateManualFoldPrice } from "@/server/pricing/pricing-service";

const schema = z.object({
  customerId: z.uuid(),
  materialVariantId: z.uuid(),
  effectiveAt: z.string().max(100).nullable().optional(),
  metrics: z.object({ version: z.literal("pricing-metrics-v1"), areaEachM2: z.string().min(1).max(40), bendOperationsEach: z.number().int().min(0).max(999), vCutLengthEachM: z.string().min(1).max(40), quantity: z.number().int().min(1).max(1_000_000) }).strict(),
}).strict();

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizePricingRequest(request, requestId, "pricing.read", true);
    if (!auth.ok) return auth.response;
    const body = await readJsonBody(request, 65536);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = schema.safeParse(body.value);
    if (!parsed.success) return apiErrorResponse(requestId, 400, "PRICE_INPUT_INVALID", "가격 계산 입력값을 확인해 주세요.");
    return jsonResponse({ data: await calculateManualFoldPrice(getPrisma(), auth.context, parsed.data) }, requestId);
  } catch (error) { return pricingRouteErrorResponse(error, requestId, "calculate fold price"); }
}

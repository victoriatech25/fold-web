import { z } from "zod";

import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";
import { authorizePricingRequest, pricingRouteErrorResponse } from "@/server/pricing/pricing-route";
import { createPriceTier } from "@/server/pricing/pricing-service";

const schema = z.object({ code: z.string().min(1).max(50), name: z.string().min(1).max(100), description: z.string().max(500).nullable().optional(), sortOrder: z.number().int().min(-9999).max(9999).optional() }).strict();

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizePricingRequest(request, requestId, "pricing.write", true);
    if (!auth.ok) return auth.response;
    const body = await readJsonBody(request, 65536);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = schema.safeParse(body.value);
    if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "가격등급 입력값을 확인해 주세요.");
    return jsonResponse({ data: await createPriceTier(getPrisma(), auth.context, { ...parsed.data, requestId }) }, requestId, 201);
  } catch (error) { return pricingRouteErrorResponse(error, requestId, "create price tier"); }
}

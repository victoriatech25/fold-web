import { z } from "zod";

import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";
import { authorizePricingRequest, pricingRouteErrorResponse } from "@/server/pricing/pricing-route";
import { priceRevisionFieldsSchema, uuidParam } from "@/server/pricing/pricing-route-schema";
import { updatePriceRevision } from "@/server/pricing/pricing-service";

type Context = { params: Promise<{ bookId: string; revisionId: string }> };
const schema = priceRevisionFieldsSchema.extend({ expectedLockVersion: z.number().int().positive() }).strict();

export async function PATCH(request: Request, context: Context) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizePricingRequest(request, requestId, "pricing.write", true);
    if (!auth.ok) return auth.response;
    const ids = await context.params;
    if (!uuidParam.safeParse(ids.bookId).success || !uuidParam.safeParse(ids.revisionId).success) return apiErrorResponse(requestId, 404, "NOT_FOUND", "가격표 개정을 찾을 수 없습니다.");
    const body = await readJsonBody(request, 1_048_576);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = schema.safeParse(body.value);
    if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "가격표 변경값을 확인해 주세요.");
    return jsonResponse({ data: await updatePriceRevision(getPrisma(), auth.context, { ...parsed.data, bookId: ids.bookId, revisionId: ids.revisionId, requestId }) }, requestId);
  } catch (error) { return pricingRouteErrorResponse(error, requestId, "update price revision"); }
}

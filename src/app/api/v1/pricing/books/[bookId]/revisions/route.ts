import { z } from "zod";

import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";
import { authorizePricingRequest, pricingRouteErrorResponse } from "@/server/pricing/pricing-route";
import { uuidParam } from "@/server/pricing/pricing-route-schema";
import { createPriceRevision } from "@/server/pricing/pricing-service";

type Context = { params: Promise<{ bookId: string }> };
const schema = z.object({ sourceRevisionId: z.uuid().nullable().optional() }).strict();

export async function POST(request: Request, context: Context) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizePricingRequest(request, requestId, "pricing.write", true);
    if (!auth.ok) return auth.response;
    const bookId = (await context.params).bookId;
    if (!uuidParam.safeParse(bookId).success) return apiErrorResponse(requestId, 404, "NOT_FOUND", "가격표를 찾을 수 없습니다.");
    const body = await readJsonBody(request, 65536);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = schema.safeParse(body.value);
    if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "새 가격표 개정 요청을 확인해 주세요.");
    return jsonResponse({ data: await createPriceRevision(getPrisma(), auth.context, { ...parsed.data, bookId, requestId }) }, requestId, 201);
  } catch (error) { return pricingRouteErrorResponse(error, requestId, "create price revision"); }
}

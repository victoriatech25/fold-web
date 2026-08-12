import { z } from "zod";

import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";
import { authorizePricingRequest, pricingRouteErrorResponse } from "@/server/pricing/pricing-route";
import { uuidParam } from "@/server/pricing/pricing-route-schema";
import { transitionPriceRevision } from "@/server/pricing/pricing-service";

type Context = { params: Promise<{ bookId: string; revisionId: string }> };
const schema = z.object({ action: z.enum(["review", "return", "publish", "retire", "discard"]), expectedLockVersion: z.number().int().positive(), effectiveFrom: z.string().max(100).nullable().optional(), reason: z.string().max(500).nullable().optional() }).strict();

export async function POST(request: Request, context: Context) {
  const requestId = getRequestId(request);
  try {
    const ids = await context.params;
    if (!uuidParam.safeParse(ids.bookId).success || !uuidParam.safeParse(ids.revisionId).success) return apiErrorResponse(requestId, 404, "NOT_FOUND", "가격표 개정을 찾을 수 없습니다.");
    const body = await readJsonBody(request, 65536);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = schema.safeParse(body.value);
    if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "가격표 상태 변경을 확인해 주세요.");
    const permission = parsed.data.action === "review" || parsed.data.action === "discard" ? "pricing.write" : "pricing.approve";
    const auth = await authorizePricingRequest(request, requestId, permission, true);
    if (!auth.ok) return auth.response;
    return jsonResponse({ data: await transitionPriceRevision(getPrisma(), auth.context, { ...parsed.data, bookId: ids.bookId, revisionId: ids.revisionId, requestId }) }, requestId);
  } catch (error) { return pricingRouteErrorResponse(error, requestId, "transition price revision"); }
}

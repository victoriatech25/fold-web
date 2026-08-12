import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { authorizePricingRequest, pricingRouteErrorResponse } from "@/server/pricing/pricing-route";
import { uuidParam } from "@/server/pricing/pricing-route-schema";
import { getPriceBookWorkspace } from "@/server/pricing/pricing-service";

type Context = { params: Promise<{ bookId: string }> };

export async function GET(request: Request, context: Context) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizePricingRequest(request, requestId, "pricing.read", false);
    if (!auth.ok) return auth.response;
    const bookId = (await context.params).bookId;
    if (!uuidParam.safeParse(bookId).success) return apiErrorResponse(requestId, 404, "NOT_FOUND", "가격표를 찾을 수 없습니다.");
    return jsonResponse({ data: await getPriceBookWorkspace(getPrisma(), auth.context, bookId) }, requestId);
  } catch (error) { return pricingRouteErrorResponse(error, requestId, "get price book"); }
}

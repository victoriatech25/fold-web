import { getPrisma } from "@/server/db/prisma";
import { getRequestId, jsonResponse } from "@/server/http/api-response";
import { authorizePricingRequest, pricingRouteErrorResponse } from "@/server/pricing/pricing-route";
import { getPricingWorkspace } from "@/server/pricing/pricing-service";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizePricingRequest(request, requestId, "pricing.read", false);
    if (!auth.ok) return auth.response;
    return jsonResponse({ data: await getPricingWorkspace(getPrisma(), auth.context) }, requestId);
  } catch (error) { return pricingRouteErrorResponse(error, requestId, "get pricing workspace"); }
}

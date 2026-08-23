import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { authorizeCuttingRequest, cuttingRouteErrorResponse } from "@/server/cutting/cutting-route";
import { listCuttingPlans } from "@/server/cutting/cutting-plan-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeCuttingRequest(request, requestId, "cutting.optimize", false);
    if (!auth.ok) return auth.response;
    const url = new URL(request.url);
    const limitValue = url.searchParams.get("limit") || "50";
    if (limitValue !== "50" && limitValue !== "100") {
      return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "목록 크기를 확인해 주세요.");
    }
    return jsonResponse(
      {
        data: await listCuttingPlans(getPrisma(), auth.context, {
          salesOrderId: url.searchParams.get("salesOrderId") || undefined,
          limit: Number(limitValue),
        }),
      },
      requestId,
    );
  } catch (error) {
    return cuttingRouteErrorResponse(error, requestId);
  }
}

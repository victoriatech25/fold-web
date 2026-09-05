import { CuttingPlanStatus } from "@/generated/prisma/client";
import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { authorizeCuttingRequest, cuttingRouteErrorResponse } from "@/server/cutting/cutting-route";
import { listCuttingPlans } from "@/server/cutting/cutting-plan-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const planStatuses = new Set(Object.values(CuttingPlanStatus));

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
    const rawStatuses = url.searchParams.get("statuses")?.split(",").filter(Boolean) ?? [];
    if (rawStatuses.some((status) => !planStatuses.has(status as CuttingPlanStatus))) {
      return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "재단 상태가 올바르지 않습니다.");
    }
    return jsonResponse(
      {
        data: await listCuttingPlans(getPrisma(), auth.context, {
          salesOrderId: url.searchParams.get("salesOrderId") || undefined,
          q: url.searchParams.get("q") || undefined,
          statuses: rawStatuses as CuttingPlanStatus[],
          limit: Number(limitValue),
        }),
      },
      requestId,
    );
  } catch (error) {
    return cuttingRouteErrorResponse(error, requestId);
  }
}

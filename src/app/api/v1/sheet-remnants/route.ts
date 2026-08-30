import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { authorizeCuttingRequest, cuttingRouteErrorResponse } from "@/server/cutting/cutting-route";
import { listSheetRemnants } from "@/server/cutting/sheet-usage-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statuses = new Set(["AVAILABLE", "CONSUMED", "DISCARDED"]);

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeCuttingRequest(request, requestId, "cutting.optimize", false);
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    if (status && !statuses.has(status)) {
      return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "잔재 상태를 확인해 주세요.");
    }

    return jsonResponse(
      {
        data: await listSheetRemnants(getPrisma(), auth.context, {
          status: (status as "AVAILABLE" | "CONSUMED" | "DISCARDED" | null) ?? undefined,
          materialVariantId: url.searchParams.get("materialVariantId") ?? undefined,
        }),
      },
      requestId,
    );
  } catch (error) {
    return cuttingRouteErrorResponse(error, requestId);
  }
}

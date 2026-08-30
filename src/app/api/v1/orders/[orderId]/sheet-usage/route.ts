import { getPrisma } from "@/server/db/prisma";
import { getRequestId, jsonResponse } from "@/server/http/api-response";
import { authorizeCuttingRequest, cuttingRouteErrorResponse } from "@/server/cutting/cutting-route";
import { listSheetUsageForOrder } from "@/server/cutting/sheet-usage-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeCuttingRequest(request, requestId, "cutting.optimize", false);
    if (!auth.ok) return auth.response;
    const { orderId } = await params;
    return jsonResponse(
      { data: await listSheetUsageForOrder(getPrisma(), auth.context, orderId) },
      requestId,
    );
  } catch (error) {
    return cuttingRouteErrorResponse(error, requestId);
  }
}

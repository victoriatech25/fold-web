import { getPrisma } from "@/server/db/prisma";
import { getRequestId, jsonResponse } from "@/server/http/api-response";
import { authorizeCuttingRequest, cuttingRouteErrorResponse } from "@/server/cutting/cutting-route";
import { createCuttingPlansForOrder, listCuttingPlans } from "@/server/cutting/cutting-plan-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeCuttingRequest(request, requestId, "cutting.optimize", false);
    if (!auth.ok) return auth.response;
    const { orderId } = await params;
    return jsonResponse(
      { data: await listCuttingPlans(getPrisma(), auth.context, { salesOrderId: orderId }) },
      requestId,
    );
  } catch (error) {
    return cuttingRouteErrorResponse(error, requestId);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeCuttingRequest(request, requestId, "cutting.optimize", true);
    if (!auth.ok) return auth.response;
    const { orderId } = await params;
    return jsonResponse(
      {
        data: {
          items: await createCuttingPlansForOrder(getPrisma(), auth.context, {
            salesOrderId: orderId,
            requestId,
          }),
        },
      },
      requestId,
      201,
    );
  } catch (error) {
    return cuttingRouteErrorResponse(error, requestId);
  }
}

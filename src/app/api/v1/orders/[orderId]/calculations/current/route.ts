import { z } from "zod";

import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { getCurrentOrderCalculation } from "@/server/orders/order-calculation-service";
import { authorizeOrderRequest, orderRouteErrorResponse } from "@/server/orders/order-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ orderId: string }> };

export async function GET(request: Request, context: Context) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeOrderRequest(request, requestId, "order.read", false);
    if (!auth.ok) return auth.response;
    const { orderId } = await context.params;
    if (!z.uuid().safeParse(orderId).success) return apiErrorResponse(requestId, 404, "NOT_FOUND", "수주를 찾을 수 없습니다.");
    return jsonResponse({ data: await getCurrentOrderCalculation(getPrisma(), auth.context, orderId) }, requestId);
  } catch (error) {
    return orderRouteErrorResponse(error, requestId);
  }
}

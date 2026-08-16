import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { listOrderFoldOptions } from "@/server/orders/order-fold-service";
import { authorizeOrderRequest, orderRouteErrorResponse } from "@/server/orders/order-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeOrderRequest(request, requestId, "order.read", false);
    if (!auth.ok) return auth.response;
    const { orderId } = await context.params;
    if (!z.uuid().safeParse(orderId).success) return apiErrorResponse(requestId, 404, "NOT_FOUND", "수주를 찾을 수 없습니다.");
    const q = new URL(request.url).searchParams.get("q") || undefined;
    return jsonResponse({ data: await listOrderFoldOptions(getPrisma(), auth.context, { orderId, q }) }, requestId);
  } catch (error) {
    return orderRouteErrorResponse(error, requestId);
  }
}

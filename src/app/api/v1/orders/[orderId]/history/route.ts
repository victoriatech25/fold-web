import { z } from "zod";

import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { authorizeOrderRequest, orderRouteErrorResponse } from "@/server/orders/order-route";
import { getOrderHistory } from "@/server/orders/order-history-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeOrderRequest(request, requestId, "order.read", false);
    if (!auth.ok) return auth.response;
    const { orderId } = await context.params;
    if (!z.uuid().safeParse(orderId).success) return apiErrorResponse(requestId, 404, "NOT_FOUND", "수주를 찾을 수 없습니다.");
    const url = new URL(request.url);
    const limitValue = url.searchParams.get("limit") || "25";
    if (limitValue !== "25" && limitValue !== "100") return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "목록 크기를 확인해 주세요.");
    return jsonResponse({ data: await getOrderHistory(getPrisma(), auth.context, orderId, { cursor: url.searchParams.get("cursor") || undefined, limit: Number(limitValue) as 25 | 100 }) }, requestId);
  } catch (error) { return orderRouteErrorResponse(error, requestId); }
}

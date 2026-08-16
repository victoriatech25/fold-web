import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";
import { reorderOrderFoldItemsSchema } from "@/server/orders/order-fold-schema";
import { reorderOrderFoldItems } from "@/server/orders/order-fold-service";
import { authorizeOrderRequest, orderRouteErrorResponse } from "@/server/orders/order-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeOrderRequest(request, requestId, "order.edit", true);
    if (!auth.ok) return auth.response;
    const { orderId } = await context.params;
    if (!z.uuid().safeParse(orderId).success) return apiErrorResponse(requestId, 404, "NOT_FOUND", "수주를 찾을 수 없습니다.");
    const body = await readJsonBody(request, 65_536);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = reorderOrderFoldItemsSchema.safeParse(body.value);
    if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "절곡 작업 순서를 확인해 주세요.");
    return jsonResponse({ data: await reorderOrderFoldItems(getPrisma(), auth.context, { orderId, ...parsed.data, requestId }) }, requestId);
  } catch (error) {
    return orderRouteErrorResponse(error, requestId);
  }
}

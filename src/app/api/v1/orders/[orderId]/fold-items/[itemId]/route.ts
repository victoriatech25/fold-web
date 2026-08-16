import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";
import { updateOrderFoldItemSchema } from "@/server/orders/order-fold-schema";
import { updateOrderFoldItem } from "@/server/orders/order-fold-service";
import { authorizeOrderRequest, orderRouteErrorResponse } from "@/server/orders/order-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ orderId: string; itemId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeOrderRequest(request, requestId, "order.edit", true);
    if (!auth.ok) return auth.response;
    const { orderId, itemId } = await context.params;
    if (!z.uuid().safeParse(orderId).success || !z.uuid().safeParse(itemId).success) return apiErrorResponse(requestId, 404, "NOT_FOUND", "절곡 작업을 찾을 수 없습니다.");
    const body = await readJsonBody(request, 65_536);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = updateOrderFoldItemSchema.safeParse(body.value);
    if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "절곡 작업 변경 정보를 확인해 주세요.");
    return jsonResponse({ data: await updateOrderFoldItem(getPrisma(), auth.context, { orderId, itemId, ...parsed.data, requestId }) }, requestId);
  } catch (error) {
    return orderRouteErrorResponse(error, requestId);
  }
}

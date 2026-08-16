import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";
import { addOrderFoldItemSchema } from "@/server/orders/order-fold-schema";
import { addOrderFoldItem, listOrderFoldItems } from "@/server/orders/order-fold-service";
import { authorizeOrderRequest, orderRouteErrorResponse } from "@/server/orders/order-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ orderId: string }> };

async function readOrderId(context: Context, requestId: string) {
  const { orderId } = await context.params;
  return z.uuid().safeParse(orderId).success ? orderId : apiErrorResponse(requestId, 404, "NOT_FOUND", "수주를 찾을 수 없습니다.");
}

export async function GET(request: Request, context: Context) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeOrderRequest(request, requestId, "order.read", false);
    if (!auth.ok) return auth.response;
    const orderId = await readOrderId(context, requestId);
    return orderId instanceof Response ? orderId : jsonResponse({ data: await listOrderFoldItems(getPrisma(), auth.context, orderId) }, requestId);
  } catch (error) {
    return orderRouteErrorResponse(error, requestId);
  }
}

export async function POST(request: Request, context: Context) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeOrderRequest(request, requestId, "order.edit", true);
    if (!auth.ok) return auth.response;
    const orderId = await readOrderId(context, requestId);
    if (orderId instanceof Response) return orderId;
    const body = await readJsonBody(request, 65_536);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = addOrderFoldItemSchema.safeParse(body.value);
    if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "절곡 작업 추가 정보를 확인해 주세요.");
    return jsonResponse({ data: await addOrderFoldItem(getPrisma(), auth.context, { orderId, ...parsed.data, requestId }) }, requestId, 201);
  } catch (error) {
    return orderRouteErrorResponse(error, requestId);
  }
}

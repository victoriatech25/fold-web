import { z } from "zod";

import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";
import { createOrderCalculationSchema } from "@/server/orders/order-calculation-schema";
import { createOrderCalculationSnapshot } from "@/server/orders/order-calculation-service";
import { authorizeOrderRequest, orderRouteErrorResponse } from "@/server/orders/order-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ orderId: string }> };

export async function POST(request: Request, context: Context) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeOrderRequest(request, requestId, "order.calculate", true);
    if (!auth.ok) return auth.response;
    const { orderId } = await context.params;
    if (!z.uuid().safeParse(orderId).success) return apiErrorResponse(requestId, 404, "NOT_FOUND", "수주를 찾을 수 없습니다.");
    const body = await readJsonBody(request, 65_536);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = createOrderCalculationSchema.safeParse(body.value);
    if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "수주 계산 요청을 확인해 주세요.");
    return jsonResponse({ data: await createOrderCalculationSnapshot(getPrisma(), auth.context, { orderId, ...parsed.data, requestId }) }, requestId, 201);
  } catch (error) {
    return orderRouteErrorResponse(error, requestId);
  }
}

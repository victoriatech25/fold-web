import { z } from "zod";
import { SalesOrderStatus } from "@/generated/prisma/client";
import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";
import { orderFieldsSchema } from "@/server/orders/order-schema";
import { authorizeOrderRequest, orderRouteErrorResponse } from "@/server/orders/order-route";
import { createOrder, listOrdersPage } from "@/server/orders/order-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.strictObject(orderFieldsSchema);
const statuses = new Set(Object.values(SalesOrderStatus));

function readDate(value: string | null) {
  if (!value) return undefined;
  if (!z.iso.date().safeParse(value).success) return null;
  return new Date(`${value}T00:00:00.000Z`);
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeOrderRequest(request, requestId, "order.read", false);
    if (!auth.ok) return auth.response;
    const url = new URL(request.url);
    const rawStatuses = url.searchParams.get("statuses")?.split(",").filter(Boolean) ?? [];
    if (rawStatuses.some((status) => !statuses.has(status as SalesOrderStatus))) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "수주 상태가 올바르지 않습니다.");
    const orderedFrom = readDate(url.searchParams.get("orderedFrom"));
    const orderedTo = readDate(url.searchParams.get("orderedTo"));
    if (orderedFrom === null || orderedTo === null || (orderedFrom && orderedTo && orderedFrom > orderedTo)) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "수주일 범위를 확인해 주세요.");
    const customerId = url.searchParams.get("customerId") || undefined;
    const ownerMembershipId = url.searchParams.get("ownerMembershipId") || undefined;
    if ((customerId && !z.uuid().safeParse(customerId).success) || (ownerMembershipId && !z.uuid().safeParse(ownerMembershipId).success)) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "수주 검색 조건을 확인해 주세요.");
    const limitValue = url.searchParams.get("limit") || "25";
    if (limitValue !== "25" && limitValue !== "100") return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "목록 크기를 확인해 주세요.");
    return jsonResponse({ data: await listOrdersPage(getPrisma(), auth.context, {
      q: url.searchParams.get("q") || undefined,
      customerId,
      ownerMembershipId,
      statuses: rawStatuses as SalesOrderStatus[],
      orderedFrom: orderedFrom ?? undefined,
      orderedTo: orderedTo ?? undefined,
      cursor: url.searchParams.get("cursor") || undefined,
      limit: Number(limitValue) as 25 | 100,
    }) }, requestId);
  } catch (error) {
    return orderRouteErrorResponse(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeOrderRequest(request, requestId, "order.edit", true);
    if (!auth.ok) return auth.response;
    const body = await readJsonBody(request, 65_536);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = createSchema.safeParse(body.value);
    if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "수주 정보를 확인해 주세요.");
    return jsonResponse({ data: await createOrder(getPrisma(), auth.context, { ...parsed.data, requestId }) }, requestId, 201);
  } catch (error) {
    return orderRouteErrorResponse(error, requestId);
  }
}

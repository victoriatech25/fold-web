import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";
import { orderFieldsSchema } from "@/server/orders/order-schema";
import { authorizeOrderRequest, orderRouteErrorResponse } from "@/server/orders/order-route";
import { createOrder, listOrders } from "@/server/orders/order-service";
export const runtime="nodejs"; export const dynamic="force-dynamic";
const createSchema=z.strictObject(orderFieldsSchema);
export async function GET(request:Request){const requestId=getRequestId(request);try{const auth=await authorizeOrderRequest(request,requestId,"order.read",false);if(!auth.ok)return auth.response; const u=new URL(request.url), s=u.searchParams.get("status");if(s&&s!=="DRAFT"&&s!=="CANCELLED")return apiErrorResponse(requestId,400,"INVALID_REQUEST","수주 상태가 올바르지 않습니다.");return jsonResponse({data:await listOrders(getPrisma(),auth.context,{q:u.searchParams.get("q")||undefined,status:s as "DRAFT"|"CANCELLED"|undefined})},requestId)}catch(e){return orderRouteErrorResponse(e,requestId)}}
export async function POST(request:Request){const requestId=getRequestId(request);try{const auth=await authorizeOrderRequest(request,requestId,"order.edit",true);if(!auth.ok)return auth.response;const body=await readJsonBody(request,65536);if(!body.ok)return apiErrorResponse(requestId,body.status,body.code,body.message);const p=createSchema.safeParse(body.value);if(!p.success)return apiErrorResponse(requestId,400,"INVALID_REQUEST","수주 정보를 확인해 주세요.");return jsonResponse({data:await createOrder(getPrisma(),auth.context,p.data)},requestId,201)}catch(e){return orderRouteErrorResponse(e,requestId)}}

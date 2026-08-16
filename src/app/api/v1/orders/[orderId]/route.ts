import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";
import { orderFieldsSchema } from "@/server/orders/order-schema";
import { authorizeOrderRequest, orderRouteErrorResponse } from "@/server/orders/order-route";
import { getOrder, updateOrder } from "@/server/orders/order-service";
export const runtime="nodejs"; export const dynamic="force-dynamic"; const patchSchema=z.strictObject({...orderFieldsSchema,expectedLockVersion:z.number().int().positive()}); type C={params:Promise<{orderId:string}>};
async function id(c:C,r:string){const v=(await c.params).orderId;return z.uuid().safeParse(v).success?v:apiErrorResponse(r,404,"NOT_FOUND","수주를 찾을 수 없습니다.")}
export async function GET(req:Request,c:C){const r=getRequestId(req);try{const a=await authorizeOrderRequest(req,r,"order.read",false);if(!a.ok)return a.response;const v=await id(c,r);return v instanceof Response?v:jsonResponse({data:await getOrder(getPrisma(),a.context,v)},r)}catch(e){return orderRouteErrorResponse(e,r)}}
export async function PATCH(req:Request,c:C){const r=getRequestId(req);try{const a=await authorizeOrderRequest(req,r,"order.edit",true);if(!a.ok)return a.response;const v=await id(c,r);if(v instanceof Response)return v;const b=await readJsonBody(req,65536);if(!b.ok)return apiErrorResponse(r,b.status,b.code,b.message);const p=patchSchema.safeParse(b.value);if(!p.success)return apiErrorResponse(r,400,"INVALID_REQUEST","수주 변경 정보를 확인해 주세요.");return jsonResponse({data:await updateOrder(getPrisma(),a.context,{...p.data,id:v,requestId:r})},r)}catch(e){return orderRouteErrorResponse(e,r)}}

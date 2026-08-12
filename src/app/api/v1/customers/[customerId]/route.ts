import { z } from "zod";

import { customerFieldsSchema } from "@/server/customers/customer-schema";
import { getCustomer, updateCustomer } from "@/server/customers/customer-service";
import {
  authorizeCustomerRequest,
  customerRouteErrorResponse,
} from "@/server/customers/customer-route";
import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.strictObject({
  ...customerFieldsSchema,
  active: z.boolean(),
  expectedLockVersion: z.number().int().positive(),
});

type Context = { params: Promise<{ customerId: string }> };

async function readId(context: Context, requestId: string) {
  const { customerId } = await context.params;
  if (!z.uuid().safeParse(customerId).success) {
    return apiErrorResponse(requestId, 404, "NOT_FOUND", "거래처를 찾을 수 없습니다.");
  }
  return customerId;
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeCustomerRequest(request, requestId, "customer.read", false);
    if (!authorization.ok) return authorization.response;
    const customerId = await readId(context, requestId);
    if (customerId instanceof Response) return customerId;
    const data = await getCustomer(getPrisma(), authorization.context, customerId);
    return jsonResponse({ data }, requestId);
  } catch (error) {
    return customerRouteErrorResponse(error, requestId, "get customer");
  }
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeCustomerRequest(request, requestId, "customer.write", true);
    if (!authorization.ok) return authorization.response;
    const customerId = await readId(context, requestId);
    if (customerId instanceof Response) return customerId;
    const body = await readJsonBody(request, 65_536);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = updateSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "거래처 변경 정보를 확인해 주세요.");
    }
    const data = await updateCustomer(getPrisma(), authorization.context, {
      ...parsed.data,
      customerId,
      requestId,
    });
    return jsonResponse({ data }, requestId);
  } catch (error) {
    return customerRouteErrorResponse(error, requestId, "update customer");
  }
}

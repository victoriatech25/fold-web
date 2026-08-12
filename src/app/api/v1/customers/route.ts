import { z } from "zod";

import {
  customerFieldsSchema,
  customerTypeSchema,
} from "@/server/customers/customer-schema";
import {
  createCustomer,
  listCustomers,
} from "@/server/customers/customer-service";
import {
  authorizeCustomerRequest,
  customerRouteErrorResponse,
} from "@/server/customers/customer-route";
import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.strictObject(customerFieldsSchema);

export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeCustomerRequest(
      request,
      requestId,
      "customer.read",
      false,
    );
    if (!authorization.ok) return authorization.response;
    const url = new URL(request.url);
    const typeValue = url.searchParams.get("type") || undefined;
    const parsedType = typeValue ? customerTypeSchema.safeParse(typeValue) : null;
    if (parsedType && !parsedType.success) {
      return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "거래처 유형이 올바르지 않습니다.");
    }
    const limitValue = Number(url.searchParams.get("limit") || "25");
    if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 100) {
      return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "목록 크기는 1~100이어야 합니다.");
    }
    const data = await listCustomers(getPrisma(), authorization.context, {
      q: url.searchParams.get("q") || undefined,
      type: parsedType?.success ? parsedType.data : undefined,
      includeInactive: url.searchParams.get("includeInactive") === "true",
      cursor: url.searchParams.get("cursor") || undefined,
      limit: limitValue,
    });
    return jsonResponse({ data }, requestId);
  } catch (error) {
    return customerRouteErrorResponse(error, requestId, "list customers");
  }
}

export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeCustomerRequest(
      request,
      requestId,
      "customer.write",
      true,
    );
    if (!authorization.ok) return authorization.response;
    const body = await readJsonBody(request, 65_536);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = createSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "거래처 정보를 확인해 주세요.");
    }
    const data = await createCustomer(getPrisma(), authorization.context, {
      ...parsed.data,
      requestId,
    });
    return jsonResponse({ data }, requestId, 201);
  } catch (error) {
    return customerRouteErrorResponse(error, requestId, "create customer");
  }
}

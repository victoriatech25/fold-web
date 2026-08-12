import { z } from "zod";

import { customerSiteFieldsSchema } from "@/server/customers/customer-schema";
import { updateCustomerSite } from "@/server/customers/customer-service";
import { authorizeCustomerRequest, customerRouteErrorResponse } from "@/server/customers/customer-route";
import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.strictObject({
  ...customerSiteFieldsSchema,
  active: z.boolean(),
  expectedLockVersion: z.number().int().positive(),
});
type Context = { params: Promise<{ customerId: string; siteId: string }> };

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeCustomerRequest(request, requestId, "customer.write", true);
    if (!authorization.ok) return authorization.response;
    const { customerId, siteId } = await context.params;
    if (!z.uuid().safeParse(customerId).success || !z.uuid().safeParse(siteId).success) {
      return apiErrorResponse(requestId, 404, "NOT_FOUND", "고객 현장을 찾을 수 없습니다.");
    }
    const body = await readJsonBody(request, 32_768);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = updateSchema.safeParse(body.value);
    if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "고객 현장 변경 정보를 확인해 주세요.");
    const data = await updateCustomerSite(getPrisma(), authorization.context, {
      ...parsed.data,
      customerId,
      siteId,
      requestId,
    });
    return jsonResponse({ data }, requestId);
  } catch (error) {
    return customerRouteErrorResponse(error, requestId, "update customer site");
  }
}

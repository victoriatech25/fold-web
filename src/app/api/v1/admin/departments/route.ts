import { z } from "zod";

import {
  createOrganizationDepartment,
  listAdminDepartments,
} from "@/server/admin/admin-service";
import {
  adminRouteErrorResponse,
  authorizeAdminRequest,
} from "@/server/admin/admin-route";
import { getPrisma } from "@/server/db/prisma";
import {
  apiErrorResponse,
  getRequestId,
  jsonResponse,
} from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z
  .object({
    code: z.string().trim().min(2).max(50),
    name: z.string().trim().min(1).max(100),
  })
  .strict();

export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeAdminRequest(
      request,
      requestId,
      false,
    );
    if (!authorization.ok) return authorization.response;
    const data = await listAdminDepartments(
      getPrisma(),
      authorization.context,
    );
    return jsonResponse({ data: { departments: data } }, requestId);
  } catch (error) {
    return adminRouteErrorResponse(error, requestId, "list departments");
  }
}

export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeAdminRequest(
      request,
      requestId,
      true,
    );
    if (!authorization.ok) return authorization.response;
    const body = await readJsonBody(request, 16_384);
    if (!body.ok) {
      return apiErrorResponse(
        requestId,
        body.status,
        body.code,
        body.message,
      );
    }
    const parsed = createSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiErrorResponse(
        requestId,
        400,
        "INVALID_REQUEST",
        "부서 정보를 확인해 주세요.",
      );
    }
    const data = await createOrganizationDepartment(
      getPrisma(),
      authorization.context,
      { ...parsed.data, requestId },
    );
    return jsonResponse({ data }, requestId, 201);
  } catch (error) {
    return adminRouteErrorResponse(error, requestId, "create department");
  }
}

import { z } from "zod";

import { updateOrganizationDepartment } from "@/server/admin/admin-service";
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

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    active: z.boolean().optional(),
    expectedUpdatedAt: z.iso.datetime(),
  })
  .strict()
  .refine((value) =>
    Object.entries(value).some(
      ([key, entry]) => key !== "expectedUpdatedAt" && entry !== undefined,
    ),
  );

type DepartmentRouteContext = {
  params: Promise<{ departmentId: string }>;
};

export async function PATCH(
  request: Request,
  context: DepartmentRouteContext,
): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeAdminRequest(
      request,
      requestId,
      true,
    );
    if (!authorization.ok) return authorization.response;
    const { departmentId } = await context.params;
    if (!z.uuid().safeParse(departmentId).success) {
      return apiErrorResponse(
        requestId,
        404,
        "NOT_FOUND",
        "부서를 찾을 수 없습니다.",
      );
    }
    const body = await readJsonBody(request, 16_384);
    if (!body.ok) {
      return apiErrorResponse(
        requestId,
        body.status,
        body.code,
        body.message,
      );
    }
    const parsed = updateSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiErrorResponse(
        requestId,
        400,
        "INVALID_REQUEST",
        "부서 변경 정보를 확인해 주세요.",
      );
    }
    const data = await updateOrganizationDepartment(
      getPrisma(),
      authorization.context,
      {
        ...parsed.data,
        departmentId,
        expectedUpdatedAt: new Date(parsed.data.expectedUpdatedAt),
        requestId,
      },
    );
    return jsonResponse({ data }, requestId);
  } catch (error) {
    return adminRouteErrorResponse(error, requestId, "update department");
  }
}

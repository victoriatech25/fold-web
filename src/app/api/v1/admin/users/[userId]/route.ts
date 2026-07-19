import { z } from "zod";

import { updateOrganizationUser } from "@/server/admin/admin-service";
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
    displayName: z.string().trim().min(1).max(100).optional(),
    status: z
      .enum(["INVITED", "ACTIVE", "SUSPENDED", "DISABLED"])
      .optional(),
    departmentId: z.uuid().nullable().optional(),
    roleIds: z.array(z.uuid()).min(1).max(20).optional(),
    expectedUpdatedAt: z.iso.datetime(),
  })
  .strict()
  .refine(
    (value) =>
      Object.entries(value).some(
        ([key, entry]) =>
          key !== "expectedUpdatedAt" && entry !== undefined,
      ),
    { message: "At least one change is required." },
  );

type UserRouteContext = {
  params: Promise<{ userId: string }>;
};

export async function PATCH(
  request: Request,
  context: UserRouteContext,
): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeAdminRequest(
      request,
      requestId,
      true,
    );
    if (!authorization.ok) return authorization.response;
    const { userId } = await context.params;
    if (!z.uuid().safeParse(userId).success) {
      return apiErrorResponse(
        requestId,
        404,
        "NOT_FOUND",
        "사용자를 찾을 수 없습니다.",
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
        "사용자 변경 정보를 확인해 주세요.",
      );
    }
    const data = await updateOrganizationUser(
      getPrisma(),
      authorization.context,
      {
        ...parsed.data,
        userId,
        expectedUpdatedAt: new Date(parsed.data.expectedUpdatedAt),
        requestId,
      },
    );
    return jsonResponse({ data }, requestId);
  } catch (error) {
    return adminRouteErrorResponse(error, requestId, "update user");
  }
}

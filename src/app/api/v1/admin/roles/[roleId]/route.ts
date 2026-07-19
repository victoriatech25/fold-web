import { z } from "zod";

import { permissionCatalog } from "@/domain/permission";
import { updateOrganizationRole } from "@/server/admin/admin-service";
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

const permissionSchema = z.enum(
  permissionCatalog.map(({ key }) => key) as [
    (typeof permissionCatalog)[number]["key"],
    ...(typeof permissionCatalog)[number]["key"][],
  ],
);
const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    active: z.boolean().optional(),
    permissions: z.array(permissionSchema).max(17).optional(),
    expectedUpdatedAt: z.iso.datetime(),
  })
  .strict()
  .refine((value) =>
    Object.entries(value).some(
      ([key, entry]) => key !== "expectedUpdatedAt" && entry !== undefined,
    ),
  );

type RoleRouteContext = {
  params: Promise<{ roleId: string }>;
};

export async function PATCH(
  request: Request,
  context: RoleRouteContext,
): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeAdminRequest(
      request,
      requestId,
      true,
    );
    if (!authorization.ok) return authorization.response;
    const { roleId } = await context.params;
    if (!z.uuid().safeParse(roleId).success) {
      return apiErrorResponse(
        requestId,
        404,
        "NOT_FOUND",
        "역할을 찾을 수 없습니다.",
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
        "역할 변경 정보를 확인해 주세요.",
      );
    }
    const data = await updateOrganizationRole(
      getPrisma(),
      authorization.context,
      {
        ...parsed.data,
        roleId,
        expectedUpdatedAt: new Date(parsed.data.expectedUpdatedAt),
        requestId,
      },
    );
    return jsonResponse({ data }, requestId);
  } catch (error) {
    return adminRouteErrorResponse(error, requestId, "update role");
  }
}

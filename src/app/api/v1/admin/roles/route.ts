import { z } from "zod";

import {
  createOrganizationRole,
  listAdminPermissions,
  listAdminRoles,
} from "@/server/admin/admin-service";
import {
  adminRouteErrorResponse,
  authorizeAdminRequest,
} from "@/server/admin/admin-route";
import { permissionCatalog } from "@/domain/permission";
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
const createSchema = z
  .object({
    key: z.string().trim().min(3).max(50),
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).nullable(),
    permissions: z.array(permissionSchema).max(17),
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
    const [roles, permissions] = await Promise.all([
      listAdminRoles(getPrisma(), authorization.context),
      Promise.resolve(listAdminPermissions(authorization.context)),
    ]);
    return jsonResponse({ data: { roles, permissions } }, requestId);
  } catch (error) {
    return adminRouteErrorResponse(error, requestId, "list roles");
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
        "역할 정보를 확인해 주세요.",
      );
    }
    const data = await createOrganizationRole(
      getPrisma(),
      authorization.context,
      { ...parsed.data, requestId },
    );
    return jsonResponse({ data }, requestId, 201);
  } catch (error) {
    return adminRouteErrorResponse(error, requestId, "create role");
  }
}

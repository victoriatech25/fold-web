import { z } from "zod";

import { inviteOrganizationUser } from "@/server/admin/admin-service";
import {
  adminRouteErrorResponse,
  authorizeAdminRequest,
} from "@/server/admin/admin-route";
import { readAuthRuntimeConfig } from "@/server/auth/auth-config";
import { getPrisma } from "@/server/db/prisma";
import {
  apiErrorResponse,
  getRequestId,
  jsonResponse,
} from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const invitationSchema = z
  .object({
    email: z.email().max(320),
    displayName: z.string().trim().min(1).max(100),
    departmentId: z.uuid().nullable(),
    roleIds: z.array(z.uuid()).min(1).max(20),
  })
  .strict();

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
    const parsed = invitationSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiErrorResponse(
        requestId,
        400,
        "INVALID_REQUEST",
        "초대 정보를 확인해 주세요.",
      );
    }
    const data = await inviteOrganizationUser(
      getPrisma(),
      authorization.context,
      {
        ...parsed.data,
        requestId,
        config: readAuthRuntimeConfig(),
      },
    );
    return jsonResponse({ data }, requestId, 201);
  } catch (error) {
    return adminRouteErrorResponse(error, requestId, "invite user");
  }
}

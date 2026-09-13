import { z } from "zod";

import { readAuthRuntimeConfig } from "@/server/auth/auth-config";
import { getPrisma } from "@/server/db/prisma";
import {
  apiErrorResponse,
  getRequestId,
  jsonResponse,
} from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";
import {
  authorizePlatformAdminRequest,
  organizationRouteErrorResponse,
} from "@/server/organizations/organization-route";
import { invitePlatformOrganizationAdministrator } from "@/server/organizations/organization-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const invitationSchema = z
  .object({
    email: z.email().max(320),
    displayName: z.string().trim().min(1).max(100),
  })
  .strict();

type RouteContext = { params: Promise<{ organizationId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizePlatformAdminRequest(request, requestId, true);
    if (!authorization.ok) return authorization.response;
    const { organizationId } = await context.params;
    if (!z.uuid().safeParse(organizationId).success) {
      return apiErrorResponse(requestId, 404, "NOT_FOUND", "회사를 찾을 수 없습니다.");
    }
    const body = await readJsonBody(request, 16_384);
    if (!body.ok) {
      return apiErrorResponse(requestId, body.status, body.code, body.message);
    }
    const parsed = invitationSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "관리자 정보를 확인해 주세요.");
    }
    const data = await invitePlatformOrganizationAdministrator(getPrisma(), authorization.context, {
      ...parsed.data,
      organizationId,
      requestId,
      config: readAuthRuntimeConfig(),
    });
    return jsonResponse({ data }, requestId, 201);
  } catch (error) {
    return organizationRouteErrorResponse(error, requestId, "invite organization administrator");
  }
}

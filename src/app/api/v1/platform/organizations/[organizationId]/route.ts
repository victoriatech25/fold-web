import { z } from "zod";

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
import { updatePlatformOrganization } from "@/server/organizations/organization-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
    expectedUpdatedAt: z.iso.datetime(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.status !== undefined);

type OrganizationRouteContext = {
  params: Promise<{ organizationId: string }>;
};

export async function PATCH(
  request: Request,
  context: OrganizationRouteContext,
): Promise<Response> {
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
    const parsed = updateSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "회사 변경 정보를 확인해 주세요.");
    }
    const data = await updatePlatformOrganization(getPrisma(), authorization.context, {
      ...parsed.data,
      organizationId,
      expectedUpdatedAt: new Date(parsed.data.expectedUpdatedAt),
      requestId,
    });
    return jsonResponse({ data }, requestId);
  } catch (error) {
    return organizationRouteErrorResponse(error, requestId, "update organization");
  }
}

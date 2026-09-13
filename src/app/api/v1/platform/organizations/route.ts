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
import {
  createPlatformOrganization,
  listPlatformOrganizations,
} from "@/server/organizations/organization-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z
  .object({
    code: z.string().trim().min(2).max(50),
    name: z.string().trim().min(1).max(200),
  })
  .strict();

export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizePlatformAdminRequest(request, requestId, false);
    if (!authorization.ok) return authorization.response;
    const organizations = await listPlatformOrganizations(getPrisma(), authorization.context);
    return jsonResponse({ data: { organizations } }, requestId);
  } catch (error) {
    return organizationRouteErrorResponse(error, requestId, "list organizations");
  }
}

export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizePlatformAdminRequest(request, requestId, true);
    if (!authorization.ok) return authorization.response;
    const body = await readJsonBody(request, 16_384);
    if (!body.ok) {
      return apiErrorResponse(requestId, body.status, body.code, body.message);
    }
    const parsed = createSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "회사 정보를 확인해 주세요.");
    }
    const data = await createPlatformOrganization(getPrisma(), authorization.context, {
      ...parsed.data,
      requestId,
    });
    return jsonResponse({ data }, requestId, 201);
  } catch (error) {
    return organizationRouteErrorResponse(error, requestId, "create organization");
  }
}

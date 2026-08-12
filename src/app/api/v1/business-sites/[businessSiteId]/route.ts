import { z } from "zod";

import {
  businessSiteTypeSchema,
  contactFieldsSchema,
} from "@/server/company-settings/company-settings-schema";
import {
  getBusinessSite,
  updateBusinessSite,
} from "@/server/company-settings/company-settings-service";
import {
  authorizeCompanySettingsRequest,
  companySettingsRouteErrorResponse,
} from "@/server/company-settings/company-settings-route";
import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: businessSiteTypeSchema,
  ...contactFieldsSchema,
  active: z.boolean(),
  expectedLockVersion: z.number().int().min(1),
}).strict();

type BusinessSiteRouteContext = {
  params: Promise<{ businessSiteId: string }>;
};

async function readBusinessSiteId(
  context: BusinessSiteRouteContext,
  requestId: string,
): Promise<string | Response> {
  const { businessSiteId } = await context.params;
  if (!z.uuid().safeParse(businessSiteId).success) {
    return apiErrorResponse(requestId, 404, "NOT_FOUND", "사업장을 찾을 수 없습니다.");
  }
  return businessSiteId;
}

export async function GET(
  request: Request,
  context: BusinessSiteRouteContext,
): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeCompanySettingsRequest(
      request,
      requestId,
      "master_data.read",
      false,
    );
    if (!authorization.ok) return authorization.response;
    const businessSiteId = await readBusinessSiteId(context, requestId);
    if (businessSiteId instanceof Response) return businessSiteId;
    const data = await getBusinessSite(getPrisma(), authorization.context, businessSiteId);
    return jsonResponse({ data }, requestId);
  } catch (error) {
    return companySettingsRouteErrorResponse(error, requestId, "get business site");
  }
}

export async function PATCH(
  request: Request,
  context: BusinessSiteRouteContext,
): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeCompanySettingsRequest(
      request,
      requestId,
      "master_data.manage",
      true,
    );
    if (!authorization.ok) return authorization.response;
    const businessSiteId = await readBusinessSiteId(context, requestId);
    if (businessSiteId instanceof Response) return businessSiteId;
    const body = await readJsonBody(request, 32_768);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = updateSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "사업장 변경 정보를 확인해 주세요.");
    }
    const data = await updateBusinessSite(getPrisma(), authorization.context, {
      ...parsed.data,
      businessSiteId,
      requestId,
    });
    return jsonResponse({ data }, requestId);
  } catch (error) {
    return companySettingsRouteErrorResponse(error, requestId, "update business site");
  }
}

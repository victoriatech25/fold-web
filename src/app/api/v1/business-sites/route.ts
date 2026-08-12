import { z } from "zod";

import {
  businessSiteTypeSchema,
  contactFieldsSchema,
} from "@/server/company-settings/company-settings-schema";
import {
  createBusinessSite,
  getCompanySettings,
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

const createSchema = z.object({
  code: z.string().trim().min(2).max(50),
  name: z.string().trim().min(1).max(200),
  type: businessSiteTypeSchema,
  ...contactFieldsSchema,
}).strict();

export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeCompanySettingsRequest(
      request,
      requestId,
      "master_data.read",
      false,
    );
    if (!authorization.ok) return authorization.response;
    const settings = await getCompanySettings(getPrisma(), authorization.context);
    return jsonResponse({ data: { businessSites: settings.businessSites } }, requestId);
  } catch (error) {
    return companySettingsRouteErrorResponse(error, requestId, "list business sites");
  }
}

export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeCompanySettingsRequest(
      request,
      requestId,
      "master_data.manage",
      true,
    );
    if (!authorization.ok) return authorization.response;
    const body = await readJsonBody(request, 32_768);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = createSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "사업장 정보를 확인해 주세요.");
    }
    const data = await createBusinessSite(getPrisma(), authorization.context, {
      ...parsed.data,
      requestId,
    });
    return jsonResponse({ data }, requestId, 201);
  } catch (error) {
    return companySettingsRouteErrorResponse(error, requestId, "create business site");
  }
}

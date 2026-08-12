import { z } from "zod";

import { contactFieldsSchema } from "@/server/company-settings/company-settings-schema";
import {
  getCompanySettings,
  updateCompanyProfile,
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
  ...contactFieldsSchema,
  expectedOrganizationLockVersion: z.number().int().min(0),
  expectedProfileLockVersion: z.number().int().min(0),
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
    return jsonResponse({ data: settings.company }, requestId);
  } catch (error) {
    return companySettingsRouteErrorResponse(error, requestId, "get company profile");
  }
}

export async function PATCH(request: Request): Promise<Response> {
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
    const parsed = updateSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "회사 정보를 확인해 주세요.");
    }
    const data = await updateCompanyProfile(getPrisma(), authorization.context, {
      ...parsed.data,
      requestId,
    });
    return jsonResponse({ data }, requestId);
  } catch (error) {
    return companySettingsRouteErrorResponse(error, requestId, "update company profile");
  }
}

import { z } from "zod";

import { setDefaultBusinessSite } from "@/server/company-settings/company-settings-service";
import {
  authorizeCompanySettingsRequest,
  companySettingsRouteErrorResponse,
} from "@/server/company-settings/company-settings-route";
import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  expectedLockVersion: z.number().int().min(1),
}).strict();

type DefaultBusinessSiteRouteContext = {
  params: Promise<{ businessSiteId: string }>;
};

export async function POST(
  request: Request,
  context: DefaultBusinessSiteRouteContext,
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
    const { businessSiteId } = await context.params;
    if (!z.uuid().safeParse(businessSiteId).success) {
      return apiErrorResponse(requestId, 404, "NOT_FOUND", "사업장을 찾을 수 없습니다.");
    }
    const body = await readJsonBody(request, 16_384);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = requestSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "기본 사업장 변경 정보를 확인해 주세요.");
    }
    const data = await setDefaultBusinessSite(getPrisma(), authorization.context, {
      businessSiteId,
      expectedLockVersion: parsed.data.expectedLockVersion,
      requestId,
    });
    return jsonResponse({ data }, requestId);
  } catch (error) {
    return companySettingsRouteErrorResponse(error, requestId, "set default business site");
  }
}

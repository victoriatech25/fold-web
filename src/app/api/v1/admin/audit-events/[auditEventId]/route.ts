import { z } from "zod";

import { auditRouteErrorResponse } from "@/server/audit/audit-route";
import { getAuditEvent } from "@/server/audit/audit-service";
import { getPrisma } from "@/server/db/prisma";
import {
  apiErrorResponse,
  getRequestId,
  jsonResponse,
} from "@/server/http/api-response";
import { authorizeApiRequest } from "@/server/http/authorize-api-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuditEventRouteContext = {
  params: Promise<{ auditEventId: string }>;
};

export async function GET(
  request: Request,
  context: AuditEventRouteContext,
): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeApiRequest(
      request,
      requestId,
      "audit.read",
    );
    if (!authorization.ok) return authorization.response;
    const { auditEventId } = await context.params;
    if (!z.uuid().safeParse(auditEventId).success) {
      return apiErrorResponse(
        requestId,
        404,
        "NOT_FOUND",
        "감사 로그를 찾을 수 없습니다.",
      );
    }
    const data = await getAuditEvent(
      getPrisma(),
      authorization.context,
      auditEventId,
      requestId,
    );
    return jsonResponse({ data }, requestId);
  } catch (error) {
    return auditRouteErrorResponse(error, requestId, "get audit event");
  }
}

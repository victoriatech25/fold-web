import { z } from "zod";

import { issueOrganizationUserPasswordReset } from "@/server/admin/admin-service";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PasswordResetRouteContext = {
  params: Promise<{ userId: string }>;
};

export async function POST(
  request: Request,
  context: PasswordResetRouteContext,
): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeAdminRequest(
      request,
      requestId,
      true,
    );
    if (!authorization.ok) return authorization.response;
    const { userId } = await context.params;
    if (!z.uuid().safeParse(userId).success) {
      return apiErrorResponse(
        requestId,
        404,
        "NOT_FOUND",
        "사용자를 찾을 수 없습니다.",
      );
    }
    const data = await issueOrganizationUserPasswordReset(
      getPrisma(),
      authorization.context,
      {
        userId,
        requestId,
        config: readAuthRuntimeConfig(),
      },
    );
    return jsonResponse({ data }, requestId, 201);
  } catch (error) {
    return adminRouteErrorResponse(error, requestId, "issue password reset");
  }
}

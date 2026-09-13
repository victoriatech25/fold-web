import "server-only";

import { adminRouteErrorResponse } from "@/server/admin/admin-route";
import { readAuthRuntimeConfig } from "@/server/auth/auth-config";
import { hasAllowedMutationOrigin } from "@/server/auth/request-security";
import { writeDeniedAuditBestEffort } from "@/server/audit/audit-writer";
import { isPlatformAdmin } from "@/server/authorization/authorization";
import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse } from "@/server/http/api-response";
import {
  authenticateApiRequest,
  type ApiAuthorizationResult,
} from "@/server/http/authorize-api-request";

/**
 * 조직 권한이 아니라 플랫폼 관리자 플래그로 연다. 거절은 `admin.manage` 거절과 같은
 * 감사 항목에 남기되 `entityId` 로 플랫폼 작업임을 구분한다.
 */
export async function authorizePlatformAdminRequest(
  request: Request,
  requestId: string,
  mutation: boolean,
): Promise<ApiAuthorizationResult> {
  const authenticated = await authenticateApiRequest(request, requestId);
  if (!authenticated.ok) return authenticated;
  const { context } = authenticated;
  const config = readAuthRuntimeConfig();
  const reason = !isPlatformAdmin(context)
    ? "MISSING_PLATFORM_ADMIN"
    : mutation && !hasAllowedMutationOrigin(request, config)
      ? "INVALID_MUTATION_ORIGIN"
      : null;
  if (reason === null) return authenticated;
  await writeDeniedAuditBestEffort(getPrisma(), {
    organizationId: context.organizationId,
    actorUserId: context.userId,
    action: "authorization.permission_denied",
    entityId: "platform.admin",
    requestId,
    metadata: { reason },
  });
  return {
    ok: false,
    response: apiErrorResponse(
      requestId,
      403,
      "FORBIDDEN",
      reason === "INVALID_MUTATION_ORIGIN"
        ? "허용되지 않은 요청 출처입니다."
        : "플랫폼 관리자만 수행할 수 있는 작업입니다.",
    ),
  };
}

export { adminRouteErrorResponse as organizationRouteErrorResponse };

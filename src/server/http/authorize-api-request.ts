import "server-only";

import type { PermissionKey } from "@/domain/permission";
import { readAuthRuntimeConfig } from "@/server/auth/auth-config";
import { getAuthenticatedContext } from "@/server/auth/auth-service";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { readSessionCookie } from "@/server/auth/session-cookie";
import { writeDeniedAuditBestEffort } from "@/server/audit/audit-writer";
import { hasPermission } from "@/server/authorization/authorization";
import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse } from "@/server/http/api-response";

export type ApiAuthorizationResult =
  | { ok: true; context: AuthenticatedContext }
  | { ok: false; response: Response };

/**
 * session만 확인한다. 필요한 권한이 요청 본문에 따라 달라지는 경로(작업 queue처럼
 * 작업 종류가 권한을 정하는 경우)에서 쓰고, 권한 검사는 application service가 한다.
 */
export async function authenticateApiRequest(
  request: Request,
  requestId: string,
): Promise<ApiAuthorizationResult> {
  const config = readAuthRuntimeConfig();
  const token = readSessionCookie(request.headers.get("cookie"), config);
  const context = await getAuthenticatedContext(getPrisma(), {
    token,
    config,
  });
  if (!context) {
    return {
      ok: false,
      response: apiErrorResponse(
        requestId,
        401,
        "UNAUTHENTICATED",
        "로그인이 필요합니다.",
      ),
    };
  }
  return { ok: true, context };
}

export async function authorizeApiRequest(
  request: Request,
  requestId: string,
  permission: PermissionKey,
): Promise<ApiAuthorizationResult> {
  const authenticated = await authenticateApiRequest(request, requestId);
  if (!authenticated.ok) return authenticated;
  const { context } = authenticated;
  if (!hasPermission(context, permission)) {
    await writeDeniedAuditBestEffort(getPrisma(), {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "authorization.permission_denied",
      entityId: permission,
      requestId,
      metadata: { reason: "MISSING_PERMISSION" },
    });
    return {
      ok: false,
      response: apiErrorResponse(
        requestId,
        403,
        "FORBIDDEN",
        "이 작업을 수행할 권한이 없습니다.",
      ),
    };
  }
  return { ok: true, context };
}

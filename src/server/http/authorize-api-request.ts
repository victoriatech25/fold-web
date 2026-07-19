import "server-only";

import type { PermissionKey } from "@/domain/permission";
import { readAuthRuntimeConfig } from "@/server/auth/auth-config";
import { getAuthenticatedContext } from "@/server/auth/auth-service";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { readSessionCookie } from "@/server/auth/session-cookie";
import { hasPermission } from "@/server/authorization/authorization";
import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse } from "@/server/http/api-response";

export type ApiAuthorizationResult =
  | { ok: true; context: AuthenticatedContext }
  | { ok: false; response: Response };

export async function authorizeApiRequest(
  request: Request,
  requestId: string,
  permission: PermissionKey,
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
  if (!hasPermission(context, permission)) {
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

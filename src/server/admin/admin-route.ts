import "server-only";

import { AdminServiceError } from "@/server/admin/admin-error";
import { readAuthRuntimeConfig } from "@/server/auth/auth-config";
import { hasAllowedMutationOrigin } from "@/server/auth/request-security";
import {
  apiErrorResponse,
  type ApiErrorCode,
} from "@/server/http/api-response";
import {
  authorizeApiRequest,
  type ApiAuthorizationResult,
} from "@/server/http/authorize-api-request";

export async function authorizeAdminRequest(
  request: Request,
  requestId: string,
  mutation: boolean,
): Promise<ApiAuthorizationResult> {
  if (
    mutation &&
    !hasAllowedMutationOrigin(request, readAuthRuntimeConfig())
  ) {
    return {
      ok: false,
      response: apiErrorResponse(
        requestId,
        403,
        "FORBIDDEN",
        "허용되지 않은 요청 출처입니다.",
      ),
    };
  }
  return authorizeApiRequest(request, requestId, "admin.manage");
}

export function adminRouteErrorResponse(
  error: unknown,
  requestId: string,
  operation: string,
): Response {
  if (error instanceof AdminServiceError) {
    const statusByCode = {
      INVALID_REQUEST: 400,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
    } as const;
    return apiErrorResponse(
      requestId,
      statusByCode[error.code],
      error.code as ApiErrorCode,
      error.message,
    );
  }
  console.error("Admin request failed.", {
    requestId,
    operation,
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return apiErrorResponse(
    requestId,
    500,
    "INTERNAL_ERROR",
    "서버에서 관리자 요청을 처리하지 못했습니다.",
  );
}

import "server-only";

import { CompanySettingsError } from "@/server/company-settings/company-settings-error";
import type { PermissionKey } from "@/domain/permission";
import { readAuthRuntimeConfig } from "@/server/auth/auth-config";
import { hasAllowedMutationOrigin } from "@/server/auth/request-security";
import { writeDeniedAuditBestEffort } from "@/server/audit/audit-writer";
import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, type ApiErrorCode } from "@/server/http/api-response";
import {
  authorizeApiRequest,
  type ApiAuthorizationResult,
} from "@/server/http/authorize-api-request";

export async function authorizeCompanySettingsRequest(
  request: Request,
  requestId: string,
  permission: PermissionKey,
  mutation: boolean,
): Promise<ApiAuthorizationResult> {
  const authorization = await authorizeApiRequest(request, requestId, permission);
  if (!authorization.ok) return authorization;
  if (mutation && !hasAllowedMutationOrigin(request, readAuthRuntimeConfig())) {
    await writeDeniedAuditBestEffort(getPrisma(), {
      organizationId: authorization.context.organizationId,
      actorUserId: authorization.context.userId,
      action: "authorization.permission_denied",
      entityId: permission,
      requestId,
      metadata: { reason: "INVALID_MUTATION_ORIGIN" },
    });
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
  return authorization;
}

export function companySettingsRouteErrorResponse(
  error: unknown,
  requestId: string,
  operation: string,
): Response {
  if (error instanceof CompanySettingsError) {
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
  console.error("Company settings request failed.", {
    requestId,
    operation,
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return apiErrorResponse(
    requestId,
    500,
    "INTERNAL_ERROR",
    "서버에서 회사·사업장 요청을 처리하지 못했습니다.",
  );
}

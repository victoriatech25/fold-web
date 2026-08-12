import "server-only";

import type { PermissionKey } from "@/domain/permission";
import { writeDeniedAuditBestEffort } from "@/server/audit/audit-writer";
import { readAuthRuntimeConfig } from "@/server/auth/auth-config";
import { hasAllowedMutationOrigin } from "@/server/auth/request-security";
import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, type ApiErrorCode } from "@/server/http/api-response";
import { authorizeApiRequest, type ApiAuthorizationResult } from "@/server/http/authorize-api-request";

import { PricingError } from "./pricing-error";

export async function authorizePricingRequest(request: Request, requestId: string, permission: PermissionKey, mutation: boolean): Promise<ApiAuthorizationResult> {
  const authorization = await authorizeApiRequest(request, requestId, permission);
  if (!authorization.ok) return authorization;
  if (mutation && !hasAllowedMutationOrigin(request, readAuthRuntimeConfig())) {
    await writeDeniedAuditBestEffort(getPrisma(), { organizationId: authorization.context.organizationId, actorUserId: authorization.context.userId, action: "authorization.permission_denied", entityId: permission, requestId, metadata: { reason: "INVALID_MUTATION_ORIGIN" } });
    return { ok: false, response: apiErrorResponse(requestId, 403, "FORBIDDEN", "허용되지 않은 요청 출처입니다.") };
  }
  return authorization;
}

export function pricingRouteErrorResponse(error: unknown, requestId: string, operation: string): Response {
  if (error instanceof PricingError) {
    const status = error.code === "FORBIDDEN" ? 403
      : error.code === "NOT_FOUND" ? 404
        : error.code === "CONFLICT" || error.code === "PRICE_SCOPE_CONFLICT" || error.code === "PRICE_REVISION_LOCKED" ? 409
          : error.code === "PRICE_NOT_CONFIGURED" || error.code === "PRICE_REVISION_NOT_EFFECTIVE" ? 422
            : 400;
    return apiErrorResponse(requestId, status, error.code as ApiErrorCode, error.message);
  }
  console.error("Pricing request failed.", { requestId, operation, errorName: error instanceof Error ? error.name : "UnknownError" });
  return apiErrorResponse(requestId, 500, "INTERNAL_ERROR", "서버에서 가격 요청을 처리하지 못했습니다.");
}

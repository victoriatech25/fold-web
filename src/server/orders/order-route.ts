import "server-only";
import type { PermissionKey } from "@/domain/permission";
import { writeDeniedAuditBestEffort } from "@/server/audit/audit-writer";
import { readAuthRuntimeConfig } from "@/server/auth/auth-config";
import { hasAllowedMutationOrigin } from "@/server/auth/request-security";
import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, type ApiErrorCode } from "@/server/http/api-response";
import { authorizeApiRequest, type ApiAuthorizationResult } from "@/server/http/authorize-api-request";
import { OrderError } from "./order-error";

export async function authorizeOrderRequest(request: Request, requestId: string, permission: PermissionKey, mutation: boolean): Promise<ApiAuthorizationResult> {
  const result = await authorizeApiRequest(request, requestId, permission);
  if (!result.ok || !mutation || hasAllowedMutationOrigin(request, readAuthRuntimeConfig())) return result;
  await writeDeniedAuditBestEffort(getPrisma(), { organizationId: result.context.organizationId, actorUserId: result.context.userId, action: "authorization.permission_denied", entityId: permission, requestId, metadata: { reason: "INVALID_MUTATION_ORIGIN" } });
  return { ok: false, response: apiErrorResponse(requestId, 403, "FORBIDDEN", "허용되지 않은 요청 출처입니다.") };
}
export function orderRouteErrorResponse(error: unknown, requestId: string): Response {
  if (error instanceof OrderError) {
    const status = { INVALID_REQUEST: 400, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409 }[error.code];
    return apiErrorResponse(
      requestId,
      status,
      error.code as ApiErrorCode,
      error.message,
      error.details,
    );
  }
  console.error("Order request failed", { requestId, error });
  return apiErrorResponse(requestId, 500, "INTERNAL_ERROR", "서버에서 수주 요청을 처리하지 못했습니다.");
}

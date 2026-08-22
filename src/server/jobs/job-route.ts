import "server-only";

import { writeDeniedAuditBestEffort } from "@/server/audit/audit-writer";
import { readAuthRuntimeConfig } from "@/server/auth/auth-config";
import { hasAllowedMutationOrigin } from "@/server/auth/request-security";
import { PermissionDeniedError } from "@/server/authorization/authorization";
import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, type ApiErrorCode } from "@/server/http/api-response";
import { authenticateApiRequest, type ApiAuthorizationResult } from "@/server/http/authorize-api-request";

import { JobError } from "./job-error";

/**
 * 필요한 권한은 작업 종류가 정하므로(`D2-B01-J`) 라우트에서는 session과 요청
 * 출처만 확인하고, 실제 권한 검사는 application service가 한다.
 */
export async function authorizeJobRequest(
  request: Request,
  requestId: string,
  mutation: boolean,
): Promise<ApiAuthorizationResult> {
  const result = await authenticateApiRequest(request, requestId);
  if (!result.ok || !mutation || hasAllowedMutationOrigin(request, readAuthRuntimeConfig())) return result;
  await writeDeniedAuditBestEffort(getPrisma(), {
    organizationId: result.context.organizationId,
    actorUserId: result.context.userId,
    action: "authorization.permission_denied",
    entityId: "job.mutation",
    requestId,
    metadata: { reason: "INVALID_MUTATION_ORIGIN" },
  });
  return { ok: false, response: apiErrorResponse(requestId, 403, "FORBIDDEN", "허용되지 않은 요청 출처입니다.") };
}

export function jobRouteErrorResponse(error: unknown, requestId: string): Response {
  if (error instanceof JobError) {
    const status = { INVALID_REQUEST: 400, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409 }[error.code];
    return apiErrorResponse(requestId, status, error.code as ApiErrorCode, error.message, error.details);
  }
  if (error instanceof PermissionDeniedError) {
    return apiErrorResponse(requestId, 403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  }
  console.error("Job request failed", { requestId, error });
  return apiErrorResponse(requestId, 500, "INTERNAL_ERROR", "서버에서 작업 요청을 처리하지 못했습니다.");
}

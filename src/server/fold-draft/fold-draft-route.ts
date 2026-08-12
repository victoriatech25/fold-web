import "server-only";

import type { PermissionKey } from "@/domain/permission";
import { readAuthRuntimeConfig } from "@/server/auth/auth-config";
import { hasAllowedMutationOrigin } from "@/server/auth/request-security";
import { writeDeniedAuditBestEffort } from "@/server/audit/audit-writer";
import { getPrisma } from "@/server/db/prisma";
import { FoldDraftServiceError } from "@/server/fold-draft/fold-draft-error";
import {
  apiErrorResponse,
  jsonResponse,
} from "@/server/http/api-response";
import {
  authorizeApiRequest,
  type ApiAuthorizationResult,
} from "@/server/http/authorize-api-request";

export async function authorizeFoldDraftRequest(
  request: Request,
  requestId: string,
  permission: PermissionKey,
  mutation: boolean,
): Promise<ApiAuthorizationResult> {
  const authorization = await authorizeApiRequest(
    request,
    requestId,
    permission,
  );
  if (!authorization.ok) return authorization;
  if (
    mutation &&
    !hasAllowedMutationOrigin(request, readAuthRuntimeConfig())
  ) {
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

export function foldDraftRouteErrorResponse(
  error: unknown,
  requestId: string,
  operation: string,
): Response {
  if (error instanceof FoldDraftServiceError) {
    const status =
      error.code === "INVALID_REQUEST"
        ? 400
        : error.code === "NOT_FOUND"
          ? 404
          : 409;
    return jsonResponse(
      {
        error: {
          code: error.code,
          message: error.message,
          requestId,
          ...(error.details ?? {}),
        },
      },
      requestId,
      status,
    );
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  ) {
    return apiErrorResponse(
      requestId,
      409,
      "CONFLICT",
      "같은 범위에 동일한 이름 또는 식별자가 이미 있습니다.",
    );
  }
  console.error("Fold draft request failed.", {
    requestId,
    operation,
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return apiErrorResponse(
    requestId,
    500,
    "INTERNAL_ERROR",
    "서버에서 절곡 초안을 처리하지 못했습니다.",
  );
}

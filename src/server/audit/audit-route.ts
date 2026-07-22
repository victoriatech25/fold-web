import "server-only";

import { AuditServiceError } from "@/server/audit/audit-error";
import {
  apiErrorResponse,
  type ApiErrorCode,
} from "@/server/http/api-response";

export function auditRouteErrorResponse(
  error: unknown,
  requestId: string,
  operation: string,
): Response {
  if (error instanceof AuditServiceError) {
    const statusByCode = {
      INVALID_REQUEST: 400,
      NOT_FOUND: 404,
    } as const;
    return apiErrorResponse(
      requestId,
      statusByCode[error.code],
      error.code as ApiErrorCode,
      error.message,
    );
  }
  console.error("Audit request failed.", {
    requestId,
    operation,
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return apiErrorResponse(
    requestId,
    500,
    "INTERNAL_ERROR",
    "서버에서 감사 로그 요청을 처리하지 못했습니다.",
  );
}

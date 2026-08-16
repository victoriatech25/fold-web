import { randomUUID } from "node:crypto";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;

export type ApiErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PRICE_NOT_CONFIGURED"
  | "PRICE_REVISION_NOT_EFFECTIVE"
  | "PRICE_SCOPE_CONFLICT"
  | "PRICE_INPUT_INVALID"
  | "PRICE_REVISION_LOCKED"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "INTERNAL_ERROR";

export function getRequestId(request: Request): string {
  const supplied = request.headers.get("x-request-id");
  return supplied && REQUEST_ID_PATTERN.test(supplied) ? supplied : randomUUID();
}

export function jsonResponse(
  body: unknown,
  requestId: string,
  status = 200,
): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "x-request-id": requestId,
    },
  });
}

export function apiErrorResponse(
  requestId: string,
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): Response {
  return jsonResponse(
    {
      error: {
        code,
        message,
        requestId,
        ...(details === undefined ? {} : { details }),
      },
    },
    requestId,
    status,
  );
}

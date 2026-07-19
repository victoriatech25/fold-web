import { timingSafeEqual } from "node:crypto";

import { getPrisma } from "@/server/db/prisma";
import {
  apiErrorResponse,
  getRequestId,
  jsonResponse,
} from "@/server/http/api-response";
import {
  runDatabaseSmoke,
  type DatabaseSmokeMode,
} from "@/server/platform/database-smoke";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PAYLOAD_BYTES = 1_024;

function isAuthorized(request: Request): boolean {
  const expected = process.env.INTERNAL_SMOKE_TOKEN;
  const provided = request.headers.get("x-internal-smoke-token");
  if (!expected || expected.length < 32 || !provided) return false;

  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return (
    expectedBytes.length === providedBytes.length &&
    timingSafeEqual(expectedBytes, providedBytes)
  );
}

function isDatabaseSmokeMode(value: unknown): value is DatabaseSmokeMode {
  return value === "commit" || value === "rollback";
}

export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request);

  if (!isAuthorized(request)) {
    return apiErrorResponse(requestId, 404, "NOT_FOUND", "요청한 리소스를 찾을 수 없습니다.");
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("application/json")) {
    return apiErrorResponse(
      requestId,
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "application/json 요청이 필요합니다.",
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_PAYLOAD_BYTES) {
    return apiErrorResponse(
      requestId,
      413,
      "PAYLOAD_TOO_LARGE",
      "요청 본문이 너무 큽니다.",
    );
  }

  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_PAYLOAD_BYTES) {
      return apiErrorResponse(
        requestId,
        413,
        "PAYLOAD_TOO_LARGE",
        "요청 본문이 너무 큽니다.",
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return apiErrorResponse(
        requestId,
        400,
        "INVALID_REQUEST",
        "올바른 JSON 요청이 필요합니다.",
      );
    }

    if (
      typeof body !== "object" ||
      body === null ||
      !("mode" in body) ||
      !isDatabaseSmokeMode(body.mode)
    ) {
      return apiErrorResponse(
        requestId,
        400,
        "INVALID_REQUEST",
        "mode는 commit 또는 rollback이어야 합니다.",
      );
    }

    const result = await runDatabaseSmoke(getPrisma(), {
      mode: body.mode,
      requestId,
    });
    return jsonResponse({ data: result }, requestId);
  } catch (error) {
    console.error("Database smoke request failed.", {
      requestId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return apiErrorResponse(
      requestId,
      500,
      "INTERNAL_ERROR",
      "서버에서 요청을 처리하지 못했습니다.",
    );
  }
}

import { z } from "zod";

import { readAuthRuntimeConfig } from "@/server/auth/auth-config";
import { login } from "@/server/auth/auth-service";
import { toSessionUserDto } from "@/server/auth/auth-types";
import { readTrustedSource, hasAllowedMutationOrigin } from "@/server/auth/request-security";
import { createSessionCookie } from "@/server/auth/session-cookie";
import { getPrisma } from "@/server/db/prisma";
import {
  apiErrorResponse,
  getRequestId,
  jsonResponse,
} from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PAYLOAD_BYTES = 4_096;
const loginSchema = z
  .object({
    email: z.email().max(320),
    password: z.string().min(1).max(256),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    const config = readAuthRuntimeConfig();
    if (!hasAllowedMutationOrigin(request, config)) {
      return apiErrorResponse(
        requestId,
        403,
        "FORBIDDEN",
        "허용되지 않은 요청 출처입니다.",
      );
    }

    const body = await readJsonBody(request, MAX_PAYLOAD_BYTES);
    if (!body.ok) {
      return apiErrorResponse(
        requestId,
        body.status,
        body.code,
        body.message,
      );
    }
    const parsed = loginSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiErrorResponse(
        requestId,
        400,
        "INVALID_REQUEST",
        "이메일과 비밀번호 형식을 확인해 주세요.",
      );
    }

    const result = await login(getPrisma(), {
      ...parsed.data,
      source: readTrustedSource(request, config),
      requestId,
      config,
    });
    if (!result.ok && result.reason === "RATE_LIMITED") {
      const response = apiErrorResponse(
        requestId,
        429,
        "RATE_LIMITED",
        "로그인 시도가 제한되었습니다. 잠시 후 다시 시도해 주세요.",
      );
      response.headers.set("Retry-After", String(result.retryAfterSeconds));
      return response;
    }
    if (!result.ok) {
      return apiErrorResponse(
        requestId,
        401,
        "UNAUTHENTICATED",
        "이메일 또는 비밀번호를 확인해 주세요.",
      );
    }

    const response = jsonResponse(
      { data: { user: toSessionUserDto(result.context) } },
      requestId,
    );
    response.headers.append("Set-Cookie", createSessionCookie(result.token, config));
    return response;
  } catch (error) {
    console.error("Authentication login request failed.", {
      requestId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return apiErrorResponse(
      requestId,
      500,
      "INTERNAL_ERROR",
      "서버에서 로그인 요청을 처리하지 못했습니다.",
    );
  }
}

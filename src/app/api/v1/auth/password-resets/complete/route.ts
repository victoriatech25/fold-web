import { z } from "zod";

import { readAuthRuntimeConfig } from "@/server/auth/auth-config";
import { completePasswordReset } from "@/server/auth/password-reset-service";
import { hasAllowedMutationOrigin } from "@/server/auth/request-security";
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
const resetSchema = z
  .object({
    token: z.string().max(128),
    password: z.string().min(1).max(256),
  })
  .strict();

function passwordPolicyMessage(reason: string): string {
  if (reason === "TOO_SHORT") {
    return "비밀번호는 15자 이상이어야 합니다.";
  }
  if (reason === "TOO_LONG") {
    return "비밀번호는 128자 이하여야 합니다.";
  }
  if (reason === "COMMON_PASSWORD") {
    return "쉽게 추측할 수 없는 다른 비밀번호를 사용해 주세요.";
  }
  return "재설정 링크가 만료되었거나 이미 사용되었습니다.";
}

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
    const parsed = resetSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiErrorResponse(
        requestId,
        400,
        "INVALID_REQUEST",
        "재설정 정보 형식을 확인해 주세요.",
      );
    }

    const result = await completePasswordReset(getPrisma(), {
      ...parsed.data,
      requestId,
    });
    if (!result.ok) {
      return apiErrorResponse(
        requestId,
        400,
        "INVALID_REQUEST",
        passwordPolicyMessage(result.reason),
      );
    }
    return jsonResponse({ data: { passwordReset: true } }, requestId);
  } catch (error) {
    console.error("Password reset request failed.", {
      requestId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return apiErrorResponse(
      requestId,
      500,
      "INTERNAL_ERROR",
      "서버에서 비밀번호 재설정을 처리하지 못했습니다.",
    );
  }
}

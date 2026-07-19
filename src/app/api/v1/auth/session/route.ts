import { readAuthRuntimeConfig } from "@/server/auth/auth-config";
import {
  getAuthenticatedContext,
  logout,
} from "@/server/auth/auth-service";
import { toSessionUserDto } from "@/server/auth/auth-types";
import { hasAllowedMutationOrigin } from "@/server/auth/request-security";
import {
  clearSessionCookie,
  readSessionCookie,
} from "@/server/auth/session-cookie";
import { getPrisma } from "@/server/db/prisma";
import {
  apiErrorResponse,
  getRequestId,
  jsonResponse,
} from "@/server/http/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    const config = readAuthRuntimeConfig();
    const token = readSessionCookie(request.headers.get("cookie"), config);
    const context = await getAuthenticatedContext(getPrisma(), {
      token,
      config,
    });
    if (!context) {
      const response = apiErrorResponse(
        requestId,
        401,
        "UNAUTHENTICATED",
        "로그인이 필요합니다.",
      );
      response.headers.append("Set-Cookie", clearSessionCookie(config));
      return response;
    }
    return jsonResponse(
      { data: { user: toSessionUserDto(context) } },
      requestId,
    );
  } catch (error) {
    console.error("Authentication session request failed.", {
      requestId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return apiErrorResponse(
      requestId,
      500,
      "INTERNAL_ERROR",
      "서버에서 세션을 확인하지 못했습니다.",
    );
  }
}

export async function DELETE(request: Request): Promise<Response> {
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

    const token = readSessionCookie(request.headers.get("cookie"), config);
    await logout(getPrisma(), {
      token,
      requestId,
      config,
    });
    const response = jsonResponse({ data: { loggedOut: true } }, requestId);
    response.headers.append("Set-Cookie", clearSessionCookie(config));
    return response;
  } catch (error) {
    console.error("Authentication logout request failed.", {
      requestId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return apiErrorResponse(
      requestId,
      500,
      "INTERNAL_ERROR",
      "서버에서 로그아웃 요청을 처리하지 못했습니다.",
    );
  }
}

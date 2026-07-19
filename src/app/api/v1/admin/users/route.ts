import { z } from "zod";

import { listAdminUsers } from "@/server/admin/admin-service";
import {
  adminRouteErrorResponse,
  authorizeAdminRequest,
} from "@/server/admin/admin-route";
import { getPrisma } from "@/server/db/prisma";
import {
  apiErrorResponse,
  getRequestId,
  jsonResponse,
} from "@/server/http/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  query: z.string().trim().max(100).optional(),
  status: z
    .enum(["INVITED", "ACTIVE", "SUSPENDED", "DISABLED"])
    .optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeAdminRequest(
      request,
      requestId,
      false,
    );
    if (!authorization.ok) return authorization.response;
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      query: url.searchParams.get("query") || undefined,
      status: url.searchParams.get("status") || undefined,
      cursor: url.searchParams.get("cursor") || undefined,
      limit: url.searchParams.get("limit") || undefined,
    });
    if (!parsed.success) {
      return apiErrorResponse(
        requestId,
        400,
        "INVALID_REQUEST",
        "사용자 목록 조건을 확인해 주세요.",
      );
    }
    const data = await listAdminUsers(
      getPrisma(),
      authorization.context,
      parsed.data,
    );
    return jsonResponse({ data }, requestId);
  } catch (error) {
    return adminRouteErrorResponse(error, requestId, "list users");
  }
}

import { z } from "zod";

import { isAuditAction } from "@/server/audit/audit-core";
import { listAuditEvents } from "@/server/audit/audit-service";
import { auditRouteErrorResponse } from "@/server/audit/audit-route";
import { getPrisma } from "@/server/db/prisma";
import {
  apiErrorResponse,
  getRequestId,
  jsonResponse,
} from "@/server/http/api-response";
import { authorizeApiRequest } from "@/server/http/authorize-api-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  category: z
    .enum([
      "AUTHENTICATION",
      "ADMINISTRATION",
      "DATA_CHANGE",
      "APPROVAL",
      "OUTPUT",
      "MACHINE",
      "SYSTEM",
    ])
    .optional(),
  outcome: z.enum(["SUCCESS", "DENIED", "FAILURE"]).optional(),
  action: z
    .string()
    .trim()
    .min(1)
    .max(150)
    .refine(isAuditAction)
    .optional(),
  actorQuery: z.string().trim().min(1).max(100).optional(),
  entityType: z.string().trim().min(1).max(100).optional(),
  entityId: z.string().trim().min(1).max(100).optional(),
  requestId: z.string().trim().min(1).max(100).optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z
    .union([z.literal("25"), z.literal("100")])
    .transform((value) => Number(value) as 25 | 100)
    .default(25),
});

export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeApiRequest(
      request,
      requestId,
      "audit.read",
    );
    if (!authorization.ok) return authorization.response;
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      from: url.searchParams.get("from") || undefined,
      to: url.searchParams.get("to") || undefined,
      category: url.searchParams.get("category") || undefined,
      outcome: url.searchParams.get("outcome") || undefined,
      action: url.searchParams.get("action") || undefined,
      actorQuery: url.searchParams.get("actorQuery") || undefined,
      entityType: url.searchParams.get("entityType") || undefined,
      entityId: url.searchParams.get("entityId") || undefined,
      requestId: url.searchParams.get("requestId") || undefined,
      cursor: url.searchParams.get("cursor") || undefined,
      limit: url.searchParams.get("limit") || undefined,
    });
    if (!parsed.success) {
      return apiErrorResponse(
        requestId,
        400,
        "INVALID_REQUEST",
        "감사 로그 조회 조건을 확인해 주세요.",
      );
    }
    const to = parsed.data.to ? new Date(parsed.data.to) : new Date();
    const from = parsed.data.from
      ? new Date(parsed.data.from)
      : new Date(to.getTime() - 7 * 86_400_000);
    const data = await listAuditEvents(
      getPrisma(),
      authorization.context,
      {
        ...parsed.data,
        from,
        to,
      },
      requestId,
    );
    return jsonResponse({ data }, requestId);
  } catch (error) {
    return auditRouteErrorResponse(error, requestId, "list audit events");
  }
}

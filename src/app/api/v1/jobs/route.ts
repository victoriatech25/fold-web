import { z } from "zod";

import { JobStatus } from "@/generated/prisma/client";
import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";
import { authorizeJobRequest, jobRouteErrorResponse } from "@/server/jobs/job-route";
import { enqueueJob, listJobs } from "@/server/jobs/job-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statuses = new Set(Object.values(JobStatus));

const enqueueSchema = z.strictObject({
  type: z.string().trim().min(1).max(100),
  payload: z.unknown(),
  idempotencyKey: z.string().trim().min(1).max(200),
  priority: z.number().int().min(1).max(1000).optional(),
});

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeJobRequest(request, requestId, false);
    if (!auth.ok) return auth.response;
    const url = new URL(request.url);
    const rawStatuses = url.searchParams.get("statuses")?.split(",").filter(Boolean) ?? [];
    if (rawStatuses.some((status) => !statuses.has(status as JobStatus))) {
      return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "작업 상태가 올바르지 않습니다.");
    }
    const limitValue = url.searchParams.get("limit") || "25";
    if (limitValue !== "25" && limitValue !== "100") {
      return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "목록 크기를 확인해 주세요.");
    }
    return jsonResponse({
      data: await listJobs(getPrisma(), auth.context, {
        type: url.searchParams.get("type") || undefined,
        statuses: rawStatuses as JobStatus[],
        cursor: url.searchParams.get("cursor") || undefined,
        limit: Number(limitValue) as 25 | 100,
      }),
    }, requestId);
  } catch (error) {
    return jobRouteErrorResponse(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeJobRequest(request, requestId, true);
    if (!auth.ok) return auth.response;
    const body = await readJsonBody(request, 65_536);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = enqueueSchema.safeParse(body.value);
    if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "작업 등록 요청을 확인해 주세요.");
    const { job, reused } = await enqueueJob(getPrisma(), auth.context, { ...parsed.data, requestId });
    // 같은 멱등키의 기존 작업이면 새로 만들지 않았음을 200으로 알린다(`D2-B01-D`).
    return jsonResponse({ data: job }, requestId, reused ? 200 : 201);
  } catch (error) {
    return jobRouteErrorResponse(error, requestId);
  }
}

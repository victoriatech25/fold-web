import { z } from "zod";

import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { authorizeJobRequest, jobRouteErrorResponse } from "@/server/jobs/job-route";
import { cancelJob } from "@/server/jobs/job-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeJobRequest(request, requestId, true);
    if (!auth.ok) return auth.response;
    const { jobId } = await context.params;
    if (!z.uuid().safeParse(jobId).success) return apiErrorResponse(requestId, 404, "NOT_FOUND", "작업을 찾을 수 없습니다.");
    return jsonResponse({ data: await cancelJob(getPrisma(), auth.context, { jobId, requestId }) }, requestId);
  } catch (error) {
    return jobRouteErrorResponse(error, requestId);
  }
}

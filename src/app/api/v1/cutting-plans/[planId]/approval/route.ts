import { z } from "zod";

import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";
import { authorizeCuttingRequest, cuttingRouteErrorResponse } from "@/server/cutting/cutting-route";
import { approveCuttingPlan } from "@/server/cutting/cutting-plan-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const approveSchema = z.strictObject({
  revisionId: z.uuid(),
  expectedLockVersion: z.number().int().min(1),
});

export async function POST(request: Request, { params }: { params: Promise<{ planId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeCuttingRequest(request, requestId, "cutting.approve", true);
    if (!auth.ok) return auth.response;
    const body = await readJsonBody(request, 8_192);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = approveSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "승인 요청을 확인해 주세요.");
    }
    const { planId } = await params;
    return jsonResponse(
      {
        data: await approveCuttingPlan(getPrisma(), auth.context, {
          planId,
          revisionId: parsed.data.revisionId,
          expectedLockVersion: parsed.data.expectedLockVersion,
          requestId,
        }),
      },
      requestId,
    );
  } catch (error) {
    return cuttingRouteErrorResponse(error, requestId);
  }
}

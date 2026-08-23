import { z } from "zod";

import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";
import { authorizeCuttingRequest, cuttingRouteErrorResponse } from "@/server/cutting/cutting-route";
import { rerunCuttingPlan } from "@/server/cutting/cutting-plan-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rerunSchema = z.strictObject({
  expectedLockVersion: z.number().int().min(1),
  pins: z
    .array(
      z.strictObject({
        partId: z.string().trim().min(1).max(100),
        sheetIndex: z.number().int().min(0).max(9_999),
      }),
    )
    .max(1_000)
    .default([]),
});

export async function POST(request: Request, { params }: { params: Promise<{ planId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeCuttingRequest(request, requestId, "cutting.optimize", true);
    if (!auth.ok) return auth.response;
    const body = await readJsonBody(request, 262_144);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = rerunSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "재실행 요청을 확인해 주세요.");
    }
    const { planId } = await params;
    return jsonResponse(
      {
        data: await rerunCuttingPlan(getPrisma(), auth.context, {
          planId,
          pins: parsed.data.pins,
          expectedLockVersion: parsed.data.expectedLockVersion,
          requestId,
        }),
      },
      requestId,
      201,
    );
  } catch (error) {
    return cuttingRouteErrorResponse(error, requestId);
  }
}

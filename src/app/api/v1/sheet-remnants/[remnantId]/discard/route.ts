import { z } from "zod";

import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";
import { authorizeCuttingRequest, cuttingRouteErrorResponse } from "@/server/cutting/cutting-route";
import { discardSheetRemnant } from "@/server/cutting/sheet-usage-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const discardSchema = z.strictObject({
  reason: z.string().trim().min(1).max(500),
  expectedLockVersion: z.number().int().min(1),
});

export async function POST(request: Request, { params }: { params: Promise<{ remnantId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeCuttingRequest(request, requestId, "cutting.approve", true);
    if (!auth.ok) return auth.response;
    const body = await readJsonBody(request, 8_192);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = discardSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "폐기 요청을 확인해 주세요.");
    }
    const { remnantId } = await params;
    return jsonResponse(
      {
        data: await discardSheetRemnant(getPrisma(), auth.context, {
          remnantId,
          reason: parsed.data.reason,
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

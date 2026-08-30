import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { authorizeCuttingRequest, cuttingRouteErrorResponse } from "@/server/cutting/cutting-route";
import { summarizeSheetUsageByPeriod } from "@/server/cutting/sheet-usage-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 날짜만 받는다. 비어 있으면 기간을 걸지 않는다. */
function readDate(value: string | null, endOfDay: boolean): Date | null | "INVALID" {
  if (!value) return null;
  const parsed = new Date(endOfDay ? `${value}T23:59:59.999` : `${value}T00:00:00.000`);
  return Number.isNaN(parsed.getTime()) ? "INVALID" : parsed;
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeCuttingRequest(request, requestId, "cutting.optimize", false);
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const from = readDate(url.searchParams.get("from"), false);
    const to = readDate(url.searchParams.get("to"), true);
    if (from === "INVALID" || to === "INVALID") {
      return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "조회 기간을 확인해 주세요.");
    }

    return jsonResponse(
      {
        data: await summarizeSheetUsageByPeriod(getPrisma(), auth.context, {
          from: from ?? undefined,
          to: to ?? undefined,
          sheetItemId: url.searchParams.get("sheetItemId") ?? undefined,
        }),
      },
      requestId,
    );
  } catch (error) {
    return cuttingRouteErrorResponse(error, requestId);
  }
}

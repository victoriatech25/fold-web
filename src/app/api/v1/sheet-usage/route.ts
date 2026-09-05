import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { authorizeCuttingRequest, cuttingRouteErrorResponse } from "@/server/cutting/cutting-route";
import { summarizeSheetUsageByPeriod } from "@/server/cutting/sheet-usage-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 날짜만 받는다. 비어 있으면 기간을 걸지 않는다.
 *
 * 경계는 KST 로 자른다. 실적이 걸린 `createdAt` 은 진짜 시각이라 서버 시간대를 따르면
 * 배포 환경에 따라 집계가 하루씩 밀린다. 감사 로그 조회조건도 같은 기준을 쓴다.
 */
function readDate(value: string | null, endOfDay: boolean): Date | null | "INVALID" {
  if (!value) return null;
  const parsed = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+09:00`);
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

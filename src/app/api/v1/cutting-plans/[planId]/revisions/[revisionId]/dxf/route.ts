import { getPrisma } from "@/server/db/prisma";
import { getRequestId, jsonResponse } from "@/server/http/api-response";
import { authorizeCuttingRequest, cuttingRouteErrorResponse } from "@/server/cutting/cutting-route";
import { listCuttingRevisionDxf } from "@/server/cutting/cutting-dxf-service";
import { CuttingError } from "@/server/cutting/cutting-error";
import { enqueueJob } from "@/server/jobs/job-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ planId: string; revisionId: string }> };

/** 원판 DXF 생성을 큐에 넣는다(`P2-B11` 4.5). 같은 개정은 작업 하나로 합쳐진다. */
export async function POST(request: Request, { params }: Params) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeCuttingRequest(request, requestId, "cutting.optimize", true);
    if (!auth.ok) return auth.response;
    const { planId, revisionId } = await params;
    const prisma = getPrisma();
    const revision = await prisma.cuttingPlanRevision.findFirst({
      where: { id: revisionId, cuttingPlanId: planId, organizationId: auth.context.organizationId },
      select: { status: true },
    });
    if (!revision) throw new CuttingError("NOT_FOUND", "재단 개정을 찾을 수 없습니다.");
    if (revision.status !== "SUCCEEDED") {
      throw new CuttingError("CONFLICT", "성공한 재단 결과만 DXF 로 낼 수 있습니다.");
    }
    const { job } = await enqueueJob(prisma, auth.context, {
      type: "cutting.dxf",
      payload: { cuttingPlanId: planId, cuttingPlanRevisionId: revisionId },
      idempotencyKey: `cutting-dxf-${revisionId}`,
      requestId,
    });
    return jsonResponse({ data: { jobId: job.id, status: job.status } }, requestId, 202);
  } catch (error) {
    return cuttingRouteErrorResponse(error, requestId);
  }
}

/** 만들어진 파일 목록. 내려받기는 `/api/v1/files/{id}/downloads` 로 한다. */
export async function GET(request: Request, { params }: Params) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeCuttingRequest(request, requestId, "cutting.optimize", false);
    if (!auth.ok) return auth.response;
    const { planId, revisionId } = await params;
    const files = await listCuttingRevisionDxf(getPrisma(), auth.context, { planId, revisionId });
    return jsonResponse({ data: { files } }, requestId);
  } catch (error) {
    return cuttingRouteErrorResponse(error, requestId);
  }
}

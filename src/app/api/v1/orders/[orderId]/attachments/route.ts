import { z } from "zod";

import { getPrisma } from "@/server/db/prisma";
import { authorizeFileRequest, fileRouteErrorResponse } from "@/server/files/file-route";
import { listOrderAttachments } from "@/server/files/file-service";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeFileRequest(request, requestId, false);
    if (!auth.ok) return auth.response;
    const { orderId } = await params;
    if (!z.uuid().safeParse(orderId).success) {
      return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "수주 정보를 확인해 주세요.");
    }
    return jsonResponse(
      { data: { items: await listOrderAttachments(getPrisma(), auth.context, orderId) } },
      requestId,
    );
  } catch (error) {
    return fileRouteErrorResponse(error, requestId);
  }
}

import { z } from "zod";

import { getPrisma } from "@/server/db/prisma";
import { authorizeFileRequest, fileRouteErrorResponse } from "@/server/files/file-route";
import { deleteFile, getFile } from "@/server/files/file-service";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeFileRequest(request, requestId, false);
    if (!auth.ok) return auth.response;
    const { fileId } = await params;
    if (!z.uuid().safeParse(fileId).success) {
      return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "파일 정보를 확인해 주세요.");
    }
    return jsonResponse({ data: await getFile(getPrisma(), auth.context, fileId) }, requestId);
  } catch (error) {
    return fileRouteErrorResponse(error, requestId);
  }
}
export async function DELETE(request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeFileRequest(request, requestId, true);
    if (!auth.ok) return auth.response;
    const { fileId } = await params;
    if (!z.uuid().safeParse(fileId).success) {
      return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "파일 정보를 확인해 주세요.");
    }
    return jsonResponse(
      { data: await deleteFile(getPrisma(), auth.context, fileId, requestId) },
      requestId,
    );
  } catch (error) {
    return fileRouteErrorResponse(error, requestId);
  }
}

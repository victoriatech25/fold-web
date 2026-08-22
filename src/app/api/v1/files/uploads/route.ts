import { z } from "zod";

import { FileAssetKind } from "@/generated/prisma/client";
import { getPrisma } from "@/server/db/prisma";
import { authorizeFileRequest, fileRouteErrorResponse } from "@/server/files/file-route";
import { startUpload } from "@/server/files/file-service";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startSchema = z.strictObject({
  kind: z.enum(FileAssetKind),
  fileName: z.string().trim().min(1).max(255),
  mediaType: z.string().trim().min(1).max(150),
  sizeBytes: z.number().int().positive(),
  checksumSha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeFileRequest(request, requestId, true);
    if (!auth.ok) return auth.response;
    const body = await readJsonBody(request, 8_192);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = startSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "업로드 요청을 확인해 주세요.");
    }
    const result = await startUpload(getPrisma(), auth.context, { ...parsed.data, requestId });
    return jsonResponse({ data: result }, requestId, 201);
  } catch (error) {
    return fileRouteErrorResponse(error, requestId);
  }
}

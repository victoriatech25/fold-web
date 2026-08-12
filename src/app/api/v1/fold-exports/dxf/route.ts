import { z } from "zod";

import { getPrisma } from "@/server/db/prisma";
import { exportFoldRevisionDxf } from "@/server/dxf/dxf-export-service";
import { authorizeFoldDraftRequest, foldDraftRouteErrorResponse } from "@/server/fold-draft/fold-draft-route";
import { apiErrorResponse, getRequestId } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.strictObject({ revisionId: z.uuid() });

export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const authorization = await authorizeFoldDraftRequest(request, requestId, "output.print", true);
    if (!authorization.ok) return authorization.response;
    const body = await readJsonBody(request, 16 * 1024);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = schema.safeParse(body.value);
    if (!parsed.success) {
      return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "DXF 출력 요청을 확인해 주세요.");
    }
    const result = await exportFoldRevisionDxf(getPrisma(), authorization.context, {
      revisionId: parsed.data.revisionId,
      requestId,
    });
    const asciiName = "fold-drawing.dxf";
    return new Response(result.content, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/dxf; charset=utf-8",
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
        "Content-Length": String(result.sizeBytes),
        "X-DXF-Checksum-SHA256": result.checksumSha256,
        "X-File-Asset-Id": result.assetId,
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    return foldDraftRouteErrorResponse(error, requestId, "export fold DXF");
  }
}

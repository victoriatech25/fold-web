import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";
import { authorizeMaterialRequest, materialRouteErrorResponse } from "@/server/materials/material-route";
import { deleteMaterials } from "@/server/materials/material-service";

export const runtime = "nodejs"; export const dynamic = "force-dynamic";
const schema = z.strictObject({ materialIds: z.array(z.uuid()).min(1).max(100) });

/** 재질 선택 삭제. 되돌릴 수 없는 작업이라 DELETE 대신 명시적 하위 자원(`deletions`)에 POST 한다. */
export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const auth = await authorizeMaterialRequest(request, requestId, "material.write", true);
    if (!auth.ok) return auth.response;
    const body = await readJsonBody(request, 16_384);
    if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message);
    const parsed = schema.safeParse(body.value);
    if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "삭제할 재질을 확인해 주세요.");
    const data = await deleteMaterials(getPrisma(), auth.context, { materialIds: parsed.data.materialIds, requestId });
    return jsonResponse({ data }, requestId);
  } catch (error) {
    return materialRouteErrorResponse(error, requestId, "delete materials");
  }
}

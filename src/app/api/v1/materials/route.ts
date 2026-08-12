import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";
import { authorizeMaterialRequest, materialRouteErrorResponse } from "@/server/materials/material-route";
import { materialFieldsSchema } from "@/server/materials/material-schema";
import { createMaterial, listMaterials } from "@/server/materials/material-service";

export const runtime = "nodejs"; export const dynamic = "force-dynamic";
const createSchema = z.strictObject(materialFieldsSchema);

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try { const auth = await authorizeMaterialRequest(request, requestId, "material.read", false); if (!auth.ok) return auth.response; const url = new URL(request.url); const limit = Number(url.searchParams.get("limit") || "25"); if (!Number.isInteger(limit) || limit < 1 || limit > 100) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "목록 크기는 1~100이어야 합니다."); const data = await listMaterials(getPrisma(), auth.context, { q: url.searchParams.get("q") || undefined, includeInactive: url.searchParams.get("includeInactive") === "true", cursor: url.searchParams.get("cursor") || undefined, limit }); return jsonResponse({ data }, requestId); }
  catch (error) { return materialRouteErrorResponse(error, requestId, "list materials"); }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try { const auth = await authorizeMaterialRequest(request, requestId, "material.write", true); if (!auth.ok) return auth.response; const body = await readJsonBody(request, 65536); if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message); const parsed = createSchema.safeParse(body.value); if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "재질 정보를 확인해 주세요."); const data = await createMaterial(getPrisma(), auth.context, { ...parsed.data, requestId }); return jsonResponse({ data }, requestId, 201); }
  catch (error) { return materialRouteErrorResponse(error, requestId, "create material"); }
}

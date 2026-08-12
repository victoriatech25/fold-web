import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";
import { authorizeMaterialRequest, materialRouteErrorResponse } from "@/server/materials/material-route";
import { materialVariantFieldsSchema } from "@/server/materials/material-schema";
import { createMaterialVariant } from "@/server/materials/material-service";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
const schema = z.strictObject(materialVariantFieldsSchema); type Context = { params: Promise<{ materialId: string }> };
export async function POST(request: Request, context: Context) { const requestId = getRequestId(request); try { const auth = await authorizeMaterialRequest(request, requestId, "material.write", true); if (!auth.ok) return auth.response; const materialId = (await context.params).materialId; if (!z.uuid().safeParse(materialId).success) return apiErrorResponse(requestId, 404, "NOT_FOUND", "재질을 찾을 수 없습니다."); const body = await readJsonBody(request, 65536); if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message); const parsed = schema.safeParse(body.value); if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "두께 정보를 확인해 주세요."); return jsonResponse({ data: await createMaterialVariant(getPrisma(), auth.context, { ...parsed.data, materialId, requestId }) }, requestId, 201); } catch (error) { return materialRouteErrorResponse(error, requestId, "create material variant"); } }

import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";
import { authorizeMaterialRequest, materialRouteErrorResponse } from "@/server/materials/material-route";
import { materialVariantFieldsSchema } from "@/server/materials/material-schema";
import { updateMaterialVariant } from "@/server/materials/material-service";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
const schema = z.strictObject({ ...materialVariantFieldsSchema, active: z.boolean(), expectedLockVersion: z.number().int().positive() }); type Context = { params: Promise<{ materialId: string; variantId: string }> };
export async function PATCH(request: Request, context: Context) { const requestId = getRequestId(request); try { const auth = await authorizeMaterialRequest(request, requestId, "material.write", true); if (!auth.ok) return auth.response; const ids = await context.params; if (!z.uuid().safeParse(ids.materialId).success || !z.uuid().safeParse(ids.variantId).success) return apiErrorResponse(requestId, 404, "NOT_FOUND", "두께 항목을 찾을 수 없습니다."); const body = await readJsonBody(request, 65536); if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message); const parsed = schema.safeParse(body.value); if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "두께 변경 정보를 확인해 주세요."); return jsonResponse({ data: await updateMaterialVariant(getPrisma(), auth.context, { ...parsed.data, ...ids, requestId }) }, requestId); } catch (error) { return materialRouteErrorResponse(error, requestId, "update material variant"); } }

import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { apiErrorResponse, getRequestId, jsonResponse } from "@/server/http/api-response";
import { readJsonBody } from "@/server/http/read-json-body";
import { authorizeMaterialRequest, materialRouteErrorResponse } from "@/server/materials/material-route";
import { materialFieldsSchema } from "@/server/materials/material-schema";
import { getMaterial, updateMaterial } from "@/server/materials/material-service";

export const runtime = "nodejs"; export const dynamic = "force-dynamic";
const schema = z.strictObject({ ...materialFieldsSchema, active: z.boolean(), expectedLockVersion: z.number().int().positive() });
type Context = { params: Promise<{ materialId: string }> };
async function idOf(context: Context, requestId: string) { const id = (await context.params).materialId; return z.uuid().safeParse(id).success ? id : apiErrorResponse(requestId, 404, "NOT_FOUND", "재질을 찾을 수 없습니다."); }

export async function GET(request: Request, context: Context) { const requestId = getRequestId(request); try { const auth = await authorizeMaterialRequest(request, requestId, "material.read", false); if (!auth.ok) return auth.response; const id = await idOf(context, requestId); if (id instanceof Response) return id; return jsonResponse({ data: await getMaterial(getPrisma(), auth.context, id) }, requestId); } catch (error) { return materialRouteErrorResponse(error, requestId, "get material"); } }
export async function PATCH(request: Request, context: Context) { const requestId = getRequestId(request); try { const auth = await authorizeMaterialRequest(request, requestId, "material.write", true); if (!auth.ok) return auth.response; const id = await idOf(context, requestId); if (id instanceof Response) return id; const body = await readJsonBody(request, 65536); if (!body.ok) return apiErrorResponse(requestId, body.status, body.code, body.message); const parsed = schema.safeParse(body.value); if (!parsed.success) return apiErrorResponse(requestId, 400, "INVALID_REQUEST", "재질 변경 정보를 확인해 주세요."); return jsonResponse({ data: await updateMaterial(getPrisma(), auth.context, { ...parsed.data, materialId: id, requestId }) }, requestId); } catch (error) { return materialRouteErrorResponse(error, requestId, "update material"); } }

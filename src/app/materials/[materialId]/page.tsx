import { notFound } from "next/navigation";
import { z } from "zod";
import { MaterialDetailPanel } from "@/components/materials/material-detail-panel";
import { requirePermissionPage } from "@/server/auth/auth-dal";
import { getPrisma } from "@/server/db/prisma";
import { MaterialError } from "@/server/materials/material-error";
import { getMaterial } from "@/server/materials/material-service";
export default async function MaterialPage({params,searchParams}:{params:Promise<{materialId:string}>;searchParams:Promise<{tab?:string}>}){const auth=await requirePermissionPage("material.read");const parsed=z.uuid().safeParse((await params).materialId);if(!parsed.success)notFound();let material;try{material=await getMaterial(getPrisma(),auth,parsed.data);}catch(error){if(error instanceof MaterialError&&error.code==="NOT_FOUND")notFound();throw error;}const tab=(await searchParams).tab==="variants"?"variants":"basic";return <MaterialDetailPanel initial={material} canWrite={auth.permissions.includes("material.write")} canApprove={auth.permissions.includes("material.approve")} initialTab={tab}/>;}

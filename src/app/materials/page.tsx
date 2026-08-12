import { MaterialListPanel } from "@/components/materials/material-list-panel";
import { requirePermissionPage } from "@/server/auth/auth-dal";
import { getPrisma } from "@/server/db/prisma";
import { listMaterials } from "@/server/materials/material-service";
export default async function MaterialsPage(){const auth=await requirePermissionPage("material.read");return <MaterialListPanel initial={await listMaterials(getPrisma(),auth,{limit:25})} canWrite={auth.permissions.includes("material.write")}/>;}

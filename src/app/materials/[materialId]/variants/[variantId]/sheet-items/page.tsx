import { notFound } from "next/navigation";
import { z } from "zod";
import { SheetItemPanel } from "@/components/materials/sheet-item-panel";
import { requirePermissionPage } from "@/server/auth/auth-dal";
import { getPrisma } from "@/server/db/prisma";
import { MaterialError } from "@/server/materials/material-error";
import { getSheetItemWorkspace } from "@/server/sheet-items/sheet-item-service";

export default async function SheetItemsPage({ params }: { params: Promise<{ materialId: string; variantId: string }> }) {
  const auth = await requirePermissionPage("material.read");
  const ids = await params;
  if (!z.uuid().safeParse(ids.materialId).success || !z.uuid().safeParse(ids.variantId).success) notFound();
  let initial;
  try {
    initial = await getSheetItemWorkspace(getPrisma(), auth, ids.materialId, ids.variantId);
  } catch (error) {
    if (error instanceof MaterialError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  return <SheetItemPanel initial={initial} canWrite={auth.permissions.includes("material.write")} />;
}

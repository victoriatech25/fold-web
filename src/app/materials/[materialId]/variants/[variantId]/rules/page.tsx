import { notFound } from "next/navigation";
import { z } from "zod";

import { MaterialRulePanel } from "@/components/materials/material-rule-panel";
import { requirePermissionPage } from "@/server/auth/auth-dal";
import { getPrisma } from "@/server/db/prisma";
import { MaterialError } from "@/server/materials/material-error";
import { getMaterialRuleWorkspace } from "@/server/material-rules/material-rule-service";

export default async function MaterialRulePage({ params }: { params: Promise<{ materialId: string; variantId: string }> }) {
  const auth = await requirePermissionPage("material.read");
  const ids = await params;
  if (!z.uuid().safeParse(ids.materialId).success || !z.uuid().safeParse(ids.variantId).success) notFound();
  let initial;
  try {
    initial = await getMaterialRuleWorkspace(getPrisma(), auth, ids.materialId, ids.variantId);
  } catch (error) {
    if (error instanceof MaterialError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  return <MaterialRulePanel initial={initial} canWrite={auth.permissions.includes("material.write")} canApprove={auth.permissions.includes("material.approve")} />;
}

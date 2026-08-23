import { notFound } from "next/navigation";

import { CuttingPlanDetailPanel } from "@/components/cutting/cutting-plan-detail-panel";
import { requireAuthenticatedPage } from "@/server/auth/auth-dal";
import { CuttingError } from "@/server/cutting/cutting-error";
import { getCuttingPlan, type CuttingPlanDetailDto } from "@/server/cutting/cutting-plan-service";
import { getPrisma } from "@/server/db/prisma";

export default async function CuttingPlanPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const auth = await requireAuthenticatedPage();
  const { planId } = await params;

  let plan: CuttingPlanDetailDto;
  try {
    plan = await getCuttingPlan(getPrisma(), auth, planId);
  } catch (error) {
    if (error instanceof CuttingError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return <CuttingPlanDetailPanel initial={plan} permissions={auth.permissions} />;
}

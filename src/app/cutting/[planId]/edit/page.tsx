import { notFound, redirect } from "next/navigation";

import { CuttingPlanEditor } from "@/components/cutting/cutting-plan-editor";
import { requireAuthenticatedPage } from "@/server/auth/auth-dal";
import { CuttingError } from "@/server/cutting/cutting-error";
import { getCuttingPlan, type CuttingPlanDetailDto } from "@/server/cutting/cutting-plan-service";
import { getPrisma } from "@/server/db/prisma";

/** 재단 배치 편집기(`P2-B11`). 성공한 결과가 있고 승인되지 않은 작업만 연다. */
export default async function CuttingPlanEditPage({ params }: { params: Promise<{ planId: string }> }) {
  const auth = await requireAuthenticatedPage();
  const { planId } = await params;

  let plan: CuttingPlanDetailDto;
  try {
    plan = await getCuttingPlan(getPrisma(), auth, planId);
  } catch (error) {
    if (error instanceof CuttingError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!auth.permissions.includes("cutting.optimize") || plan.status === "APPROVED" || !plan.result) {
    redirect(`/cutting/${planId}`);
  }

  return <CuttingPlanEditor plan={plan} />;
}

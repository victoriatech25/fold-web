import { CuttingPlanListPanel } from "@/components/cutting/cutting-plan-list-panel";
import { requireAuthenticatedPage } from "@/server/auth/auth-dal";
import { listCuttingPlans } from "@/server/cutting/cutting-plan-service";
import { getPrisma } from "@/server/db/prisma";

export default async function CuttingPage() {
  const auth = await requireAuthenticatedPage();
  const initial = await listCuttingPlans(getPrisma(), auth, {});
  return <CuttingPlanListPanel initial={initial} />;
}

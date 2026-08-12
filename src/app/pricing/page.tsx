import { PricingPanel } from "@/components/pricing/pricing-panel";
import { requirePermissionPage } from "@/server/auth/auth-dal";
import { getPrisma } from "@/server/db/prisma";
import { getPricingWorkspace } from "@/server/pricing/pricing-service";

export default async function PricingPage() {
  const auth = await requirePermissionPage("pricing.read");
  return <PricingPanel initial={await getPricingWorkspace(getPrisma(), auth)} canWrite={auth.permissions.includes("pricing.write")} />;
}

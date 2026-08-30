import { SheetRemnantPanel } from "@/components/cutting/sheet-remnant-panel";
import { requirePermissionPage } from "@/server/auth/auth-dal";
import { getPrisma } from "@/server/db/prisma";
import { listSheetRemnants } from "@/server/cutting/sheet-usage-service";

export const dynamic = "force-dynamic";

export default async function SheetRemnantPage() {
  const auth = await requirePermissionPage("cutting.optimize");
  const initial = await listSheetRemnants(getPrisma(), auth, { status: "AVAILABLE" });
  return (
    <SheetRemnantPanel
      canDiscard={auth.permissions.includes("cutting.approve")}
      initial={initial}
    />
  );
}

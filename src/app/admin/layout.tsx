import { notFound } from "next/navigation";

import { ServiceShell } from "@/components/app-shell/service-shell";
import { requireAuthenticatedPage } from "@/server/auth/auth-dal";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const auth = await requireAuthenticatedPage();
  const canManageOrganization = auth.permissions.includes("admin.manage");
  const canReadMasterData = auth.permissions.includes("master_data.read");
  const canReadAudit = auth.permissions.includes("audit.read");
  if (!canManageOrganization && !canReadMasterData && !canReadAudit) notFound();

  return (
    <ServiceShell
      displayName={auth.displayName}
      headerHeading={false}
      organizationName={auth.organizationName}
      pageDescription="회사 기준정보와 사용자·권한·감사 이력을 관리합니다."
      pageTitle="시스템 관리"
      permissions={auth.permissions}
    >
      {children}
    </ServiceShell>
  );
}

import { ServiceShell } from "@/components/app-shell/service-shell";
import { requireAuthenticatedPage } from "@/server/auth/auth-dal";

export const dynamic = "force-dynamic";

export default async function CuttingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const auth = await requireAuthenticatedPage();
  return (
    <ServiceShell
      displayName={auth.displayName}
      headerHeading={false}
      organizationName={auth.organizationName}
      pageTitle="생산·절단"
      pageDescription="승인된 수주의 재단 결과를 확인하고 승인합니다."
      permissions={auth.permissions}
    >
      {children}
    </ServiceShell>
  );
}

import { ServiceShell } from "@/components/app-shell/service-shell";
import { requirePermissionPage } from "@/server/auth/auth-dal";

export const dynamic = "force-dynamic";

export default async function CustomersLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const auth = await requirePermissionPage("customer.read");

  return (
    <ServiceShell
      displayName={auth.displayName}
      headerHeading={false}
      organizationName={auth.organizationName}
      pageDescription="거래처 기본정보와 담당자·납품 현장을 관리합니다."
      pageTitle="거래처·현장"
      permissions={auth.permissions}
    >
      {children}
    </ServiceShell>
  );
}

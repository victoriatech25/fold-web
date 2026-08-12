import { ServiceShell } from "@/components/app-shell/service-shell";
import { requirePermissionPage } from "@/server/auth/auth-dal";

export const dynamic = "force-dynamic";

export default async function PricingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const auth = await requirePermissionPage("pricing.read");
  return <ServiceShell displayName={auth.displayName} headerHeading={false} organizationName={auth.organizationName} pageDescription="거래처별 적용 가격과 승인 개정을 관리합니다." pageTitle="가격 관리" permissions={auth.permissions} wide>{children}</ServiceShell>;
}

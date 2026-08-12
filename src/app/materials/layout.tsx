import { ServiceShell } from "@/components/app-shell/service-shell";
import { requirePermissionPage } from "@/server/auth/auth-dal";
export const dynamic = "force-dynamic";
export default async function MaterialsLayout({ children }: Readonly<{ children: React.ReactNode }>) { const auth=await requirePermissionPage("material.read"); return <ServiceShell displayName={auth.displayName} headerHeading={false} organizationName={auth.organizationName} pageDescription="재질과 두께, 계산 기준 발행 상태를 관리합니다." pageTitle="재질·두께" permissions={auth.permissions}>{children}</ServiceShell>; }

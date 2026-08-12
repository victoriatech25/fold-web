import { ServiceShell } from "@/components/app-shell/service-shell";
import { requirePermissionPage } from "@/server/auth/auth-dal";
export const dynamic="force-dynamic";
export default async function OrdersLayout({children}:Readonly<{children:React.ReactNode}>){const auth=await requirePermissionPage("order.read");return <ServiceShell displayName={auth.displayName} headerHeading={false} organizationName={auth.organizationName} pageTitle="수주·작업" pageDescription="수주 기본정보를 만들고 관리합니다." permissions={auth.permissions}>{children}</ServiceShell>}

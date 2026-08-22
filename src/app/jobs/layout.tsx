import { ServiceShell } from "@/components/app-shell/service-shell";
import { requireAuthenticatedPage } from "@/server/auth/auth-dal";

export const dynamic = "force-dynamic";

export default async function JobsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const auth = await requireAuthenticatedPage();
  return (
    <ServiceShell
      displayName={auth.displayName}
      headerHeading={false}
      organizationName={auth.organizationName}
      pageTitle="작업 큐"
      pageDescription="서버에서 실행하는 작업의 진행과 실패를 확인합니다."
      permissions={auth.permissions}
    >
      {children}
    </ServiceShell>
  );
}

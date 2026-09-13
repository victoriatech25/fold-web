import { OrganizationAdminPanel } from "@/components/admin/organization-admin-panel";
import { requirePlatformAdminPage } from "@/server/auth/auth-dal";
import { getPrisma } from "@/server/db/prisma";
import { listPlatformOrganizations } from "@/server/organizations/organization-service";

export default async function AdminOrganizationsPage() {
  const context = await requirePlatformAdminPage();
  const organizations = await listPlatformOrganizations(getPrisma(), context);

  return (
    <>
      <div className="mb-5">
        <h1 className="text-xl font-black">회사 등록·관리</h1>
        <p className="mt-1 text-sm text-slate-600">
          서비스를 사용할 회사(조직)를 등록하고 이름과 사용 상태를 관리합니다. 플랫폼 관리자만 볼 수 있습니다.
        </p>
      </div>
      <OrganizationAdminPanel organizations={organizations} />
    </>
  );
}

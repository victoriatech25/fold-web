import { CompanySettingsPanel } from "@/components/company-settings/company-settings-panel";
import { requirePermissionPage } from "@/server/auth/auth-dal";
import { getCompanySettings } from "@/server/company-settings/company-settings-service";
import { getPrisma } from "@/server/db/prisma";

export default async function CompanySettingsPage() {
  const context = await requirePermissionPage("master_data.read");
  const settings = await getCompanySettings(getPrisma(), context);

  return (
    <>
      <div className="mb-5">
        <h1 className="text-xl font-black">회사·사업장</h1>
        <p className="mt-1 text-sm text-slate-600">
          수주와 출력에서 공통으로 사용할 회사 기본정보와 사업장을 관리합니다.
        </p>
      </div>
      <CompanySettingsPanel
        businessSites={settings.businessSites}
        canManage={context.permissions.includes("master_data.manage")}
        company={settings.company}
      />
    </>
  );
}

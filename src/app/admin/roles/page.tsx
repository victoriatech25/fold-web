import { RoleAdminPanel } from "@/components/admin/role-admin-panel";
import {
  listAdminPermissions,
  listAdminRoles,
} from "@/server/admin/admin-service";
import { requirePermissionPage } from "@/server/auth/auth-dal";
import { getPrisma } from "@/server/db/prisma";

export default async function AdminRolesPage() {
  const context = await requirePermissionPage("admin.manage");
  const [roles, permissions] = await Promise.all([
    listAdminRoles(getPrisma(), context),
    Promise.resolve(listAdminPermissions(context)),
  ]);

  return (
    <>
      <div className="mb-5">
        <h1 className="text-xl font-black">역할과 권한</h1>
        <p className="mt-1 text-sm text-slate-600">고정 시스템 역할을 확인하고 업무별 사용자 정의 역할을 구성합니다.</p>
      </div>
      <RoleAdminPanel permissions={permissions} roles={roles} />
    </>
  );
}

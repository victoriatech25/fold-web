import { UserAdminPanel } from "@/components/admin/user-admin-panel";
import {
  listAdminDepartments,
  listAdminRoles,
  listAdminUsers,
} from "@/server/admin/admin-service";
import { requirePermissionPage } from "@/server/auth/auth-dal";
import { getPrisma } from "@/server/db/prisma";

export default async function AdminUsersPage() {
  const context = await requirePermissionPage("admin.manage");
  const prisma = getPrisma();
  const [users, departments, roles] = await Promise.all([
    listAdminUsers(prisma, context, { limit: 25 }),
    listAdminDepartments(prisma, context),
    listAdminRoles(prisma, context),
  ]);

  return (
    <>
      <div className="mb-5">
        <h1 className="text-xl font-black">사용자 관리</h1>
        <p className="mt-1 text-sm text-slate-600">초대, 역할 배정, 계정 상태와 비밀번호 설정 주소를 관리합니다.</p>
      </div>
      <UserAdminPanel
        departments={departments}
        key={users.items.map(({ id, updatedAt }) => `${id}:${updatedAt}`).join("|")}
        nextCursor={users.nextCursor}
        roles={roles}
        users={users.items}
      />
    </>
  );
}

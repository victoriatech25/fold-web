import { DepartmentAdminPanel } from "@/components/admin/department-admin-panel";
import { listAdminDepartments } from "@/server/admin/admin-service";
import { requirePermissionPage } from "@/server/auth/auth-dal";
import { getPrisma } from "@/server/db/prisma";

export default async function AdminDepartmentsPage() {
  const context = await requirePermissionPage("admin.manage");
  const departments = await listAdminDepartments(getPrisma(), context);

  return (
    <>
      <div className="mb-5">
        <h1 className="text-xl font-black">부서 관리</h1>
        <p className="mt-1 text-sm text-slate-600">조직의 부서 코드와 사용 상태를 관리합니다.</p>
      </div>
      <DepartmentAdminPanel departments={departments} />
    </>
  );
}

import Link from "next/link";

import { LogoutButton } from "@/components/auth/logout-button";
import { requirePermissionPage } from "@/server/auth/auth-dal";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const auth = await requirePermissionPage("admin.manage");

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <header className="border-b border-slate-300 bg-white">
        <div className="mx-auto flex min-h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div>
            <Link className="text-sm font-black text-teal-800" href="/">
              FOLD WEB
            </Link>
            <span className="ml-2 text-sm font-bold text-slate-700">조직 관리</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-slate-600 sm:inline">
              {auth.displayName} · {auth.organizationName}
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-5 px-4 py-5 sm:px-6 md:grid-cols-[12rem_1fr]">
        <nav aria-label="관리 메뉴" className="h-fit rounded-md border border-slate-300 bg-white p-2 shadow-sm">
          <Link className="block rounded px-3 py-2 text-sm font-bold hover:bg-slate-100" href="/admin/users">사용자</Link>
          <Link className="block rounded px-3 py-2 text-sm font-bold hover:bg-slate-100" href="/admin/departments">부서</Link>
          <Link className="block rounded px-3 py-2 text-sm font-bold hover:bg-slate-100" href="/admin/roles">역할과 권한</Link>
          <Link className="block rounded px-3 py-2 text-sm font-bold hover:bg-slate-100" href="/admin/audit-logs">감사 로그</Link>
          <div className="my-2 border-t border-slate-200" />
          <Link className="block rounded px-3 py-2 text-sm text-slate-600 hover:bg-slate-100" href="/">편집기로 돌아가기</Link>
        </nav>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}

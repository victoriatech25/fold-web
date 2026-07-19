import { CanvasWorkspace } from "@/components/canvas-workspace";
import { LogoutButton } from "@/components/auth/logout-button";
import { requireAuthenticatedPage } from "@/server/auth/auth-dal";

export const dynamic = "force-dynamic";

export default async function Home() {
  const auth = await requireAuthenticatedPage();

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <header className="border-b border-slate-300 bg-white">
        <div className="mx-auto flex min-h-14 w-full max-w-[1600px] items-center justify-between px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-teal-700 text-sm font-black text-white">F</div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-bold text-slate-950">절곡 단면 편집기</h1>
              <p className="truncate text-[11px] text-slate-500">알루미늄 전개 폭 계산 프로토타입</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right text-xs sm:block">
              <p className="font-semibold text-slate-700">{auth.displayName}</p>
              <p className="text-slate-500">{auth.organizationName}</p>
            </div>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1600px] py-4 sm:px-4 sm:py-6"><CanvasWorkspace /></main>
    </div>
  );
}

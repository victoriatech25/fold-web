import Link from "next/link";
import { ArrowLeft, Library } from "lucide-react";

import { LogoutButton } from "@/components/auth/logout-button";
import { FoldDraftWorkspace } from "@/components/fold-draft-workspace";
import { requireAuthenticatedPage } from "@/server/auth/auth-dal";

export const dynamic = "force-dynamic";

export default async function FoldEditorPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string | string[] }>;
}) {
  const auth = await requireAuthenticatedPage();
  const query = await searchParams;
  const initialDraftId =
    typeof query.draft === "string" ? query.draft : null;

  return (
    <div className="min-h-dvh bg-slate-100 text-slate-950 xl:flex xl:h-dvh xl:flex-col xl:overflow-hidden">
      <header className="shrink-0 border-b border-slate-300 bg-white">
        <div className="flex min-h-14 w-full items-center justify-between gap-2 px-3 sm:px-5 xl:px-6">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Link
              aria-label="업무 홈으로 이동"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50"
              href="/"
              title="업무 홈"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            </Link>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-700 text-sm font-black text-white">
              F
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-bold text-slate-950">
                절곡 단면 편집기
              </h1>
              <p className="truncate text-[11px] text-slate-500">
                절곡 형상 설계 · 계산 · 제작 데이터 준비
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-3">
            <Link
              className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 sm:px-3"
              href="/fold-library"
            >
              <Library aria-hidden="true" className="h-3.5 w-3.5" />
              <span className="sm:hidden">템플릿</span>
              <span className="hidden sm:inline">템플릿 라이브러리</span>
            </Link>
            <button
              className="hidden cursor-not-allowed rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-400 md:inline-flex"
              disabled
              title="첫 단계에서는 항목만 제공하며 실제 기계 통신은 후속 단계에서 구현합니다."
              type="button"
            >
              기계 연동 · 준비 중
            </button>
            <div className="hidden text-right text-xs lg:block">
              <p className="font-semibold text-slate-700">{auth.displayName}</p>
              <p className="text-slate-500">{auth.organizationName}</p>
            </div>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="w-full py-3 sm:px-3 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col xl:px-4 xl:py-3">
        <FoldDraftWorkspace
          initialDraftId={initialDraftId}
          identity={{
            organizationId: auth.organizationId,
            userId: auth.userId,
          }}
          canEdit={auth.permissions.includes("template.fold.edit")}
        />
      </main>
    </div>
  );
}

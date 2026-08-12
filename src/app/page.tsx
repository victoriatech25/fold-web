import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock3,
  FilePenLine,
  Library,
  PenTool,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

import { ServiceShell } from "@/components/app-shell/service-shell";
import { requireAuthenticatedPage } from "@/server/auth/auth-dal";
import { getPrisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

function formatUpdatedAt(value: Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

export default async function Home() {
  const auth = await requireAuthenticatedPage();
  const prisma = getPrisma();
  const canReadTemplates = auth.permissions.includes("template.fold.read");
  const canEditTemplates = auth.permissions.includes("template.fold.edit");
  const canReadMasterData = auth.permissions.includes("master_data.read");

  const [draftCount, publishedCount, templateCount, recentDrafts, siteCount] =
    await Promise.all([
      canReadTemplates
        ? prisma.foldRevision.count({
            where: {
              deletedAt: null,
              organizationId: auth.organizationId,
              status: "DRAFT",
            },
          })
        : Promise.resolve(0),
      canReadTemplates
        ? prisma.foldRevision.count({
            where: {
              deletedAt: null,
              organizationId: auth.organizationId,
              status: "PUBLISHED",
            },
          })
        : Promise.resolve(0),
      canReadTemplates
        ? prisma.foldTemplate.count({
            where: {
              active: true,
              deletedAt: null,
              organizationId: auth.organizationId,
            },
          })
        : Promise.resolve(0),
      canReadTemplates
        ? prisma.foldRevision.findMany({
            include: {
              template: {
                select: { code: true },
              },
            },
            orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
            take: 5,
            where: {
              deletedAt: null,
              organizationId: auth.organizationId,
              status: "DRAFT",
            },
          })
        : Promise.resolve([]),
      canReadMasterData
        ? prisma.businessSite.count({
            where: {
              active: true,
              deletedAt: null,
              organizationId: auth.organizationId,
            },
          })
        : Promise.resolve(0),
    ]);

  return (
    <ServiceShell
      displayName={auth.displayName}
      organizationName={auth.organizationName}
      pageDescription="오늘 필요한 업무를 빠르게 시작하고 최근 진행 상황을 확인합니다."
      pageTitle="업무 홈"
      permissions={auth.permissions}
    >
      <section className="overflow-hidden rounded-2xl bg-slate-950 px-5 py-6 text-white shadow-sm sm:px-7 sm:py-7">
        <div className="grid items-end gap-6 md:grid-cols-[1fr_auto]">
          <div>
            <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-teal-100">
              <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
              FOLD WEB 업무 공간
            </div>
            <h2 className="text-2xl font-black tracking-tight sm:text-3xl">
              {auth.displayName}님, 무엇을 시작할까요?
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              설계부터 템플릿 관리까지 현재 제공되는 기능을 한곳에서 이용할 수 있습니다.
              수주·생산 업무는 단계별로 연결됩니다.
            </p>
          </div>
          {canEditTemplates ? (
            <Link
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-teal-500 px-5 text-sm font-black text-slate-950 transition hover:bg-teal-400"
              href="/fold-editor"
            >
              <PenTool aria-hidden="true" className="h-4 w-4" />
              새 도면 설계
            </Link>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="quick-start-title" className="mt-7">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-black" id="quick-start-title">
              빠른 시작
            </h2>
            <p className="mt-1 text-xs text-slate-500">자주 쓰는 업무로 바로 이동합니다.</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Link
            className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md"
            href="/fold-editor"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
              <PenTool aria-hidden="true" className="h-5 w-5" />
            </span>
            <span className="mt-4 block text-sm font-black">도면 설계</span>
            <span className="mt-1 block text-xs leading-5 text-slate-500">
              절곡 형상을 그리고 전개 폭과 3D를 확인합니다.
            </span>
            <ArrowRight aria-hidden="true" className="mt-4 h-4 w-4 text-slate-300 transition group-hover:translate-x-1 group-hover:text-teal-600" />
          </Link>
          {canReadTemplates ? (
            <Link
              className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md"
              href="/fold-library"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                <Library aria-hidden="true" className="h-5 w-5" />
              </span>
              <span className="mt-4 block text-sm font-black">템플릿 찾기</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">
                검증된 절곡 형상과 개정 이력을 검색합니다.
              </span>
              <ArrowRight aria-hidden="true" className="mt-4 h-4 w-4 text-slate-300 transition group-hover:translate-x-1 group-hover:text-teal-600" />
            </Link>
          ) : null}
          {canReadMasterData ? (
            <Link
              className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md"
              href="/admin/company"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
                <Building2 aria-hidden="true" className="h-5 w-5" />
              </span>
              <span className="mt-4 block text-sm font-black">회사·사업장</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">
                출력과 업무에 사용할 회사 기준정보를 관리합니다.
              </span>
              <ArrowRight aria-hidden="true" className="mt-4 h-4 w-4 text-slate-300 transition group-hover:translate-x-1 group-hover:text-teal-600" />
            </Link>
          ) : null}
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-200 text-slate-500">
              <FilePenLine aria-hidden="true" className="h-5 w-5" />
            </span>
            <span className="mt-4 flex items-center gap-2 text-sm font-black text-slate-600">
              수주·작업
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] text-slate-600">
                준비 중
              </span>
            </span>
            <span className="mt-1 block text-xs leading-5 text-slate-500">
              고객 주문에서 설계·계산·생산까지 연결할 예정입니다.
            </span>
          </div>
        </div>
      </section>

      <section className="mt-7 grid gap-5 xl:grid-cols-[1.55fr_1fr]">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-base font-black">최근 설계 초안</h2>
              <p className="mt-0.5 text-xs text-slate-500">마지막으로 변경된 작업을 이어서 엽니다.</p>
            </div>
            {canReadTemplates ? (
              <Link className="text-xs font-bold text-teal-700 hover:text-teal-900" href="/fold-library">
                전체 보기
              </Link>
            ) : null}
          </div>
          {recentDrafts.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {recentDrafts.map((draft) => (
                <Link
                  className="group flex items-center gap-3 px-5 py-3.5 transition hover:bg-slate-50"
                  href={`/fold-editor?draft=${draft.id}`}
                  key={draft.id}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 group-hover:bg-teal-50 group-hover:text-teal-700">
                    <FilePenLine aria-hidden="true" className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-slate-800">
                      {draft.name}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                      {draft.template.code} · r{draft.revisionNumber}
                    </span>
                  </span>
                  <span className="hidden shrink-0 items-center gap-1 text-[11px] text-slate-400 sm:flex">
                    <Clock3 aria-hidden="true" className="h-3.5 w-3.5" />
                    {formatUpdatedAt(draft.updatedAt)}
                  </span>
                  <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-teal-600" />
                </Link>
              ))}
            </div>
          ) : (
            <div className="px-5 py-10 text-center">
              <p className="text-sm font-bold text-slate-700">진행 중인 설계 초안이 없습니다.</p>
              <p className="mt-1 text-xs text-slate-500">새 도면 설계에서 첫 작업을 시작할 수 있습니다.</p>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 aria-hidden="true" className="h-5 w-5 text-teal-700" />
            <h2 className="text-base font-black">현재 서비스 현황</h2>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-teal-50 p-4">
              <p className="text-2xl font-black text-teal-900">{draftCount}</p>
              <p className="mt-1 text-xs font-semibold text-teal-700">설계 초안</p>
            </div>
            <div className="rounded-xl bg-blue-50 p-4">
              <p className="text-2xl font-black text-blue-900">{publishedCount}</p>
              <p className="mt-1 text-xs font-semibold text-blue-700">게시 개정</p>
            </div>
            <div className="rounded-xl bg-amber-50 p-4">
              <p className="text-2xl font-black text-amber-900">{templateCount}</p>
              <p className="mt-1 text-xs font-semibold text-amber-700">활성 템플릿</p>
            </div>
            <div className="rounded-xl bg-violet-50 p-4">
              <p className="text-2xl font-black text-violet-900">{siteCount}</p>
              <p className="mt-1 text-xs font-semibold text-violet-700">활성 사업장</p>
            </div>
          </div>
          <p className="mt-4 text-[11px] leading-5 text-slate-500">
            실제 서버 데이터만 집계합니다. 미구현 업무의 임의 통계는 표시하지 않습니다.
          </p>
        </div>
      </section>
    </ServiceShell>
  );
}

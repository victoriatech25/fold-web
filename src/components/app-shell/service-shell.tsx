"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import {
  currentModule,
  isCurrentPath,
  moduleEntryHref,
  visibleModules,
  type NavigationItem,
  type NavigationModule,
} from "@/components/app-shell/navigation-model";
import { LogoutButton } from "@/components/auth/logout-button";
import type { PermissionKey } from "@/domain/permission";

type ServiceShellProps = {
  children: ReactNode;
  displayName: string;
  headerHeading?: boolean;
  organizationName: string;
  pageDescription?: string;
  pageTitle: string;
  permissions: readonly PermissionKey[];
  wide?: boolean;
};

function Brand() {
  return (
    <Link className="flex shrink-0 items-center gap-2.5" href="/">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-700 text-sm font-black text-white">
        F
      </span>
      <span className="hidden text-sm font-black tracking-tight text-slate-950 sm:block">
        FOLD WEB
      </span>
    </Link>
  );
}

/** 좌측 메뉴 한 줄. 링크가 없는 항목은 후속 기능이므로 `준비 중`으로만 표시한다. */
function MenuRow({
  item,
  onNavigate,
  pathname,
}: {
  item: NavigationItem;
  onNavigate?: () => void;
  pathname: string;
}) {
  const Icon = item.icon;
  if (!item.href) {
    return (
      <div
        className="flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-semibold text-slate-400"
        title="후속 단계에서 제공할 기능입니다."
      >
        <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
        <span>{item.label}</span>
        <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
          준비 중
        </span>
      </div>
    );
  }
  const active = isCurrentPath(pathname, item.href);
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-semibold transition ${
        active
          ? "bg-teal-50 text-teal-800 shadow-[inset_2px_0_0_0_#0f766e]"
          : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
      }`}
      href={item.href}
      key={item.label}
      onClick={onNavigate}
    >
      <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
      {item.label}
    </Link>
  );
}

/** 데스크톱 좌측 메뉴. 현재 모듈의 화면만 보여 목록을 짧게 유지한다. */
function ModuleMenu({
  activeModule,
  modules,
  onNavigate,
  pathname,
}: {
  activeModule: NavigationModule;
  modules: NavigationModule[];
  onNavigate?: () => void;
  pathname: string;
}) {
  const hasItems = activeModule.items.length > 0;
  return (
    <nav aria-label="주요 메뉴" className="flex min-h-0 flex-1 flex-col gap-1">
      <p className="px-3 pb-1 text-[11px] font-bold tracking-[0.12em] text-slate-400">
        {hasItems ? `${activeModule.label} 메뉴` : "업무 바로가기"}
      </p>
      {hasItems
        ? activeModule.items.map((item) => (
            <MenuRow item={item} key={item.label} onNavigate={onNavigate} pathname={pathname} />
          ))
        : modules
            .filter((module) => module.items.length > 0)
            .map((module) => (
              <div className="mt-2 first:mt-0" key={module.id}>
                <p className="px-3 pb-1 text-[11px] font-bold text-slate-400">{module.label}</p>
                {module.items.map((item) => (
                  <MenuRow item={item} key={item.label} onNavigate={onNavigate} pathname={pathname} />
                ))}
              </div>
            ))}
    </nav>
  );
}

export function ServiceShell({
  children,
  displayName,
  headerHeading = true,
  organizationName,
  pageDescription,
  pageTitle,
  permissions,
  wide = false,
}: ServiceShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const modules = visibleModules(permissions);
  const activeModule = currentModule(pathname, modules);

  return (
    <div className="min-h-dvh bg-[#f4f7f6] text-slate-950">
      <a
        className="fixed left-3 top-3 z-[70] -translate-y-20 rounded bg-slate-950 px-3 py-2 text-sm font-bold text-white focus:translate-y-0"
        href="#main-content"
      >
        본문으로 이동
      </a>

      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="flex min-h-14 items-center gap-3 px-4 sm:px-6">
          <button
            aria-label="메뉴 열기"
            className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 lg:hidden"
            onClick={() => setMobileOpen(true)}
            type="button"
          >
            <Menu aria-hidden="true" className="h-5 w-5" />
          </button>
          <Brand />
          <nav
            aria-label="업무 모듈"
            className="hidden min-w-0 flex-1 items-stretch gap-1 self-stretch overflow-x-auto pl-4 lg:flex"
          >
            {modules.map((module) => {
              const href = moduleEntryHref(module);
              if (!href) return null;
              const active = module.id === activeModule.id;
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={`flex shrink-0 items-center border-b-[3px] px-4 text-sm font-bold transition ${
                    active
                      ? "border-teal-700 text-teal-800"
                      : "border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                  }`}
                  href={href}
                  key={module.id}
                >
                  {module.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3 lg:ml-0">
            <div className="hidden text-right sm:block">
              <p className="text-xs font-bold text-slate-700">{organizationName}</p>
              <p className="text-[11px] text-slate-500">{displayName}</p>
            </div>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-50 text-xs font-black text-teal-800">
              {displayName.trim().slice(0, 1) || "U"}
            </span>
            <div className="hidden lg:block">
              <LogoutButton />
            </div>
          </div>
        </div>

        {activeModule.items.length > 0 ? (
          <div className="border-t border-slate-100 bg-slate-50">
            <nav
              aria-label={`${activeModule.label} 화면`}
              className="flex gap-1 overflow-x-auto px-4 sm:px-6"
            >
              {activeModule.items.map((item) => {
                if (!item.href) {
                  return (
                    <span
                      className="shrink-0 px-3 py-2.5 text-xs font-bold text-slate-400"
                      key={item.label}
                      title="후속 단계에서 제공할 기능입니다."
                    >
                      {item.label}
                      <span className="ml-1.5 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px]">
                        준비 중
                      </span>
                    </span>
                  );
                }
                const active = isCurrentPath(pathname, item.href);
                return (
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={`shrink-0 border-b-2 px-3 py-2.5 text-xs font-bold transition ${
                      active
                        ? "border-teal-700 text-teal-800"
                        : "border-transparent text-slate-500 hover:text-slate-900"
                    }`}
                    href={item.href}
                    key={item.label}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        ) : null}
      </header>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="메뉴 닫기"
            className="absolute inset-0 cursor-default bg-slate-950/35"
            onClick={() => setMobileOpen(false)}
            type="button"
          />
          <aside className="relative flex h-full w-[min(19rem,86vw)] flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-4">
              <Brand />
              <button
                aria-label="메뉴 닫기"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                onClick={() => setMobileOpen(false)}
                type="button"
              >
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4">
              <nav aria-label="주요 메뉴" className="flex flex-col gap-1">
                <MenuRow
                  item={{ href: "/", icon: Menu, label: "홈" }}
                  onNavigate={() => setMobileOpen(false)}
                  pathname={pathname}
                />
                {modules
                  .filter((module) => module.items.length > 0)
                  .map((module) => (
                    <div className="mt-3" key={module.id}>
                      <p className="px-3 pb-1 text-[11px] font-bold tracking-[0.12em] text-slate-400">
                        {module.label}
                      </p>
                      {module.items.map((item) => (
                        <MenuRow
                          item={item}
                          key={item.label}
                          onNavigate={() => setMobileOpen(false)}
                          pathname={pathname}
                        />
                      ))}
                    </div>
                  ))}
              </nav>
            </div>
            <div className="border-t border-slate-100 p-4">
              <p className="text-xs font-bold text-slate-800">{displayName}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">{organizationName}</p>
              <div className="mt-3">
                <LogoutButton />
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      <div className="lg:flex">
        <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white lg:sticky lg:top-[6.4rem] lg:flex lg:h-[calc(100dvh-6.4rem)] lg:flex-col">
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4">
            <ModuleMenu
              activeModule={activeModule}
              modules={modules}
              pathname={pathname}
            />
          </div>
        </aside>

        <main
          className={`${wide ? "max-w-[1600px]" : "max-w-[1400px]"} mx-auto w-full min-w-0 flex-1 px-4 py-5 sm:px-6`}
          id="main-content"
        >
          {/* 화면이 스스로 제목을 그리는 경우(headerHeading=false)에는 셸이 제목을 겹쳐 그리지 않는다. */}
          {headerHeading ? (
            <div className="mb-4">
              <h1 className="text-lg font-black tracking-tight text-slate-950">{pageTitle}</h1>
              {pageDescription ? (
                <p className="mt-0.5 text-xs text-slate-500">{pageDescription}</p>
              ) : null}
            </div>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}

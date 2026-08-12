"use client";

import {
  Building2,
  ClipboardList,
  ContactRound,
  BadgeDollarSign,
  Factory,
  LayoutDashboard,
  Library,
  Layers3,
  Menu,
  Network,
  PenTool,
  Printer,
  ScrollText,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

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

type NavigationItem = {
  href?: string;
  icon: typeof LayoutDashboard;
  label: string;
  planned?: boolean;
};

function isCurrentPath(pathname: string, href: string) {
  if (href === "/") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Navigation({
  onNavigate,
  permissions,
}: {
  onNavigate?: () => void;
  permissions: readonly PermissionKey[];
}) {
  const pathname = usePathname();
  const canReadMasterData = permissions.includes("master_data.read");
  const canReadCustomers = permissions.includes("customer.read");
  const canReadMaterials = permissions.includes("material.read");
  const canReadPricing = permissions.includes("pricing.read");
  const canReadOrders = permissions.includes("order.read");
  const canManageOrganization = permissions.includes("admin.manage");
  const canReadAudit = permissions.includes("audit.read");

  const workItems: NavigationItem[] = [
    { href: "/", icon: LayoutDashboard, label: "홈" },
    { href: "/fold-editor", icon: PenTool, label: "도면 설계" },
    { href: "/fold-library", icon: Library, label: "템플릿" },
    ...(canReadOrders ? [{ href: "/orders", icon: ClipboardList, label: "수주·작업" }] : []),
    { icon: Factory, label: "생산·절단", planned: true },
    { icon: Printer, label: "출력·이력", planned: true },
  ];
  const settingItems: NavigationItem[] = [
    ...(canReadCustomers
      ? [{ href: "/customers", icon: ContactRound, label: "거래처·현장" }]
      : []),
    ...(canReadMaterials
      ? [{ href: "/materials", icon: Layers3, label: "재질·두께" }]
      : []),
    ...(canReadPricing
      ? [{ href: "/pricing", icon: BadgeDollarSign, label: "가격 관리" }]
      : []),
    ...(canReadMasterData
      ? [{ href: "/admin/company", icon: Building2, label: "회사·사업장" }]
      : []),
    ...(canManageOrganization
      ? [
          { href: "/admin/users", icon: Users, label: "조직 관리" },
          { href: "/admin/departments", icon: Network, label: "부서" },
          { href: "/admin/roles", icon: ShieldCheck, label: "역할과 권한" },
        ]
      : []),
    ...(canReadAudit
      ? [{ href: "/admin/audit-logs", icon: ScrollText, label: "감사 로그" }]
      : []),
  ];

  function renderItems(items: NavigationItem[]) {
    return items.map((item) => {
      const Icon = item.icon;
      if (!item.href) {
        return (
          <div
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-400"
            key={item.label}
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
          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
            active
              ? "bg-teal-50 text-teal-800"
              : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
          }`}
          href={item.href}
          key={item.label}
          onClick={onNavigate}
        >
          <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
          {item.label}
          {active ? (
            <span className="ml-auto h-1.5 w-1.5 rounded-full bg-teal-600" />
          ) : null}
        </Link>
      );
    });
  }

  return (
    <nav aria-label="주요 메뉴" className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-1">
        <p className="px-3 pb-1 text-[11px] font-bold tracking-[0.12em] text-slate-400">
          업무
        </p>
        {renderItems(workItems)}
      </div>
      {settingItems.length > 0 ? (
        <div className="mt-7 space-y-1">
          <p className="px-3 pb-1 text-[11px] font-bold tracking-[0.12em] text-slate-400">
            관리
          </p>
          {renderItems(settingItems)}
        </div>
      ) : null}
    </nav>
  );
}

function Brand() {
  return (
    <Link className="flex items-center gap-3" href="/">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-700 text-base font-black text-white shadow-sm">
        F
      </span>
      <span>
        <span className="block text-sm font-black tracking-tight text-slate-950">
          FOLD WEB
        </span>
        <span className="block text-[11px] font-medium text-slate-500">
          절곡 업무 플랫폼
        </span>
      </span>
    </Link>
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
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-[#f4f7f6] text-slate-950 lg:flex">
      <a
        className="fixed left-3 top-3 z-[70] -translate-y-20 rounded bg-slate-950 px-3 py-2 text-sm font-bold text-white focus:translate-y-0"
        href="#main-content"
      >
        본문으로 이동
      </a>

      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
        <div className="border-b border-slate-100 px-5 py-5">
          <Brand />
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-5">
          <Navigation permissions={permissions} />
        </div>
        <div className="border-t border-slate-100 p-4">
          <p className="truncate text-xs font-bold text-slate-800">{displayName}</p>
          <p className="mt-0.5 truncate text-[11px] text-slate-500">{organizationName}</p>
          <div className="mt-3">
            <LogoutButton />
          </div>
        </div>
      </aside>

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
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-5">
              <Navigation
                onNavigate={() => setMobileOpen(false)}
                permissions={permissions}
              />
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

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex min-h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
            <button
              aria-label="메뉴 열기"
              className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 lg:hidden"
              onClick={() => setMobileOpen(true)}
              type="button"
            >
              <Menu aria-hidden="true" className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              {headerHeading ? (
                <h1 className="truncate text-base font-black tracking-tight text-slate-950 sm:text-lg">
                  {pageTitle}
                </h1>
              ) : (
                <p className="truncate text-base font-black tracking-tight text-slate-950 sm:text-lg">
                  {pageTitle}
                </p>
              )}
              {pageDescription ? (
                <p className="hidden truncate text-xs text-slate-500 sm:block">
                  {pageDescription}
                </p>
              ) : null}
            </div>
            <div className="ml-auto hidden items-center gap-3 lg:flex">
              <div className="text-right">
                <p className="text-xs font-bold text-slate-700">{organizationName}</p>
                <p className="text-[11px] text-slate-500">{displayName}</p>
              </div>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-50 text-xs font-black text-teal-800">
                {displayName.trim().slice(0, 1) || "U"}
              </span>
            </div>
          </div>
        </header>
        <main
          className={`${wide ? "max-w-[1600px]" : "max-w-7xl"} mx-auto w-full px-4 py-5 sm:px-6 sm:py-7 lg:px-8`}
          id="main-content"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

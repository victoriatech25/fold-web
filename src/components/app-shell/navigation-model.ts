import {
  BadgeDollarSign,
  Building2,
  ClipboardList,
  ContactRound,
  Factory,
  FileSpreadsheet,
  LayoutDashboard,
  Layers3,
  Library,
  ListChecks,
  Network,
  PenTool,
  Printer,
  ScrollText,
  ShieldCheck,
  Truck,
  Users,
} from "lucide-react";

import type { PermissionKey } from "@/domain/permission";

export type NavigationItem = {
  href?: string;
  icon: typeof LayoutDashboard;
  label: string;
  /** 화면을 여는 데 필요한 권한. 없으면 모든 사용자에게 보인다. */
  permission?: PermissionKey;
  /** 후속 단계에서 제공할 기능. 링크 없이 `준비 중`으로만 표시한다. */
  planned?: boolean;
};

export type NavigationModule = {
  id: string;
  label: string;
  /** 모듈 자체가 한 화면인 경우의 경로. 하위 메뉴가 있으면 첫 화면으로 대신 이동한다. */
  href?: string;
  items: NavigationItem[];
};

/**
 * 상단 모듈 탭과 좌측 메뉴가 함께 쓰는 단일 정의다.
 * 화면을 추가할 때 이 배열만 고치면 두 자리에 동시에 반영된다.
 */
const modules: NavigationModule[] = [
  { id: "home", label: "업무 홈", href: "/", items: [] },
  {
    id: "sales",
    label: "영업관리",
    items: [
      { href: "/orders", icon: ClipboardList, label: "수주 등록/조회", permission: "order.read" },
      { icon: FileSpreadsheet, label: "견적 관리", planned: true },
      { icon: Truck, label: "출하 요청", planned: true },
    ],
  },
  {
    id: "design",
    label: "설계·도면",
    items: [
      { href: "/fold-editor", icon: PenTool, label: "도면 설계" },
      { href: "/fold-library", icon: Library, label: "템플릿" },
    ],
  },
  {
    id: "production",
    label: "생산·출력",
    items: [
      { href: "/jobs", icon: ListChecks, label: "작업 큐" },
      { icon: Factory, label: "생산·절단", planned: true },
      { icon: Printer, label: "출력·이력", planned: true },
    ],
  },
  {
    id: "master",
    label: "기준정보",
    items: [
      { href: "/customers", icon: ContactRound, label: "거래처·현장", permission: "customer.read" },
      { href: "/materials", icon: Layers3, label: "재질·두께", permission: "material.read" },
      { href: "/pricing", icon: BadgeDollarSign, label: "가격 관리", permission: "pricing.read" },
      { href: "/admin/company", icon: Building2, label: "회사·사업장", permission: "master_data.read" },
    ],
  },
  {
    id: "system",
    label: "시스템",
    items: [
      { href: "/admin/users", icon: Users, label: "조직 관리", permission: "admin.manage" },
      { href: "/admin/departments", icon: Network, label: "부서", permission: "admin.manage" },
      { href: "/admin/roles", icon: ShieldCheck, label: "역할과 권한", permission: "admin.manage" },
      { href: "/admin/audit-logs", icon: ScrollText, label: "감사 로그", permission: "audit.read" },
    ],
  },
];

export const homeItem: NavigationItem = { href: "/", icon: LayoutDashboard, label: "홈" };

/** 권한이 없는 화면은 메뉴에서 제거한다. 주소 직접 접근은 서버가 다시 검증한다. */
export function visibleModules(permissions: readonly PermissionKey[]): NavigationModule[] {
  return modules
    .map((module) => ({
      ...module,
      items: module.items.filter(
        (item) => !item.permission || permissions.includes(item.permission),
      ),
    }))
    .filter((module) => module.href !== undefined || module.items.length > 0);
}

function matchesPath(pathname: string, href: string) {
  if (href === "/") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isCurrentPath(pathname: string, href: string) {
  return matchesPath(pathname, href);
}

/** 현재 경로가 속한 모듈. 어디에도 속하지 않으면 업무 홈으로 본다. */
export function currentModule(
  pathname: string,
  available: NavigationModule[],
): NavigationModule {
  const matched = available.find((module) =>
    module.items.some((item) => item.href && matchesPath(pathname, item.href)),
  );
  if (matched) return matched;
  return available.find((module) => module.href && matchesPath(pathname, module.href)) ?? available[0];
}

/** 모듈 탭이 가리킬 첫 화면. */
export function moduleEntryHref(module: NavigationModule): string | undefined {
  return module.href ?? module.items.find((item) => item.href)?.href;
}

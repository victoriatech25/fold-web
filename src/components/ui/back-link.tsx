import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * 상세 화면에서 상위 목록으로 돌아가는 버튼. 모든 상세 화면이 같은 모양을 쓴다.
 * 글자 링크는 눈에 띄지 않아 사용자가 찾지 못했다(2026-09-13). 테두리 있는 버튼으로 통일한다.
 */
export function BackLink({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      className={`inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 shadow-sm transition hover:border-teal-700 hover:bg-teal-50 hover:text-teal-800 ${className}`}
      href={href}
    >
      <ArrowLeft aria-hidden="true" className="h-4 w-4" />
      {children}
    </Link>
  );
}

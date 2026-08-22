"use client";

import { Search } from "lucide-react";
import type { FormEvent, ReactNode } from "react";

/**
 * 목록 화면 상단의 공통 조회조건 바다.
 * 조건은 한 줄에 모으고 `조회` 버튼을 오른쪽 끝에 고정해 화면마다 위치가 흔들리지 않게 한다.
 */
export function QueryBar({
  actions,
  busy = false,
  children,
  onReset,
  onSubmit,
}: {
  actions?: ReactNode;
  busy?: boolean;
  children: ReactNode;
  onReset?: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form
      className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm"
      onSubmit={onSubmit}
    >
      <div className="flex flex-wrap items-end gap-3">
        {children}
        <div className="ml-auto flex items-end gap-2">
          {actions}
          {onReset ? (
            <button
              className="h-9 rounded border border-slate-300 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"
              onClick={onReset}
              type="button"
            >
              초기화
            </button>
          ) : null}
          <button
            className="inline-flex h-9 items-center gap-1.5 rounded bg-teal-700 px-4 text-xs font-bold text-white hover:bg-teal-800 disabled:opacity-50"
            disabled={busy}
            type="submit"
          >
            <Search aria-hidden="true" className="h-3.5 w-3.5" />
            {busy ? "조회 중" : "조회"}
          </button>
        </div>
      </div>
    </form>
  );
}

/** 조회조건 한 칸. 라벨과 입력을 세로로 붙여 정렬을 맞춘다. */
export function QueryField({
  children,
  label,
  width = "w-44",
}: {
  children: ReactNode;
  label: string;
  width?: string;
}) {
  return (
    <label className={`${width} min-w-0 shrink-0 text-[11px] font-bold text-slate-500`}>
      {label}
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

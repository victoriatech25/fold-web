"use client";

import type { KeyboardEvent, ReactNode } from "react";

export type TabDefinition = {
  /** 탭 식별자. panel 과 짝을 맞춘다. */
  id: string;
  label: string;
  /** 건수처럼 탭 이름 옆에 붙는 짧은 보조 표시. */
  badge?: ReactNode;
};

/**
 * 업무 화면의 세로 나열을 대신하는 공통 탭이다.
 * 화살표·Home·End 키 이동과 `aria-selected`, `aria-controls`를 함께 제공한다.
 */
export function Tabs({
  ariaLabel,
  onChange,
  tabs,
  value,
}: {
  ariaLabel: string;
  onChange: (id: string) => void;
  tabs: readonly TabDefinition[];
  value: string;
}) {
  function move(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.id === value);
    if (index < 0) return;
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    onChange(tabs[next].id);
    document.getElementById(`tab-${tabs[next].id}`)?.focus();
  }

  return (
    <div
      aria-label={ariaLabel}
      className="flex gap-1 overflow-x-auto border-b border-slate-200 px-2"
      onKeyDown={move}
      role="tablist"
    >
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            aria-controls={`tabpanel-${tab.id}`}
            aria-selected={selected}
            className={`shrink-0 border-b-2 px-4 py-3 text-sm font-bold transition ${
              selected
                ? "border-teal-700 text-teal-800"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
            id={`tab-${tab.id}`}
            key={tab.id}
            onClick={() => onChange(tab.id)}
            role="tab"
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            {tab.label}
            {tab.badge !== undefined && tab.badge !== null ? (
              <span
                className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${
                  selected ? "bg-teal-100 text-teal-800" : "bg-slate-100 text-slate-500"
                }`}
              >
                {tab.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * 선택되지 않은 panel 도 DOM 에 남긴다.
 * 탭을 오갈 때 각 panel 이 들고 있는 편집 상태가 초기값으로 되돌아가는 것을 막는다.
 * DOM 에서 지워야 하는 무거운 화면은 `unmount` 로 따로 지정한다.
 */
export function TabPanel({
  children,
  id,
  unmount = false,
  value,
}: {
  children: ReactNode;
  id: string;
  unmount?: boolean;
  value: string;
}) {
  const selected = id === value;
  if (unmount && !selected) return null;
  return (
    <div
      aria-labelledby={`tab-${id}`}
      hidden={!selected}
      id={`tabpanel-${id}`}
      role="tabpanel"
      tabIndex={selected ? 0 : -1}
    >
      {children}
    </div>
  );
}

"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { QueryBar, QueryField } from "@/components/ui/query-bar";
import type { CuttingPlanDto, CuttingRevisionDto } from "@/server/cutting/cutting-plan-service";

export const planStatusLabels: Record<CuttingPlanDto["status"], string> = {
  PENDING: "계산 중",
  CALCULATED: "계산 완료",
  APPROVED: "승인",
  FAILED: "실패",
};

/** 개정 한 건의 실행 결과. 재단 작업 자체의 상태(`planStatusLabels`)와는 다른 값이다. */
export const revisionStatusLabels: Record<CuttingRevisionDto["status"], string> = {
  QUEUED: "계산 중",
  SUCCEEDED: "완료",
  FAILED: "실패",
};

export const planStatusStyles: Record<CuttingPlanDto["status"], string> = {
  PENDING: "bg-slate-100 text-slate-700",
  CALCULATED: "bg-blue-100 text-blue-800",
  APPROVED: "bg-teal-100 text-teal-900",
  FAILED: "bg-red-100 text-red-800",
};

export async function cuttingRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message ?? "재단 요청을 처리하지 못했습니다.");
  }
  return body.data as T;
}

const statusFilters = ["PENDING", "CALCULATED", "APPROVED", "FAILED"] as const;

export function CuttingPlanListPanel({ initial }: { initial: { items: CuttingPlanDto[] } }) {
  const [items, setItems] = useState(initial.items);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // 자동 갱신도 같은 조건으로 다시 읽는다. 조건이 빠지면 갱신 때마다 목록이 바뀐다.
  const params = useCallback(() => {
    const search = new URLSearchParams();
    if (query.trim()) search.set("q", query.trim());
    if (statuses.length > 0) search.set("statuses", statuses.join(","));
    return search;
  }, [query, statuses]);

  const refresh = useCallback(async () => {
    const page = await cuttingRequest<{ items: CuttingPlanDto[] }>(`/api/v1/cutting-plans?${params()}`);
    setItems(page.items);
  }, [params]);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "재단 작업을 조회하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setQuery("");
    setStatuses([]);
  }

  function toggleStatus(status: string) {
    setStatuses((current) =>
      current.includes(status) ? current.filter((item) => item !== status) : [...current, status],
    );
  }

  // 계산 중인 작업이 있을 때만 2초 간격으로 다시 읽는다(`D2-B01-H`).
  const hasPending = items.some((item) => item.status === "PENDING");
  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(() => {
      void refresh().catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : "재단 작업을 조회하지 못했습니다."),
      );
    }, 2_000);
    return () => clearInterval(timer);
  }, [hasPending, refresh]);

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-black">생산·절단</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          수주번호·상태로 재단을 찾아 결과를 확인하고 승인합니다. 계산 중인 작업이 있으면 자동으로 갱신됩니다.
        </p>
      </div>

      <QueryBar busy={busy} onReset={reset} onSubmit={search}>
        <QueryField label="수주번호" width="w-64">
          <input
            className="field-control !mt-0 h-9"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="수주번호 일부"
            value={query}
          />
        </QueryField>
      </QueryBar>

      <div
        aria-label="재단 상태"
        className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-sm"
        role="group"
      >
        <span className="mr-1 text-[11px] font-bold text-slate-500">상태</span>
        <button
          aria-pressed={statuses.length === 0}
          className={`rounded-full px-3 py-1 text-xs font-bold ${
            statuses.length === 0
              ? "bg-teal-700 text-white"
              : "border border-slate-300 text-slate-600 hover:bg-slate-50"
          }`}
          onClick={() => setStatuses([])}
          type="button"
        >
          전체
        </button>
        {statusFilters.map((status) => {
          const on = statuses.includes(status);
          return (
            <button
              aria-pressed={on}
              className={`rounded-full px-3 py-1 text-xs font-bold ${
                on
                  ? "bg-teal-700 text-white"
                  : "border border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
              key={status}
              onClick={() => toggleStatus(status)}
              type="button"
            >
              {planStatusLabels[status]}
            </button>
          );
        })}
      </div>

      {error ? (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-800">
          {error}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="bg-slate-50 text-[11px] font-bold text-slate-500">
            <tr>
              <th className="px-4 py-2">수주</th>
              <th className="px-4 py-2">재질</th>
              <th className="px-4 py-2">상태</th>
              <th className="px-4 py-2 text-right">원판 수</th>
              <th className="px-4 py-2 text-right">수율</th>
              <th className="px-4 py-2 text-right">미배치</th>
              <th className="px-4 py-2">갱신</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-center text-slate-500" colSpan={7}>
                  {query.trim() || statuses.length > 0
                    ? "조건에 맞는 재단이 없습니다. 조회조건을 바꿔 주세요."
                    : "재단 작업이 없습니다. 승인된 수주 상세에서 재단을 시작해 주세요."}
                </td>
              </tr>
            ) : null}
            {items.map((plan) => (
              <tr className="border-t border-slate-100 hover:bg-slate-50" key={plan.id}>
                <td className="px-4 py-2 font-bold">
                  <Link className="text-teal-800 underline" href={`/cutting/${plan.id}`}>
                    {plan.orderNumber}
                  </Link>
                </td>
                <td className="px-4 py-2">
                  {plan.materialLabel}
                  <span className="ml-1 text-slate-500">{plan.thicknessMm}T</span>
                </td>
                <td className="px-4 py-2">
                  <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${planStatusStyles[plan.status]}`}>
                    {planStatusLabels[plan.status]}
                  </span>
                </td>
                <td className="px-4 py-2 text-right">{plan.currentRevision?.sheetCount ?? "-"}</td>
                <td className="px-4 py-2 text-right">
                  {plan.currentRevision?.yieldPercent ? `${plan.currentRevision.yieldPercent}%` : "-"}
                </td>
                <td className="px-4 py-2 text-right">
                  {plan.currentRevision?.unplacedQuantity ?? "-"}
                </td>
                <td className="px-4 py-2 text-slate-500">
                  {new Date(plan.updatedAt).toLocaleString("ko-KR")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { CuttingPlanDto } from "@/server/cutting/cutting-plan-service";

export const planStatusLabels: Record<CuttingPlanDto["status"], string> = {
  PENDING: "계산 중",
  CALCULATED: "계산 완료",
  APPROVED: "승인",
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

export function CuttingPlanListPanel({ initial }: { initial: { items: CuttingPlanDto[] } }) {
  const [items, setItems] = useState(initial.items);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const page = await cuttingRequest<{ items: CuttingPlanDto[] }>("/api/v1/cutting-plans");
    setItems(page.items);
  }, []);

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
          승인된 수주의 재단 결과를 확인하고 승인합니다. 계산 중인 작업이 있으면 자동으로 갱신됩니다.
        </p>
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
                  재단 작업이 없습니다. 승인된 수주 상세에서 재단을 시작해 주세요.
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

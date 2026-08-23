"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  cuttingRequest,
  planStatusLabels,
  planStatusStyles,
} from "@/components/cutting/cutting-plan-list-panel";
import { useCommonPopup } from "@/components/ui/common-popup";
import type { CuttingPlanDto } from "@/server/cutting/cutting-plan-service";
import type { SalesOrderDto } from "@/server/orders/order-service";

/** 재단을 열 수 있는 수주 상태(`D2-B05-A`). */
const cuttableStatuses: SalesOrderDto["status"][] = [
  "APPROVED",
  "PRODUCTION_REQUESTED",
  "IN_PRODUCTION",
];

/**
 * 수주 상세의 `승인·생산` 탭에서 재단으로 넘어가는 자리다.
 * 재질별로 작업이 하나씩 생긴다(`D2-B05-I`).
 */
export function OrderCuttingPanel({
  order,
  canOptimize,
  initialPlans,
}: {
  order: SalesOrderDto;
  canOptimize: boolean;
  initialPlans: CuttingPlanDto[];
}) {
  const popup = useCommonPopup();
  const [plans, setPlans] = useState(initialPlans);
  const [busy, setBusy] = useState(false);
  const cuttable = cuttableStatuses.includes(order.status);

  const refresh = useCallback(async () => {
    if (!canOptimize) return;
    const page = await cuttingRequest<{ items: CuttingPlanDto[] }>(
      `/api/v1/orders/${order.id}/cutting-plans`,
    );
    setPlans(page.items);
  }, [canOptimize, order.id]);

  const hasPending = plans.some((plan) => plan.status === "PENDING");
  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(() => {
      void refresh().catch(() => undefined);
    }, 2_000);
    return () => clearInterval(timer);
  }, [hasPending, refresh]);

  async function start() {
    setBusy(true);
    try {
      const created = await cuttingRequest<{ items: CuttingPlanDto[] }>(
        `/api/v1/orders/${order.id}/cutting-plans`,
        { method: "POST", body: "{}" },
      );
      setPlans(created.items);
      await popup.alert({
        title: "재단 시작",
        message: `재질 ${created.items.length}종의 재단 작업을 만들었습니다. 계산이 끝나면 결과가 표시됩니다.`,
      });
    } catch (caught) {
      await popup.alert({
        title: "재단 시작 실패",
        message: caught instanceof Error ? caught.message : "재단 작업을 만들지 못했습니다.",
        variant: "danger",
      });
    } finally {
      setBusy(false);
    }
  }

  if (!canOptimize) return null;

  return (
    <section className="mt-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black">재단</h2>
          <p className="mt-1 text-sm text-slate-600">
            승인된 수주의 절곡 작업을 재질별로 묶어 원판에 배치합니다.
          </p>
        </div>
        {cuttable ? (
          <button
            className="rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            disabled={busy}
            onClick={() => void start()}
            type="button"
          >
            {plans.length > 0 ? "재단 작업 확인" : "재단 시작"}
          </button>
        ) : null}
      </div>

      {!cuttable ? (
        <p className="mt-4 rounded bg-slate-50 px-3 py-2 text-sm text-slate-600">
          수주를 승인하면 재단을 시작할 수 있습니다.
        </p>
      ) : null}

      {plans.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {plans.map((plan) => (
            <li
              className="flex flex-wrap items-center gap-2 rounded border border-slate-200 px-3 py-2 text-xs"
              key={plan.id}
            >
              <span className="font-bold">
                {plan.materialLabel} {plan.thicknessMm}T
              </span>
              <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${planStatusStyles[plan.status]}`}>
                {planStatusLabels[plan.status]}
              </span>
              <span className="text-slate-600">
                원판 {plan.currentRevision?.sheetCount ?? "-"}장 · 수율{" "}
                {plan.currentRevision?.yieldPercent ? `${plan.currentRevision.yieldPercent}%` : "-"}
              </span>
              <Link className="ml-auto text-teal-800 underline" href={`/cutting/${plan.id}`}>
                결과 보기
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

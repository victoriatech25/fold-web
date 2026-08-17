"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { OrderRequestError, orderRequest } from "@/components/orders/order-api";
import { useCommonPopup } from "@/components/ui/common-popup";
import type { OrderCalculationStateDto } from "@/server/orders/order-calculation-service";
import type { SalesOrderDto } from "@/server/orders/order-service";

type CalculationMutation = {
  orderLockVersion: number;
  state: OrderCalculationStateDto;
};

const won = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 });
const amount = (value: string) => won.format(BigInt(value));
const scopeLabel = { CUSTOMER: "거래처 전용", TIER: "가격등급", STANDARD: "조직 기본", PREVIEW: "미리보기" } as const;

export function OrderCalculationPanel({
  state,
  editable,
  getReadyOrder,
  onCalculated,
}: {
  state: OrderCalculationStateDto;
  editable: boolean;
  getReadyOrder: () => Promise<SalesOrderDto | null>;
  onCalculated: (result: CalculationMutation) => void;
}) {
  const popup = useCommonPopup();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const snapshot = state.snapshot;

  async function calculate() {
    setBusy(true);
    try {
      const order = await getReadyOrder();
      if (!order) throw new Error("수주 기본정보를 먼저 저장해 주세요.");
      const result = await orderRequest<CalculationMutation>(`/api/v1/orders/${order.id}/calculations`, {
        method: "POST",
        body: JSON.stringify({ expectedOrderLockVersion: order.lockVersion }),
      });
      onCalculated(result);
      await popup.alert({
        title: snapshot ? "수주 재계산 완료" : "수주 계산 완료",
        message: `계산 버전 ${result.state.snapshot?.snapshotNumber ?? "-"} · 총액 ${result.state.snapshot ? amount(result.state.snapshot.totalAmountKrw) : "-"}`,
      });
    } catch (caught) {
      if (caught instanceof OrderRequestError && caught.code === "CONFLICT" && caught.details) {
        await popup.alert({ title: "계산 충돌", message: `${caught.message} 최신 내용을 다시 불러옵니다.`, variant: "warning" });
        router.refresh();
      } else {
        await popup.alert({ title: "수주 계산 실패", message: caught instanceof Error ? caught.message : "수주를 계산하지 못했습니다.", variant: "danger" });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-black">계산·가격</h2>
            <span className={`rounded px-2 py-1 text-xs font-bold ${state.stale ? "bg-amber-100 text-amber-900" : snapshot ? "bg-teal-100 text-teal-900" : "bg-slate-100 text-slate-600"}`}>
              {state.stale ? "재계산 필요" : snapshot ? "계산 완료" : "계산 전"}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">작업 형상과 계산 시점의 게시 가격을 불변 스냅샷으로 저장합니다.</p>
        </div>
        {editable ? <button className="rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={busy || !state.canCalculate} onClick={() => void calculate()} type="button">{busy ? "계산 중…" : snapshot ? "다시 계산" : "수주 계산"}</button> : null}
      </div>

      {!snapshot ? (
        <div className="mt-5 rounded-lg border border-dashed border-slate-300 p-7 text-center text-sm text-slate-500">절곡 작업을 추가한 뒤 수주 계산을 실행해 주세요.</div>
      ) : (
        <>
          {state.stale ? <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">절곡 작업 입력이 계산 버전 {snapshot.snapshotNumber} 이후 변경되었습니다. 기존 금액은 이력으로 유지되며 다시 계산해야 현재 금액이 됩니다.</p> : null}
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">공급가액</p><p className="mt-1 text-xl font-black">{amount(snapshot.supplyAmountKrw)}</p></div>
            <div className="rounded-lg bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">VAT {snapshot.vatRatePercent}%</p><p className="mt-1 text-xl font-black">{amount(snapshot.vatAmountKrw)}</p></div>
            <div className="rounded-lg bg-teal-50 p-4"><p className="text-xs font-bold text-teal-700">총액</p><p className="mt-1 text-xl font-black text-teal-950">{amount(snapshot.totalAmountKrw)}</p></div>
          </div>
          <div className="mt-4 overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="p-3 text-left">작업</th><th className="p-3 text-right">면적/개</th><th className="p-3 text-right">절곡/개</th><th className="p-3 text-right">V-CUT/개</th><th className="p-3 text-right">재질비</th><th className="p-3 text-right">가공·할증</th><th className="p-3 text-right">공급가</th><th className="p-3 text-left">가격 출처</th></tr></thead>
              <tbody className="divide-y">{snapshot.items.map((item) => <tr key={item.id}><td className="p-3"><b>작업 {item.lineNumber}</b><p className="max-w-48 truncate text-xs text-slate-500">{item.name} · 수량 {item.quantity}</p></td><td className="p-3 text-right font-mono">{item.metrics.areaEachM2}㎡</td><td className="p-3 text-right font-mono">{item.metrics.bendOperationsEach}회</td><td className="p-3 text-right font-mono">{item.metrics.vCutLengthEachM}m</td><td className="p-3 text-right">{amount(item.materialAmountKrw)}</td><td className="p-3 text-right">{amount((BigInt(item.bendAmountKrw) + BigInt(item.vCutAmountKrw) + BigInt(item.surchargeAmountKrw)).toString())}</td><td className="p-3 text-right font-bold">{amount(item.supplyAmountKrw)}</td><td className="p-3 text-xs"><b>{scopeLabel[item.pricingResult.trace.foldRate.scopeType]}</b><br /><span className="text-slate-500">개정 {item.pricingResult.trace.foldRate.revisionId.slice(0, 8)}…</span></td></tr>)}</tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500">계산 버전 {snapshot.snapshotNumber} · {new Date(snapshot.createdAt).toLocaleString("ko-KR")} · 입력 {snapshot.inputChecksumSha256.slice(0, 12)}… · 결과 {snapshot.resultChecksumSha256.slice(0, 12)}…</p>
        </>
      )}
    </section>
  );
}

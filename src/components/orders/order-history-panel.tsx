"use client";

import { useEffect, useState } from "react";
import { orderRequest } from "@/components/orders/order-api";
import type { OrderHistoryDto } from "@/server/orders/order-history-service";

export function OrderHistoryPanel({ orderId, initial, refreshVersion = 0 }: { orderId: string; initial: OrderHistoryDto; refreshVersion?: number }) {
  const [history, setHistory] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!refreshVersion) return;
    void (async () => {
      try {
        const next = await orderRequest<OrderHistoryDto>(`/api/v1/orders/${orderId}/history`);
        setHistory(next);
      } catch (caught) { setError(caught instanceof Error ? caught.message : "수주 이력을 불러오지 못했습니다."); }
    })();
  }, [orderId, refreshVersion]);
  async function more() {
    if (!history.nextCursor) return;
    setBusy(true); setError("");
    try {
      const next = await orderRequest<OrderHistoryDto>(`/api/v1/orders/${orderId}/history?cursor=${encodeURIComponent(history.nextCursor)}`);
      setHistory((current) => ({ items: [...current.items, ...next.items], nextCursor: next.nextCursor }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "수주 이력을 더 불러오지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-black">수주 이력</h2><p className="mt-1 text-sm text-slate-500">입력·절곡·계산·승인·생산 상태의 변경 요약입니다.</p>{history.items.length ? <ol className="mt-4 divide-y divide-slate-100">{history.items.map((item) => <li className="py-3" key={item.id}><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{item.actionLabel}</strong><time className="text-xs text-slate-500">{new Date(item.occurredAt).toLocaleString("ko-KR")}</time></div><p className="mt-1 text-xs text-slate-600">{item.actorName ?? "시스템"} · {item.outcome === "SUCCESS" ? "완료" : item.outcome}</p></li>)}</ol> : <p className="mt-4 rounded bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">표시할 수주 이력이 없습니다.</p>}{error ? <p className="mt-3 text-sm text-red-700" role="alert">{error}</p> : null}{history.nextCursor ? <button className="mt-4 rounded border border-slate-300 px-3 py-2 text-sm font-bold disabled:opacity-50" disabled={busy} onClick={() => void more()} type="button">{busy ? "불러오는 중…" : "이력 더 보기"}</button> : null}</section>;
}

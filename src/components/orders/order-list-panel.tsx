"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { orderRequest } from "@/components/orders/order-api";
import type { SalesOrderDto } from "@/server/orders/order-service";

type Customer = { id: string; code: string; name: string };

export function OrderListPanel({
  initial,
  customers,
  canWrite,
}: {
  initial: SalesOrderDto[];
  customers: Customer[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [customerId, setCustomerId] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    if (!customerId) {
      setError("거래처를 선택해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const row = await orderRequest<SalesOrderDto>("/api/v1/orders", {
        method: "POST",
        body: JSON.stringify({ customerId }),
      });
      router.push(`/orders/${row.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "수주를 만들지 못했습니다.");
      setBusy(false);
    }
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (status) params.set("status", status);
      const result = await orderRequest<SalesOrderDto[]>(`/api/v1/orders?${params}`);
      setItems(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "수주를 조회하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-black">수주 목록</h1>
        <p className="mt-1 text-sm text-slate-500">
          절곡 항목과 금액은 다음 단계에서 이 수주에 추가됩니다.
        </p>
        {canWrite ? (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <select
              aria-label="새 수주 거래처"
              className="h-10 min-w-0 rounded border border-slate-300 bg-white px-3 text-sm"
              onChange={(event) => setCustomerId(event.target.value)}
              value={customerId}
            >
              <option value="">거래처 선택</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.code} · {customer.name}
                </option>
              ))}
            </select>
            <button
              className="h-10 rounded bg-teal-700 px-4 text-sm font-bold text-white disabled:opacity-50"
              disabled={busy}
              onClick={() => void create()}
              type="button"
            >
              {busy ? "처리 중" : "새 수주"}
            </button>
          </div>
        ) : null}
        <form className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto]" onSubmit={search}>
          <input
            aria-label="수주 검색"
            className="field-control"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="수주번호 또는 거래처명"
            value={query}
          />
          <select
            aria-label="수주 상태"
            className="field-control"
            onChange={(event) => setStatus(event.target.value)}
            value={status}
          >
            <option value="">전체 상태</option>
            <option value="DRAFT">작성 중</option>
            <option value="CANCELLED">취소</option>
          </select>
          <button className="rounded border border-slate-300 px-4 py-2 text-sm font-bold" disabled={busy}>
            조회
          </button>
        </form>
        {error ? <p className="mt-3 text-sm text-red-700" role="alert">{error}</p> : null}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {items.length ? (
          items.map((order) => (
            <Link
              className="block border-b border-slate-100 px-5 py-4 last:border-0 hover:bg-slate-50"
              href={`/orders/${order.id}`}
              key={order.id}
            >
              <div className="flex items-center justify-between gap-3">
                <b>{order.orderNumber}</b>
                <span className={order.status === "DRAFT"
                  ? "rounded bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-800"
                  : "rounded bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-700"}
                >
                  {order.status === "DRAFT" ? "작성 중" : "취소"}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-700">
                {order.customer.code} · {order.customer.name}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                납기 {order.dueDate ?? "미지정"} · 수정 {new Date(order.updatedAt).toLocaleString("ko-KR")}
              </p>
            </Link>
          ))
        ) : (
          <p className="px-5 py-16 text-center text-sm text-slate-500">조건에 맞는 수주가 없습니다.</p>
        )}
      </section>
    </div>
  );
}

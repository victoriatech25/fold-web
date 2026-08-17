"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { orderRequest } from "@/components/orders/order-api";
import { orderStatusLabels } from "@/components/orders/order-status-panel";
import type { SalesOrderDto } from "@/server/orders/order-service";

type Customer = { id: string; code: string; name: string };
type Owner = { id: string; name: string };
type OrderListPage = { items: SalesOrderDto[]; nextCursor: string | null };

export function OrderListPanel({
  initial,
  customers,
  owners,
  canWrite,
}: {
  initial: OrderListPage;
  customers: Customer[];
  owners: Owner[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial.items);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [customerId, setCustomerId] = useState("");
  const [ownerMembershipId, setOwnerMembershipId] = useState("");
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [orderedFrom, setOrderedFrom] = useState("");
  const [orderedTo, setOrderedTo] = useState("");
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

  function queryParams(cursor?: string) {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (customerId) params.set("customerId", customerId);
    if (ownerMembershipId) params.set("ownerMembershipId", ownerMembershipId);
    if (statuses.length) params.set("statuses", statuses.join(","));
    if (orderedFrom) params.set("orderedFrom", orderedFrom);
    if (orderedTo) params.set("orderedTo", orderedTo);
    if (cursor) params.set("cursor", cursor);
    return params;
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await orderRequest<OrderListPage>(`/api/v1/orders?${queryParams()}`);
      setItems(result.items);
      setNextCursor(result.nextCursor);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "수주를 조회하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function loadMore() {
    if (!nextCursor) return;
    setBusy(true);
    setError("");
    try {
      const result = await orderRequest<OrderListPage>(`/api/v1/orders?${queryParams(nextCursor)}`);
      setItems((current) => [...current, ...result.items]);
      setNextCursor(result.nextCursor);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "수주를 더 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-black">수주 목록</h1>
        <p className="mt-1 text-sm text-slate-500">기간·거래처·담당자·상태로 수주를 찾아 최근 변경순으로 확인합니다.</p>
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
        <form className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" onSubmit={search}>
          <input
            aria-label="수주 검색"
            className="field-control"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="수주번호 또는 거래처명"
            value={query}
          />
          <select aria-label="거래처 필터" className="field-control" onChange={(event) => setCustomerId(event.target.value)} value={customerId}>
            <option value="">전체 거래처</option>
            {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.code} · {customer.name}</option>)}
          </select>
          <select aria-label="담당자 필터" className="field-control" onChange={(event) => setOwnerMembershipId(event.target.value)} value={ownerMembershipId}>
            <option value="">전체 담당자</option>
            {owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
          </select>
          <input aria-label="수주일 시작" className="field-control" onChange={(event) => setOrderedFrom(event.target.value)} type="date" value={orderedFrom} />
          <input aria-label="수주일 종료" className="field-control" onChange={(event) => setOrderedTo(event.target.value)} type="date" value={orderedTo} />
          <select
            aria-label="수주 상태"
            className="field-control h-28 py-2"
            multiple
            onChange={(event) => setStatuses(Array.from(event.target.selectedOptions, (option) => option.value))}
            value={statuses}
          >
            <option value="">전체 상태</option>
            <option value="DRAFT">작성 중</option>
            <option value="CALCULATED">계산 완료</option>
            <option value="APPROVED">승인</option>
            <option value="PRODUCTION_REQUESTED">생산 요청</option>
            <option value="IN_PRODUCTION">생산 중</option>
            <option value="PRODUCED">생산 완료</option>
            <option value="CLOSED">마감</option>
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
                  {orderStatusLabels[order.status]}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-700">
                {order.customer.code} · {order.customer.name}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                수주일 {order.orderedAt} · 납기 {order.dueDate ?? "미지정"} · 담당 {order.ownerName ?? "미지정"}
              </p>
              {order.approvedTotalAmountKrw ? <p className="mt-1 text-xs font-bold text-teal-800">승인 총액 {Number(order.approvedTotalAmountKrw).toLocaleString("ko-KR")}원</p> : null}
            </Link>
          ))
        ) : (
          <p className="px-5 py-16 text-center text-sm text-slate-500">조건에 맞는 수주가 없습니다.</p>
        )}
      </section>
      {nextCursor ? <div className="text-center"><button className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-bold disabled:opacity-50" disabled={busy} onClick={() => void loadMore()} type="button">{busy ? "불러오는 중…" : "수주 더 보기"}</button></div> : null}
    </div>
  );
}

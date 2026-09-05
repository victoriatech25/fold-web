"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { orderRequest } from "@/components/orders/order-api";
import { orderStatusLabels } from "@/components/orders/order-status-panel";
import { CommonDialog } from "@/components/ui/common-popup";
import { QueryBar, QueryField } from "@/components/ui/query-bar";
import type { SalesOrderDto } from "@/server/orders/order-service";

type Customer = { id: string; code: string; name: string };
type Owner = { id: string; name: string };
type OrderListPage = { items: SalesOrderDto[]; nextCursor: string | null };

const statusFilters = [
  "DRAFT",
  "CALCULATED",
  "APPROVED",
  "PRODUCTION_REQUESTED",
  "IN_PRODUCTION",
  "PRODUCED",
  "CLOSED",
  "CANCELLED",
] as const;

const statusStyles: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  CALCULATED: "bg-blue-100 text-blue-800",
  APPROVED: "bg-teal-100 text-teal-800",
  PRODUCTION_REQUESTED: "bg-teal-50 text-teal-700",
  IN_PRODUCTION: "bg-amber-100 text-amber-800",
  PRODUCED: "bg-emerald-100 text-emerald-800",
  CLOSED: "bg-slate-200 text-slate-700",
  CANCELLED: "bg-red-100 text-red-800",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-bold ${statusStyles[status] ?? "bg-slate-100 text-slate-700"}`}
    >
      {orderStatusLabels[status as keyof typeof orderStatusLabels] ?? status}
    </span>
  );
}

export function OrderListPanel({
  initial,
  initialStatuses = [],
  customers,
  owners,
  canWrite,
}: {
  initial: OrderListPage;
  /** 주소로 들어온 상태 조건. chip 이 처음부터 켜져 있어야 목록과 조건이 맞는다. */
  initialStatuses?: string[];
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
  const [statuses, setStatuses] = useState<string[]>(initialStatuses);
  const [orderedFrom, setOrderedFrom] = useState("");
  const [orderedTo, setOrderedTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createCustomerId, setCreateCustomerId] = useState("");

  async function create() {
    if (!createCustomerId) {
      setError("거래처를 선택해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const row = await orderRequest<SalesOrderDto>("/api/v1/orders", {
        method: "POST",
        body: JSON.stringify({ customerId: createCustomerId }),
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

  function toggleStatus(status: string) {
    setStatuses((current) =>
      current.includes(status)
        ? current.filter((item) => item !== status)
        : [...current, status],
    );
  }

  function reset() {
    setQuery("");
    setCustomerId("");
    setOwnerMembershipId("");
    setStatuses([]);
    setOrderedFrom("");
    setOrderedTo("");
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-black">수주 목록</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            기간·거래처·담당자·상태로 수주를 찾아 최근 변경순으로 확인합니다.
          </p>
        </div>
        {canWrite ? (
          <button
            className="inline-flex h-9 items-center gap-1.5 rounded bg-teal-700 px-4 text-xs font-bold text-white hover:bg-teal-800"
            onClick={() => {
              setError("");
              setCreateOpen(true);
            }}
            type="button"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />새 수주
          </button>
        ) : null}
      </div>

      <QueryBar busy={busy} onReset={reset} onSubmit={search}>
        <QueryField label="조회기간" width="w-[19rem]">
          <span className="flex items-center gap-1.5">
            <input
              aria-label="수주일 시작"
              className="field-control !mt-0 h-9"
              onChange={(event) => setOrderedFrom(event.target.value)}
              type="date"
              value={orderedFrom}
            />
            <span className="text-slate-400">~</span>
            <input
              aria-label="수주일 종료"
              className="field-control !mt-0 h-9"
              onChange={(event) => setOrderedTo(event.target.value)}
              type="date"
              value={orderedTo}
            />
          </span>
        </QueryField>
        <QueryField label="거래처">
          <select
            aria-label="거래처 필터"
            className="field-control !mt-0 h-9 bg-white"
            onChange={(event) => setCustomerId(event.target.value)}
            value={customerId}
          >
            <option value="">전체</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.code} · {customer.name}
              </option>
            ))}
          </select>
        </QueryField>
        <QueryField label="담당자" width="w-36">
          <select
            aria-label="담당자 필터"
            className="field-control !mt-0 h-9 bg-white"
            onChange={(event) => setOwnerMembershipId(event.target.value)}
            value={ownerMembershipId}
          >
            <option value="">전체</option>
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
        </QueryField>
        <QueryField label="검색어" width="w-56">
          <input
            aria-label="수주 검색"
            className="field-control !mt-0 h-9"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="수주번호 또는 거래처명"
            value={query}
          />
        </QueryField>
      </QueryBar>

      <div
        aria-label="수주 상태"
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
              {orderStatusLabels[status]}
            </button>
          );
        })}
      </div>

      {error ? (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5">
          <h2 className="text-sm font-black text-slate-800">수주 전표 목록</h2>
          <span className="text-xs text-slate-500">{items.length}건 표시</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-white text-xs text-slate-500">
              <tr className="border-b border-slate-200">
                <th className="px-4 py-2.5 text-left font-bold">수주번호</th>
                <th className="px-4 py-2.5 text-left font-bold">거래처명</th>
                <th className="px-4 py-2.5 text-left font-bold">수주일</th>
                <th className="px-4 py-2.5 text-left font-bold">납기</th>
                <th className="px-4 py-2.5 text-left font-bold">담당자</th>
                <th className="px-4 py-2.5 text-right font-bold">승인 총액</th>
                <th className="px-4 py-2.5 text-left font-bold">상태</th>
                {/* 정렬 기준을 열로 보여 준다. 기준이 화면에 없으면 목록 순서가 무작위로 보인다. */}
                <th className="px-4 py-2.5 text-left font-bold">최근 변경 ↓</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.length ? (
                items.map((order) => (
                  <tr className="hover:bg-teal-50/60" key={order.id}>
                    <td className="px-4 py-2.5">
                      <Link
                        className="font-bold text-teal-800 underline-offset-2 hover:underline"
                        href={`/orders/${order.id}`}
                      >
                        {order.orderNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      {order.customer.name}
                      <span className="ml-1.5 text-xs text-slate-400">{order.customer.code}</span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{order.orderedAt}</td>
                    <td className="px-4 py-2.5 text-slate-600">{order.dueDate ?? "미지정"}</td>
                    <td className="px-4 py-2.5 text-slate-600">{order.ownerName ?? "미지정"}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-800">
                      {order.approvedTotalAmountKrw
                        ? `${Number(order.approvedTotalAmountKrw).toLocaleString("ko-KR")}원`
                        : "-"}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={order.status} />
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">
                      {new Date(order.updatedAt).toLocaleString("ko-KR")}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-4 py-16 text-center text-sm text-slate-500" colSpan={8}>
                    조건에 맞는 수주가 없습니다. 조회조건을 바꾸거나 새 수주를 등록해 주세요.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {nextCursor ? (
          <div className="border-t border-slate-100 px-4 py-3 text-center">
            <button
              className="rounded border border-slate-300 bg-white px-4 py-2 text-xs font-bold disabled:opacity-50"
              disabled={busy}
              onClick={() => void loadMore()}
              type="button"
            >
              {busy ? "불러오는 중…" : "수주 더 보기"}
            </button>
          </div>
        ) : null}
      </section>

      <CommonDialog
        description="거래처를 고르면 작성 중 수주가 만들어지고 상세 화면으로 이동합니다."
        footer={
          <>
            <button
              className="rounded border border-slate-300 px-4 py-2 text-sm font-bold"
              onClick={() => setCreateOpen(false)}
              type="button"
            >
              닫기
            </button>
            <button
              className="rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              disabled={busy}
              onClick={() => void create()}
              type="button"
            >
              {busy ? "처리 중" : "수주 등록"}
            </button>
          </>
        }
        onClose={() => setCreateOpen(false)}
        open={createOpen}
        size="md"
        title="새 수주"
      >
        <label className="block text-sm font-bold">
          거래처
          <select
            aria-label="새 수주 거래처"
            className="field-control bg-white"
            onChange={(event) => setCreateCustomerId(event.target.value)}
            value={createCustomerId}
          >
            <option value="">거래처 선택</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.code} · {customer.name}
              </option>
            ))}
          </select>
        </label>
        {error ? (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </CommonDialog>
    </div>
  );
}

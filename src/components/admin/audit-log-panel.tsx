"use client";

import { FormEvent, useState, useTransition } from "react";

import { adminRequest } from "@/components/admin/admin-api";
import type {
  AuditEventDetailDto,
  AuditEventListDto,
  AuditEventSummaryDto,
} from "@/server/audit/audit-types";

const categoryLabels = {
  AUTHENTICATION: "인증",
  ADMINISTRATION: "관리",
  DATA_CHANGE: "데이터 변경",
  APPROVAL: "승인",
  OUTPUT: "출력",
  MACHINE: "기계 연동",
  SYSTEM: "시스템",
} as const;

const outcomeLabels = {
  SUCCESS: "성공",
  DENIED: "거부",
  FAILURE: "실패",
} as const;

function dateInputValue(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function startOfLocalDate(value: string): string {
  return new Date(`${value}T00:00:00+09:00`).toISOString();
}

function endOfLocalDate(value: string): string {
  return new Date(`${value}T23:59:59.999+09:00`).toISOString();
}

function formatOccurredAt(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function createQuery(
  form: HTMLFormElement,
  cursor?: string | null,
): URLSearchParams {
  const data = new FormData(form);
  const query = new URLSearchParams();
  const from = String(data.get("from") ?? "");
  const to = String(data.get("to") ?? "");
  if (from) query.set("from", startOfLocalDate(from));
  if (to) query.set("to", endOfLocalDate(to));
  for (const key of [
    "category",
    "outcome",
    "action",
    "actorQuery",
    "entityType",
    "entityId",
    "requestId",
    "limit",
  ]) {
    const value = String(data.get(key) ?? "").trim();
    if (value) query.set(key, value);
  }
  if (cursor) query.set("cursor", cursor);
  return query;
}

function JsonBlock({
  label,
  value,
}: {
  label: string;
  value: unknown;
}) {
  return (
    <section>
      <h3 className="text-xs font-black uppercase tracking-wide text-slate-600">
        {label}
      </h3>
      <pre className="mt-1 max-h-64 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-100">
        {JSON.stringify(value, null, 2) ?? "null"}
      </pre>
    </section>
  );
}

function AuditDetail({
  detail,
  onClose,
}: {
  detail: AuditEventDetailDto;
  onClose: () => void;
}) {
  return (
    <aside className="rounded-md border border-slate-300 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold text-teal-700">감사 로그 상세</p>
          <h2 className="mt-1 text-lg font-black">{detail.actionLabel}</h2>
          <p className="mt-1 break-all text-xs text-slate-500">{detail.id}</p>
        </div>
        <button
          className="rounded border border-slate-300 px-3 py-1.5 text-sm font-bold"
          onClick={onClose}
          type="button"
        >
          닫기
        </button>
      </div>
      <dl className="mt-4 grid gap-x-5 gap-y-2 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-slate-500">발생 시각</dt><dd>{formatOccurredAt(detail.occurredAt)}<span className="block text-xs text-slate-500">UTC {detail.occurredAt}</span></dd></div>
        <div><dt className="text-xs text-slate-500">스키마</dt><dd>v{detail.schemaVersion}</dd></div>
        <div><dt className="text-xs text-slate-500">행위자</dt><dd>{detail.actor.displayName ?? "시스템"}{detail.actor.email ? ` · ${detail.actor.email}` : ""}</dd></div>
        <div><dt className="text-xs text-slate-500">요청 ID</dt><dd className="break-all">{detail.requestId ?? "-"}</dd></div>
        <div><dt className="text-xs text-slate-500">대상</dt><dd className="break-all">{detail.entityType} · {detail.entityId ?? "-"}</dd></div>
        <div><dt className="text-xs text-slate-500">출처 / 결과</dt><dd>{detail.source} · {outcomeLabels[detail.outcome]}</dd></div>
        <div><dt className="text-xs text-slate-500">주체 지문</dt><dd className="break-all font-mono text-xs">{detail.subjectFingerprint ?? "-"}</dd></div>
        <div><dt className="text-xs text-slate-500">출처 지문</dt><dd className="break-all font-mono text-xs">{detail.sourceFingerprint ?? "-"}</dd></div>
      </dl>
      <div className="mt-5 grid gap-4">
        <JsonBlock label="변경 전" value={detail.before} />
        <JsonBlock label="변경 후" value={detail.after} />
        <JsonBlock label="메타데이터" value={detail.metadata} />
      </div>
    </aside>
  );
}

export function AuditLogPanel({
  initialData,
  initialFrom,
  initialTo,
}: {
  initialData: AuditEventListDto;
  initialFrom: string;
  initialTo: string;
}) {
  const [pending, startTransition] = useTransition();
  const [items, setItems] = useState(initialData.items);
  const [nextCursor, setNextCursor] = useState(initialData.nextCursor);
  const [detail, setDetail] = useState<AuditEventDetailDto | null>(null);
  const [error, setError] = useState("");
  const [activeQuery, setActiveQuery] = useState(
    () =>
      new URLSearchParams({
        from: initialFrom,
        to: initialTo,
        limit: "25",
      }),
  );

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = createQuery(event.currentTarget);
    startTransition(async () => {
      try {
        setError("");
        const data = await adminRequest<AuditEventListDto>(
          `/api/v1/admin/audit-events?${query.toString()}`,
          { method: "GET" },
        );
        setItems(data.items);
        setNextCursor(data.nextCursor);
        setActiveQuery(query);
        setDetail(null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "조회 실패");
      }
    });
  }

  function loadMore() {
    if (!nextCursor) return;
    const query = new URLSearchParams(activeQuery);
    query.set("cursor", nextCursor);
    startTransition(async () => {
      try {
        setError("");
        const data = await adminRequest<AuditEventListDto>(
          `/api/v1/admin/audit-events?${query.toString()}`,
          { method: "GET" },
        );
        setItems((current) => [...current, ...data.items]);
        setNextCursor(data.nextCursor);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "추가 조회 실패");
      }
    });
  }

  function openDetail(item: AuditEventSummaryDto) {
    startTransition(async () => {
      try {
        setError("");
        setDetail(
          await adminRequest<AuditEventDetailDto>(
            `/api/v1/admin/audit-events/${item.id}`,
            { method: "GET" },
          ),
        );
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "상세 조회 실패");
      }
    });
  }

  return (
    <div className="space-y-5">
      <form
        className="rounded-md border border-slate-300 bg-white p-4 shadow-sm"
        onSubmit={search}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-semibold text-slate-600">시작일<input className="field-control" defaultValue={dateInputValue(new Date(initialFrom))} name="from" required type="date" /></label>
          <label className="text-xs font-semibold text-slate-600">종료일<input className="field-control" defaultValue={dateInputValue(new Date(initialTo))} name="to" required type="date" /></label>
          <label className="text-xs font-semibold text-slate-600">분류<select className="field-control" defaultValue="" name="category"><option value="">전체</option>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-600">결과<select className="field-control" defaultValue="" name="outcome"><option value="">전체</option>{Object.entries(outcomeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-600">작업 코드<input className="field-control" maxLength={150} name="action" placeholder="admin.user_updated" /></label>
          <label className="text-xs font-semibold text-slate-600">행위자<input className="field-control" maxLength={100} name="actorQuery" placeholder="이름 또는 이메일" /></label>
          <label className="text-xs font-semibold text-slate-600">대상 유형<input className="field-control" maxLength={100} name="entityType" placeholder="User" /></label>
          <label className="text-xs font-semibold text-slate-600">대상 ID<input className="field-control" maxLength={100} name="entityId" /></label>
          <label className="text-xs font-semibold text-slate-600">요청 ID<input className="field-control" maxLength={100} name="requestId" /></label>
          <label className="text-xs font-semibold text-slate-600">페이지 크기<select className="field-control" defaultValue="25" name="limit"><option value="25">25건</option><option value="100">100건</option></select></label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button className="rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={pending} type="submit">조회</button>
          <p className="text-xs text-slate-500">한 번에 최대 90일까지 조회할 수 있습니다.</p>
        </div>
        {error ? <p className="mt-3 text-sm font-semibold text-red-700">{error}</p> : null}
      </form>

      {detail ? <AuditDetail detail={detail} onClose={() => setDetail(null)} /> : null}

      <section className="overflow-hidden rounded-md border border-slate-300 bg-white shadow-sm">
        <div className="divide-y divide-slate-200 md:hidden">
          {items.length === 0 ? (
            <p className="p-5 text-center text-sm text-slate-500">
              조회된 감사 로그가 없습니다.
            </p>
          ) : items.map((item) => (
            <article className="space-y-3 p-4" key={`mobile-${item.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <button className="text-left font-bold text-teal-800 hover:underline" onClick={() => openDetail(item)} type="button">{item.actionLabel}</button>
                  <p className="mt-0.5 break-all text-xs text-slate-500">{item.action}</p>
                </div>
                <span className="whitespace-nowrap rounded bg-slate-100 px-2 py-1 text-xs font-bold">{outcomeLabels[item.outcome]}</span>
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <div><dt className="text-xs text-slate-500">발생 시각</dt><dd>{formatOccurredAt(item.occurredAt)}</dd></div>
                <div><dt className="text-xs text-slate-500">분류</dt><dd>{categoryLabels[item.category]}</dd></div>
                <div><dt className="text-xs text-slate-500">행위자</dt><dd>{item.actor.displayName ?? "시스템"}</dd></div>
                <div><dt className="text-xs text-slate-500">대상</dt><dd className="break-all">{item.entityType} · {item.entityId ?? "-"}</dd></div>
              </dl>
            </article>
          ))}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr><th className="px-3 py-3">시각</th><th className="px-3 py-3">분류</th><th className="px-3 py-3">작업</th><th className="px-3 py-3">행위자</th><th className="px-3 py-3">결과</th><th className="px-3 py-3">대상</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {items.length === 0 ? (
                <tr><td className="px-3 py-8 text-center text-slate-500" colSpan={6}>조회된 감사 로그가 없습니다.</td></tr>
              ) : items.map((item) => (
                <tr className="hover:bg-slate-50" key={item.id}>
                  <td className="whitespace-nowrap px-3 py-3">{formatOccurredAt(item.occurredAt)}</td>
                  <td className="whitespace-nowrap px-3 py-3">{categoryLabels[item.category]}</td>
                  <td className="px-3 py-3"><button className="text-left font-bold text-teal-800 hover:underline" onClick={() => openDetail(item)} type="button">{item.actionLabel}</button><div className="text-xs text-slate-500">{item.action}</div></td>
                  <td className="px-3 py-3">{item.actor.displayName ?? "시스템"}{item.actor.email ? <div className="text-xs text-slate-500">{item.actor.email}</div> : null}</td>
                  <td className="whitespace-nowrap px-3 py-3">{outcomeLabels[item.outcome]}</td>
                  <td className="px-3 py-3">{item.entityType}<div className="max-w-48 truncate text-xs text-slate-500">{item.entityId ?? "-"}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {nextCursor ? <div className="border-t border-slate-200 p-3 text-center"><button className="rounded border border-slate-300 px-4 py-2 text-sm font-bold disabled:opacity-50" disabled={pending} onClick={loadMore} type="button">더 보기</button></div> : null}
      </section>
    </div>
  );
}

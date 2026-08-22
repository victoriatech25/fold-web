"use client";

import { useCallback, useEffect, useState } from "react";

import { useCommonPopup } from "@/components/ui/common-popup";
import type { JobDto } from "@/server/jobs/job-service";

type JobPage = { items: JobDto[]; nextCursor: string | null };

const statusLabels: Record<JobDto["status"], string> = {
  QUEUED: "대기 중",
  RUNNING: "실행 중",
  SUCCEEDED: "완료",
  FAILED: "실패",
  CANCELLED: "취소",
};

const statusStyles: Record<JobDto["status"], string> = {
  QUEUED: "bg-slate-100 text-slate-700",
  RUNNING: "bg-blue-100 text-blue-800",
  SUCCEEDED: "bg-teal-100 text-teal-900",
  FAILED: "bg-red-100 text-red-800",
  CANCELLED: "bg-amber-100 text-amber-900",
};

const activeStatuses: JobDto["status"][] = ["QUEUED", "RUNNING"];

async function jobRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message ?? "작업 요청을 처리하지 못했습니다.");
  }
  return body.data as T;
}

export function JobListPanel({ initial }: { initial: JobPage }) {
  const popup = useCommonPopup();
  const [items, setItems] = useState(initial.items);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const queryString = useCallback((cursor?: string) => {
    const params = new URLSearchParams();
    if (statuses.length) params.set("statuses", statuses.join(","));
    if (cursor) params.set("cursor", cursor);
    return params.toString();
  }, [statuses]);

  const refresh = useCallback(async () => {
    const page = await jobRequest<JobPage>(`/api/v1/jobs?${queryString()}`);
    setItems(page.items);
    setNextCursor(page.nextCursor);
  }, [queryString]);

  // 진행 중인 작업이 있을 때만 2초 간격으로 다시 읽는다(`D2-B01-H`).
  // SSE는 실제로 오래 걸리는 작업이 생기는 P2-B04·B09에서 다시 판단한다.
  const hasActive = items.some((item) => activeStatuses.includes(item.status));
  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(() => {
      void refresh().catch(() => undefined);
    }, 2_000);
    return () => clearInterval(timer);
  }, [hasActive, refresh]);

  async function search() {
    setBusy(true);
    setError("");
    try {
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "작업을 조회하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function loadMore() {
    if (!nextCursor) return;
    setBusy(true);
    setError("");
    try {
      const page = await jobRequest<JobPage>(`/api/v1/jobs?${queryString(nextCursor)}`);
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "작업을 더 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function act(job: JobDto, action: "cancel" | "retries", title: string, message: string) {
    const confirmed = await popup.confirm({ title, message, confirmText: title, variant: action === "cancel" ? "warning" : "info" });
    if (!confirmed) return;
    setBusy(true);
    try {
      const updated = await jobRequest<JobDto>(`/api/v1/jobs/${job.id}/${action}`, { method: "POST", body: "{}" });
      setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      await popup.alert({ title: `${title} 완료`, message: `${updated.typeLabel} 작업이 ${statusLabels[updated.status]} 상태가 되었습니다.` });
    } catch (caught) {
      await popup.alert({ title: `${title} 실패`, message: caught instanceof Error ? caught.message : "작업 상태를 바꾸지 못했습니다.", variant: "danger" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-black">작업 큐</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          서버에서 오래 걸리는 작업의 진행과 실패를 확인하고 다시 실행합니다. 실행 중인 작업이 있으면 자동으로 갱신됩니다.
        </p>
      </div>

      <div
        aria-label="작업 상태"
        className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-sm"
        role="group"
      >
        <span className="mr-1 text-[11px] font-bold text-slate-500">상태</span>
        <button
          aria-pressed={statuses.length === 0}
          className={`rounded-full px-3 py-1 text-xs font-bold ${statuses.length === 0 ? "bg-teal-700 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50"}`}
          onClick={() => setStatuses([])}
          type="button"
        >
          전체
        </button>
        {Object.entries(statusLabels).map(([value, label]) => {
          const on = statuses.includes(value);
          return (
            <button
              aria-pressed={on}
              className={`rounded-full px-3 py-1 text-xs font-bold ${on ? "bg-teal-700 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50"}`}
              key={value}
              onClick={() =>
                setStatuses((current) =>
                  current.includes(value)
                    ? current.filter((item) => item !== value)
                    : [...current, value],
                )
              }
              type="button"
            >
              {label}
            </button>
          );
        })}
        <button
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded bg-teal-700 px-4 text-xs font-bold text-white hover:bg-teal-800 disabled:opacity-50"
          disabled={busy}
          onClick={() => void search()}
          type="button"
        >
          {busy ? "조회 중" : "조회"}
        </button>
      </div>

      {error ? <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}

      <section className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {items.length ? (
          items.map((job) => (
            <article className="p-5" key={job.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm font-black">{job.typeLabel}</strong>
                    <span className={`rounded px-2 py-0.5 text-xs font-bold ${statusStyles[job.status]}`}>
                      {statusLabels[job.status]}
                    </span>
                    {job.cancelRequested && job.status === "RUNNING"
                      ? <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">취소 요청됨</span>
                      : null}
                  </div>
                  <p className="mt-1 truncate text-sm text-slate-700">{job.summary ?? "요약 없음"}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {job.requestedByName} · 등록 {new Date(job.createdAt).toLocaleString("ko-KR")} · 시도 {job.attempt}/{job.maxAttempts}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {job.status === "QUEUED" || job.status === "RUNNING" ? (
                    <button
                      className="rounded border border-amber-300 px-3 py-2 text-xs font-bold text-amber-800 disabled:opacity-50"
                      disabled={busy || job.cancelRequested}
                      onClick={() => void act(job, "cancel", "작업 취소", "이 작업을 취소하시겠습니까? 실행 중이면 확인 지점에서 멈춥니다.")}
                      type="button"
                    >
                      취소
                    </button>
                  ) : null}
                  {job.status === "FAILED" ? (
                    <button
                      className="rounded bg-teal-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void act(job, "retries", "다시 실행", "같은 입력으로 이 작업을 다시 큐에 넣습니다.")}
                      type="button"
                    >
                      다시 실행
                    </button>
                  ) : null}
                </div>
              </div>
              {job.status === "RUNNING" ? (
                <div className="mt-3">
                  <div aria-label="진행률" aria-valuemax={100} aria-valuemin={0} aria-valuenow={job.progressPercent} className="h-2 w-full overflow-hidden rounded bg-slate-100" role="progressbar">
                    <div className="h-full rounded bg-blue-500 transition-all" style={{ width: `${job.progressPercent}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{job.progressPercent}%</p>
                </div>
              ) : null}
              {job.lastError ? (
                <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{job.lastError}</p>
              ) : null}
              {job.status === "SUCCEEDED" && job.result ? (
                <pre className="mt-3 overflow-x-auto rounded bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  {JSON.stringify(job.result, null, 2)}
                </pre>
              ) : null}
            </article>
          ))
        ) : (
          <p className="px-5 py-16 text-center text-sm text-slate-500">조건에 맞는 작업이 없습니다.</p>
        )}
      </section>

      {nextCursor ? (
        <div className="text-center">
          <button
            className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-bold disabled:opacity-50"
            disabled={busy}
            onClick={() => void loadMore()}
            type="button"
          >
            {busy ? "불러오는 중…" : "작업 더 보기"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";

import { cuttingRequest } from "@/components/cutting/cutting-plan-list-panel";
import type {
  SheetUsageDto,
  SheetUsageTotals,
} from "@/server/cutting/sheet-usage-service";

export type SheetUsageOverview = {
  items: { sheetItemId: string; code: string; name: string; totals: SheetUsageTotals }[];
  totals: SheetUsageTotals;
  rows: SheetUsageDto[];
};

/** 면적·중량은 자릿수가 길어 화면에서는 줄여 보인다. 저장된 값은 그대로다. */
function area(value: string): string {
  return `${Number(value).toFixed(3)} ㎡`;
}

function weight(value: string | null): string {
  return value === null ? "—" : `${Number(value).toFixed(1)} kg`;
}

function money(value: string | null): string {
  return value === null ? "—" : `${Number(value).toLocaleString("ko-KR")} 원`;
}

function TotalsRow({ totals }: { totals: SheetUsageTotals }) {
  return (
    <dl className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs shadow-sm sm:grid-cols-6">
      <div>
        <dt className="text-slate-500">사용 장수</dt>
        <dd className="font-bold">{totals.sheetCount} 장</dd>
      </div>
      <div>
        <dt className="text-slate-500">총면적</dt>
        <dd className="font-bold">{area(totals.totalAreaM2)}</dd>
      </div>
      <div>
        <dt className="text-slate-500">배치면적</dt>
        <dd className="font-bold">{area(totals.placedAreaM2)}</dd>
      </div>
      <div>
        <dt className="text-slate-500">손실</dt>
        <dd className="font-bold">{area(totals.lossAreaM2)}</dd>
      </div>
      <div>
        <dt className="text-slate-500">수율</dt>
        <dd className="font-bold">{totals.yieldPercent}%</dd>
      </div>
      <div>
        <dt className="text-slate-500">중량</dt>
        <dd className="font-bold">{weight(totals.totalWeightKg)}</dd>
      </div>
      <div>
        <dt className="text-slate-500">참고 매입원가</dt>
        <dd className="font-bold">{money(totals.totalCostKrw)}</dd>
      </div>
    </dl>
  );
}

/**
 * 기간·원판별 사용 실적(`P2-B06`).
 *
 * 승인된 재단만 실적이다. 무효가 된 기록은 여기 오지 않는다(`D2-B06-A`·`F`).
 */
export function SheetUsagePanel({
  initial,
  initialFrom,
  initialSheetItemId,
  initialTo,
}: {
  initial: SheetUsageOverview;
  initialFrom: string;
  initialSheetItemId: string;
  initialTo: string;
}) {
  const [overview, setOverview] = useState(initial);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [sheetItemId, setSheetItemId] = useState(initialSheetItemId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function search() {
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams({ from, to });
      if (sheetItemId) query.set("sheetItemId", sheetItemId);
      setOverview(await cuttingRequest<SheetUsageOverview>(`/api/v1/sheet-usage?${query}`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "사용 실적을 조회하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-black">원판 사용 실적</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          승인된 재단이 실제로 쓴 원판입니다. 보유 수량은 관리하지 않습니다.
          {sheetItemId ? " 지금은 원판 한 종류만 걸러 보고 있습니다." : ""}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <label className="text-xs font-bold text-slate-600">
          시작일
          <input
            className="field-control mt-1"
            onChange={(event) => setFrom(event.target.value)}
            type="date"
            value={from}
          />
        </label>
        <label className="text-xs font-bold text-slate-600">
          종료일
          <input
            className="field-control mt-1"
            onChange={(event) => setTo(event.target.value)}
            type="date"
            value={to}
          />
        </label>
        <button
          className="rounded bg-teal-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
          disabled={busy}
          onClick={() => void search()}
          type="button"
        >
          조회
        </button>
        {sheetItemId ? (
          <button
            className="rounded border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700"
            disabled={busy}
            onClick={() => setSheetItemId("")}
            type="button"
          >
            원판 필터 해제
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-800">
          {error}
        </p>
      ) : null}

      <TotalsRow totals={overview.totals} />

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[52rem] text-xs">
          <caption className="px-4 py-2 text-left text-xs font-bold text-slate-600">
            원판별 합계
          </caption>
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">원판</th>
              <th className="px-3 py-2 text-right">장수</th>
              <th className="px-3 py-2 text-right">총면적</th>
              <th className="px-3 py-2 text-right">배치</th>
              <th className="px-3 py-2 text-right">손실</th>
              <th className="px-3 py-2 text-right">수율</th>
              <th className="px-3 py-2 text-right">중량</th>
              <th className="px-3 py-2 text-right">참고 원가</th>
            </tr>
          </thead>
          <tbody>
            {overview.items.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-center text-slate-500" colSpan={8}>
                  이 기간에 승인된 재단이 없습니다. 실적은 재단을 승인할 때 쌓입니다.{" "}
                  <Link className="font-bold text-teal-800 underline" href="/cutting">
                    생산·절단으로 이동
                  </Link>
                </td>
              </tr>
            ) : (
              overview.items.map((item) => (
                <tr className="border-t border-slate-100" key={item.sheetItemId}>
                  <td className="px-3 py-2 font-bold">
                    {item.code} {item.name}
                  </td>
                  <td className="px-3 py-2 text-right">{item.totals.sheetCount}</td>
                  <td className="px-3 py-2 text-right">{area(item.totals.totalAreaM2)}</td>
                  <td className="px-3 py-2 text-right">{area(item.totals.placedAreaM2)}</td>
                  <td className="px-3 py-2 text-right">{area(item.totals.lossAreaM2)}</td>
                  <td className="px-3 py-2 text-right font-bold">{item.totals.yieldPercent}%</td>
                  <td className="px-3 py-2 text-right">{weight(item.totals.totalWeightKg)}</td>
                  <td className="px-3 py-2 text-right">{money(item.totals.totalCostKrw)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[48rem] text-xs">
          <caption className="px-4 py-2 text-left text-xs font-bold text-slate-600">
            재단 건별 내역
          </caption>
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">수주</th>
              <th className="px-3 py-2 text-left">원판</th>
              <th className="px-3 py-2 text-right">장수</th>
              <th className="px-3 py-2 text-right">수율</th>
              <th className="px-3 py-2 text-right">참고 원가</th>
              <th className="px-3 py-2 text-left">승인 시각</th>
            </tr>
          </thead>
          <tbody>
            {overview.rows.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-center text-slate-500" colSpan={6}>
                  내역이 없습니다.
                </td>
              </tr>
            ) : (
              overview.rows.map((row) => (
                <tr className="border-t border-slate-100" key={row.id}>
                  <td className="px-3 py-2">
                    <Link className="text-teal-800 underline" href={`/cutting/${row.cuttingPlanId}`}>
                      {row.orderNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{row.label}</td>
                  <td className="px-3 py-2 text-right">{row.sheetCount}</td>
                  <td className="px-3 py-2 text-right">{row.yieldPercent}%</td>
                  <td className="px-3 py-2 text-right">{money(row.totalCostKrw)}</td>
                  <td className="px-3 py-2">{new Date(row.createdAt).toLocaleString("ko-KR")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

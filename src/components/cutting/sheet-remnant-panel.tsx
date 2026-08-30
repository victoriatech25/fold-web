"use client";

import Link from "next/link";
import { useState } from "react";

import { cuttingRequest } from "@/components/cutting/cutting-plan-list-panel";
import { useCommonPopup } from "@/components/ui/common-popup";
import type { SheetRemnantDto } from "@/server/cutting/sheet-usage-service";

const statusLabels: Record<SheetRemnantDto["status"], string> = {
  AVAILABLE: "남아 있음",
  CONSUMED: "사용함",
  DISCARDED: "폐기",
};

const statusStyles: Record<SheetRemnantDto["status"], string> = {
  AVAILABLE: "bg-teal-100 text-teal-900",
  CONSUMED: "bg-slate-100 text-slate-700",
  DISCARDED: "bg-red-100 text-red-800",
};

type StatusFilter = "AVAILABLE" | "CONSUMED" | "DISCARDED" | "ALL";

/**
 * 잔재 목록(`D2-B06-H`).
 *
 * 남아 있는 잔재는 다음 재단에서 원판 후보로 실린다. 실물에 없으면 여기서
 * 폐기해야 한다. 폐기하지 않으면 없는 조각을 깔고 앉은 계획이 계속 나온다.
 */
export function SheetRemnantPanel({
  initial,
  canDiscard,
}: {
  initial: { items: SheetRemnantDto[] };
  canDiscard: boolean;
}) {
  const popup = useCommonPopup();
  const [items, setItems] = useState(initial.items);
  const [status, setStatus] = useState<StatusFilter>("AVAILABLE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load(next: StatusFilter) {
    setStatus(next);
    setBusy(true);
    setError("");
    try {
      const query = next === "ALL" ? "" : `?status=${next}`;
      const page = await cuttingRequest<{ items: SheetRemnantDto[] }>(
        `/api/v1/sheet-remnants${query}`,
      );
      setItems(page.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "잔재를 조회하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function discard(remnant: SheetRemnantDto) {
    const reason = await popup.prompt({
      title: "잔재 폐기",
      message: `${remnant.code} (${remnant.widthMm}×${remnant.lengthMm})을 폐기합니다. 다음 재단의 원판 후보에서 빠집니다. 기록은 남습니다.`,
      inputLabel: "폐기 사유",
      required: true,
      maxLength: 500,
      confirmText: "폐기",
      variant: "danger",
    });
    if (reason === null) return;

    setBusy(true);
    setError("");
    try {
      await cuttingRequest<SheetRemnantDto>(`/api/v1/sheet-remnants/${remnant.id}/discard`, {
        method: "POST",
        body: JSON.stringify({ reason, expectedLockVersion: remnant.lockVersion }),
      });
      await load(status);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "잔재를 폐기하지 못했습니다.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-black">잔재</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          재단하고 남은 조각입니다. 남아 있는 잔재는 다음 재단에서 원판 후보로 먼저 쓰입니다.
          실물에 없으면 폐기해 주세요.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["AVAILABLE", "CONSUMED", "DISCARDED", "ALL"] as StatusFilter[]).map((value) => (
          <button
            className={`rounded px-3 py-1.5 text-xs font-bold ${
              status === value ? "bg-teal-700 text-white" : "border border-slate-300 text-slate-700"
            }`}
            disabled={busy}
            key={value}
            onClick={() => void load(value)}
            type="button"
          >
            {value === "ALL" ? "전체" : statusLabels[value]}
          </button>
        ))}
        <Link className="ml-auto text-xs text-teal-800 underline" href="/cutting/usage">
          사용 실적 보기
        </Link>
      </div>

      {error ? (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-800">
          {error}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[48rem] text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">이름</th>
              <th className="px-3 py-2 text-left">원판</th>
              <th className="px-3 py-2 text-left">재질</th>
              <th className="px-3 py-2 text-right">크기</th>
              <th className="px-3 py-2 text-right">면적</th>
              <th className="px-3 py-2 text-left">상태</th>
              <th className="px-3 py-2 text-left">나온 수주</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-center text-slate-500" colSpan={8}>
                  잔재가 없습니다.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr className="border-t border-slate-100" key={item.id}>
                  <td className="px-3 py-2 font-bold">{item.code}</td>
                  <td className="px-3 py-2">{item.sheetItemLabel}</td>
                  <td className="px-3 py-2">{item.materialLabel}</td>
                  <td className="px-3 py-2 text-right">
                    {item.widthMm} × {item.lengthMm}
                  </td>
                  <td className="px-3 py-2 text-right">{Number(item.areaM2).toFixed(3)} ㎡</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${statusStyles[item.status]}`}>
                      {statusLabels[item.status]}
                    </span>
                    {item.discardReason ? (
                      <span className="ml-1 text-slate-500">{item.discardReason}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {item.originCuttingPlanId ? (
                      <Link className="text-teal-800 underline" href={`/cutting/${item.originCuttingPlanId}`}>
                        {item.originOrderNumber ?? "재단"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canDiscard && item.status === "AVAILABLE" ? (
                      <button
                        className="rounded border border-red-300 px-2 py-1 text-[11px] font-bold text-red-700 disabled:opacity-50"
                        disabled={busy}
                        onClick={() => void discard(item)}
                        type="button"
                      >
                        폐기
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { CuttingAnnotations } from "@/domain/cutting/annotations";
import type { CuttingInput, CuttingResult } from "@/domain/cutting/schema";
import { isLandscape, screenViewBox, toScreenRect } from "@/domain/cutting/screen-transform";
import { useCommonPopup } from "@/components/ui/common-popup";
import type { CuttingPlanDetailDto, CuttingPlanDto } from "@/server/cutting/cutting-plan-service";
import { cuttingRequest, planStatusLabels, planStatusStyles, revisionStatusLabels } from "./cutting-plan-list-panel";

/** 원판 하나를 화면 폭에 맞춰 그린다. 긴 쪽을 가로로, 배치 원점을 좌상단으로 놓는다. */
function SheetFigure({
  input,
  result,
  annotations,
  sheetIndex,
  pinnedPartIds,
  onTogglePin,
  editable,
}: {
  input: CuttingInput;
  result: CuttingResult;
  annotations: CuttingAnnotations | null;
  sheetIndex: number;
  pinnedPartIds: Set<string>;
  onTogglePin: (partId: string, sheetIndex: number) => void;
  editable: boolean;
}) {
  const sheetResult = result.sheets[sheetIndex];
  const sheet = input.sheets.find((item) => item.sheetItemId === sheetResult.sheetItemId);
  if (!sheet) return null;

  const partById = new Map(input.parts.map((part) => [part.id, part]));

  // 긴 쪽이 가로로, 배치 원점이 좌상단에 오게 그린다(`D2-B05-L`). 편집기와 같은 변환이다.
  const landscape = isLandscape(sheet);
  const viewBox = screenViewBox(sheet);

  function toScreen(xMm: string, yMm: string, boxWidth: number, boxLength: number) {
    return toScreenRect({ x: Number(xMm), y: Number(yMm), width: boxWidth, height: boxLength }, landscape);
  }

  // 편집 개정의 지정(`P2-B11`). 레이저 그룹은 사각형, 절단선은 폭을 가로지르는 선, 필름은 머리글 표시.
  const laserGroups = annotations?.laserGroups.filter((group) => group.sheetIndex === sheetIndex) ?? [];
  const cutLines = annotations?.horizontalCutLines.filter((line) => line.sheetIndex === sheetIndex) ?? [];
  const film = annotations?.sheets.some((item) => item.sheetIndex === sheetIndex && item.film) ?? false;
  const usableX = Number(sheet.trimLeftMm);
  const usableWidth = Number(sheet.widthMm) - usableX - Number(sheet.trimRightMm);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-black">원판 {sheetIndex + 1}</h3>
        <span className="text-xs text-slate-500">{sheet.label}</span>
        {film ? <span className="rounded bg-sky-100 px-1.5 text-[11px] font-bold text-sky-900">필름</span> : null}
        {laserGroups.length > 0 ? <span className="text-xs text-indigo-700">레이저 그룹 {laserGroups.length}</span> : null}
        {cutLines.length > 0 ? <span className="text-xs text-rose-700">절단선 {cutLines.length}</span> : null}
        <span className="ml-auto text-xs text-slate-500">
          사용 면적 {sheetResult.usedAreaM2}㎡ · 부품 {sheetResult.placements.length}개
        </span>
      </div>

      <svg
        aria-label={`원판 ${sheetIndex + 1} 배치`}
        className={`w-full border border-slate-300 bg-slate-50 ${landscape ? "max-w-2xl" : "max-w-md"}`}
        role="img"
        viewBox={`0 0 ${viewBox.width} ${viewBox.height}`}
      >
        {sheetResult.remnants.map((remnant, index) => {
          const box = toScreen(
            remnant.xMm,
            remnant.yMm,
            Number(remnant.widthMm),
            Number(remnant.lengthMm),
          );
          return (
            <rect
              fill="#f1f5f9"
              height={box.height}
              key={`remnant-${index}`}
              stroke="#94a3b8"
              strokeDasharray="20 20"
              strokeWidth={4}
              width={box.width}
              x={box.x}
              y={box.y}
            />
          );
        })}
        {sheetResult.placements.map((placement, index) => {
          const part = partById.get(placement.partId);
          if (!part) return null;
          const partWidth = Number(placement.rotated ? part.lengthMm : part.widthMm);
          const partLength = Number(placement.rotated ? part.widthMm : part.lengthMm);
          const pinned = pinnedPartIds.has(placement.partId);
          const box = toScreen(placement.xMm, placement.yMm, partWidth, partLength);
          return (
            <g key={`placement-${index}`}>
              <rect
                fill={pinned ? "#99f6e4" : "#ccfbf1"}
                height={box.height}
                stroke={pinned ? "#0f766e" : "#14b8a6"}
                strokeWidth={pinned ? 10 : 4}
                width={box.width}
                x={box.x}
                y={box.y}
              />
              <text
                fill="#134e4a"
                fontSize={Math.max(28, Math.min(box.width, box.height) / 6)}
                x={box.x + box.width / 2}
                y={box.y + box.height / 2}
                textAnchor="middle"
              >
                {part.label}
              </text>
            </g>
          );
        })}
        {laserGroups.map((group) => {
          const box = toScreen(group.boundsMm.xMm, group.boundsMm.yMm, Number(group.boundsMm.widthMm), Number(group.boundsMm.lengthMm));
          return (
            <rect
              data-testid={`plan-laser-group-${group.id}`}
              fill="rgba(99,102,241,0.12)"
              height={box.height}
              key={group.id}
              stroke="#4f46e5"
              strokeDasharray="24 12"
              strokeWidth={8}
              width={box.width}
              x={box.x}
              y={box.y}
            />
          );
        })}
        {cutLines.map((line) => {
          const box = toScreenRect({ x: usableX, y: Number(line.yMm), width: usableWidth, height: 0 }, landscape);
          return (
            <line
              data-testid={`plan-cut-line-${line.id}`}
              key={line.id}
              stroke="#e11d48"
              strokeDasharray="30 15"
              strokeWidth={6}
              x1={box.x}
              x2={box.x + box.width}
              y1={box.y}
              y2={box.y + box.height}
            />
          );
        })}
      </svg>

      {editable ? (
        <ul className="mt-2 space-y-1">
          {[...new Set(sheetResult.placements.map((placement) => placement.partId))].map((partId) => (
            <li className="flex items-center gap-2 text-xs" key={partId}>
              <input
                checked={pinnedPartIds.has(partId)}
                id={`pin-${sheetIndex}-${partId}`}
                onChange={() => onTogglePin(partId, sheetIndex)}
                type="checkbox"
              />
              <label htmlFor={`pin-${sheetIndex}-${partId}`}>
                {partById.get(partId)?.label ?? partId}
                <span className="ml-1 text-slate-500">이 원판에 고정</span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function CuttingPlanDetailPanel({
  initial,
  permissions,
}: {
  initial: CuttingPlanDetailDto;
  permissions: string[];
}) {
  const popup = useCommonPopup();
  const [plan, setPlan] = useState(initial);
  const [pins, setPins] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canOptimize = permissions.includes("cutting.optimize");
  const canApprove = permissions.includes("cutting.approve");
  const approved = plan.status === "APPROVED";
  const editable = canOptimize && !approved && plan.result !== null;

  const refresh = useCallback(async () => {
    setPlan(await cuttingRequest<CuttingPlanDetailDto>(`/api/v1/cutting-plans/${initial.id}`));
  }, [initial.id]);

  // 계산 중에는 2초 간격으로 다시 읽는다(`D2-B01-H`).
  useEffect(() => {
    if (plan.status !== "PENDING") return;
    const timer = setInterval(() => {
      void refresh().catch(() => undefined);
    }, 2_000);
    return () => clearInterval(timer);
  }, [plan.status, refresh]);

  const pinnedPartIds = useMemo(() => new Set(Object.keys(pins)), [pins]);

  function togglePin(partId: string, sheetIndex: number) {
    setPins((current) => {
      const next = { ...current };
      if (next[partId] === sheetIndex) delete next[partId];
      else next[partId] = sheetIndex;
      return next;
    });
  }

  async function rerun() {
    const pinList = Object.entries(pins).map(([partId, sheetIndex]) => ({ partId, sheetIndex }));
    const confirmed = await popup.confirm({
      title: "다시 계산",
      message:
        pinList.length > 0
          ? `부품 ${pinList.length}개를 지정한 원판에 고정하고 나머지를 다시 배치합니다.`
          : "고정 없이 처음부터 다시 배치합니다.",
      confirmText: "다시 계산",
    });
    if (!confirmed) return;

    setBusy(true);
    setError("");
    try {
      await cuttingRequest<CuttingPlanDto>(`/api/v1/cutting-plans/${plan.id}/revisions`, {
        method: "POST",
        body: JSON.stringify({ expectedLockVersion: plan.lockVersion, pins: pinList }),
      });
      setPins({});
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "다시 계산하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    const revision = plan.currentRevision;
    if (!revision) return;
    const confirmed = await popup.confirm({
      title: "재단 승인",
      message: `개정 ${revision.revisionNumber}을 승인합니다. 승인하면 잠기고 다시 계산할 수 없습니다.`,
      confirmText: "승인",
      variant: "warning",
    });
    if (!confirmed) return;

    setBusy(true);
    setError("");
    try {
      await cuttingRequest<CuttingPlanDto>(`/api/v1/cutting-plans/${plan.id}/approval`, {
        method: "POST",
        body: JSON.stringify({ revisionId: revision.id, expectedLockVersion: plan.lockVersion }),
      });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "승인하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelApproval() {
    const reason = await popup.prompt({
      title: "재단 승인 취소",
      message:
        "승인을 풀고 계산 완료 상태로 되돌립니다. 이 재단의 원판 사용 실적은 지우지 않고 무효로 표시하며, 무효가 된 실적은 기간 집계에서 빠집니다.",
      inputLabel: "승인 취소 사유",
      required: true,
      maxLength: 500,
      confirmText: "승인 취소",
      variant: "danger",
    });
    if (reason === null) return;

    setBusy(true);
    setError("");
    try {
      await cuttingRequest<CuttingPlanDto>(`/api/v1/cutting-plans/${plan.id}/approval/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason, expectedLockVersion: plan.lockVersion }),
      });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "승인을 취소하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const revision = plan.currentRevision;
  const unplaced = plan.result?.summary.unplacedParts ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="text-xl font-black">
          재단{" "}
          <Link className="text-teal-800 underline" href={`/orders/${plan.salesOrderId}`}>
            {plan.orderNumber}
          </Link>
        </h1>
        <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${planStatusStyles[plan.status]}`}>
          {planStatusLabels[plan.status]}
        </span>
        <Link className="ml-auto text-xs text-teal-800 underline" href="/cutting">
          목록으로
        </Link>
      </div>

      <dl className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs shadow-sm sm:grid-cols-4">
        <div>
          <dt className="text-slate-500">재질</dt>
          <dd className="font-bold">
            {plan.materialLabel} {plan.thicknessMm}T
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">원판 수</dt>
          <dd className="font-bold">{revision?.sheetCount ?? "-"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">수율</dt>
          <dd className="font-bold">{revision?.yieldPercent ? `${revision.yieldPercent}%` : "-"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">개정</dt>
          <dd className="font-bold">{revision?.revisionNumber ?? "-"}</dd>
        </div>
      </dl>

      {error ? (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-800">
          {error}
        </p>
      ) : null}

      {plan.status === "PENDING" ? (
        <p className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          재단을 계산하고 있습니다. 끝나면 자동으로 표시됩니다.
        </p>
      ) : null}

      {revision?.status === "FAILED" ? (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-800">
          {revision.failureReason ?? "재단 계산에 실패했습니다."}
        </p>
      ) : null}

      {unplaced.length > 0 ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-bold">배치하지 못한 부품이 있습니다.</p>
          <ul className="mt-1 space-y-0.5">
            {unplaced.map((item) => (
              <li key={item.partId}>
                {plan.input.parts.find((part) => part.id === item.partId)?.label ?? item.partId} ·{" "}
                {item.quantity}개 · {item.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {canOptimize && !approved ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded bg-teal-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
            disabled={busy || plan.status === "PENDING"}
            onClick={() => void rerun()}
            type="button"
          >
            {Object.keys(pins).length > 0 ? "고정하고 다시 계산" : "다시 계산"}
          </button>
          {plan.result ? (
            <Link
              className="rounded border border-teal-700 px-3 py-1.5 text-xs font-bold text-teal-800"
              data-testid="cutting-edit-link"
              href={`/cutting/${plan.id}/edit`}
            >
              배치 편집
            </Link>
          ) : null}
          {canApprove ? (
            <button
              className="rounded border border-teal-700 px-3 py-1.5 text-xs font-bold text-teal-800 disabled:opacity-50"
              disabled={busy || revision?.status !== "SUCCEEDED" || (revision?.unplacedQuantity ?? 0) > 0}
              onClick={() => void approve()}
              type="button"
            >
              승인
            </button>
          ) : null}
        </div>
      ) : null}

      {approved ? (
        <div className="flex flex-wrap items-center gap-2 rounded border border-teal-200 bg-teal-50 px-3 py-2">
          <p className="text-xs font-bold text-teal-900">
            {plan.approvedByName ?? "승인자"}가 승인했습니다. 승인된 재단은 다시 계산할 수 없습니다.
            원판 사용 실적이 남았습니다.
          </p>
          {canApprove ? (
            <button
              className="ml-auto rounded border border-red-300 px-3 py-1.5 text-xs font-bold text-red-700 disabled:opacity-50"
              disabled={busy}
              onClick={() => void cancelApproval()}
              type="button"
            >
              승인 취소
            </button>
          ) : null}
        </div>
      ) : null}

      {plan.result ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {plan.result.sheets.map((_, index) => (
            <SheetFigure
              annotations={plan.annotations}
              editable={editable}
              input={plan.input}
              key={index}
              onTogglePin={togglePin}
              pinnedPartIds={pinnedPartIds}
              result={plan.result!}
              sheetIndex={index}
            />
          ))}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[560px] text-left text-xs">
          <caption className="px-4 py-2 text-left text-[11px] font-bold text-slate-500">
            개정 이력
          </caption>
          <thead className="bg-slate-50 text-[11px] font-bold text-slate-500">
            <tr>
              <th className="px-4 py-2">개정</th>
              <th className="px-4 py-2">상태</th>
              <th className="px-4 py-2 text-right">원판 수</th>
              <th className="px-4 py-2 text-right">수율</th>
              <th className="px-4 py-2">출처</th>
              <th className="px-4 py-2 text-right">고정</th>
              <th className="px-4 py-2">실행</th>
            </tr>
          </thead>
          <tbody>
            {plan.revisions.map((item) => (
              <tr className="border-t border-slate-100" key={item.id}>
                <td className="px-4 py-2 font-bold">{item.revisionNumber}</td>
                <td className="px-4 py-2">{revisionStatusLabels[item.status]}</td>
                <td className="px-4 py-2 text-right">{item.sheetCount ?? "-"}</td>
                <td className="px-4 py-2 text-right">
                  {item.yieldPercent ? `${item.yieldPercent}%` : "-"}
                </td>
                <td className="px-4 py-2">
                  {item.source === "MANUAL_EDIT" ? "편집" : "계산"}
                  {item.warnings.length > 0 ? (
                    <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-900">
                      경고 {item.warnings.length}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-2 text-right">{item.pins.length}</td>
                <td className="px-4 py-2 text-slate-500">
                  {item.createdByName} · {new Date(item.createdAt).toLocaleString("ko-KR")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

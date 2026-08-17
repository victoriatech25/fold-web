"use client";

import { useState } from "react";

import { orderRequest } from "@/components/orders/order-api";
import { useCommonPopup } from "@/components/ui/common-popup";
import type { SalesOrderDto } from "@/server/orders/order-service";
import type { OrderTransitionAction } from "@/server/orders/order-transition-schema";

export const orderStatusLabels: Record<SalesOrderDto["status"], string> = {
  DRAFT: "작성 중",
  CALCULATED: "계산 완료",
  APPROVED: "승인",
  PRODUCTION_REQUESTED: "생산 요청",
  IN_PRODUCTION: "생산 중",
  PRODUCED: "생산 완료",
  CLOSED: "마감",
  CANCELLED: "취소",
};

const nextAction: Partial<Record<SalesOrderDto["status"], { action: OrderTransitionAction; label: string; message: string }>> = {
  CALCULATED: { action: "APPROVE", label: "수주 승인", message: "현재 계산 스냅샷을 승인본으로 고정하시겠습니까? 승인 후에는 수주 입력과 계산을 변경할 수 없습니다." },
  APPROVED: { action: "REQUEST_PRODUCTION", label: "생산 요청", message: "승인된 계산을 기준으로 생산을 요청하시겠습니까? 이후에는 승인을 취소할 수 없습니다." },
  PRODUCTION_REQUESTED: { action: "START_PRODUCTION", label: "생산 시작", message: "이 수주를 생산 중 상태로 전환하시겠습니까?" },
  IN_PRODUCTION: { action: "COMPLETE_PRODUCTION", label: "생산 완료", message: "생산 작업이 완료되었음을 기록하시겠습니까?" },
  PRODUCED: { action: "CLOSE", label: "수주 마감", message: "생산 완료 수주를 마감하시겠습니까?" },
};

export function OrderStatusPanel({ order, canApprove, onChanged }: { order: SalesOrderDto; canApprove: boolean; onChanged: (order: SalesOrderDto) => void }) {
  const popup = useCommonPopup();
  const [busy, setBusy] = useState(false);
  const action = nextAction[order.status];

  async function transition(selected: OrderTransitionAction, reason?: string) {
    setBusy(true);
    try {
      const updated = await orderRequest<SalesOrderDto>(`/api/v1/orders/${order.id}/transitions`, {
        method: "POST",
        body: JSON.stringify({ action: selected, expectedLockVersion: order.lockVersion, ...(reason ? { reason } : {}) }),
      });
      onChanged(updated);
      await popup.alert({ title: "상태 변경 완료", message: `${orderStatusLabels[updated.status]} 상태로 변경했습니다.` });
    } catch (caught) {
      await popup.alert({ title: "상태 변경 실패", message: caught instanceof Error ? caught.message : "수주 상태를 변경하지 못했습니다.", variant: "danger" });
    } finally {
      setBusy(false);
    }
  }

  async function runNext() {
    if (!action) return;
    const confirmed = await popup.confirm({ title: action.label, message: action.message, confirmText: action.label, variant: action.action === "APPROVE" ? "info" : "warning" });
    if (confirmed) await transition(action.action);
  }

  async function cancelApproval() {
    const reason = await popup.prompt({
      title: "승인 취소",
      message: "승인 고정을 해제하고 계산 완료 상태로 되돌립니다. 기존 계산 스냅샷은 이력으로 보존됩니다.",
      inputLabel: "승인 취소 사유",
      required: true,
      maxLength: 500,
      confirmText: "승인 취소",
      variant: "danger",
    });
    if (reason !== null) await transition("CANCEL_APPROVAL", reason);
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black">검토·승인·생산 상태</h2>
          <p className="mt-1 text-sm text-slate-600">현재 단계: <strong>{orderStatusLabels[order.status]}</strong></p>
        </div>
        {canApprove && action ? <button className="rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={busy} onClick={() => void runNext()} type="button">{action.label}</button> : null}
      </div>
      {order.approvedAt ? (
        <div className="mt-4 grid gap-2 rounded border border-teal-200 bg-teal-50 p-3 text-sm text-teal-950 sm:grid-cols-2">
          <p>승인자 <strong>{order.approvedByName ?? "확인 불가"}</strong></p>
          <p>승인 시각 <strong>{new Date(order.approvedAt).toLocaleString("ko-KR")}</strong></p>
          <p>고정 계산 버전 <strong>{order.approvedCalculationSnapshotNumber}</strong></p>
          <p>결과 checksum <strong className="font-mono">{order.approvedCalculationResultChecksumSha256?.slice(0, 12)}</strong></p>
        </div>
      ) : (
        <p className="mt-4 rounded bg-slate-50 px-3 py-2 text-sm text-slate-600">최신 계산을 완료하면 승인할 수 있습니다.</p>
      )}
      {canApprove && order.status === "APPROVED" ? <button className="mt-3 rounded border border-red-300 px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-50" disabled={busy} onClick={() => void cancelApproval()} type="button">승인 취소</button> : null}
      {!canApprove && action ? <p className="mt-3 text-xs text-slate-500">상태 전이에는 수주 승인 권한이 필요합니다.</p> : null}
    </section>
  );
}

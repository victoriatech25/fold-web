"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { OrderRequestError, orderRequest } from "@/components/orders/order-api";
import { OrderFoldItemsPanel } from "@/components/orders/order-fold-items-panel";
import { OrderCalculationPanel } from "@/components/orders/order-calculation-panel";
import { OrderCuttingPanel } from "@/components/orders/order-cutting-panel";
import type { CuttingPlanDto } from "@/server/cutting/cutting-plan-service";
import { OrderStatusPanel, orderStatusLabels } from "@/components/orders/order-status-panel";
import { OrderAttachmentsPanel } from "@/components/orders/order-attachments-panel";
import { OrderHistoryPanel } from "@/components/orders/order-history-panel";
import { StatusBadge } from "@/components/orders/order-list-panel";
import { TabPanel, Tabs } from "@/components/ui/tabs";
import { useCommonPopup } from "@/components/ui/common-popup";
import type {
  OrderFormOptionsDto,
  SalesOrderDto,
} from "@/server/orders/order-service";
import type { OrderFoldItemDto, OrderFoldMutationResult, OrderFoldOptionsDto } from "@/server/orders/order-fold-service";
import type { OrderCalculationStateDto } from "@/server/orders/order-calculation-service";
import type { OrderHistoryDto } from "@/server/orders/order-history-service";

type FormState = {
  customerId: string;
  customerSiteId: string;
  customerContactId: string;
  ownerMembershipId: string;
  dueDate: string;
  externalReference: string;
  memo: string;
};

function formFromOrder(order: SalesOrderDto): FormState {
  return {
    customerId: order.customerId,
    customerSiteId: order.customerSiteId ?? "",
    customerContactId: order.customerContactId ?? "",
    ownerMembershipId: order.ownerMembershipId ?? "",
    dueDate: order.dueDate ?? "",
    externalReference: order.externalReference ?? "",
    memo: order.memo ?? "",
  };
}

function fingerprint(form: FormState) {
  return JSON.stringify(form);
}

export function OrderDetailPanel({
  initial,
  options,
  canWrite,
  canApprove,
  canOptimizeCutting,
  initialCuttingPlans,
  initialFoldItems,
  foldOptions,
  initialCalculation,
  initialHistory,
}: {
  initial: SalesOrderDto;
  options: OrderFormOptionsDto;
  canWrite: boolean;
  canApprove: boolean;
  canOptimizeCutting: boolean;
  initialCuttingPlans: CuttingPlanDto[];
  initialFoldItems: OrderFoldItemDto[];
  foldOptions: OrderFoldOptionsDto;
  initialCalculation: OrderCalculationStateDto;
  initialHistory: OrderHistoryDto;
}) {
  const popup = useCommonPopup();
  const router = useRouter();
  const [order, setOrder] = useState(initial);
  const [calculation, setCalculation] = useState(initialCalculation);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [tab, setTab] = useState("basic");
  const [foldCount, setFoldCount] = useState(initialFoldItems.length);
  const [attachmentCount, setAttachmentCount] = useState<number | null>(null);
  const [form, setForm] = useState(() => formFromOrder(initial));
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const formRef = useRef(form);
  const savingRef = useRef(false);
  const editable = canWrite && (order.status === "DRAFT" || order.status === "CALCULATED");
  const customer = useMemo(
    () => options.customers.find((item) => item.id === form.customerId),
    [form.customerId, options.customers],
  );
  const serverFingerprint = fingerprint(formFromOrder(order));
  const formFingerprint = fingerprint(form);

  function replaceWith(latest: SalesOrderDto) {
    const nextForm = formFromOrder(latest);
    setOrder(latest);
    formRef.current = nextForm;
    setForm(nextForm);
    setSaveState("saved");
  }

  async function resolveConflict(localForm: FormState) {
    const reloadServer = await popup.confirm({
      title: "수주 변경 충돌",
      message: "다른 화면에서 먼저 저장했습니다. 서버의 최신 내용을 불러오거나 현재 입력으로 새 사본을 만들 수 있습니다.",
      confirmText: "서버본 불러오기",
      cancelText: "사본 만들기",
      variant: "warning",
    });
    if (reloadServer) {
      const latest = await orderRequest<SalesOrderDto>(`/api/v1/orders/${order.id}`);
      replaceWith(latest);
      return;
    }
    const copied = await orderRequest<SalesOrderDto>(`/api/v1/orders/${order.id}/copy`, {
      method: "POST",
      body: "{}",
    });
    const updated = await orderRequest<SalesOrderDto>(`/api/v1/orders/${copied.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        ...localForm,
        customerSiteId: localForm.customerSiteId || null,
        customerContactId: localForm.customerContactId || null,
        ownerMembershipId: localForm.ownerMembershipId || null,
        expectedLockVersion: copied.lockVersion,
      }),
    });
    router.push(`/orders/${updated.id}`);
  }

  async function persist(localForm = form, notifyFailure = false): Promise<SalesOrderDto | null> {
    if (!editable) return order;
    if (savingRef.current) return null;
    if (fingerprint(localForm) === serverFingerprint) {
      setSaveState("saved");
      return order;
    }
    savingRef.current = true;
    setSaveState("saving");
    try {
      const updated = await orderRequest<SalesOrderDto>(`/api/v1/orders/${order.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...localForm,
          customerSiteId: localForm.customerSiteId || null,
          customerContactId: localForm.customerContactId || null,
          ownerMembershipId: localForm.ownerMembershipId || null,
          expectedLockVersion: order.lockVersion,
        }),
      });
      setOrder(updated);
      setSaveState(fingerprint(localForm) === fingerprint(formRef.current) ? "saved" : "dirty");
      return updated;
    } catch (caught) {
      setSaveState("error");
      if (caught instanceof OrderRequestError && caught.code === "CONFLICT") {
        await resolveConflict(localForm);
      } else if (notifyFailure) {
        await popup.alert({
          title: "저장 실패",
          message: caught instanceof Error ? caught.message : "수주를 저장하지 못했습니다.",
          variant: "danger",
        });
      }
      return null;
    } finally {
      savingRef.current = false;
    }
  }

  useEffect(() => {
    if (!editable || formFingerprint === serverFingerprint) return;
    const timer = window.setTimeout(() => void persist(form), 1_000);
    return () => window.clearTimeout(timer);
    // persist intentionally uses the lock version associated with this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, formFingerprint, order.lockVersion, serverFingerprint]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => {
      const next = { ...current, [key]: value };
      formRef.current = next;
      return next;
    });
    setSaveState("dirty");
  }

  function changeCustomer(customerId: string) {
    const next = options.customers.find((item) => item.id === customerId);
    setForm((current) => {
      const changed = {
        ...current,
        customerId,
        customerSiteId: next?.sites.find((site) => site.isDefault)?.id ?? next?.sites[0]?.id ?? "",
        customerContactId:
          next?.contacts.find((contact) => contact.isPrimary)?.id ?? next?.contacts[0]?.id ?? "",
      };
      formRef.current = changed;
      return changed;
    });
    setSaveState("dirty");
  }

  async function copy() {
    const saved = await persist(form, true);
    if (!saved) return;
    const confirmed = await popup.confirm({
      title: "수주 복사",
      message: "기본정보를 새 작성 중 수주로 복사하시겠습니까?",
      confirmText: "복사",
    });
    if (!confirmed) return;
    try {
      const next = await orderRequest<SalesOrderDto>(`/api/v1/orders/${order.id}/copy`, {
        method: "POST",
        body: "{}",
      });
      router.push(`/orders/${next.id}`);
    } catch (caught) {
      await popup.alert({
        title: "복사 실패",
        message: caught instanceof Error ? caught.message : "수주를 복사하지 못했습니다.",
        variant: "danger",
      });
    }
  }

  async function cancel() {
    const saved = await persist(form, true);
    if (!saved) return;
    const reason = await popup.prompt({
      title: "수주 취소",
      message: "취소된 수주는 수정할 수 없으며 이력으로 보존됩니다.",
      inputLabel: "취소 사유",
      required: true,
      maxLength: 500,
      variant: "danger",
      confirmText: "취소",
      cancelText: "돌아가기",
    });
    if (reason === null) return;
    try {
      const updated = await orderRequest<SalesOrderDto>(`/api/v1/orders/${order.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({
          expectedLockVersion: saved.lockVersion,
          cancellationReason: reason,
        }),
      });
      replaceWith(updated);
      await popup.alert({
        title: "수주 취소 완료",
        message: "수주는 이력으로 보존되며 읽기 전용입니다.",
      });
    } catch (caught) {
      await popup.alert({
        title: "취소 실패",
        message: caught instanceof Error ? caught.message : "수주를 취소하지 못했습니다.",
        variant: "danger",
      });
    }
  }

  const currentCustomerMissing = !options.customers.some((item) => item.id === order.customerId);
  const currentOwnerMissing = order.ownerMembershipId &&
    !options.owners.some((item) => item.id === order.ownerMembershipId);

  const tabs = [
    { id: "basic", label: "기본정보" },
    { id: "folds", label: "절곡 작업", badge: foldCount },
    { id: "calc", label: "계산·금액" },
    { id: "status", label: "승인·생산" },
    { id: "files", label: "첨부", badge: attachmentCount ?? undefined },
    { id: "history", label: "이력" },
  ];

  return (
    <div className="space-y-3">
      {/* 수주 문맥과 주 행동은 탭을 바꿔도 항상 같은 자리에 남는다. */}
      <section className="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Link className="text-xs font-bold text-teal-700" href="/orders">← 수주 목록</Link>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-black">{order.orderNumber}</h1>
              <StatusBadge status={order.status} />
            </div>
            <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
              <div className="flex gap-1.5"><dt className="font-bold">거래처</dt><dd>{order.customer.name}</dd></div>
              <div className="flex gap-1.5"><dt className="font-bold">수주일</dt><dd>{order.orderedAt}</dd></div>
              <div className="flex gap-1.5"><dt className="font-bold">납기</dt><dd>{order.dueDate ?? "미지정"}</dd></div>
              <div className="flex gap-1.5"><dt className="font-bold">담당자</dt><dd>{order.ownerName ?? "미지정"}</dd></div>
            </dl>
          </div>
          <div className="flex flex-col items-end gap-2">
            {editable ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="rounded border border-slate-300 px-3 py-2 text-xs font-bold disabled:opacity-50"
                  disabled={saveState === "saving"}
                  onClick={() => void persist(form, true)}
                  type="button"
                >
                  저장
                </button>
                {order.status === "DRAFT" ? <button className="rounded border border-slate-300 px-3 py-2 text-xs font-bold disabled:opacity-50" disabled={saveState === "saving"} onClick={() => void copy()} type="button">복사</button> : null}
                <button className="rounded border border-red-300 px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-50" disabled={saveState === "saving"} onClick={() => void cancel()} type="button">취소</button>
              </div>
            ) : null}
            <p className={`text-xs ${saveState === "error" ? "text-red-700" : "text-slate-500"}`} role="status">
              {saveState === "saving" ? "저장 중…" : saveState === "dirty" ? "변경 내용 저장 대기 중…" : saveState === "error" ? "저장 실패 · 저장 버튼으로 다시 시도하세요." : editable ? `저장됨 · ${new Date(order.updatedAt).toLocaleString("ko-KR")}` : `${orderStatusLabels[order.status]} 수주는 읽기 전용입니다.`}
            </p>
          </div>
        </div>
      </section>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <Tabs ariaLabel="수주 상세" onChange={setTab} tabs={tabs} value={tab} />
      </div>

      <TabPanel id="basic" value={tab}>
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-black text-slate-800">수주 기본정보</h2>
      {(currentCustomerMissing || currentOwnerMissing || !order.customer.active || order.customerSite?.active === false || order.customerContact?.active === false) ? (
        <p className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          현재 참조 중 일부가 비활성 상태입니다. 기존 수주에는 표시되지만 새 선택에는 사용할 수 없습니다.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <label className="text-sm font-bold">
          거래처
          <select
            className="field-control"
            disabled={!editable || order.customerFieldsLocked}
            onChange={(event) => changeCustomer(event.target.value)}
            value={form.customerId}
          >
            {currentCustomerMissing ? <option value={order.customerId}>{order.customer.code} · {order.customer.name} (비활성)</option> : null}
            {options.customers.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-bold">
          고객 현장
          <select className="field-control" disabled={!editable || order.customerFieldsLocked} onChange={(event) => update("customerSiteId", event.target.value)} value={form.customerSiteId}>
            <option value="">미지정</option>
            {order.customerId === form.customerId && order.customerSiteId && !customer?.sites.some((site) => site.id === order.customerSiteId) ? <option value={order.customerSiteId}>{order.customerSite?.name ?? "기존 고객 현장"} (비활성)</option> : null}
            {customer?.sites.map((site) => <option key={site.id} value={site.id}>{site.name}{site.isDefault ? " · 기본" : ""}</option>)}
          </select>
        </label>
        <label className="text-sm font-bold">
          거래처 담당자
          <select className="field-control" disabled={!editable || order.customerFieldsLocked} onChange={(event) => update("customerContactId", event.target.value)} value={form.customerContactId}>
            <option value="">미지정</option>
            {order.customerId === form.customerId && order.customerContactId && !customer?.contacts.some((contact) => contact.id === order.customerContactId) ? <option value={order.customerContactId}>{order.customerContact?.name ?? "기존 거래처 담당자"} (비활성)</option> : null}
            {customer?.contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}{contact.isPrimary ? " · 기본" : ""}</option>)}
          </select>
        </label>
        <label className="text-sm font-bold">
          사내 담당자
          <select className="field-control" disabled={!editable} onChange={(event) => update("ownerMembershipId", event.target.value)} value={form.ownerMembershipId}>
            <option value="">미지정</option>
            {currentOwnerMissing ? <option value={order.ownerMembershipId ?? ""}>{order.ownerName ?? "기존 담당자"} (비활성)</option> : null}
            {options.owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-bold">
          납기
          <input className="field-control" disabled={!editable} onChange={(event) => update("dueDate", event.target.value)} type="date" value={form.dueDate} />
        </label>
        <label className="text-sm font-bold">
          외부 참조
          <input className="field-control" disabled={!editable} maxLength={200} onChange={(event) => update("externalReference", event.target.value)} value={form.externalReference} />
        </label>
      </div>
      {order.customerFieldsLocked ? <p className="mt-4 rounded border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">첫 절곡 작업 추가 시점의 고객정보가 고정되었습니다. 거래처·현장·거래처 담당자를 바꾸려면 새 수주를 만들어 주세요.</p> : null}
      <label className="mt-4 block text-sm font-bold">
        내부 비고
        <textarea className="field-control min-h-24" disabled={!editable} maxLength={4000} onChange={(event) => update("memo", event.target.value)} value={form.memo} />
      </label>
      {order.status === "CANCELLED" ? (
        <p className="mt-4 rounded bg-slate-100 px-3 py-2 text-sm text-slate-700">
          취소 사유: {order.cancellationReason}
        </p>
      ) : null}
        </section>
      </TabPanel>

      <TabPanel id="folds" value={tab}>
        <OrderFoldItemsPanel
          editable={editable}
          getReadyOrder={() => persist(form, true)}
          initialItems={initialFoldItems}
          onMutation={(result: OrderFoldMutationResult, activeItemCount, affectsCalculation) => {
            setFoldCount(activeItemCount);
            setOrder((current) => ({
              ...current,
              status: affectsCalculation && current.status === "CALCULATED" ? "DRAFT" : current.status,
              lockVersion: result.orderLockVersion,
              partySnapshotCapturedAt: result.partySnapshotCapturedAt,
              customerFieldsLocked: result.partySnapshotCapturedAt !== null,
            }));
            setCalculation((current) => ({ ...current, stale: affectsCalculation && current.snapshot !== null ? true : current.stale, canCalculate: activeItemCount > 0 }));
          }}
          options={foldOptions}
        />
      </TabPanel>

      <TabPanel id="calc" value={tab}>
        <OrderCalculationPanel
          editable={editable}
          getReadyOrder={() => persist(form, true)}
          onCalculated={(result) => {
            setOrder((current) => ({ ...current, status: "CALCULATED", lockVersion: result.orderLockVersion }));
            setCalculation(result.state);
          }}
          state={calculation}
        />
      </TabPanel>

      <TabPanel id="status" value={tab}>
        <OrderStatusPanel
          canApprove={canApprove}
          onChanged={(updated) => {
            replaceWith(updated);
            setCalculation((current) => ({ ...current, canCalculate: updated.status === "DRAFT" || updated.status === "CALCULATED" }));
            setHistoryVersion((current) => current + 1);
          }}
          order={order}
        />
        <OrderCuttingPanel canOptimize={canOptimizeCutting} initialPlans={initialCuttingPlans} order={order} />
      </TabPanel>

      <TabPanel id="files" value={tab}>
        <OrderAttachmentsPanel
          editable={canWrite && order.status !== "CANCELLED"}
          onCountChange={setAttachmentCount}
          orderId={order.id}
        />
      </TabPanel>

      <TabPanel id="history" value={tab}>
        <OrderHistoryPanel initial={initialHistory} orderId={order.id} refreshVersion={historyVersion} />
      </TabPanel>
    </div>
  );
}

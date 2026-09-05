"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { OrderRequestError, orderRequest } from "@/components/orders/order-api";
import { useCommonPopup } from "@/components/ui/common-popup";
import type { OrderCalculationStateDto } from "@/server/orders/order-calculation-service";
import type { SalesOrderDto } from "@/server/orders/order-service";
import type { OrderFoldItemDto, OrderFoldMutationResult, OrderFoldOptionsDto } from "@/server/orders/order-fold-service";

type ItemMutation = OrderFoldMutationResult & { item: OrderFoldItemDto };
type RemoveMutation = OrderFoldMutationResult & { removedItemId: string };

/**
 * 작업 카드에 붙는 계산 상태. 수주 전체 상태와 그 작업의 계산 결과가 함께 있어야
 * "이 작업이 지금 얼마로 잡혀 있는지" 를 한 줄로 말할 수 있다.
 */
function itemCalculationNote(calculation: OrderCalculationStateDto, foldItemId: string) {
  const row = calculation.snapshot?.items.find((item) => item.foldItemId === foldItemId);
  if (!row) return "계산 전";
  if (calculation.stale) return `재계산 필요 · 계산 버전 ${calculation.snapshot!.snapshotNumber} 기준 ${row.metrics.areaEachM2}㎡/개`;
  return `계산 완료 · ${row.metrics.areaEachM2}㎡/개`;
}

export function OrderFoldItemsPanel({
  initialItems,
  options,
  editable,
  calculation,
  getReadyOrder,
  onMutation,
}: {
  initialItems: OrderFoldItemDto[];
  options: OrderFoldOptionsDto;
  editable: boolean;
  calculation: OrderCalculationStateDto;
  getReadyOrder: () => Promise<SalesOrderDto | null>;
  onMutation: (result: OrderFoldMutationResult, activeItemCount: number, affectsCalculation: boolean) => void;
}) {
  const popup = useCommonPopup();
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedRevisionId, setSelectedRevisionId] = useState(options.templates[0]?.revisionId ?? "");
  const [selectedItemId, setSelectedItemId] = useState(initialItems[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const [quantity, setQuantity] = useState(selectedItem?.quantity ?? 1);
  const [variableValues, setVariableValues] = useState<Record<string, string>>(
    Object.fromEntries((selectedItem?.variables ?? []).map((variable) => [variable.name, variable.valueMm])),
  );
  const [materialRuleRevisionId, setMaterialRuleRevisionId] = useState(selectedItem?.materialRuleRevisionId ?? "");
  const [sheetItemId, setSheetItemId] = useState(selectedItem?.sheetItemId ?? "");

  const templates = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ko-KR");
    return normalized
      ? options.templates.filter((template) => `${template.code} ${template.name} ${template.categoryName ?? ""}`.toLocaleLowerCase("ko-KR").includes(normalized))
      : options.templates;
  }, [options.templates, query]);
  const selectedMaterial = options.materials.find((material) => material.ruleRevisionId === materialRuleRevisionId);

  function selectItem(item: OrderFoldItemDto) {
    setSelectedItemId(item.id);
    setQuantity(item.quantity);
    setVariableValues(Object.fromEntries(item.variables.map((variable) => [variable.name, variable.valueMm])));
    setMaterialRuleRevisionId(item.materialRuleRevisionId);
    setSheetItemId(item.sheetItemId ?? "");
  }

  async function ready() {
    const order = await getReadyOrder();
    if (!order) throw new Error("수주 기본정보를 먼저 저장해 주세요.");
    return order;
  }

  async function handleFailure(caught: unknown, title: string) {
    if (caught instanceof OrderRequestError && caught.code === "CONFLICT") {
      await popup.alert({ title: "변경 충돌", message: `${caught.message} 최신 내용을 다시 불러옵니다.`, variant: "warning" });
      router.refresh();
      return;
    }
    await popup.alert({ title, message: caught instanceof Error ? caught.message : "요청을 처리하지 못했습니다.", variant: "danger" });
  }

  async function addItem() {
    if (!selectedRevisionId) return;
    setBusy(true);
    try {
      const order = await ready();
      const result = await orderRequest<ItemMutation>(`/api/v1/orders/${order.id}/fold-items`, {
        method: "POST",
        body: JSON.stringify({ sourceFoldRevisionId: selectedRevisionId, expectedOrderLockVersion: order.lockVersion }),
      });
      const next = [...items, result.item];
      setItems(next);
      selectItem(result.item);
      onMutation(result, next.length, true);
      setAdding(false);
    } catch (caught) {
      await handleFailure(caught, "절곡 작업 추가 실패");
    } finally {
      setBusy(false);
    }
  }

  async function saveItem() {
    if (!selectedItem) return;
    setBusy(true);
    try {
      const order = await ready();
      const result = await orderRequest<ItemMutation>(`/api/v1/orders/${order.id}/fold-items/${selectedItem.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          quantity,
          variableValues,
          materialRuleRevisionId,
          sheetItemId: sheetItemId || null,
          expectedOrderLockVersion: order.lockVersion,
          expectedItemLockVersion: selectedItem.lockVersion,
        }),
      });
      setItems((current) => current.map((item) => item.id === result.item.id ? result.item : item));
      selectItem(result.item);
      onMutation(result, items.length, selectedItem.documentChecksumSha256 !== result.item.documentChecksumSha256);
    } catch (caught) {
      await handleFailure(caught, "절곡 작업 저장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function copyItem(item: OrderFoldItemDto) {
    setBusy(true);
    try {
      const order = await ready();
      const result = await orderRequest<ItemMutation>(`/api/v1/orders/${order.id}/fold-items/${item.id}/copy`, {
        method: "POST",
        body: JSON.stringify({ expectedOrderLockVersion: order.lockVersion }),
      });
      setItems((current) => [...current, result.item]);
      selectItem(result.item);
      onMutation(result, items.length + 1, true);
    } catch (caught) {
      await handleFailure(caught, "절곡 작업 복사 실패");
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(item: OrderFoldItemDto) {
    const confirmed = await popup.confirm({ title: "절곡 작업 제거", message: `${item.name} 작업을 수주에서 제거하시겠습니까?`, confirmText: "제거", variant: "danger" });
    if (!confirmed) return;
    setBusy(true);
    try {
      const order = await ready();
      const result = await orderRequest<RemoveMutation>(`/api/v1/orders/${order.id}/fold-items/${item.id}/remove`, {
        method: "POST",
        body: JSON.stringify({ expectedOrderLockVersion: order.lockVersion, expectedItemLockVersion: item.lockVersion }),
      });
      const next = items.filter((candidate) => candidate.id !== result.removedItemId).map((candidate, index) => ({ ...candidate, sortOrder: index + 1 }));
      setItems(next);
      if (selectedItemId === item.id) {
        if (next[0]) selectItem(next[0]);
        else setSelectedItemId("");
      }
      onMutation(result, next.length, true);
    } catch (caught) {
      await handleFailure(caught, "절곡 작업 제거 실패");
    } finally {
      setBusy(false);
    }
  }

  async function move(item: OrderFoldItemDto, direction: -1 | 1) {
    const index = items.findIndex((candidate) => candidate.id === item.id);
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    setBusy(true);
    try {
      const order = await ready();
      const result = await orderRequest<OrderFoldMutationResult>(`/api/v1/orders/${order.id}/fold-items/reorder`, {
        method: "POST",
        body: JSON.stringify({ itemIds: next.map((candidate) => candidate.id), expectedOrderLockVersion: order.lockVersion }),
      });
      setItems(next.map((candidate, orderIndex) => ({ ...candidate, sortOrder: orderIndex + 1 })));
      onMutation(result, items.length, false);
    } catch (caught) {
      await handleFailure(caught, "절곡 작업 순서 변경 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black">절곡 작업</h2>
          <p className="mt-1 text-sm text-slate-500">게시 개정을 주문용 불변 스냅샷으로 복사하고 아래 계산·가격에서 금액을 확정합니다.</p>
        </div>
        {editable ? <button className="rounded bg-teal-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={busy || options.templates.length === 0} onClick={() => setAdding((value) => !value)} type="button">{adding ? "선택 닫기" : "절곡 작업 추가"}</button> : null}
      </div>

      {adding ? (
        <div className="mt-4 rounded-lg border border-teal-200 bg-teal-50 p-4">
          <label className="block text-sm font-bold">게시 템플릿 검색<input className="field-control" onChange={(event) => setQuery(event.target.value)} placeholder="코드·이름·분류" value={query} /></label>
          <div className="mt-3 grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
            {templates.map((template) => (
              <label className={`cursor-pointer rounded border p-3 text-sm ${selectedRevisionId === template.revisionId ? "border-teal-600 bg-white ring-1 ring-teal-600" : "border-slate-200 bg-white"}`} key={template.revisionId}>
                <input checked={selectedRevisionId === template.revisionId} className="mr-2" name="fold-template" onChange={() => setSelectedRevisionId(template.revisionId)} type="radio" />
                <span className="font-bold">{template.code} · {template.name}</span>
                <span className="mt-1 block text-xs text-slate-500">개정 {template.revisionNumber} · {template.categoryName ?? "미분류"} · {template.materialName} {template.thicknessMm}T</span>
              </label>
            ))}
          </div>
          {templates.length === 0 ? <p className="mt-3 text-sm text-slate-600">조건에 맞는 게시 템플릿이 없습니다.</p> : null}
          <div className="mt-3 flex justify-end"><button className="rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={busy || !selectedRevisionId} onClick={() => void addItem()} type="button">선택 작업 추가</button></div>
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="mt-5 rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">등록된 절곡 작업이 없습니다. 게시 템플릿에서 첫 작업을 추가해 주세요.</div>
      ) : (
        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.8fr)]">
          <div className="space-y-2">
            {items.map((item, index) => (
              <article className={`rounded-lg border p-4 ${selectedItemId === item.id ? "border-teal-600 ring-1 ring-teal-600" : "border-slate-200"}`} key={item.id}>
                <button className="w-full text-left" onClick={() => selectItem(item)} type="button">
                  <span className="text-xs font-bold text-teal-700">작업 {item.lineNumber} · {item.source.templateCode} · 개정 {item.source.revisionNumber}</span>
                  <strong className="mt-1 block text-base">{item.name}</strong>
                  <span className="mt-1 block text-sm text-slate-600">수량 {item.quantity} · {item.materialName} {item.thicknessMm}T{item.sheetName ? ` · ${item.sheetName}` : ""}</span>
                  <span className="mt-1 block text-xs text-slate-500">{item.blockCount}개 블록 · {item.segmentCount}개 선/호 · {itemCalculationNote(calculation, item.id)}</span>
                </button>
                {editable ? <div className="mt-3 flex flex-wrap gap-2 border-t pt-3"><button aria-label={`${item.name} 위로`} className="rounded border px-2 py-1 text-xs disabled:opacity-40" disabled={busy || index === 0} onClick={() => void move(item, -1)} type="button">↑ 위로</button><button aria-label={`${item.name} 아래로`} className="rounded border px-2 py-1 text-xs disabled:opacity-40" disabled={busy || index === items.length - 1} onClick={() => void move(item, 1)} type="button">↓ 아래로</button><button className="rounded border px-2 py-1 text-xs" disabled={busy} onClick={() => void copyItem(item)} type="button">복사</button><button className="rounded border border-red-300 px-2 py-1 text-xs text-red-700" disabled={busy} onClick={() => void removeItem(item)} type="button">제거</button></div> : null}
              </article>
            ))}
          </div>

          {selectedItem ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <h3 className="font-black">작업 {selectedItem.lineNumber} 입력</h3>
              <p className="mt-1 text-xs text-slate-500">원본 checksum {selectedItem.source.checksumSha256.slice(0, 12)}…</p>
              <label className="mt-4 block text-sm font-bold">수량<input className="field-control" disabled={!editable || busy} max={1_000_000} min={1} onChange={(event) => setQuantity(Number(event.target.value))} type="number" value={quantity} /></label>
              {selectedItem.variables.map((variable) => <label className="mt-3 block text-sm font-bold" key={variable.name}>{variable.name}{variable.editable ? "" : ` · ${variable.expression}`}<input className="field-control" disabled={!editable || busy || !variable.editable} onChange={(event) => setVariableValues((current) => ({ ...current, [variable.name]: event.target.value }))} value={variableValues[variable.name] ?? variable.valueMm} /></label>)}
              <label className="mt-3 block text-sm font-bold">재질·두께<select className="field-control" disabled={!editable || busy} onChange={(event) => { setMaterialRuleRevisionId(event.target.value); const material = options.materials.find((candidate) => candidate.ruleRevisionId === event.target.value); setSheetItemId(material?.sheets.find((sheet) => sheet.isDefault)?.id ?? ""); }} value={materialRuleRevisionId}>{!options.materials.some((material) => material.ruleRevisionId === selectedItem.materialRuleRevisionId) ? <option value={selectedItem.materialRuleRevisionId}>{selectedItem.materialName} · {selectedItem.thicknessMm}T · 기존 snapshot</option> : null}{options.materials.map((material) => <option key={material.ruleRevisionId} value={material.ruleRevisionId}>{material.label} · {material.thicknessMm}T</option>)}</select></label>
              <label className="mt-3 block text-sm font-bold">원판<select className="field-control" disabled={!editable || busy} onChange={(event) => setSheetItemId(event.target.value)} value={sheetItemId}><option value="">미지정</option>{selectedMaterial?.sheets.map((sheet) => <option key={sheet.id} value={sheet.id}>{sheet.code} · {sheet.name} · {sheet.size}{sheet.isDefault ? " · 기본" : ""}</option>)}</select></label>
              {editable ? <button className="mt-4 w-full rounded bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={busy || !Number.isInteger(quantity) || quantity < 1} onClick={() => void saveItem()} type="button">{busy ? "처리 중…" : "작업 입력 저장"}</button> : null}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

"use client";

import { ArrowLeft, CopyPlus, Pencil, Plus, Power, Star } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useRef, useState, useTransition } from "react";
import { CommonDialog, useCommonPopup } from "@/components/ui/common-popup";
import type {
  SheetItemCalculationDto,
  SheetItemDto,
  SheetItemFields,
  SheetItemTransitionAction,
  SheetItemWorkspaceDto,
} from "@/server/sheet-items/sheet-item-types";
import { materialRequest, MaterialRequestError } from "./material-api";

type EditorState = { mode: "create" | "copy" | "edit"; item: SheetItemDto | null };
const decimalPattern = "[0-9]+([.][0-9]{1,6})?";
const text = (data: FormData, name: string) => String(data.get(name) ?? "").trim();
const nullable = (value: string) => value || null;

function fieldsFromForm(data: FormData): SheetItemFields {
  return {
    code: text(data, "code"),
    name: text(data, "name"),
    finishName: nullable(text(data, "finishName")),
    widthMm: text(data, "widthMm"),
    lengthMm: text(data, "lengthMm"),
    rotationPolicy: text(data, "rotationPolicy") as SheetItemFields["rotationPolicy"],
    grainAxis: text(data, "grainAxis") as SheetItemFields["grainAxis"],
    trimTopMm: text(data, "trimTopMm"),
    trimRightMm: text(data, "trimRightMm"),
    trimBottomMm: text(data, "trimBottomMm"),
    trimLeftMm: text(data, "trimLeftMm"),
    weightOverrideKg: nullable(text(data, "weightOverrideKg")),
    weightOverrideReason: nullable(text(data, "weightOverrideReason")),
    standardPurchaseCostKrw: nullable(text(data, "standardPurchaseCostKrw")),
    minRemnantWidthMm: nullable(text(data, "minRemnantWidthMm")),
    minRemnantLengthMm: nullable(text(data, "minRemnantLengthMm")),
    minRemnantAreaM2: nullable(text(data, "minRemnantAreaM2")),
    sortOrder: Number(text(data, "sortOrder") || 0),
    memo: nullable(text(data, "memo")),
  };
}

function blankFields(workspace: SheetItemWorkspaceDto): SheetItemFields {
  return {
    code: `${workspace.variant.code}-SHEET-`, name: "", finishName: null,
    widthMm: "1220", lengthMm: "2440", rotationPolicy: "FREE", grainAxis: "NONE",
    trimTopMm: "0", trimRightMm: "0", trimBottomMm: "0", trimLeftMm: "0",
    weightOverrideKg: null, weightOverrideReason: null, standardPurchaseCostKrw: null,
    minRemnantWidthMm: null, minRemnantLengthMm: null, minRemnantAreaM2: null,
    sortOrder: 0, memo: null,
  };
}

function DecimalField({ label, name, value, required = false, readOnly = false }: { label: string; name: string; value: string | null; required?: boolean; readOnly?: boolean }) {
  return <label className="text-xs font-bold text-slate-600">{label}<input className="field-control bg-white font-mono read-only:bg-slate-100" defaultValue={value ?? ""} inputMode="decimal" name={name} pattern={decimalPattern} readOnly={readOnly} required={required} /></label>;
}

function CalculationCard({ value }: { value: SheetItemCalculationDto }) {
  return <div className="grid gap-2 rounded-lg border border-teal-100 bg-teal-50/70 p-3 text-xs sm:grid-cols-3">
    <span><b className="block text-slate-500">원판 면적</b>{value.nominalAreaM2}㎡</span>
    <span><b className="block text-slate-500">유효 크기</b>{value.usableWidthMm} × {value.usableLengthMm}mm</span>
    <span><b className="block text-slate-500">유효 면적</b>{value.usableAreaM2}㎡</span>
    <span><b className="block text-slate-500">계산 중량</b>{value.calculatedWeightKg ? `${value.calculatedWeightKg}kg` : "밀도 미등록"}</span>
    <span><b className="block text-slate-500">적용 중량</b>{value.effectiveWeightKg ? `${value.effectiveWeightKg}kg` : "미산출"}</span>
    <span><b className="block text-slate-500">중량 출처</b>{value.weightSource === "OVERRIDE" ? "수동 보정" : value.weightSource === "CALCULATED" ? "크기·두께·밀도" : "없음"}</span>
  </div>;
}

function SheetEditor({ state, workspace, onClose, onSaved }: { state: EditorState | null; workspace: SheetItemWorkspaceDto; onClose: () => void; onSaved: () => Promise<void> }) {
  const popup = useCommonPopup();
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<SheetItemCalculationDto | null>(state?.item?.calculation ?? null);
  const formRef = useRef<HTMLFormElement>(null);
  if (!state) return null;
  const editing = state.mode === "edit";
  const editingItem = editing ? state.item : null;
  const source: SheetItemFields = state.item ?? blankFields(workspace);
  const formId = `sheet-item-${state.mode}-${state.item?.id ?? "new"}`;
  const base = `/api/v1/materials/${workspace.material.id}/variants/${workspace.variant.id}/sheet-items`;

  async function previewValues() {
    if (!formRef.current?.reportValidity()) return;
    try {
      setPreview(await materialRequest<SheetItemCalculationDto>(`${base}/preview`, { method: "POST", body: JSON.stringify(fieldsFromForm(new FormData(formRef.current))) }));
    } catch (error) {
      await popup.alert({ title: "계산 확인 실패", message: error instanceof Error ? error.message : "원판 계산값을 확인하지 못했습니다.", variant: "danger" });
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const fields = fieldsFromForm(data);
    const isDefault = data.get("isDefault") === "on";
    startTransition(async () => {
      try {
        await materialRequest(editingItem ? `${base}/${editingItem.id}` : base, {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify(editingItem ? { ...fields, expectedLockVersion: editingItem.lockVersion } : { ...fields, isDefault }),
        });
        onClose();
        await onSaved();
        await popup.alert({ title: "저장 완료", message: editing ? "원판 품목 정보를 저장했습니다." : "새 원판 품목을 등록했습니다." });
      } catch (error) {
        await popup.alert({ title: "저장 실패", message: error instanceof Error ? error.message : "원판 품목을 저장하지 못했습니다.", variant: "danger" });
        if (error instanceof MaterialRequestError && error.code === "CONFLICT") await onSaved();
      }
    });
  }

  return <CommonDialog open onClose={onClose} size="xl" title={editing ? "원판 품목 수정" : state.mode === "copy" ? "원판 품목 복사 등록" : "원판 품목 등록"} description="코드와 폭·길이는 등록 후 변경할 수 없습니다. 미리 계산으로 유효 면적과 중량을 확인할 수 있습니다." footer={<><button className="rounded border bg-white px-4 py-2 text-sm font-bold" disabled={pending} onClick={onClose}>취소</button><button className="rounded border border-teal-300 bg-white px-4 py-2 text-sm font-bold text-teal-800" disabled={pending} onClick={previewValues}>미리 계산</button><button className="rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white" disabled={pending} form={formId}>저장</button></>}>
    <form id={formId} ref={formRef} onSubmit={submit} className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-bold text-slate-600">품목 코드<input className="field-control font-mono read-only:bg-slate-100" defaultValue={state.mode === "copy" ? `${source.code}-COPY` : source.code} name="code" readOnly={editing} required /></label>
        <label className="text-xs font-bold text-slate-600 sm:col-span-2">품목명<input className="field-control" defaultValue={state.mode === "copy" ? `${source.name} 복사본` : source.name} name="name" required /></label>
        <label className="text-xs font-bold text-slate-600">표면·마감<input className="field-control" defaultValue={source.finishName ?? ""} name="finishName" /></label>
        <DecimalField label="폭 (mm)" name="widthMm" value={source.widthMm} required readOnly={editing} />
        <DecimalField label="길이 (mm)" name="lengthMm" value={source.lengthMm} required readOnly={editing} />
        <label className="text-xs font-bold text-slate-600">회전 정책<select className="field-control bg-white" defaultValue={source.rotationPolicy} name="rotationPolicy"><option value="FREE">자유 회전</option><option value="KEEP_GRAIN">결 방향 유지</option></select></label>
        <label className="text-xs font-bold text-slate-600">결 방향<select className="field-control bg-white" defaultValue={source.grainAxis} name="grainAxis"><option value="NONE">없음</option><option value="WIDTH">폭 방향</option><option value="LENGTH">길이 방향</option></select></label>
      </section>
      <section><h3 className="mb-2 text-sm font-black">가공 여유</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><DecimalField label="위 (mm)" name="trimTopMm" value={source.trimTopMm} required /><DecimalField label="오른쪽 (mm)" name="trimRightMm" value={source.trimRightMm} required /><DecimalField label="아래 (mm)" name="trimBottomMm" value={source.trimBottomMm} required /><DecimalField label="왼쪽 (mm)" name="trimLeftMm" value={source.trimLeftMm} required /></div></section>
      <section><h3 className="mb-2 text-sm font-black">중량·구매 참고</h3><div className="grid gap-3 sm:grid-cols-3"><DecimalField label="중량 보정 (kg)" name="weightOverrideKg" value={source.weightOverrideKg} /><label className="text-xs font-bold text-slate-600">중량 보정 사유<input className="field-control" defaultValue={source.weightOverrideReason ?? ""} name="weightOverrideReason" /></label><DecimalField label="표준 구매가 (원, 참고)" name="standardPurchaseCostKrw" value={source.standardPurchaseCostKrw} /></div></section>
      <section><h3 className="mb-2 text-sm font-black">잔재 보관 기준</h3><div className="grid gap-3 sm:grid-cols-3"><DecimalField label="최소 폭 (mm)" name="minRemnantWidthMm" value={source.minRemnantWidthMm} /><DecimalField label="최소 길이 (mm)" name="minRemnantLengthMm" value={source.minRemnantLengthMm} /><DecimalField label="최소 면적 (㎡)" name="minRemnantAreaM2" value={source.minRemnantAreaM2} /></div></section>
      <section className="grid gap-3 sm:grid-cols-[10rem_1fr]"><label className="text-xs font-bold text-slate-600">정렬 순서<input className="field-control" defaultValue={source.sortOrder} name="sortOrder" type="number" /></label><label className="text-xs font-bold text-slate-600">메모<input className="field-control" defaultValue={source.memo ?? ""} name="memo" /></label></section>
      {!editing ? <label className="flex items-center gap-2 text-sm font-bold"><input defaultChecked={workspace.defaultItemId === null} name="isDefault" type="checkbox" /> 이 두께의 기본 원판으로 지정</label> : null}
      {preview ? <CalculationCard value={preview} /> : null}
    </form>
  </CommonDialog>;
}

export function SheetItemPanel({ initial, canWrite }: { initial: SheetItemWorkspaceDto; canWrite: boolean }) {
  const popup = useCommonPopup();
  const [workspace, setWorkspace] = useState(initial);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [pending, startTransition] = useTransition();
  const base = `/api/v1/materials/${workspace.material.id}/variants/${workspace.variant.id}/sheet-items`;
  async function refresh() { setWorkspace(await materialRequest<SheetItemWorkspaceDto>(base)); }
  async function transition(item: SheetItemDto, action: SheetItemTransitionAction) {
    const label = action === "set_default" ? "기본 원판 지정" : action === "deactivate" ? "원판 비활성화" : "원판 재활성화";
    if (!(await popup.confirm({ title: label, message: action === "deactivate" ? `${item.name}을 새 설계의 선택 목록에서 제외하시겠습니까? 기존 문서의 스냅샷은 유지됩니다.` : `${item.name} 상태를 변경하시겠습니까?`, confirmText: label, variant: action === "deactivate" ? "warning" : "info" }))) return;
    startTransition(async () => {
      try { await materialRequest(`${base}/${item.id}/transitions`, { method: "POST", body: JSON.stringify({ action, expectedLockVersion: item.lockVersion }) }); await refresh(); await popup.alert({ title: "처리 완료", message: `${label} 처리가 완료되었습니다.` }); }
      catch (error) { await popup.alert({ title: "처리 실패", message: error instanceof Error ? error.message : "원판 상태를 변경하지 못했습니다.", variant: "danger" }); await refresh(); }
    });
  }
  return <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><Link className="inline-flex items-center gap-1 text-sm font-bold text-slate-600" href={`/materials/${workspace.material.id}`}><ArrowLeft size={16} /> 재질 상세</Link><h1 className="mt-2 text-2xl font-black">원판 품목</h1><p className="mt-1 text-sm text-slate-600">{workspace.material.name} · {workspace.variant.name} ({workspace.variant.thicknessMm}T)</p></div>{canWrite ? <button className="inline-flex items-center gap-2 rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white" onClick={() => setEditor({ mode: "create", item: null })}><Plus size={16} /> 원판 등록</button> : null}</header>
    <section className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-3"><span><b className="block text-xs text-slate-500">등록 품목</b>{workspace.items.length}개</span><span><b className="block text-xs text-slate-500">활성 품목</b>{workspace.activeCount}개</span><span><b className="block text-xs text-slate-500">중량 계산 밀도</b>{workspace.material.densityKgPerM3 ? `${workspace.material.densityKgPerM3}kg/㎥` : "미등록"}</span></section>
    {workspace.items.length === 0 ? <section className="rounded-xl border border-dashed bg-white p-10 text-center text-sm text-slate-600">등록된 원판이 없습니다. 첫 품목은 자동으로 기본 원판이 됩니다.</section> : <section className="grid gap-4 xl:grid-cols-2">{workspace.items.map((item) => <article key={item.id} className={`rounded-xl border bg-white p-4 shadow-sm ${!item.active ? "opacity-65" : item.isDefault ? "border-teal-300" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><span className="flex flex-wrap items-center gap-2"><h2 className="font-black">{item.name}</h2>{item.isDefault && item.active ? <span className="rounded bg-teal-100 px-2 py-0.5 text-[11px] font-bold text-teal-800">기본</span> : null}{!item.active ? <span className="rounded bg-slate-200 px-2 py-0.5 text-[11px] font-bold">비활성</span> : null}</span><p className="mt-1 font-mono text-xs text-slate-500">{item.code}</p></div><b className="text-lg">{item.widthMm} × {item.lengthMm}mm</b></div>
      <p className="mt-2 text-xs text-slate-500">{item.finishName ?? "마감 미지정"} · {item.rotationPolicy === "FREE" ? "자유 회전" : `결 방향 유지(${item.grainAxis === "WIDTH" ? "폭" : "길이"})`} · 재고 단위 장</p>
      <div className="mt-4"><CalculationCard value={item.calculation} /></div>
      {/* 사용 실적은 재단 승인에서 쌓인다(`P2-B06`). 기준정보에서 그 원판만 걸러 본다. */}
      <p className="mt-3 text-xs"><Link className="text-teal-800 underline" href={`/cutting/usage?sheetItemId=${item.id}`}>이 원판의 사용 실적 보기</Link></p>
      {canWrite ? <div className="mt-4 flex flex-wrap gap-2"><button className="inline-flex items-center gap-1 rounded border px-3 py-2 text-xs font-bold" onClick={() => setEditor({ mode: "edit", item })}><Pencil size={14} /> 수정</button><button className="inline-flex items-center gap-1 rounded border px-3 py-2 text-xs font-bold" onClick={() => setEditor({ mode: "copy", item })}><CopyPlus size={14} /> 복사</button>{item.active && !item.isDefault ? <button className="inline-flex items-center gap-1 rounded border border-teal-200 px-3 py-2 text-xs font-bold text-teal-800" disabled={pending} onClick={() => transition(item, "set_default")}><Star size={14} /> 기본 지정</button> : null}<button className="inline-flex items-center gap-1 rounded border px-3 py-2 text-xs font-bold" disabled={pending} onClick={() => transition(item, item.active ? "deactivate" : "reactivate")}><Power size={14} /> {item.active ? "비활성화" : "재활성화"}</button></div> : null}
    </article>)}</section>}
    <SheetEditor key={editor ? `${editor.mode}-${editor.item?.id ?? "new"}` : "closed"} state={editor} workspace={workspace} onClose={() => setEditor(null)} onSaved={refresh} />
  </div>;
}

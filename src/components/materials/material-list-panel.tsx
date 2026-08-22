"use client";
import { Layers3, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { materialRequest } from "./material-api";
import { CommonDialog, useCommonPopup } from "@/components/ui/common-popup";
import { QueryBar, QueryField } from "@/components/ui/query-bar";
import type { MaterialDetailDto, MaterialListDto } from "@/server/materials/material-types";

const field = (data: FormData, name: string) => String(data.get(name) ?? "").trim();
function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter(); const popup = useCommonPopup(); const [pending, startTransition] = useTransition(); const formId = "material-create";
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); startTransition(async () => { try { const created = await materialRequest<MaterialDetailDto>("/api/v1/materials", { method: "POST", body: JSON.stringify({ code: field(data,"code"), name: field(data,"name"), densityKgPerM3: field(data,"density"), sortOrder: Number(field(data,"sortOrder") || 0), memo: field(data,"memo") }) }); onClose(); await popup.alert({ title: "재질 등록 완료", message: `${created.code} 재질을 등록했습니다.` }); router.push(`/materials/${created.id}`); } catch (error) { await popup.alert({ title: "등록 실패", message: error instanceof Error ? error.message : "재질을 등록하지 못했습니다.", variant: "danger" }); } }); }
  return <CommonDialog open={open} onClose={onClose} title="새 재질" description="실제 업무에서 사용할 코드와 재질명을 등록합니다." size="lg" footer={<><button className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-bold" onClick={onClose} disabled={pending}>취소</button><button className="rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white" form={formId} disabled={pending}>{pending?"등록 중":"재질 등록"}</button></>}><form id={formId} onSubmit={submit} className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-600">재질 코드<input autoFocus className="field-control uppercase" name="code" required maxLength={50} placeholder="AL" pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,49}" /></label><label className="text-xs font-semibold text-slate-600">재질명<input className="field-control" name="name" required maxLength={100} placeholder="알루미늄" /></label><label className="text-xs font-semibold text-slate-600">밀도(kg/m³)<input className="field-control" name="density" inputMode="decimal" pattern="[0-9]+([.][0-9]{1,3})?" placeholder="2700" /></label><label className="text-xs font-semibold text-slate-600">정렬 순서<input className="field-control" name="sortOrder" type="number" defaultValue="0" /></label><label className="text-xs font-semibold text-slate-600 sm:col-span-2">메모<textarea className="mt-1.5 min-h-20 w-full rounded border border-slate-300 p-2.5 text-sm" name="memo" maxLength={2000} /></label></form></CommonDialog>;
}

export function MaterialListPanel({ initial, canWrite }: { initial: MaterialListDto; canWrite: boolean }) {
  const [result,setResult]=useState(initial); const [query,setQuery]=useState(""); const [inactive,setInactive]=useState(false); const [open,setOpen]=useState(false); const [error,setError]=useState(""); const [pending,startTransition]=useTransition();
  function load(cursor?: string) { const params = new URLSearchParams({ limit:"25" }); if(query.trim()) params.set("q",query.trim()); if(inactive) params.set("includeInactive","true"); if(cursor) params.set("cursor",cursor); startTransition(async()=>{try{setError("");setResult(await materialRequest<MaterialListDto>(`/api/v1/materials?${params}`));}catch(e){setError(e instanceof Error?e.message:"목록을 불러오지 못했습니다.");}}); }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-black">재질·두께</h1>
          <p className="mt-0.5 text-xs text-slate-500">제품 계산에 사용할 재질과 두께별 발행 상태를 관리합니다.</p>
        </div>
        {canWrite ? (
          <button className="inline-flex h-9 items-center gap-1.5 rounded bg-teal-700 px-4 text-xs font-bold text-white hover:bg-teal-800" onClick={() => setOpen(true)} type="button">
            <Plus className="h-4 w-4" />새 재질
          </button>
        ) : null}
      </div>

      <QueryBar busy={pending} onSubmit={(event) => { event.preventDefault(); load(); }}>
        <QueryField label="통합 검색" width="w-72">
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              aria-label="통합 검색"
              className="h-9 w-full rounded border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="재질·두께 코드 또는 이름"
              value={query}
            />
          </span>
        </QueryField>
        <label className="flex h-9 items-center gap-2 text-xs font-bold text-slate-600">
          <input checked={inactive} onChange={(event) => setInactive(event.target.checked)} type="checkbox" />
          비활성 포함
        </label>
      </QueryBar>

      {error ? <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5">
          <h2 className="text-sm font-black text-slate-800">재질 목록</h2>
          <span className="text-xs text-slate-500">{result.items.length}건 표시</span>
        </div>
        {result.items.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <Layers3 className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-bold">조건에 맞는 재질이 없습니다.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-xs text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-2.5 text-left font-bold">재질명</th>
                  <th className="px-4 py-2.5 text-left font-bold">코드</th>
                  <th className="px-4 py-2.5 text-right font-bold">밀도(kg/m³)</th>
                  <th className="px-4 py-2.5 text-right font-bold">사용 두께</th>
                  <th className="px-4 py-2.5 text-left font-bold">계산 기준</th>
                  <th className="px-4 py-2.5 text-left font-bold">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.items.map((item) => (
                  <tr className="hover:bg-teal-50/60" key={item.id}>
                    <td className="px-4 py-2.5">
                      <Link className="font-bold text-teal-800 underline-offset-2 hover:underline" href={`/materials/${item.id}`}>{item.name}</Link>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{item.code}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-600">{item.densityKgPerM3 ?? "미입력"}</td>
                    <td className="px-4 py-2.5 text-right text-slate-600">{item.activeVariantCount}개</td>
                    <td className="px-4 py-2.5">
                      <span className={item.calculationRequiredCount ? "font-bold text-amber-700" : "text-teal-700"}>
                        {item.calculationRequiredCount ? `계산 기준 필요 ${item.calculationRequiredCount}개` : "계산 기준 준비 완료"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {item.active ? (
                        <span className="rounded bg-teal-50 px-2 py-0.5 text-xs font-bold text-teal-800">사용</span>
                      ) : (
                        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">비활성</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {result.nextCursor ? (
          <div className="border-t border-slate-200 bg-slate-50 p-3 text-center">
            <button className="rounded border border-slate-300 bg-white px-4 py-2 text-xs font-bold" onClick={() => load(result.nextCursor!)} type="button">다음 재질 보기</button>
          </div>
        ) : null}
      </section>
      <CreateDialog onClose={() => setOpen(false)} open={open} />
    </div>
  );
}

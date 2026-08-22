"use client";

import { BadgeDollarSign, Calculator, CircleDollarSign, Plus, Tags, UsersRound } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useMemo, useState, useTransition } from "react";

import { CommonDialog, useCommonPopup } from "@/components/ui/common-popup";
import { TabPanel, Tabs } from "@/components/ui/tabs";
import type { FoldPricePreviewDto, PriceScopeTypeDto, PricingWorkspaceDto } from "@/server/pricing/pricing-types";

import { pricingRequest } from "./pricing-api";

const field = (data: FormData, name: string) => String(data.get(name) ?? "").trim();
const scopeLabel = { STANDARD: "조직 기본", TIER: "가격등급", CUSTOMER: "거래처 전용" } as const;
const currency = (value: string) => `${new Intl.NumberFormat("ko-KR").format(Number(value))}원`;

function TierDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const popup = useCommonPopup(); const [pending,startTransition]=useTransition(); const formId="pricing-tier-create";
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);startTransition(async()=>{try{await pricingRequest("/api/v1/pricing/tiers",{method:"POST",body:JSON.stringify({code:field(data,"code"),name:field(data,"name"),description:field(data,"description")||null,sortOrder:Number(field(data,"sortOrder")||0)})});onClose();await onSaved();await popup.alert({title:"가격등급 등록 완료",message:"새 가격등급을 등록했습니다."});}catch(error){await popup.alert({title:"등록 실패",message:error instanceof Error?error.message:"가격등급을 등록하지 못했습니다.",variant:"danger"});}})}
  return <CommonDialog open={open} onClose={onClose} title="새 가격등급" description="인증 역할과 별개인 거래처 가격 기준입니다." footer={<><button type="button" onClick={onClose} disabled={pending} className="rounded border bg-white px-4 py-2 text-sm font-bold">취소</button><button form={formId} disabled={pending} className="rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white">등록</button></>}><form id={formId} onSubmit={submit} className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-bold text-slate-600">등급 코드<input autoFocus required name="code" className="field-control uppercase" placeholder="VIP" /></label><label className="text-xs font-bold text-slate-600">등급명<input required name="name" className="field-control" placeholder="우대 거래처" /></label><label className="text-xs font-bold text-slate-600">정렬 순서<input name="sortOrder" type="number" defaultValue="0" className="field-control" /></label><label className="text-xs font-bold text-slate-600 sm:col-span-2">설명<textarea name="description" maxLength={500} className="mt-1.5 min-h-20 w-full rounded border border-slate-300 p-2.5 text-sm" /></label></form></CommonDialog>;
}

function BookDialog({ open, onClose, onSaved, workspace }: { open: boolean; onClose: () => void; onSaved: () => Promise<void>; workspace: PricingWorkspaceDto }) {
  const popup=useCommonPopup();const[pending,startTransition]=useTransition();const[scope,setScope]=useState<PriceScopeTypeDto>("TIER");const formId="price-book-create";
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);startTransition(async()=>{try{await pricingRequest("/api/v1/pricing/books",{method:"POST",body:JSON.stringify({code:field(data,"code"),name:field(data,"name"),scopeType:scope,priceTierId:scope==="TIER"?field(data,"target")||null:null,customerId:scope==="CUSTOMER"?field(data,"target")||null:null})});onClose();await onSaved();await popup.alert({title:"가격표 등록 완료",message:"가격표를 등록했습니다. 상세 화면에서 첫 초안을 작성하세요."});}catch(error){await popup.alert({title:"등록 실패",message:error instanceof Error?error.message:"가격표를 등록하지 못했습니다.",variant:"danger"});}})}
  return <CommonDialog open={open} onClose={onClose} title="새 가격표" description="같은 등급이나 거래처에는 활성 가격표를 하나만 둘 수 있습니다." footer={<><button type="button" onClick={onClose} disabled={pending} className="rounded border bg-white px-4 py-2 text-sm font-bold">취소</button><button form={formId} disabled={pending} className="rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white">등록</button></>}><form id={formId} onSubmit={submit} className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-bold text-slate-600">가격표 코드<input autoFocus required name="code" className="field-control uppercase" placeholder="TIER-VIP" /></label><label className="text-xs font-bold text-slate-600">가격표명<input required name="name" className="field-control" placeholder="우대 가격표" /></label><label className="text-xs font-bold text-slate-600">적용 범위<select value={scope} onChange={e=>setScope(e.target.value as PriceScopeTypeDto)} className="field-control bg-white"><option value="STANDARD">조직 기본</option><option value="TIER">가격등급</option><option value="CUSTOMER">거래처 전용</option></select></label>{scope!=="STANDARD"?<label className="text-xs font-bold text-slate-600">적용 대상<select required name="target" className="field-control bg-white"><option value="">선택</option>{(scope==="TIER"?workspace.tiers.filter(x=>x.active):workspace.customers).map(item=><option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>:null}</form></CommonDialog>;
}

function ManualCalculator({ workspace }: { workspace: PricingWorkspaceDto }) {
  const popup=useCommonPopup();const[pending,startTransition]=useTransition();const[result,setResult]=useState<FoldPricePreviewDto|null>(null);
  const variants=useMemo(()=>workspace.materials.flatMap(material=>material.variants.map(variant=>({...variant,materialName:material.name}))),[workspace.materials]);
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);startTransition(async()=>{try{setResult(await pricingRequest<FoldPricePreviewDto>("/api/v1/pricing/calculate-fold",{method:"POST",body:JSON.stringify({customerId:field(data,"customerId"),materialVariantId:field(data,"materialVariantId"),metrics:{version:"pricing-metrics-v1",areaEachM2:field(data,"area"),bendOperationsEach:Number(field(data,"bends")),vCutLengthEachM:field(data,"vcut"),quantity:Number(field(data,"quantity"))}})}));}catch(error){setResult(null);await popup.alert({title:"가격 계산 실패",message:error instanceof Error?error.message:"가격을 계산하지 못했습니다.",variant:"danger"});}})}
  return <section className="rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 px-5 py-4"><h2 className="flex items-center gap-2 font-black"><Calculator className="h-5 w-5 text-teal-700"/>게시 가격 미리보기</h2><p className="mt-1 text-xs text-slate-500">수주 저장 전 가격 적용 순서와 공급가액을 확인하는 비저장 계산입니다.</p></div><form onSubmit={submit} className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-6"><label className="text-xs font-bold text-slate-600 xl:col-span-2">거래처<select required name="customerId" className="field-control bg-white"><option value="">선택</option>{workspace.customers.map(item=><option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label><label className="text-xs font-bold text-slate-600 xl:col-span-2">재질·두께<select required name="materialVariantId" className="field-control bg-white"><option value="">선택</option>{variants.map(item=><option key={item.id} value={item.id}>{item.materialName} · {item.name}</option>)}</select></label><label className="text-xs font-bold text-slate-600">제품 1개 면적(㎡)<input required name="area" defaultValue="0.3" inputMode="decimal" className="field-control font-mono" /></label><label className="text-xs font-bold text-slate-600">수량<input required name="quantity" type="number" min="1" defaultValue="3" className="field-control font-mono" /></label><label className="text-xs font-bold text-slate-600">제품 1개 절곡수<input required name="bends" type="number" min="0" max="999" defaultValue="2" className="field-control font-mono" /></label><label className="text-xs font-bold text-slate-600">제품 1개 V-CUT(m)<input required name="vcut" defaultValue="1.25" inputMode="decimal" className="field-control font-mono" /></label><button disabled={pending} className="h-10 self-end rounded bg-teal-700 px-5 text-sm font-bold text-white sm:col-span-2 xl:col-span-2">{pending?"계산 중":"가격 계산"}</button></form>{result?<div className="grid gap-3 border-t border-slate-200 bg-teal-50/60 p-5 sm:grid-cols-2 lg:grid-cols-5"><Amount label="재질비" value={result.amounts.materialKrw}/><Amount label="절곡비" value={result.amounts.bendKrw}/><Amount label="V-CUT비" value={result.amounts.vCutKrw}/><Amount label="가공 할증" value={result.amounts.surchargeKrw}/><div className="rounded-lg bg-teal-800 p-3 text-white"><p className="text-xs font-bold text-teal-100">공급가액 · VAT 별도</p><p className="mt-1 text-xl font-black">{currency(result.amounts.supplyKrw)}</p></div><p className="text-xs text-slate-600 sm:col-span-2 lg:col-span-5">적용 출처: {scopeLabel[result.trace.foldRate.scopeType as keyof typeof scopeLabel]??"미리보기"} · 엔진 {result.engineVersion}{result.surchargeApplied?" · 최소 절곡 할증 적용":" · 할증 없음"}</p></div>:null}</section>;
}

function Amount({label,value}:{label:string;value:string}){return <div className="rounded-lg border border-teal-100 bg-white p-3"><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-1 text-lg font-black text-slate-950">{currency(value)}</p></div>}

export function PricingPanel({ initial, canWrite }: { initial: PricingWorkspaceDto; canWrite: boolean }) {
  const popup=useCommonPopup();const[workspace,setWorkspace]=useState(initial);const[tierOpen,setTierOpen]=useState(false);const[bookOpen,setBookOpen]=useState(false);const[tab,setTab]=useState("books");const[pending,startTransition]=useTransition();
  async function reload(){setWorkspace(await pricingRequest<PricingWorkspaceDto>("/api/v1/pricing"));}
  function tierAction(tier:PricingWorkspaceDto["tiers"][number],action:"set_default"|"deactivate"|"reactivate"){startTransition(async()=>{const confirmed=await popup.confirm({title:action==="set_default"?"기본 가격등급 지정":action==="deactivate"?"가격등급 비활성화":"가격등급 재활성화",message:`${tier.name} 등급에 이 작업을 적용하시겠습니까?`,variant:action==="deactivate"?"warning":"info"});if(!confirmed)return;try{await pricingRequest(`/api/v1/pricing/tiers/${tier.id}/transitions`,{method:"POST",body:JSON.stringify({action,expectedLockVersion:tier.lockVersion})});await reload();}catch(error){await popup.alert({title:"처리 실패",message:error instanceof Error?error.message:"가격등급을 변경하지 못했습니다.",variant:"danger"});}})}
  function assign(customer:PricingWorkspaceDto["customers"][number],priceTierId:string|null){startTransition(async()=>{try{await pricingRequest(`/api/v1/customers/${customer.id}/pricing-tier`,{method:"POST",body:JSON.stringify({priceTierId,expectedLockVersion:customer.lockVersion})});await reload();}catch(error){await popup.alert({title:"배정 실패",message:error instanceof Error?error.message:"가격등급을 배정하지 못했습니다.",variant:"danger"});}})}
  const currentBooks=workspace.books.filter(book=>book.currentRevisionId).length;
  const tabs = [
    { id: "books", label: "가격표", badge: workspace.books.length },
    { id: "tiers", label: "가격등급", badge: workspace.tiers.length },
    { id: "assign", label: "거래처 등급", badge: workspace.customers.length },
    { id: "calculator", label: "가격 계산기" },
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-950">가격 관리</h1>
          <p className="mt-0.5 text-xs text-slate-500">기본·등급·거래처 전용 가격을 승인 개정으로 관리하고 적용 결과를 확인합니다.</p>
        </div>
        {canWrite ? (
          <div className="flex gap-2">
            <button className="inline-flex h-9 items-center gap-1.5 rounded border border-slate-300 bg-white px-4 text-xs font-bold" onClick={() => setTierOpen(true)} type="button"><Plus className="h-4 w-4" />가격등급</button>
            <button className="inline-flex h-9 items-center gap-1.5 rounded bg-teal-700 px-4 text-xs font-bold text-white hover:bg-teal-800" onClick={() => setBookOpen(true)} type="button"><Plus className="h-4 w-4" />가격표</button>
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Summary icon={Tags} label="활성 가격등급" value={`${workspace.tiers.filter(x => x.active).length}개`} />
        <Summary icon={BadgeDollarSign} label="사용 중 가격표" value={`${currentBooks}개`} />
        <Summary icon={UsersRound} label="가격 대상 거래처" value={`${workspace.customers.length}개`} />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <Tabs ariaLabel="가격 관리" onChange={setTab} tabs={tabs} value={tab} />
      </div>

      <TabPanel id="books" value={tab}>
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5">
            <h2 className="text-sm font-black text-slate-800">가격표</h2>
            <span className="text-xs text-slate-500">게시 개정과 작성 중 개정을 확인합니다.</span>
          </div>
          {workspace.books.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="text-xs text-slate-500">
                  <tr className="border-b border-slate-200">
                    <th className="px-4 py-2.5 text-left font-bold">가격표</th>
                    <th className="px-4 py-2.5 text-left font-bold">적용 범위</th>
                    <th className="px-4 py-2.5 text-left font-bold">코드</th>
                    <th className="px-4 py-2.5 text-left font-bold">상태</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {workspace.books.map(book => (
                    <tr className="hover:bg-teal-50/60" key={book.id}>
                      <td className="px-4 py-2.5">
                        <Link className="font-bold text-teal-800 underline-offset-2 hover:underline" href={`/pricing/${book.id}`}>{book.name}</Link>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {scopeLabel[book.scopeType]}
                        {book.priceTier ? ` · ${book.priceTier.name}` : ""}
                        {book.customer ? ` · ${book.customer.name}` : ""}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{book.code}</td>
                      <td className="px-4 py-2.5">
                        <span className="flex flex-wrap gap-1.5 text-[11px] font-bold">
                          <span className={book.currentRevisionId ? "rounded bg-teal-100 px-2 py-1 text-teal-800" : "rounded bg-amber-100 px-2 py-1 text-amber-800"}>{book.currentRevisionId ? "사용 중" : "게시 필요"}</span>
                          {book.openRevisionId ? <span className="rounded bg-blue-100 px-2 py-1 text-blue-800">작성 중</span> : null}
                          {book.scheduledRevisionId ? <span className="rounded bg-violet-100 px-2 py-1 text-violet-800">예약</span> : null}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="px-5 py-12 text-center text-sm text-slate-500">등록된 가격표가 없습니다.</p>}
        </section>
      </TabPanel>

      <TabPanel id="tiers" value={tab}>
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b px-5 py-4">
            <h2 className="font-black">가격등급</h2>
            <p className="mt-1 text-xs text-slate-500">거래처가 공유할 가격 범위입니다.</p>
          </div>
          <div className="divide-y">
            {workspace.tiers.map(tier => (
              <div className="flex items-center justify-between gap-3 px-5 py-4" key={tier.id}>
                <div>
                  <p className="font-bold">{tier.name} <span className="text-xs text-slate-400">{tier.code}</span></p>
                  <p className="mt-1 text-xs text-slate-500">거래처 {tier.customerCount}곳 {tier.isDefault ? "· 조직 기본" : ""} {!tier.active ? "· 비활성" : ""}</p>
                </div>
                {canWrite ? (
                  <div className="flex gap-1">
                    {!tier.isDefault && tier.active ? <button className="rounded border px-2.5 py-1.5 text-xs font-bold" disabled={pending} onClick={() => tierAction(tier, "set_default")} type="button">기본 지정</button> : null}
                    <button className="rounded border px-2.5 py-1.5 text-xs font-bold" disabled={pending} onClick={() => tierAction(tier, tier.active ? "deactivate" : "reactivate")} type="button">{tier.active ? "비활성" : "재활성"}</button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </TabPanel>

      <TabPanel id="assign" value={tab}>
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b px-5 py-4">
            <h2 className="font-black">거래처 가격등급</h2>
            <p className="mt-1 text-xs text-slate-500">미지정은 조직 기본 등급을 사용합니다.</p>
          </div>
          <div className="divide-y">
            {workspace.customers.map(customer => (
              <label className="grid gap-2 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_180px] sm:items-center" key={customer.id}>
                <span className="text-sm font-bold">{customer.name}<span className="ml-2 text-xs font-normal text-slate-400">{customer.code}</span></span>
                <select className="h-9 rounded border border-slate-300 bg-white px-2 text-sm" disabled={!canWrite || pending} onChange={e => assign(customer, e.target.value || null)} value={customer.priceTierId ?? ""}>
                  <option value="">조직 기본 사용</option>
                  {workspace.tiers.filter(x => x.active).map(tier => <option key={tier.id} value={tier.id}>{tier.name}</option>)}
                </select>
              </label>
            ))}
          </div>
        </div>
      </TabPanel>

      <TabPanel id="calculator" value={tab}>
        <ManualCalculator workspace={workspace} />
      </TabPanel>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
        <b>로컬 검수 자료:</b> `LOCAL TEST ONLY` 가격은 화면 검수 전용이며 운영 가격으로 사용할 수 없습니다. 모든 가격은 VAT 별도입니다.
      </div>
      <TierDialog onClose={() => setTierOpen(false)} onSaved={reload} open={tierOpen} />
      <BookDialog onClose={() => setBookOpen(false)} onSaved={reload} open={bookOpen} workspace={workspace} />
    </div>
  );
}

function Summary({icon:Icon,label,value}:{icon:typeof CircleDollarSign;label:string;value:string}){return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2 text-xs font-bold text-slate-500"><Icon className="h-4 w-4 text-teal-700"/>{label}</div><p className="mt-2 text-2xl font-black">{value}</p></div>}

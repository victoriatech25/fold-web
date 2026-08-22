"use client";

import { Building2, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

import { customerRequest } from "@/components/customers/customer-api";
import { CommonDialog, useCommonPopup } from "@/components/ui/common-popup";
import { QueryBar, QueryField } from "@/components/ui/query-bar";
import type { CustomerType } from "@/generated/prisma/client";
import type {
  CustomerDetailDto,
  CustomerListDto,
} from "@/server/customers/customer-types";

const typeLabels: Record<CustomerType, string> = {
  SALES: "매출처",
  PURCHASE: "매입처",
  TEMPORARY: "임시 거래처",
  INTERNAL: "자사",
  OTHER: "기타",
};

function field(data: FormData, name: string) {
  return String(data.get(name) ?? "").trim();
}

function CustomerCreateDialog({ onClose, open }: { onClose: () => void; open: boolean }) {
  const router = useRouter();
  const popup = useCommonPopup();
  const [pending, startTransition] = useTransition();
  const formId = "customer-create-form";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        const created = await customerRequest<CustomerDetailDto>("/api/v1/customers", {
          method: "POST",
          body: JSON.stringify({
            type: field(data, "type"),
            name: field(data, "name"),
            businessRegistrationNumber: field(data, "businessRegistrationNumber"),
            representativeName: field(data, "representativeName"),
            phone: field(data, "phone"),
            fax: "",
            email: field(data, "email"),
            website: "",
            postalCode: "",
            addressLine1: "",
            addressLine2: "",
            taxInvoiceEnabled: true,
            memo: "",
          }),
        });
        onClose();
        await popup.alert({
          title: "거래처 등록 완료",
          message: `${created.code} 거래처를 등록했습니다.`,
        });
        router.push(`/customers/${created.id}`);
      } catch (error) {
        await popup.alert({
          title: "등록 실패",
          message: error instanceof Error ? error.message : "거래처를 등록하지 못했습니다.",
          variant: "danger",
        });
      }
    });
  }

  return (
    <CommonDialog
      description="필수 정보만 먼저 등록하고 상세 화면에서 담당자와 현장을 추가합니다."
      footer={<>
        <button className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700" disabled={pending} onClick={onClose} type="button">취소</button>
        <button className="rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={pending} form={formId} type="submit">{pending ? "등록 중" : "거래처 등록"}</button>
      </>}
      onClose={onClose}
      open={open}
      size="lg"
      title="새 거래처"
    >
      <form className="grid gap-4 sm:grid-cols-2" id={formId} onSubmit={submit}>
        <label className="text-xs font-semibold text-slate-600">
          거래처 유형
          <select className="field-control" defaultValue="SALES" name="type">
            {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">
          거래처명
          <input autoFocus className="field-control" maxLength={200} name="name" placeholder="거래처 상호" required />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          사업자등록번호
          <input className="field-control" maxLength={20} name="businessRegistrationNumber" placeholder="000-00-00000" />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          대표자
          <input className="field-control" maxLength={100} name="representativeName" />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          대표 전화
          <input className="field-control" maxLength={30} name="phone" type="tel" />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          대표 이메일
          <input className="field-control" maxLength={320} name="email" type="email" />
        </label>
        <p className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-500 sm:col-span-2">
          거래처 코드는 등록 시 자동 발급됩니다. 고객 현장이 없어도 거래처를 먼저 등록할 수 있습니다.
        </p>
      </form>
    </CommonDialog>
  );
}

export function CustomerListPanel({
  canWrite,
  initial,
}: {
  canWrite: boolean;
  initial: CustomerListDto;
}) {
  const [result, setResult] = useState(initial);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<CustomerType | "">("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function load(cursor?: string) {
    setError("");
    const params = new URLSearchParams({ limit: "25" });
    if (query.trim()) params.set("q", query.trim());
    if (type) params.set("type", type);
    if (includeInactive) params.set("includeInactive", "true");
    if (cursor) params.set("cursor", cursor);
    startTransition(async () => {
      try {
        setResult(await customerRequest<CustomerListDto>(`/api/v1/customers?${params}`));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "거래처 목록을 불러오지 못했습니다.");
      }
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    load();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-black">거래처·고객 현장</h1>
          <p className="mt-0.5 text-xs text-slate-500">거래처를 찾고 담당자와 납품·공사 현장을 관리합니다.</p>
        </div>
        {canWrite ? (
          <button className="inline-flex h-9 items-center gap-1.5 rounded bg-teal-700 px-4 text-xs font-bold text-white hover:bg-teal-800" onClick={() => setCreateOpen(true)} type="button">
            <Plus className="h-4 w-4" /> 새 거래처
          </button>
        ) : null}
      </div>

      <QueryBar busy={pending} onSubmit={submit}>
        <QueryField label="통합 검색" width="w-72">
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              aria-label="통합 검색"
              className="h-9 w-full rounded border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="코드, 상호, 사업자번호, 전화"
              value={query}
            />
          </span>
        </QueryField>
        <QueryField label="유형" width="w-36">
          <select
            aria-label="거래처 유형 필터"
            className="field-control !mt-0 h-9 bg-white"
            onChange={(event) => setType(event.target.value as CustomerType | "")}
            value={type}
          >
            <option value="">전체</option>
            {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </QueryField>
        <label className="flex h-9 items-center gap-2 text-xs font-bold text-slate-600">
          <input checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} type="checkbox" />
          비활성 포함
        </label>
      </QueryBar>

      {error ? <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5">
          <h2 className="text-sm font-black text-slate-800">거래처 목록</h2>
          <span className="text-xs text-slate-500">{result.items.length}건 표시</span>
        </div>
        {result.items.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <Building2 className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-bold text-slate-700">조건에 맞는 거래처가 없습니다.</p>
            <p className="mt-1 text-xs text-slate-500">검색 조건을 바꾸거나 새 거래처를 등록해 주세요.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="text-xs text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-2.5 text-left font-bold">거래처명</th>
                  <th className="px-4 py-2.5 text-left font-bold">코드</th>
                  <th className="px-4 py-2.5 text-left font-bold">유형</th>
                  <th className="px-4 py-2.5 text-left font-bold">대표자</th>
                  <th className="px-4 py-2.5 text-left font-bold">대표 전화</th>
                  <th className="px-4 py-2.5 text-right font-bold">담당자</th>
                  <th className="px-4 py-2.5 text-right font-bold">현장</th>
                  <th className="px-4 py-2.5 text-left font-bold">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.items.map((customer) => (
                  <tr className="hover:bg-teal-50/60" key={customer.id}>
                    <td className="px-4 py-2.5">
                      <Link className="font-bold text-teal-800 underline-offset-2 hover:underline" href={`/customers/${customer.id}`}>
                        {customer.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{customer.code}</td>
                    <td className="px-4 py-2.5 text-slate-600">{typeLabels[customer.type]}</td>
                    <td className="px-4 py-2.5 text-slate-600">{customer.representativeName || "-"}</td>
                    <td className="px-4 py-2.5 text-slate-600">{customer.phone || "-"}</td>
                    <td className="px-4 py-2.5 text-right text-slate-600">{customer.contactCount}명</td>
                    <td className="px-4 py-2.5 text-right text-slate-600">{customer.siteCount}개</td>
                    <td className="px-4 py-2.5">
                      {customer.active ? (
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
            <button className="rounded border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 disabled:opacity-50" disabled={pending} onClick={() => load(result.nextCursor ?? undefined)} type="button">다음 거래처 보기</button>
          </div>
        ) : null}
      </section>
      <CustomerCreateDialog onClose={() => setCreateOpen(false)} open={createOpen} />
    </div>
  );
}

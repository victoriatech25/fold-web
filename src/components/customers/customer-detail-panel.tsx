"use client";

import {
  ArrowLeft,
  Building2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Star,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useState, useTransition } from "react";

import {
  customerRequest,
  CustomerRequestError,
} from "@/components/customers/customer-api";
import { CommonDialog, useCommonPopup } from "@/components/ui/common-popup";
import type { CustomerType } from "@/generated/prisma/client";
import type {
  CustomerContactDto,
  CustomerDetailDto,
  CustomerSiteDto,
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

function customerPayload(data: FormData) {
  return {
    type: field(data, "type"),
    name: field(data, "name"),
    businessRegistrationNumber: field(data, "businessRegistrationNumber"),
    representativeName: field(data, "representativeName"),
    phone: field(data, "phone"),
    fax: field(data, "fax"),
    email: field(data, "email"),
    website: field(data, "website"),
    postalCode: field(data, "postalCode"),
    addressLine1: field(data, "addressLine1"),
    addressLine2: field(data, "addressLine2"),
    taxInvoiceEnabled: data.get("taxInvoiceEnabled") === "on",
    memo: field(data, "memo"),
  };
}

function CustomerForm({
  canWrite,
  customer,
  onChanged,
}: {
  canWrite: boolean;
  customer: CustomerDetailDto;
  onChanged: (customer: CustomerDetailDto) => void;
}) {
  const popup = useCommonPopup();
  const [pending, startTransition] = useTransition();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const active = data.get("active") === "on";
    if (customer.active && !active) {
      const confirmed = await popup.confirm({
        title: "거래처 비활성화",
        message: `${customer.name} 거래처를 비활성화하면 새 수주 선택 목록에서 제외됩니다. 계속하시겠습니까?`,
        confirmText: "비활성화",
        variant: "warning",
      });
      if (!confirmed) return;
    }
    startTransition(async () => {
      try {
        const updated = await customerRequest<CustomerDetailDto>(
          `/api/v1/customers/${customer.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              ...customerPayload(data),
              active,
              expectedLockVersion: customer.lockVersion,
            }),
          },
        );
        onChanged(updated);
        await popup.alert({ title: "저장 완료", message: "거래처 기본정보를 저장했습니다." });
      } catch (caught) {
        await popup.alert({
          title: "저장 실패",
          message: caught instanceof Error ? caught.message : "거래처를 저장하지 못했습니다.",
          variant: "danger",
        });
        if (caught instanceof CustomerRequestError && caught.code === "CONFLICT") {
          location.reload();
        }
      }
    });
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-50 text-teal-700"><Building2 className="h-5 w-5" /></span>
        <div>
          <h2 className="font-black">거래처 기본정보</h2>
          <p className="text-xs text-slate-500">코드 {customer.code} · 코드는 변경할 수 없습니다.</p>
        </div>
      </div>
      <form className="grid gap-4 p-5 sm:grid-cols-2" key={customer.lockVersion} onSubmit={submit}>
        <label className="text-xs font-semibold text-slate-600">
          거래처 유형
          <select className="field-control" defaultValue={customer.type} disabled={!canWrite} name="type">
            {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">
          거래처명
          <input className="field-control" defaultValue={customer.name} disabled={!canWrite} maxLength={200} name="name" required />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          사업자등록번호
          <input className="field-control" defaultValue={customer.businessRegistrationNumber ?? ""} disabled={!canWrite} maxLength={20} name="businessRegistrationNumber" placeholder="000-00-00000" />
          {customer.businessRegistrationDuplicate ? <span className="mt-1.5 block text-xs font-semibold text-amber-700" role="status">같은 사업자등록번호를 사용하는 거래처가 있습니다.</span> : null}
        </label>
        <label className="text-xs font-semibold text-slate-600">
          대표자
          <input className="field-control" defaultValue={customer.representativeName ?? ""} disabled={!canWrite} maxLength={100} name="representativeName" />
        </label>
        <label className="text-xs font-semibold text-slate-600">대표 전화<input className="field-control" defaultValue={customer.phone ?? ""} disabled={!canWrite} maxLength={30} name="phone" type="tel" /></label>
        <label className="text-xs font-semibold text-slate-600">팩스<input className="field-control" defaultValue={customer.fax ?? ""} disabled={!canWrite} maxLength={30} name="fax" /></label>
        <label className="text-xs font-semibold text-slate-600">이메일<input className="field-control" defaultValue={customer.email ?? ""} disabled={!canWrite} maxLength={320} name="email" type="email" /></label>
        <label className="text-xs font-semibold text-slate-600">웹사이트<input className="field-control" defaultValue={customer.website ?? ""} disabled={!canWrite} maxLength={500} name="website" type="url" /></label>
        <label className="text-xs font-semibold text-slate-600">우편번호<input className="field-control" defaultValue={customer.postalCode ?? ""} disabled={!canWrite} maxLength={20} name="postalCode" /></label>
        <label className="text-xs font-semibold text-slate-600 sm:col-span-2">기본 주소<input className="field-control" defaultValue={customer.addressLine1 ?? ""} disabled={!canWrite} maxLength={300} name="addressLine1" /></label>
        <label className="text-xs font-semibold text-slate-600 sm:col-span-2">상세 주소<input className="field-control" defaultValue={customer.addressLine2 ?? ""} disabled={!canWrite} maxLength={300} name="addressLine2" /></label>
        <label className="text-xs font-semibold text-slate-600 sm:col-span-2">내부 비고<textarea className="mt-1.5 min-h-20 w-full rounded border border-slate-300 p-2.5 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100" defaultValue={customer.memo ?? ""} disabled={!canWrite} maxLength={2000} name="memo" /></label>
        <div className="flex flex-wrap items-center gap-5 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input defaultChecked={customer.taxInvoiceEnabled} disabled={!canWrite} name="taxInvoiceEnabled" type="checkbox" />세금계산서 사용</label>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input defaultChecked={customer.active} disabled={!canWrite} name="active" type="checkbox" />사용 중</label>
          {canWrite ? <button className="ml-auto rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={pending} type="submit">{pending ? "저장 중" : "기본정보 저장"}</button> : null}
        </div>
      </form>
    </section>
  );
}

function ContactDialog({
  contact,
  customer,
  onClose,
  onSaved,
}: {
  contact: CustomerContactDto | null | undefined;
  customer: CustomerDetailDto;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const popup = useCommonPopup();
  const [pending, startTransition] = useTransition();
  const formId = contact ? `contact-${contact.id}` : "contact-create";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const active = contact ? data.get("active") === "on" : true;
    if (contact?.active && !active && !(await popup.confirm({
      title: "담당자 비활성화",
      message: `${contact.name} 담당자를 비활성화하시겠습니까?`,
      confirmText: "비활성화",
      variant: "warning",
    }))) return;
    startTransition(async () => {
      try {
        await customerRequest<CustomerContactDto>(
          contact
            ? `/api/v1/customers/${customer.id}/contacts/${contact.id}`
            : `/api/v1/customers/${customer.id}/contacts`,
          {
            method: contact ? "PATCH" : "POST",
            body: JSON.stringify({
              customerSiteId: field(data, "customerSiteId") || null,
              name: field(data, "name"),
              department: field(data, "department"),
              title: field(data, "title"),
              phone: field(data, "phone"),
              mobile: field(data, "mobile"),
              email: field(data, "email"),
              ...(contact ? { active, expectedLockVersion: contact.lockVersion } : {}),
            }),
          },
        );
        onClose();
        await onSaved();
        await popup.alert({ title: "저장 완료", message: "담당자 정보를 저장했습니다." });
      } catch (caught) {
        await popup.alert({ title: "저장 실패", message: caught instanceof Error ? caught.message : "담당자를 저장하지 못했습니다.", variant: "danger" });
      }
    });
  }

  return (
    <CommonDialog
      description="거래처 전체 담당자 또는 특정 고객 현장 담당자로 등록합니다."
      footer={<><button className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-bold" disabled={pending} onClick={onClose} type="button">취소</button><button className="rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={pending} form={formId} type="submit">저장</button></>}
      onClose={onClose}
      open={contact !== undefined}
      size="lg"
      title={contact ? "담당자 수정" : "담당자 추가"}
    >
      <form className="grid gap-4 sm:grid-cols-2" id={formId} onSubmit={submit}>
        <label className="text-xs font-semibold text-slate-600">담당자명<input className="field-control" defaultValue={contact?.name ?? ""} maxLength={100} name="name" required /></label>
        <label className="text-xs font-semibold text-slate-600">연결 고객 현장<select className="field-control" defaultValue={contact?.customerSiteId ?? ""} name="customerSiteId"><option value="">거래처 공통</option>{customer.sites.filter((site) => site.active).map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600">부서<input className="field-control" defaultValue={contact?.department ?? ""} maxLength={100} name="department" /></label>
        <label className="text-xs font-semibold text-slate-600">직책<input className="field-control" defaultValue={contact?.title ?? ""} maxLength={100} name="title" /></label>
        <label className="text-xs font-semibold text-slate-600">전화<input className="field-control" defaultValue={contact?.phone ?? ""} maxLength={30} name="phone" type="tel" /></label>
        <label className="text-xs font-semibold text-slate-600">휴대전화<input className="field-control" defaultValue={contact?.mobile ?? ""} maxLength={30} name="mobile" type="tel" /></label>
        <label className="text-xs font-semibold text-slate-600 sm:col-span-2">이메일<input className="field-control" defaultValue={contact?.email ?? ""} maxLength={320} name="email" type="email" /></label>
        {contact ? <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 sm:col-span-2"><input defaultChecked={contact.active} name="active" type="checkbox" />사용 중</label> : null}
      </form>
    </CommonDialog>
  );
}

function SiteDialog({
  customer,
  onClose,
  onSaved,
  site,
}: {
  customer: CustomerDetailDto;
  onClose: () => void;
  onSaved: () => Promise<void>;
  site: CustomerSiteDto | null | undefined;
}) {
  const popup = useCommonPopup();
  const [pending, startTransition] = useTransition();
  const formId = site ? `customer-site-${site.id}` : "customer-site-create";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const active = site ? data.get("active") === "on" : true;
    if (site?.active && !active && !(await popup.confirm({
      title: "고객 현장 비활성화",
      message: `${site.name} 현장을 비활성화하면 새 수주 선택 목록에서 제외됩니다. 계속하시겠습니까?`,
      confirmText: "비활성화",
      variant: "warning",
    }))) return;
    startTransition(async () => {
      try {
        await customerRequest<CustomerSiteDto>(
          site
            ? `/api/v1/customers/${customer.id}/sites/${site.id}`
            : `/api/v1/customers/${customer.id}/sites`,
          {
            method: site ? "PATCH" : "POST",
            body: JSON.stringify({
              code: field(data, "code"),
              name: field(data, "name"),
              phone: field(data, "phone"),
              postalCode: field(data, "postalCode"),
              addressLine1: field(data, "addressLine1"),
              addressLine2: field(data, "addressLine2"),
              memo: field(data, "memo"),
              ...(site ? { active, expectedLockVersion: site.lockVersion } : {}),
            }),
          },
        );
        onClose();
        await onSaved();
        await popup.alert({ title: "저장 완료", message: "고객 현장 정보를 저장했습니다." });
      } catch (caught) {
        await popup.alert({ title: "저장 실패", message: caught instanceof Error ? caught.message : "고객 현장을 저장하지 못했습니다.", variant: "danger" });
      }
    });
  }

  return (
    <CommonDialog
      description="납품·공사 주소로 사용할 거래처 소속 현장을 등록합니다."
      footer={<><button className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-bold" disabled={pending} onClick={onClose} type="button">취소</button><button className="rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={pending} form={formId} type="submit">저장</button></>}
      onClose={onClose}
      open={site !== undefined}
      size="lg"
      title={site ? "고객 현장 수정" : "고객 현장 추가"}
    >
      <form className="grid gap-4 sm:grid-cols-2" id={formId} onSubmit={submit}>
        <label className="text-xs font-semibold text-slate-600">현장 코드<input className="field-control uppercase read-only:bg-slate-100 read-only:text-slate-500" defaultValue={site?.code ?? ""} maxLength={50} name="code" placeholder="SITE-01" readOnly={Boolean(site)} required /></label>
        <label className="text-xs font-semibold text-slate-600">현장명<input className="field-control" defaultValue={site?.name ?? ""} maxLength={200} name="name" required /></label>
        <label className="text-xs font-semibold text-slate-600">현장 전화<input className="field-control" defaultValue={site?.phone ?? ""} maxLength={30} name="phone" type="tel" /></label>
        <label className="text-xs font-semibold text-slate-600">우편번호<input className="field-control" defaultValue={site?.postalCode ?? ""} maxLength={20} name="postalCode" /></label>
        <label className="text-xs font-semibold text-slate-600 sm:col-span-2">기본 주소<input className="field-control" defaultValue={site?.addressLine1 ?? ""} maxLength={300} name="addressLine1" /></label>
        <label className="text-xs font-semibold text-slate-600 sm:col-span-2">상세 주소<input className="field-control" defaultValue={site?.addressLine2 ?? ""} maxLength={300} name="addressLine2" /></label>
        <label className="text-xs font-semibold text-slate-600 sm:col-span-2">현장 비고<textarea className="mt-1.5 min-h-20 w-full rounded border border-slate-300 p-2.5 text-sm" defaultValue={site?.memo ?? ""} maxLength={2000} name="memo" /></label>
        {site ? <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 sm:col-span-2"><input defaultChecked={site.active} name="active" type="checkbox" />사용 중</label> : null}
      </form>
    </CommonDialog>
  );
}

export function CustomerDetailPanel({
  canWrite,
  initial,
}: {
  canWrite: boolean;
  initial: CustomerDetailDto;
}) {
  const popup = useCommonPopup();
  const [customer, setCustomer] = useState(initial);
  const [contactDialog, setContactDialog] = useState<CustomerContactDto | null | undefined>();
  const [siteDialog, setSiteDialog] = useState<CustomerSiteDto | null | undefined>();
  const [pending, startTransition] = useTransition();

  async function reload() {
    setCustomer(await customerRequest<CustomerDetailDto>(`/api/v1/customers/${customer.id}`));
  }

  async function setDefaultContact(contact: CustomerContactDto) {
    if (!(await popup.confirm({ title: "기본 담당자 변경", message: `${contact.name} 담당자를 기본 담당자로 지정하시겠습니까?`, confirmText: "기본 지정" }))) return;
    startTransition(async () => {
      try {
        await customerRequest(`/api/v1/customers/${customer.id}/contacts/${contact.id}/default`, { method: "POST", body: JSON.stringify({ expectedLockVersion: contact.lockVersion }) });
        await reload();
        await popup.alert({ title: "변경 완료", message: "기본 담당자를 변경했습니다." });
      } catch (caught) {
        await popup.alert({ title: "변경 실패", message: caught instanceof Error ? caught.message : "기본 담당자를 변경하지 못했습니다.", variant: "danger" });
        await reload();
      }
    });
  }

  async function setDefaultSite(site: CustomerSiteDto) {
    if (!(await popup.confirm({ title: "기본 고객 현장 변경", message: `${site.name}을 기본 고객 현장으로 지정하시겠습니까?`, confirmText: "기본 지정" }))) return;
    startTransition(async () => {
      try {
        await customerRequest(`/api/v1/customers/${customer.id}/sites/${site.id}/default`, { method: "POST", body: JSON.stringify({ expectedLockVersion: site.lockVersion }) });
        await reload();
        await popup.alert({ title: "변경 완료", message: "기본 고객 현장을 변경했습니다." });
      } catch (caught) {
        await popup.alert({ title: "변경 실패", message: caught instanceof Error ? caught.message : "기본 고객 현장을 변경하지 못했습니다.", variant: "danger" });
        await reload();
      }
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <Link className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-teal-700" href="/customers"><ArrowLeft className="h-3.5 w-3.5" />거래처 목록</Link>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-black tracking-tight">{customer.name}</h1>
          <span className="rounded bg-slate-200 px-2 py-1 text-xs font-bold text-slate-700">{customer.code}</span>
          <span className="rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">{typeLabels[customer.type]}</span>
          {!customer.active ? <span className="rounded bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">비활성</span> : null}
        </div>
        <p className="mt-1 text-sm text-slate-500">기본정보와 담당자, 납품·공사 현장을 한곳에서 관리합니다.</p>
      </div>

      <CustomerForm canWrite={canWrite} customer={customer} onChanged={setCustomer} />

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><UserRound className="h-5 w-5" /></span><div><h2 className="font-black">담당자</h2><p className="text-xs text-slate-500">{customer.contacts.length}명 등록</p></div></div>
            {canWrite ? <button className="inline-flex items-center gap-1.5 rounded bg-slate-900 px-3 py-2 text-xs font-bold text-white" onClick={() => setContactDialog(null)} type="button"><Plus className="h-3.5 w-3.5" />담당자 추가</button> : null}
          </div>
          {customer.contacts.length === 0 ? <p className="p-6 text-sm text-slate-500">등록된 담당자가 없습니다.</p> : <div className="divide-y divide-slate-100">{customer.contacts.map((contact) => {
            const siteName = customer.sites.find((site) => site.id === contact.customerSiteId)?.name;
            return <article className="p-5" key={contact.id}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold">{contact.name}</h3>{contact.isPrimary ? <span className="inline-flex items-center gap-1 rounded bg-teal-100 px-2 py-0.5 text-[11px] font-bold text-teal-800"><Star className="h-3 w-3" />기본</span> : null}{!contact.active ? <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">비활성</span> : null}</div><p className="mt-1 text-xs text-slate-500">{[contact.department, contact.title, siteName ?? "거래처 공통"].filter(Boolean).join(" · ")}</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">{contact.mobile || contact.phone ? <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{contact.mobile || contact.phone}</span> : null}{contact.email ? <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{contact.email}</span> : null}</div></div>{canWrite ? <div className="flex shrink-0 gap-1">{contact.active && !contact.isPrimary ? <button aria-label={`${contact.name} 기본 담당자 지정`} className="rounded border border-teal-200 p-2 text-teal-700" disabled={pending} onClick={() => setDefaultContact(contact)} title="기본 담당자 지정" type="button"><Star className="h-3.5 w-3.5" /></button> : null}<button aria-label={`${contact.name} 담당자 수정`} className="rounded border border-slate-200 p-2 text-slate-600" onClick={() => setContactDialog(contact)} type="button"><Pencil className="h-3.5 w-3.5" /></button></div> : null}</div></article>;
          })}</div>}
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-700"><MapPin className="h-5 w-5" /></span><div><h2 className="font-black">고객 현장</h2><p className="text-xs text-slate-500">{customer.sites.length}개 등록</p></div></div>
            {canWrite ? <button className="inline-flex items-center gap-1.5 rounded bg-slate-900 px-3 py-2 text-xs font-bold text-white" onClick={() => setSiteDialog(null)} type="button"><Plus className="h-3.5 w-3.5" />현장 추가</button> : null}
          </div>
          {customer.sites.length === 0 ? <p className="p-6 text-sm text-slate-500">등록된 고객 현장이 없습니다. 현장 없이도 거래처를 사용할 수 있습니다.</p> : <div className="divide-y divide-slate-100">{customer.sites.map((site) => <article className="p-5" key={site.id}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold">{site.name}</h3><span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{site.code}</span>{site.isDefault ? <span className="inline-flex items-center gap-1 rounded bg-teal-100 px-2 py-0.5 text-[11px] font-bold text-teal-800"><Star className="h-3 w-3" />기본</span> : null}{!site.active ? <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">비활성</span> : null}</div><p className="mt-2 text-xs text-slate-500">{[site.phone, site.addressLine1, site.addressLine2].filter(Boolean).join(" · ") || "연락처와 주소 미등록"}</p></div>{canWrite ? <div className="flex shrink-0 gap-1">{site.active && !site.isDefault ? <button aria-label={`${site.name} 기본 고객 현장 지정`} className="rounded border border-teal-200 p-2 text-teal-700" disabled={pending} onClick={() => setDefaultSite(site)} title="기본 고객 현장 지정" type="button"><Star className="h-3.5 w-3.5" /></button> : null}<button aria-label={`${site.name} 고객 현장 수정`} className="rounded border border-slate-200 p-2 text-slate-600" onClick={() => setSiteDialog(site)} type="button"><Pencil className="h-3.5 w-3.5" /></button></div> : null}</div></article>)}</div>}
        </section>
      </div>

      <ContactDialog contact={contactDialog} customer={customer} onClose={() => setContactDialog(undefined)} onSaved={reload} />
      <SiteDialog customer={customer} onClose={() => setSiteDialog(undefined)} onSaved={reload} site={siteDialog} />
    </div>
  );
}

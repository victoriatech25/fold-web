"use client";

import { Building2, MapPin, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState, useTransition } from "react";

import {
  companySettingsRequest,
  CompanySettingsRequestError,
} from "@/components/company-settings/company-settings-api";
import { CommonDialog, useCommonPopup } from "@/components/ui/common-popup";
import { TabPanel, Tabs } from "@/components/ui/tabs";
import type {
  BusinessSiteDto,
  CompanyProfileDto,
} from "@/server/company-settings/company-settings-types";

const typeLabels = {
  HEAD_OFFICE: "본사",
  FACTORY: "공장",
  BRANCH: "지점",
  OTHER: "기타",
} as const;

function value(data: FormData, name: string): string {
  return String(data.get(name) ?? "").trim();
}

function contactPayload(data: FormData) {
  return {
    businessRegistrationNumber: value(data, "businessRegistrationNumber"),
    representativeName: value(data, "representativeName"),
    phone: value(data, "phone"),
    email: value(data, "email"),
    postalCode: value(data, "postalCode"),
    addressLine1: value(data, "addressLine1"),
    addressLine2: value(data, "addressLine2"),
  };
}

function CompanyProfileForm({
  canManage,
  company,
}: {
  canManage: boolean;
  company: CompanyProfileDto;
}) {
  const router = useRouter();
  const popup = useCommonPopup();
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        await companySettingsRequest<CompanyProfileDto>("/api/v1/company-profile", {
          method: "PATCH",
          body: JSON.stringify({
            name: value(data, "name"),
            ...contactPayload(data),
            expectedOrganizationLockVersion: company.organizationLockVersion,
            expectedProfileLockVersion: company.profileLockVersion,
          }),
        });
        router.refresh();
        await popup.alert({ title: "저장 완료", message: "회사 정보를 저장했습니다." });
      } catch (caught) {
        await popup.alert({
          title: "저장 실패",
          message: caught instanceof Error ? caught.message : "회사 정보를 저장하지 못했습니다.",
          variant: "danger",
        });
        if (caught instanceof CompanySettingsRequestError && caught.code === "CONFLICT") router.refresh();
      }
    });
  }

  return (
    <section className="rounded-lg border border-slate-300 bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
        <Building2 className="text-teal-700" size={22} />
        <div>
          <h2 className="font-black">회사 기본정보</h2>
          <p className="text-xs text-slate-500">조직 코드 {company.code}</p>
        </div>
      </div>
      <form className="grid gap-4 p-5 sm:grid-cols-2" key={`${company.organizationLockVersion}-${company.profileLockVersion}`} onSubmit={submit}>
        <label className="text-xs font-semibold text-slate-600 sm:col-span-2">
          회사명
          <input className="field-control" defaultValue={company.name} disabled={!canManage} maxLength={200} name="name" required />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          사업자등록번호
          <input className="field-control" defaultValue={company.businessRegistrationNumber ?? ""} disabled={!canManage} maxLength={20} name="businessRegistrationNumber" placeholder="000-00-00000" />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          대표자
          <input className="field-control" defaultValue={company.representativeName ?? ""} disabled={!canManage} maxLength={100} name="representativeName" />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          전화번호
          <input className="field-control" defaultValue={company.phone ?? ""} disabled={!canManage} maxLength={30} name="phone" type="tel" />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          이메일
          <input className="field-control" defaultValue={company.email ?? ""} disabled={!canManage} maxLength={320} name="email" type="email" />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          우편번호
          <input className="field-control" defaultValue={company.postalCode ?? ""} disabled={!canManage} maxLength={20} name="postalCode" />
        </label>
        <label className="text-xs font-semibold text-slate-600 sm:col-span-2">
          기본 주소
          <input className="field-control" defaultValue={company.addressLine1 ?? ""} disabled={!canManage} maxLength={300} name="addressLine1" />
        </label>
        <label className="text-xs font-semibold text-slate-600 sm:col-span-2">
          상세 주소
          <input className="field-control" defaultValue={company.addressLine2 ?? ""} disabled={!canManage} maxLength={300} name="addressLine2" />
        </label>
        {canManage ? (
          <div className="flex justify-end sm:col-span-2">
            <button className="rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={pending} type="submit">
              회사정보 저장
            </button>
          </div>
        ) : null}
      </form>
    </section>
  );
}

function SiteDialog({
  onClose,
  site,
}: {
  onClose: () => void;
  site: BusinessSiteDto | null | undefined;
}) {
  const router = useRouter();
  const popup = useCommonPopup();
  const [pending, startTransition] = useTransition();
  const formId = site ? `business-site-${site.id}` : "business-site-create";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const active = site ? data.get("active") === "on" : true;
    if (site?.active && !active) {
      const confirmed = await popup.confirm({
        title: "사업장 비활성화",
        message: `${site.name} 사업장을 비활성화하시겠습니까?`,
        confirmText: "비활성화",
        variant: "warning",
      });
      if (!confirmed) return;
    }
    startTransition(async () => {
      try {
        const body = {
          name: value(data, "name"),
          type: value(data, "type"),
          ...contactPayload(data),
          ...(site
            ? { active, expectedLockVersion: site.lockVersion }
            : { code: value(data, "code") }),
        };
        await companySettingsRequest<BusinessSiteDto>(
          site ? `/api/v1/business-sites/${site.id}` : "/api/v1/business-sites",
          { method: site ? "PATCH" : "POST", body: JSON.stringify(body) },
        );
        onClose();
        router.refresh();
        await popup.alert({ title: "저장 완료", message: "사업장 정보를 저장했습니다." });
      } catch (caught) {
        await popup.alert({
          title: "저장 실패",
          message: caught instanceof Error ? caught.message : "사업장을 저장하지 못했습니다.",
          variant: "danger",
        });
        if (caught instanceof CompanySettingsRequestError && caught.code === "CONFLICT") router.refresh();
      }
    });
  }

  return (
    <CommonDialog
      description={site ? "사업장 연락처와 사용 상태를 변경합니다." : "회사에서 사용할 사업장을 추가합니다."}
      footer={<>
        <button className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700" disabled={pending} onClick={onClose} type="button">취소</button>
        <button className="rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={pending} form={formId} type="submit">저장</button>
      </>}
      onClose={onClose}
      open={site !== undefined}
      size="lg"
      title={site ? "사업장 수정" : "사업장 추가"}
    >
      <form className="grid gap-4 sm:grid-cols-2" id={formId} onSubmit={submit}>
        <label className="text-xs font-semibold text-slate-600">
          사업장 코드
          <input className="field-control uppercase" defaultValue={site?.code ?? ""} disabled={Boolean(site)} maxLength={50} name="code" placeholder="FACTORY-1" required />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          사업장명
          <input className="field-control" defaultValue={site?.name ?? ""} maxLength={200} name="name" required />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          유형
          <select className="field-control" defaultValue={site?.type ?? "FACTORY"} name="type">
            {Object.entries(typeLabels).map(([entry, label]) => <option key={entry} value={entry}>{label}</option>)}
          </select>
        </label>
        {site ? (
          <label className="flex items-center gap-2 self-end pb-2 text-sm font-semibold text-slate-700">
            <input defaultChecked={site.active} disabled={site.isDefault} name="active" type="checkbox" />
            사용 중
          </label>
        ) : <div />}
        <div className="contents" key={site?.id ?? "new"}>
          <label className="text-xs font-semibold text-slate-600">
            사업자등록번호
            <input className="field-control" defaultValue={site?.businessRegistrationNumber ?? ""} maxLength={20} name="businessRegistrationNumber" placeholder="000-00-00000" />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            대표자
            <input className="field-control" defaultValue={site?.representativeName ?? ""} maxLength={100} name="representativeName" />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            전화번호
            <input className="field-control" defaultValue={site?.phone ?? ""} maxLength={30} name="phone" type="tel" />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            이메일
            <input className="field-control" defaultValue={site?.email ?? ""} maxLength={320} name="email" type="email" />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            우편번호
            <input className="field-control" defaultValue={site?.postalCode ?? ""} maxLength={20} name="postalCode" />
          </label>
          <label className="text-xs font-semibold text-slate-600 sm:col-span-2">
            기본 주소
            <input className="field-control" defaultValue={site?.addressLine1 ?? ""} maxLength={300} name="addressLine1" />
          </label>
          <label className="text-xs font-semibold text-slate-600 sm:col-span-2">
            상세 주소
            <input className="field-control" defaultValue={site?.addressLine2 ?? ""} maxLength={300} name="addressLine2" />
          </label>
        </div>
      </form>
    </CommonDialog>
  );
}

export function CompanySettingsPanel({
  businessSites,
  canManage,
  company,
}: {
  businessSites: BusinessSiteDto[];
  canManage: boolean;
  company: CompanyProfileDto;
}) {
  const router = useRouter();
  const popup = useCommonPopup();
  const [dialogSite, setDialogSite] = useState<BusinessSiteDto | null | undefined>(undefined);
  const [tab, setTab] = useState("profile");
  const [query, setQuery] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [pending, startTransition] = useTransition();
  const filteredSites = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ko-KR");
    return businessSites.filter((site) =>
      (includeInactive || site.active) &&
      (!normalized || `${site.code} ${site.name}`.toLocaleLowerCase("ko-KR").includes(normalized)),
    );
  }, [businessSites, includeInactive, query]);

  async function setDefault(site: BusinessSiteDto) {
    const confirmed = await popup.confirm({
      title: "기본 사업장 변경",
      message: `${site.name}을 기본 사업장으로 지정하시겠습니까?`,
      confirmText: "기본으로 지정",
    });
    if (!confirmed) return;
    startTransition(async () => {
      try {
        await companySettingsRequest<BusinessSiteDto>(`/api/v1/business-sites/${site.id}/default`, {
          method: "POST",
          body: JSON.stringify({ expectedLockVersion: site.lockVersion }),
        });
        router.refresh();
        await popup.alert({ title: "변경 완료", message: "기본 사업장을 변경했습니다." });
      } catch (caught) {
        await popup.alert({
          title: "변경 실패",
          message: caught instanceof Error ? caught.message : "기본 사업장을 변경하지 못했습니다.",
          variant: "danger",
        });
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <Tabs
          ariaLabel="회사·사업장"
          onChange={setTab}
          tabs={[
            { id: "profile", label: "회사 기본정보" },
            { id: "sites", label: "사업장", badge: businessSites.length },
          ]}
          value={tab}
        />
      </div>

      <TabPanel id="profile" value={tab}>
        <CompanyProfileForm canManage={canManage} company={company} />
      </TabPanel>

      <TabPanel id="sites" value={tab}>
      <section className="rounded-lg border border-slate-300 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <MapPin className="text-teal-700" size={22} />
            <div>
              <h2 className="font-black">사업장</h2>
              <p className="text-xs text-slate-500">수주와 출력에서 사용할 회사 사업장입니다.</p>
            </div>
          </div>
          {canManage ? (
            <button className="inline-flex items-center justify-center gap-2 rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white" onClick={() => setDialogSite(null)} type="button">
              <Plus size={16} /> 사업장 추가
            </button>
          ) : null}
        </div>
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3 sm:flex-row sm:items-center">
          <label className="flex-1 text-xs font-semibold text-slate-600">
            사업장 검색
            <input className="field-control bg-white" onChange={(event) => setQuery(event.target.value)} placeholder="코드 또는 사업장명" value={query} />
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 sm:pt-5">
            <input checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} type="checkbox" />
            비활성 포함
          </label>
        </div>
        <div className="divide-y divide-slate-200">
          {filteredSites.length === 0 ? (
            <p className="p-5 text-sm text-slate-500">조건에 맞는 사업장이 없습니다.</p>
          ) : filteredSites.map((site) => (
            <article className="grid gap-3 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={site.id}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold text-slate-900">{site.name}</h3>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{site.code}</span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{typeLabels[site.type]}</span>
                  {site.isDefault ? <span className="rounded bg-teal-100 px-2 py-0.5 text-xs font-bold text-teal-800">기본 사업장</span> : null}
                  {!site.active ? <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">비활성</span> : null}
                </div>
                <p className="mt-2 text-sm text-slate-600">{[site.phone, site.addressLine1, site.addressLine2].filter(Boolean).join(" · ") || "연락처와 주소 미등록"}</p>
              </div>
              {canManage ? (
                <div className="flex flex-wrap gap-2">
                  {!site.isDefault && site.active ? (
                    <button className="rounded border border-teal-300 bg-white px-3 py-2 text-xs font-bold text-teal-800 disabled:opacity-50" disabled={pending} onClick={() => setDefault(site)} type="button">기본 지정</button>
                  ) : null}
                  <button className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700" onClick={() => setDialogSite(site)} type="button">
                    <Pencil size={14} /> 수정
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </section>
      </TabPanel>
      <SiteDialog key={dialogSite === null ? "new" : dialogSite?.id ?? "closed"} onClose={() => setDialogSite(undefined)} site={dialogSite} />
    </div>
  );
}

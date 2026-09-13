"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

import { adminRequest } from "@/components/admin/admin-api";
import { OneTimeUrl } from "@/components/admin/one-time-url";
import { useCommonPopup } from "@/components/ui/common-popup";
import { formatDate } from "@/domain/format-date";
import type {
  PlatformOrganizationAdministratorInvitationDto,
  PlatformOrganizationDto,
} from "@/server/organizations/organization-types";

const statusLabel = { ACTIVE: "사용", SUSPENDED: "정지" } as const;
const userStatusLabel = {
  INVITED: "초대",
  ACTIVE: "활성",
  SUSPENDED: "정지",
  DISABLED: "비활성",
} as const;

/**
 * 회사의 관리자 목록과 발급 폼. 발급된 계정은 그 회사의 `ADMINISTRATOR` 역할이라
 * 들어가서 자기 회사의 사용자·부서·역할을 스스로 관리한다.
 */
function AdministratorSection({ organization }: { organization: PlatformOrganizationDto }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [invitation, setInvitation] = useState<PlatformOrganizationAdministratorInvitationDto | null>(null);

  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError("");
    startTransition(async () => {
      try {
        const result = await adminRequest<PlatformOrganizationAdministratorInvitationDto>(
          `/api/v1/platform/organizations/${organization.id}/administrators`,
          {
            method: "POST",
            body: JSON.stringify({
              email: data.get("email"),
              displayName: data.get("displayName"),
            }),
          },
        );
        form.reset();
        setOpen(false);
        setInvitation(result);
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "발급 실패");
      }
    });
  }

  return (
    <div className="space-y-3 border-t border-dashed border-slate-200 px-4 pb-4 pt-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="font-semibold text-slate-600">회사 관리자</span>
        {organization.administrators.length === 0 ? (
          <span className="text-amber-700">아직 없습니다. 관리자를 발급해야 이 회사가 사용자를 등록할 수 있습니다.</span>
        ) : (
          organization.administrators.map((administrator) => (
            <span className="text-slate-700" key={administrator.userId}>
              {administrator.displayName}
              <span className="text-slate-500"> · {administrator.email}</span>
              <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                {userStatusLabel[administrator.status]}
              </span>
            </span>
          ))
        )}
        {organization.status === "ACTIVE" ? (
          <button
            className="ml-auto text-xs font-bold text-teal-800 underline"
            onClick={() => setOpen((value) => !value)}
            type="button"
          >
            {open ? "발급 취소" : "관리자 발급"}
          </button>
        ) : null}
      </div>
      {open ? (
        <form className="grid items-end gap-3 sm:grid-cols-[1fr_12rem_auto]" onSubmit={invite}>
          <label className="text-xs font-semibold text-slate-600">
            이메일
            <input className="field-control" maxLength={320} name="email" required type="email" />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            이름
            <input className="field-control" maxLength={100} name="displayName" required />
          </label>
          <button
            className="h-9 rounded bg-teal-700 px-4 text-sm font-bold text-white disabled:opacity-50"
            disabled={pending}
            type="submit"
          >
            발급
          </button>
          {error ? <p className="text-sm text-red-700 sm:col-span-3">{error}</p> : null}
        </form>
      ) : null}
      {invitation ? (
        <OneTimeUrl
          onClose={() => setInvitation(null)}
          title={`${invitation.administrator.displayName} 관리자 비밀번호 설정 주소`}
          url={invitation.invitationUrl}
        />
      ) : null}
    </div>
  );
}

function OrganizationEditor({ organization }: { organization: PlatformOrganizationDto }) {
  const router = useRouter();
  const { confirm: confirmPopup } = useCommonPopup();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(organization.name);
  const [status, setStatus] = useState(organization.status);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      status === "SUSPENDED" &&
      organization.status === "ACTIVE" &&
      !(await confirmPopup({
        title: "회사 정지",
        message: `${organization.name} 회사를 정지하면 소속 사용자 ${organization.memberCount}명이 즉시 로그인할 수 없게 됩니다. 계속하시겠습니까?`,
        confirmText: "정지",
        variant: "danger",
      }))
    ) {
      return;
    }
    setError("");
    startTransition(async () => {
      try {
        await adminRequest<PlatformOrganizationDto>(
          `/api/v1/platform/organizations/${organization.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              name,
              status,
              expectedUpdatedAt: organization.updatedAt,
            }),
          },
        );
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "변경 실패");
      }
    });
  }

  return (
    <form
      className="grid items-end gap-3 p-4 sm:grid-cols-[10rem_1fr_7rem_auto_auto]"
      data-testid="organization-row"
      onSubmit={submit}
    >
      <label className="text-xs font-semibold text-slate-600">
        코드
        <input className="field-control bg-slate-100" disabled value={organization.code} />
      </label>
      <label className="text-xs font-semibold text-slate-600">
        이름
        <input
          className="field-control"
          maxLength={200}
          onChange={(event) => setName(event.target.value)}
          required
          value={name}
        />
      </label>
      <label className="text-xs font-semibold text-slate-600">
        상태
        <select
          className="field-control"
          disabled={organization.own}
          onChange={(event) => setStatus(event.target.value as PlatformOrganizationDto["status"])}
          title={organization.own ? "자신이 속한 회사는 정지할 수 없습니다." : undefined}
          value={status}
        >
          <option value="ACTIVE">{statusLabel.ACTIVE}</option>
          <option value="SUSPENDED">{statusLabel.SUSPENDED}</option>
        </select>
      </label>
      <p className="h-9 text-xs leading-9 text-slate-500">
        사용자 {organization.memberCount}명 · 등록 {formatDate(organization.createdAt)}
        {organization.own ? " · 내 회사" : ""}
      </p>
      <button
        className="h-9 rounded bg-teal-700 px-4 text-sm font-bold text-white disabled:opacity-50"
        disabled={pending}
        type="submit"
      >
        저장
      </button>
      {error ? <p className="text-sm text-red-700 sm:col-span-5">{error}</p> : null}
    </form>
  );
}

export function OrganizationAdminPanel({
  organizations,
}: {
  organizations: PlatformOrganizationDto[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError("");
    startTransition(async () => {
      try {
        await adminRequest<PlatformOrganizationDto>("/api/v1/platform/organizations", {
          method: "POST",
          body: JSON.stringify({
            code: data.get("code"),
            name: data.get("name"),
          }),
        });
        form.reset();
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "등록 실패");
      }
    });
  }

  return (
    <div className="space-y-5">
      <section className="rounded-md border border-slate-300 bg-white p-5 shadow-sm">
        <h2 className="font-bold">회사 등록</h2>
        <p className="mt-1 text-xs text-slate-500">
          등록하면 기본 사업장(본사)과 시스템 역할(관리자·설계자·승인자·조회자)이 함께 만들어집니다.
          등록 뒤 아래 목록에서 그 회사의 관리자 계정을 발급하면, 그 계정이 회사의 사용자·부서·역할을 관리합니다.
        </p>
        <form className="mt-4 grid items-end gap-3 sm:grid-cols-[12rem_1fr_auto]" onSubmit={create}>
          <label className="text-xs font-semibold text-slate-600">
            코드
            <input
              className="field-control uppercase"
              maxLength={50}
              name="code"
              pattern="[A-Za-z0-9][A-Za-z0-9_\-]{1,49}"
              placeholder="ACME"
              required
              title="영문·숫자·-·_ 조합 2~50자"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            이름
            <input className="field-control" maxLength={200} name="name" placeholder="에이스 절곡" required />
          </label>
          <button
            className="h-9 rounded bg-teal-700 px-4 text-sm font-bold text-white disabled:opacity-50"
            disabled={pending}
            type="submit"
          >
            등록
          </button>
          {error ? <p className="text-sm text-red-700 sm:col-span-3">{error}</p> : null}
        </form>
      </section>
      <section className="divide-y divide-slate-200 overflow-hidden rounded-md border border-slate-300 bg-white shadow-sm">
        {organizations.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">등록된 회사가 없습니다.</p>
        ) : (
          organizations.map((organization) => (
            <div key={organization.id}>
              <OrganizationEditor
                key={`${organization.id}-${organization.updatedAt}`}
                organization={organization}
              />
              <AdministratorSection organization={organization} />
            </div>
          ))
        )}
      </section>
    </div>
  );
}

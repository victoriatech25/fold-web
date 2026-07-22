"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

import { adminRequest } from "@/components/admin/admin-api";
import { OneTimeUrl } from "@/components/admin/one-time-url";
import type {
  AdminDepartmentDto,
  AdminRoleDto,
  AdminUserDto,
} from "@/server/admin/admin-types";

const statusLabels = {
  INVITED: "초대",
  ACTIVE: "활성",
  SUSPENDED: "정지",
  DISABLED: "비활성",
} as const;

function UserEditor({
  user,
  departments,
  roles,
  onUrl,
}: {
  user: AdminUserDto;
  departments: AdminDepartmentDto[];
  roles: AdminRoleDto[];
  onUrl: (title: string, url: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [displayName, setDisplayName] = useState(user.displayName);
  const [status, setStatus] = useState(user.status);
  const [departmentId, setDepartmentId] = useState(
    user.membership.department?.id ?? "",
  );
  const [roleIds, setRoleIds] = useState(
    user.membership.roles.map(({ id }) => id),
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const removesAdministrator =
      user.membership.roles.some(({ key }) => key === "ADMINISTRATOR") &&
      !roles.some(
        (role) =>
          role.key === "ADMINISTRATOR" && roleIds.includes(role.id),
      );
    if (
      (status !== "ACTIVE" || removesAdministrator) &&
      !window.confirm(
        `${user.displayName} 사용자의 접근 권한을 제한합니다. 계속하시겠습니까?`,
      )
    ) {
      return;
    }
    setError("");
    startTransition(async () => {
      try {
        await adminRequest<AdminUserDto>(`/api/v1/admin/users/${user.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            displayName,
            status,
            departmentId: departmentId || null,
            roleIds,
            expectedUpdatedAt: user.updatedAt,
          }),
        });
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "변경 실패");
      }
    });
  }

  return (
    <details className="border-t border-slate-200">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-teal-800">
        사용자 설정
      </summary>
      <form className="space-y-4 px-4 pb-4" onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-semibold text-slate-600">
            이름
            <input
              className="field-control"
              maxLength={100}
              onChange={(event) => setDisplayName(event.target.value)}
              required
              value={displayName}
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            상태
            <select
              className="field-control"
              onChange={(event) =>
                setStatus(event.target.value as AdminUserDto["status"])
              }
              value={status}
            >
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            부서
            <select
              className="field-control"
              onChange={(event) => setDepartmentId(event.target.value)}
              value={departmentId}
            >
              <option value="">미지정</option>
              {departments
                .filter(({ active }) => active)
                .map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <fieldset>
          <legend className="text-xs font-semibold text-slate-600">역할</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {roles
              .filter(({ active }) => active)
              .map((role) => (
                <label className="flex items-center gap-1.5 text-sm" key={role.id}>
                  <input
                    checked={roleIds.includes(role.id)}
                    onChange={(event) =>
                      setRoleIds((current) =>
                        event.target.checked
                          ? [...current, role.id]
                          : current.filter((id) => id !== role.id),
                      )
                    }
                    type="checkbox"
                  />
                  {role.name}
                </label>
              ))}
          </div>
        </fieldset>
        {error ? <p className="text-sm font-semibold text-red-700">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            disabled={pending || roleIds.length === 0}
            type="submit"
          >
            {pending ? "저장 중…" : "변경 저장"}
          </button>
          {(user.status === "ACTIVE" || user.status === "INVITED") ? (
            <button
              className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-bold"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setError("");
                  try {
                    const data = await adminRequest<{ passwordResetUrl: string }>(
                      `/api/v1/admin/users/${user.id}/password-resets`,
                      { method: "POST" },
                    );
                    onUrl("비밀번호 설정 주소", data.passwordResetUrl);
                  } catch (caught) {
                    setError(
                      caught instanceof Error ? caught.message : "발급 실패",
                    );
                  }
                })
              }
              type="button"
            >
              비밀번호 주소 발급
            </button>
          ) : null}
        </div>
      </form>
    </details>
  );
}

export function UserAdminPanel({
  users,
  nextCursor: initialNextCursor,
  departments,
  roles,
}: {
  users: AdminUserDto[];
  nextCursor: string | null;
  departments: AdminDepartmentDto[];
  roles: AdminRoleDto[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [oneTimeUrl, setOneTimeUrl] = useState<{
    title: string;
    url: string;
  } | null>(null);
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [visibleUsers, setVisibleUsers] = useState(users);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  function loadUsers({
    cursor,
    append,
  }: {
    cursor?: string;
    append: boolean;
  }) {
    setError("");
    startTransition(async () => {
      try {
        const search = new URLSearchParams({ limit: "25" });
        if (query.trim()) search.set("query", query.trim());
        if (statusFilter) search.set("status", statusFilter);
        if (cursor) search.set("cursor", cursor);
        const data = await adminRequest<{
          items: AdminUserDto[];
          nextCursor: string | null;
        }>(`/api/v1/admin/users?${search}`, { method: "GET" });
        setVisibleUsers((current) =>
          append ? [...current, ...data.items] : data.items,
        );
        setNextCursor(data.nextCursor);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "목록 조회 실패");
      }
    });
  }

  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setError("");
    startTransition(async () => {
      try {
        const data = await adminRequest<{
          user: AdminUserDto;
          invitationUrl: string;
        }>("/api/v1/admin/user-invitations", {
          method: "POST",
          body: JSON.stringify({
            email: form.get("email"),
            displayName: form.get("displayName"),
            departmentId: form.get("departmentId") || null,
            roleIds,
          }),
        });
        setOneTimeUrl({ title: "사용자 초대 주소", url: data.invitationUrl });
        setVisibleUsers((current) => [
          data.user,
          ...current.filter(({ id }) => id !== data.user.id),
        ]);
        setRoleIds([]);
        formElement.reset();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "초대 실패");
      }
    });
  }

  return (
    <div className="space-y-5">
      {oneTimeUrl ? (
        <OneTimeUrl
          onClose={() => setOneTimeUrl(null)}
          title={oneTimeUrl.title}
          url={oneTimeUrl.url}
        />
      ) : null}
      <section className="rounded-md border border-slate-300 bg-white p-5 shadow-sm">
        <h2 className="text-base font-bold">새 사용자 초대</h2>
        <p className="mt-1 text-xs text-slate-500">
          30분 동안 유효한 비밀번호 설정 주소를 발급합니다.
        </p>
        <form className="mt-4 space-y-4" onSubmit={invite}>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-xs font-semibold text-slate-600">
              이메일
              <input className="field-control" name="email" required type="email" />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              이름
              <input className="field-control" maxLength={100} name="displayName" required />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              부서
              <select className="field-control" name="departmentId">
                <option value="">미지정</option>
                {departments.filter(({ active }) => active).map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset>
            <legend className="text-xs font-semibold text-slate-600">역할</legend>
            <div className="mt-2 flex flex-wrap gap-3">
              {roles.filter(({ active }) => active).map((role) => (
                <label className="flex items-center gap-1.5 text-sm" key={role.id}>
                  <input
                    checked={roleIds.includes(role.id)}
                    onChange={(event) =>
                      setRoleIds((current) =>
                        event.target.checked
                          ? [...current, role.id]
                          : current.filter((id) => id !== role.id),
                      )
                    }
                    type="checkbox"
                  />
                  {role.name}
                </label>
              ))}
            </div>
          </fieldset>
          {error ? <p className="text-sm font-semibold text-red-700">{error}</p> : null}
          <button
            className="rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            disabled={pending || roleIds.length === 0}
            type="submit"
          >
            {pending ? "초대 중…" : "초대 주소 발급"}
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">조직 사용자</h2>
            <p className="text-xs text-slate-500">현재 {visibleUsers.length}명 표시</p>
          </div>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              loadUsers({ append: false });
            }}
          >
            <label className="text-xs font-semibold text-slate-600">
              검색
              <input
                className="field-control w-48"
                maxLength={100}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="이름 또는 이메일"
                value={query}
              />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              상태
              <select
                className="field-control"
                onChange={(event) => setStatusFilter(event.target.value)}
                value={statusFilter}
              >
                <option value="">전체</option>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="h-9 rounded border border-slate-300 bg-white px-4 text-sm font-bold"
              disabled={pending}
              type="submit"
            >
              조회
            </button>
          </form>
        </div>
        {visibleUsers.map((user) => (
          <article
            className="overflow-hidden rounded-md border border-slate-300 bg-white shadow-sm"
            key={user.id}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold">{user.displayName}</h3>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold">
                    {statusLabels[user.status]}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">{user.email}</p>
              </div>
              <div className="text-right text-xs text-slate-500">
                <p>{user.membership.department?.name ?? "부서 미지정"}</p>
                <p className="mt-1">
                  {user.membership.roles.map(({ name }) => name).join(", ")}
                </p>
              </div>
            </div>
            <UserEditor
              departments={departments}
              key={user.updatedAt}
              onUrl={(title, url) => setOneTimeUrl({ title, url })}
              roles={roles}
              user={user}
            />
          </article>
        ))}
        {nextCursor ? (
          <button
            className="w-full rounded border border-slate-300 bg-white py-2 text-sm font-bold"
            disabled={pending}
            onClick={() => loadUsers({ cursor: nextCursor, append: true })}
            type="button"
          >
            더보기
          </button>
        ) : null}
      </section>
    </div>
  );
}

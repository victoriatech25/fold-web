"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

import { adminRequest } from "@/components/admin/admin-api";
import type {
  AdminPermissionDto,
  AdminRoleDto,
} from "@/server/admin/admin-types";

function PermissionPicker({
  permissions,
  selected,
  onChange,
  disabled = false,
}: {
  permissions: AdminPermissionDto[];
  selected: string[];
  onChange: (keys: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {permissions.map((permission) => (
        <label
          className="flex gap-2 rounded border border-slate-200 p-2 text-xs"
          key={permission.key}
        >
          <input
            checked={selected.includes(permission.key)}
            disabled={disabled || permission.key === "admin.manage"}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...selected, permission.key]
                  : selected.filter((key) => key !== permission.key),
              )
            }
            type="checkbox"
          />
          <span>
            <strong className="block text-slate-800">{permission.key}</strong>
            <span className="text-slate-500">{permission.description}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function CustomRoleEditor({
  role,
  permissions,
}: {
  role: AdminRoleDto;
  permissions: AdminPermissionDto[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");
  const [active, setActive] = useState(role.active);
  const [selected, setSelected] = useState<string[]>(role.permissions);
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      role.active &&
      !active &&
      !window.confirm(
        `${role.name} 역할을 비활성화합니다. 계속하시겠습니까?`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      try {
        await adminRequest<AdminRoleDto>(`/api/v1/admin/roles/${role.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name,
            description: description || null,
            active,
            permissions: selected,
            expectedUpdatedAt: role.updatedAt,
          }),
        });
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "변경 실패");
      }
    });
  }

  return (
    <details className="rounded-md border border-slate-300 bg-white shadow-sm">
      <summary className="cursor-pointer p-4">
        <span className="font-bold">{role.name}</span>
        <span className="ml-2 font-mono text-xs text-slate-500">{role.key}</span>
      </summary>
      <form className="space-y-4 border-t border-slate-200 p-4" onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-600">
            이름
            <input className="field-control" onChange={(event) => setName(event.target.value)} required value={name} />
          </label>
          <label className="flex items-end gap-2 pb-2 text-sm font-semibold">
            <input checked={active} onChange={(event) => setActive(event.target.checked)} type="checkbox" />
            사용
          </label>
        </div>
        <label className="block text-xs font-semibold text-slate-600">
          설명
          <input className="field-control" maxLength={500} onChange={(event) => setDescription(event.target.value)} value={description} />
        </label>
        <PermissionPicker onChange={setSelected} permissions={permissions} selected={selected} />
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button className="rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white" disabled={pending} type="submit">
          변경 저장
        </button>
      </form>
    </details>
  );
}

export function RoleAdminPanel({
  roles,
  permissions,
}: {
  roles: AdminRoleDto[];
  permissions: AdminPermissionDto[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const systemRoles = roles.filter(({ system }) => system);
  const customRoles = roles.filter(({ system }) => !system);

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      try {
        await adminRequest<AdminRoleDto>("/api/v1/admin/roles", {
          method: "POST",
          body: JSON.stringify({
            key: data.get("key"),
            name: data.get("name"),
            description: data.get("description") || null,
            permissions: selected,
          }),
        });
        form.reset();
        setSelected([]);
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "생성 실패");
      }
    });
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="font-bold">시스템 역할</h2>
        <p className="mt-1 text-xs text-slate-500">고정된 기준 역할이며 화면에서 변경할 수 없습니다.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {systemRoles.map((role) => (
            <article className="rounded-md border border-slate-300 bg-white p-4 shadow-sm" key={role.id}>
              <h3 className="font-bold">{role.name}</h3>
              <p className="font-mono text-xs text-slate-500">{role.key}</p>
              <p className="mt-3 text-xs leading-5 text-slate-600">{role.permissions.join(" · ")}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-slate-300 bg-white p-5 shadow-sm">
        <h2 className="font-bold">사용자 정의 역할 추가</h2>
        <form className="mt-4 space-y-4" onSubmit={create}>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-semibold text-slate-600">
              키
              <input className="field-control uppercase" maxLength={50} name="key" placeholder="SHOP_TEAM" required />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              이름
              <input className="field-control" maxLength={100} name="name" required />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              설명
              <input className="field-control" maxLength={500} name="description" />
            </label>
          </div>
          <PermissionPicker onChange={setSelected} permissions={permissions} selected={selected} />
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <button className="rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white" disabled={pending} type="submit">
            역할 추가
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="font-bold">사용자 정의 역할</h2>
        {customRoles.length === 0 ? (
          <p className="rounded border border-slate-300 bg-white p-4 text-sm text-slate-500">아직 사용자 정의 역할이 없습니다.</p>
        ) : (
          customRoles.map((role) => (
            <CustomRoleEditor key={`${role.id}-${role.updatedAt}`} permissions={permissions} role={role} />
          ))
        )}
      </section>
    </div>
  );
}

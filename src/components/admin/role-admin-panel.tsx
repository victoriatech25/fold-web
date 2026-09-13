"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

import { adminRequest } from "@/components/admin/admin-api";
import { CommonDialog, useCommonPopup } from "@/components/ui/common-popup";
import { permissionGroupOrder } from "@/domain/permission";
import type {
  AdminPermissionDto,
  AdminRoleDto,
} from "@/server/admin/admin-types";

/** 권한을 한글 분류로 묶어 보여준다. 영문 키는 개발자 참고용이라 tooltip 으로만 남긴다. */
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
  const groups = permissionGroupOrder
    .map((group) => ({
      group,
      items: permissions.filter((permission) => permission.group === group),
    }))
    .filter(({ items }) => items.length > 0);

  return (
    <div className="space-y-3">
      {groups.map(({ group, items }) => (
        <div key={group}>
          <p className="mb-1.5 text-[11px] font-bold tracking-[0.08em] text-slate-400">{group}</p>
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((permission) => (
              <label
                className="flex items-center gap-2 rounded border border-slate-200 px-2.5 py-2 text-sm hover:bg-slate-50"
                key={permission.key}
                title={permission.key}
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
                <span className="text-slate-800">{permission.label}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 역할이 가진 권한 전체를 분류별로 읽기 전용으로 보여주는 팝업. */
function RolePermissionDialog({
  permissions,
  role,
  onClose,
}: {
  permissions: AdminPermissionDto[];
  role: AdminRoleDto | null;
  onClose: () => void;
}) {
  const owned = role ? permissions.filter((permission) => role.permissions.includes(permission.key)) : [];
  const groups = permissionGroupOrder
    .map((group) => ({ group, items: owned.filter((item) => item.group === group) }))
    .filter(({ items }) => items.length > 0);

  return (
    <CommonDialog
      description={role ? `${role.name} 역할이 가진 권한 ${owned.length}개입니다.` : undefined}
      onClose={onClose}
      open={role !== null}
      size="lg"
      title="역할 권한"
    >
      <div className="space-y-4">
        {groups.length === 0 ? <p className="text-sm text-slate-500">부여된 권한이 없습니다.</p> : null}
        {groups.map(({ group, items }) => (
          <div key={group}>
            <p className="mb-1.5 text-[11px] font-bold tracking-[0.08em] text-slate-400">{group}</p>
            <ul className="grid gap-1 sm:grid-cols-2">
              {items.map((permission) => (
                <li className="text-sm text-slate-700" key={permission.key} title={permission.key}>
                  · {permission.label}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </CommonDialog>
  );
}

/** 사용자 정의 역할 수정 팝업. 이름·설명·사용 여부·권한을 한 번에 저장한다. */
function CustomRoleEditDialog({
  role,
  permissions,
  onClose,
}: {
  role: AdminRoleDto;
  permissions: AdminPermissionDto[];
  onClose: () => void;
}) {
  const router = useRouter();
  const { confirm: confirmPopup } = useCommonPopup();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");
  const [active, setActive] = useState(role.active);
  const [selected, setSelected] = useState<string[]>(role.permissions);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      role.active &&
      !active &&
      !(await confirmPopup({
        title: "역할 비활성화",
        message: `${role.name} 역할을 비활성화합니다. 이 역할을 통한 권한 부여가 중단됩니다.`,
        confirmText: "비활성화",
        variant: "danger",
      }))
    ) {
      return;
    }
    setError("");
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
        onClose();
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "변경 실패");
      }
    });
  }

  return (
    <CommonDialog
      description={`${role.key} · 권한을 바꾸면 이 역할을 가진 사용자에게 바로 적용됩니다.`}
      footer={
        <>
          <button
            className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
            onClick={onClose}
            type="button"
          >
            취소
          </button>
          <button
            className="rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            disabled={pending}
            form="custom-role-edit-form"
            type="submit"
          >
            변경 저장
          </button>
        </>
      }
      onClose={onClose}
      open
      size="xl"
      title="역할 수정"
    >
      <form className="space-y-4" id="custom-role-edit-form" onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
          <label className="text-xs font-semibold text-slate-600">
            이름
            <input className="field-control" maxLength={100} onChange={(event) => setName(event.target.value)} required value={name} />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            설명
            <input className="field-control" maxLength={500} onChange={(event) => setDescription(event.target.value)} value={description} />
          </label>
          <label className="flex h-full items-end gap-2 pb-2 text-sm font-semibold">
            <input checked={active} onChange={(event) => setActive(event.target.checked)} type="checkbox" />
            사용
          </label>
        </div>
        <fieldset>
          <legend className="text-xs font-semibold text-slate-600">권한</legend>
          <div className="mt-2">
            <PermissionPicker onChange={setSelected} permissions={permissions} selected={selected} />
          </div>
        </fieldset>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
      </form>
    </CommonDialog>
  );
}

/** 사용자 정의 역할 추가 팝업. */
function CustomRoleCreateDialog({
  open,
  permissions,
  onClose,
}: {
  open: boolean;
  permissions: AdminPermissionDto[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError("");
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
        onClose();
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "생성 실패");
      }
    });
  }

  return (
    <CommonDialog
      description="업무에 맞는 권한 조합을 역할로 묶습니다. 키는 영문 대문자·숫자·_ 조합입니다."
      footer={
        <>
          <button
            className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
            onClick={onClose}
            type="button"
          >
            취소
          </button>
          <button
            className="rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            disabled={pending}
            form="custom-role-create-form"
            type="submit"
          >
            역할 추가
          </button>
        </>
      }
      onClose={onClose}
      open={open}
      size="xl"
      title="사용자 정의 역할 추가"
    >
      <form className="space-y-4" id="custom-role-create-form" onSubmit={create}>
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
        <fieldset>
          <legend className="text-xs font-semibold text-slate-600">권한</legend>
          <div className="mt-2">
            <PermissionPicker onChange={setSelected} permissions={permissions} selected={selected} />
          </div>
        </fieldset>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
      </form>
    </CommonDialog>
  );
}

/** 역할 한 줄. 상세와 편집은 팝업으로 열어 목록 자체는 짧게 유지한다. */
function RoleRow({
  role,
  onView,
  onEdit,
}: {
  role: AdminRoleDto;
  onView: () => void;
  onEdit?: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold">{role.name}</span>
          <span className="font-mono text-[11px] text-slate-400">{role.key}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
              role.system ? "bg-slate-100 text-slate-600" : "bg-teal-50 text-teal-800"
            }`}
          >
            {role.system ? "시스템" : "사용자 정의"}
          </span>
          {!role.active ? (
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">비활성</span>
          ) : null}
        </div>
        {role.description ? <p className="mt-0.5 text-xs text-slate-500">{role.description}</p> : null}
      </div>
      <span className="text-xs text-slate-500">권한 {role.permissions.length}개</span>
      <div className="flex gap-1.5">
        <button
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
          onClick={onView}
          type="button"
        >
          권한 보기
        </button>
        {onEdit ? (
          <button
            className="rounded border border-teal-700 bg-white px-3 py-1.5 text-xs font-bold text-teal-800 hover:bg-teal-50"
            onClick={onEdit}
            type="button"
          >
            수정
          </button>
        ) : null}
      </div>
    </li>
  );
}

export function RoleAdminPanel({
  roles,
  permissions,
}: {
  roles: AdminRoleDto[];
  permissions: AdminPermissionDto[];
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [viewing, setViewing] = useState<AdminRoleDto | null>(null);
  const [editing, setEditing] = useState<AdminRoleDto | null>(null);
  const systemRoles = roles.filter(({ system }) => system);
  const customRoles = roles.filter(({ system }) => !system);

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <button
          className="inline-flex h-9 items-center rounded bg-teal-700 px-4 text-xs font-bold text-white hover:bg-teal-800"
          onClick={() => setCreateOpen(true)}
          type="button"
        >
          역할 추가
        </button>
      </div>

      <section>
        <h2 className="font-bold">시스템 역할</h2>
        <p className="mt-1 text-xs text-slate-500">고정된 기준 역할이며 화면에서 변경할 수 없습니다.</p>
        <ul className="mt-3 divide-y divide-slate-200 rounded-md border border-slate-300 bg-white shadow-sm">
          {systemRoles.map((role) => (
            <RoleRow key={role.id} onView={() => setViewing(role)} role={role} />
          ))}
        </ul>
      </section>

      <section>
        <h2 className="font-bold">사용자 정의 역할</h2>
        <p className="mt-1 text-xs text-slate-500">업무에 맞게 권한을 묶은 역할입니다. 수정하면 그 역할을 가진 사용자에게 바로 적용됩니다.</p>
        {customRoles.length === 0 ? (
          <p className="mt-3 rounded-md border border-slate-300 bg-white p-4 text-sm text-slate-500">
            아직 사용자 정의 역할이 없습니다. 오른쪽 위 `역할 추가` 로 만듭니다.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-200 rounded-md border border-slate-300 bg-white shadow-sm">
            {customRoles.map((role) => (
              <RoleRow
                key={`${role.id}-${role.updatedAt}`}
                onEdit={() => setEditing(role)}
                onView={() => setViewing(role)}
                role={role}
              />
            ))}
          </ul>
        )}
      </section>

      <CustomRoleCreateDialog onClose={() => setCreateOpen(false)} open={createOpen} permissions={permissions} />
      <RolePermissionDialog onClose={() => setViewing(null)} permissions={permissions} role={viewing} />
      {editing ? (
        <CustomRoleEditDialog
          key={`${editing.id}-${editing.updatedAt}`}
          onClose={() => setEditing(null)}
          permissions={permissions}
          role={editing}
        />
      ) : null}
    </div>
  );
}

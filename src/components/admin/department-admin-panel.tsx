"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

import { adminRequest } from "@/components/admin/admin-api";
import type { AdminDepartmentDto } from "@/server/admin/admin-types";

function DepartmentEditor({ department }: { department: AdminDepartmentDto }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(department.name);
  const [active, setActive] = useState(department.active);
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      try {
        await adminRequest<AdminDepartmentDto>(
          `/api/v1/admin/departments/${department.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              name,
              active,
              expectedUpdatedAt: department.updatedAt,
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
    <form className="grid items-end gap-3 p-4 sm:grid-cols-[10rem_1fr_auto_auto]" onSubmit={submit}>
      <label className="text-xs font-semibold text-slate-600">
        코드
        <input className="field-control bg-slate-100" disabled value={department.code} />
      </label>
      <label className="text-xs font-semibold text-slate-600">
        이름
        <input
          className="field-control"
          maxLength={100}
          onChange={(event) => setName(event.target.value)}
          required
          value={name}
        />
      </label>
      <label className="flex h-9 items-center gap-2 text-sm font-semibold">
        <input checked={active} onChange={(event) => setActive(event.target.checked)} type="checkbox" />
        사용
      </label>
      <button
        className="h-9 rounded bg-teal-700 px-4 text-sm font-bold text-white disabled:opacity-50"
        disabled={pending}
        type="submit"
      >
        저장
      </button>
      {error ? <p className="text-sm text-red-700 sm:col-span-4">{error}</p> : null}
    </form>
  );
}

export function DepartmentAdminPanel({
  departments,
}: {
  departments: AdminDepartmentDto[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      try {
        await adminRequest<AdminDepartmentDto>("/api/v1/admin/departments", {
          method: "POST",
          body: JSON.stringify({
            code: data.get("code"),
            name: data.get("name"),
          }),
        });
        form.reset();
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "생성 실패");
      }
    });
  }

  return (
    <div className="space-y-5">
      <section className="rounded-md border border-slate-300 bg-white p-5 shadow-sm">
        <h2 className="font-bold">부서 추가</h2>
        <form className="mt-4 grid items-end gap-3 sm:grid-cols-[12rem_1fr_auto]" onSubmit={create}>
          <label className="text-xs font-semibold text-slate-600">
            코드
            <input className="field-control uppercase" maxLength={50} name="code" placeholder="DESIGN" required />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            이름
            <input className="field-control" maxLength={100} name="name" placeholder="설계팀" required />
          </label>
          <button
            className="h-9 rounded bg-teal-700 px-4 text-sm font-bold text-white disabled:opacity-50"
            disabled={pending}
            type="submit"
          >
            추가
          </button>
          {error ? <p className="text-sm text-red-700 sm:col-span-3">{error}</p> : null}
        </form>
      </section>
      <section className="divide-y divide-slate-200 overflow-hidden rounded-md border border-slate-300 bg-white shadow-sm">
        {departments.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">등록된 부서가 없습니다.</p>
        ) : (
          departments.map((department) => (
            <DepartmentEditor department={department} key={`${department.id}-${department.updatedAt}`} />
          ))
        )}
      </section>
    </div>
  );
}

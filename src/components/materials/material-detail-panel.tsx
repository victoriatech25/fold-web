"use client";
import { ArrowLeft, CircleAlert, Layers3, Pencil, Plus, Settings2 } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useState, useTransition } from "react";
import { CommonDialog, useCommonPopup } from "@/components/ui/common-popup";
import { TabPanel, Tabs } from "@/components/ui/tabs";
import type {
  MaterialDetailDto,
  MaterialVariantDto,
} from "@/server/materials/material-types";
import { materialRequest, MaterialRequestError } from "./material-api";

const field = (data: FormData, name: string) =>
  String(data.get(name) ?? "").trim();
function VariantDialog({
  material,
  variant,
  onClose,
  onSaved,
}: {
  material: MaterialDetailDto;
  variant: MaterialVariantDto | null | undefined;
  onClose: () => void;
  onSaved: (value: MaterialDetailDto) => void;
}) {
  const popup = useCommonPopup();
  const [pending, startTransition] = useTransition();
  const open = variant !== undefined;
  const edit = Boolean(variant);
  const formId = edit ? `variant-${variant!.id}` : "variant-create";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const active = edit ? data.get("active") === "on" : true;
    if (
      variant?.active &&
      !active &&
      !(await popup.confirm({
        title: "두께 비활성화",
        message: `${variant.name} 항목을 설계 선택 목록에서 제외하시겠습니까?`,
        confirmText: "비활성화",
        variant: "warning",
      }))
    )
      return;
    startTransition(async () => {
      try {
        await materialRequest(
          edit
            ? `/api/v1/materials/${material.id}/variants/${variant!.id}`
            : `/api/v1/materials/${material.id}/variants`,
          {
            method: edit ? "PATCH" : "POST",
            body: JSON.stringify({
              code: field(data, "code"),
              name: field(data, "name"),
              thicknessMm: field(data, "thickness"),
              defaultInsideRadiusMm: field(data, "radius"),
              sortOrder: Number(field(data, "sortOrder") || 0),
              ...(edit
                ? { active, expectedLockVersion: variant!.lockVersion }
                : {}),
            }),
          },
        );
        onClose();
        onSaved(
          await materialRequest<MaterialDetailDto>(
            `/api/v1/materials/${material.id}`,
          ),
        );
        await popup.alert({
          title: "저장 완료",
          message: edit
            ? "두께 정보를 저장했습니다."
            : "두께를 등록했습니다. 계산 기준 발행 전까지 설계에는 사용할 수 없습니다.",
        });
      } catch (error) {
        await popup.alert({
          title: "저장 실패",
          message:
            error instanceof Error
              ? error.message
              : "두께를 저장하지 못했습니다.",
          variant: "danger",
        });
      }
    });
  }
  return (
    <CommonDialog
      open={open}
      onClose={onClose}
      title={edit ? "두께 수정" : "두께 추가"}
      description="두께와 코드는 등록 후 변경할 수 없습니다. 내측반경은 새 계산 기준의 제안값입니다."
      size="lg"
      footer={
        <>
          <button
            className="rounded border bg-white px-4 py-2 text-sm font-bold"
            onClick={onClose}
            disabled={pending}
          >
            취소
          </button>
          <button
            form={formId}
            className="rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white"
            disabled={pending}
          >
            저장
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <label className="text-xs font-semibold text-slate-600">
          두께 코드
          <input
            autoFocus={!edit}
            className="field-control uppercase read-only:bg-slate-100"
            name="code"
            defaultValue={variant?.code ?? ""}
            readOnly={edit}
            required
            pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,49}"
          />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          표시 이름
          <input
            className="field-control"
            name="name"
            defaultValue={variant?.name ?? ""}
            required
            maxLength={100}
          />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          두께(mm)
          <input
            className="field-control read-only:bg-slate-100"
            name="thickness"
            defaultValue={variant?.thicknessMm ?? ""}
            readOnly={edit}
            required
            inputMode="decimal"
            pattern="[0-9]+([.][0-9]{1,3})?"
          />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          기본 내측반경(mm)
          <input
            className="field-control"
            name="radius"
            defaultValue={variant?.defaultInsideRadiusMm ?? ""}
            required
            inputMode="decimal"
            pattern="[0-9]+([.][0-9]{1,3})?"
          />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          정렬 순서
          <input
            className="field-control"
            name="sortOrder"
            type="number"
            defaultValue={variant?.sortOrder ?? 0}
          />
        </label>
        {edit ? (
          <label className="flex items-center gap-2 self-end pb-2 text-sm font-semibold">
            <input
              name="active"
              type="checkbox"
              defaultChecked={variant!.active}
            />
            사용 중
          </label>
        ) : null}
      </form>
    </CommonDialog>
  );
}

export function MaterialDetailPanel({
  initial,
  canWrite,
}: {
  initial: MaterialDetailDto;
  canWrite: boolean;
}) {
  const popup = useCommonPopup();
  const [material, setMaterial] = useState(initial);
  const [tab, setTab] = useState("basic");
  const [dialog, setDialog] = useState<MaterialVariantDto | null | undefined>();
  const [pending, startTransition] = useTransition();
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const active = data.get("active") === "on";
    if (
      material.active &&
      !active &&
      !(await popup.confirm({
        title: "재질 비활성화",
        message:
          "재질을 비활성화하면 소속 두께가 설계 선택 목록에서 모두 숨겨집니다. 개별 두께 상태는 유지됩니다.",
        confirmText: "비활성화",
        variant: "warning",
      }))
    )
      return;
    startTransition(async () => {
      try {
        const updated = await materialRequest<MaterialDetailDto>(
          `/api/v1/materials/${material.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              code: material.code,
              name: field(data, "name"),
              densityKgPerM3: field(data, "density"),
              sortOrder: Number(field(data, "sortOrder") || 0),
              memo: field(data, "memo"),
              active,
              expectedLockVersion: material.lockVersion,
            }),
          },
        );
        setMaterial(updated);
        await popup.alert({
          title: "저장 완료",
          message: "재질 기본정보를 저장했습니다.",
        });
      } catch (error) {
        await popup.alert({
          title: "저장 실패",
          message:
            error instanceof Error
              ? error.message
              : "재질을 저장하지 못했습니다.",
          variant: "danger",
        });
        if (error instanceof MaterialRequestError && error.code === "CONFLICT")
          location.reload();
      }
    });
  }
  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/materials"
          className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          재질 목록
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-black">{material.name}</h1>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold">
            {material.code}
          </span>
          {!material.active ? (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
              비활성
            </span>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <Tabs
          ariaLabel="재질 상세"
          onChange={setTab}
          tabs={[
            { id: "basic", label: "기본정보" },
            { id: "variants", label: "두께 항목", badge: material.variants.length },
          ]}
          value={tab}
        />
      </div>

      <TabPanel id="basic" value={tab}>
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b px-5 py-4">
          <h2 className="font-black">재질 기본정보</h2>
          <p className="mt-1 text-xs text-slate-500">
            재질 코드는 변경할 수 없습니다.
          </p>
        </div>
        <form
          key={material.lockVersion}
          onSubmit={save}
          className="grid gap-4 p-5 sm:grid-cols-2"
        >
          <label className="text-xs font-semibold text-slate-600">
            재질 코드
            <input
              className="field-control bg-slate-100 text-slate-500"
              value={material.code}
              readOnly
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            재질명
            <input
              className="field-control"
              name="name"
              defaultValue={material.name}
              disabled={!canWrite}
              required
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            밀도(kg/m³)
            <input
              className="field-control"
              name="density"
              defaultValue={material.densityKgPerM3 ?? ""}
              disabled={!canWrite}
              inputMode="decimal"
              pattern="[0-9]+([.][0-9]{1,3})?"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            정렬 순서
            <input
              className="field-control"
              name="sortOrder"
              type="number"
              defaultValue={material.sortOrder}
              disabled={!canWrite}
            />
          </label>
          <label className="text-xs font-semibold text-slate-600 sm:col-span-2">
            메모
            <textarea
              className="mt-1.5 min-h-20 w-full rounded border border-slate-300 p-2.5 text-sm"
              name="memo"
              defaultValue={material.memo ?? ""}
              disabled={!canWrite}
            />
          </label>
          <div className="flex items-center gap-4 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                name="active"
                type="checkbox"
                defaultChecked={material.active}
                disabled={!canWrite}
              />
              사용 중
            </label>
            {canWrite ? (
              <button
                disabled={pending}
                className="ml-auto rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white"
              >
                기본정보 저장
              </button>
            ) : null}
          </div>
        </form>
      </section>
      </TabPanel>

      <TabPanel id="variants" value={tab}>
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
          <div>
            <h2 className="font-black">두께 항목</h2>
            <p className="mt-1 text-xs text-slate-500">
              발행된 계산 기준이 있는 활성 항목만 설계 화면에서 선택할 수
              있습니다.
            </p>
          </div>
          {canWrite ? (
            <button
              onClick={() => setDialog(null)}
              className="inline-flex items-center gap-2 rounded bg-teal-700 px-3 py-2 text-xs font-bold text-white"
            >
              <Plus className="h-4 w-4" />
              두께 추가
            </button>
          ) : null}
        </div>
        {material.variants.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <CircleAlert className="mx-auto h-7 w-7 text-amber-400" />
            <p className="mt-2 text-sm font-bold">등록된 두께가 없습니다.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {material.variants.map((v) => (
              <div
                key={v.id}
                className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center"
              >
                <div>
                  <span className="flex flex-wrap items-center gap-2">
                    <b className="text-sm">{v.name}</b>
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold">
                      {v.code}
                    </span>
                    {!v.active ? (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                        비활성
                      </span>
                    ) : null}
                  </span>
                  <p className="mt-1 text-xs text-slate-500">
                    {v.thicknessMm}T · 제안 내측반경 {v.defaultInsideRadiusMm}mm
                  </p>
                </div>
                <div>
                  {v.publishedRule ? (
                    <>
                      <span className="rounded bg-teal-50 px-2 py-1 text-xs font-bold text-teal-700">
                        발행 r{v.publishedRule.revisionNumber}
                      </span>
                      <p className="mt-1 text-[11px] text-slate-500">
                        고정 내측반경 {v.publishedRule.insideBendRadiusMm}mm
                      </p>
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">
                      <CircleAlert className="h-3.5 w-3.5" />
                      계산 기준 필요
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/materials/${material.id}/variants/${v.id}/sheet-items`}
                    className="inline-flex items-center justify-center gap-1 rounded border border-sky-200 px-3 py-2 text-xs font-bold text-sky-800"
                  >
                    <Layers3 className="h-3.5 w-3.5" />
                    원판 품목
                  </Link>
                  <Link
                    href={`/materials/${material.id}/variants/${v.id}/rules`}
                    className="inline-flex items-center justify-center gap-1 rounded border border-teal-200 px-3 py-2 text-xs font-bold text-teal-800"
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                    계산 기준
                  </Link>
                  {canWrite ? (
                    <button
                      onClick={() => setDialog(v)}
                      className="inline-flex items-center justify-center gap-1 rounded border px-3 py-2 text-xs font-bold"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      수정
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      </TabPanel>
      <VariantDialog
        material={material}
        variant={dialog}
        onClose={() => setDialog(undefined)}
        onSaved={setMaterial}
      />
    </div>
  );
}

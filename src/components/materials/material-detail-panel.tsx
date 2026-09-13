"use client";
import { Check, CircleAlert, Layers3, Pencil, Plus, Settings2 } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useState, useTransition } from "react";
import { BackLink } from "@/components/ui/back-link";
import { CommonDialog, useCommonPopup } from "@/components/ui/common-popup";
import { TabPanel, Tabs } from "@/components/ui/tabs";
import type {
  MaterialDetailDto,
  MaterialVariantDto,
} from "@/server/materials/material-types";
import { materialRequest, MaterialRequestError } from "./material-api";
import { VariantWizardDialog } from "./variant-wizard-dialog";

const field = (data: FormData, name: string) =>
  String(data.get(name) ?? "").trim();
/** 두께 수정 팝업. 새 두께는 마법사(`VariantWizardDialog`)가 만든다. */
function VariantDialog({
  material,
  variant,
  onClose,
  onSaved,
}: {
  material: MaterialDetailDto;
  variant: MaterialVariantDto | undefined;
  onClose: () => void;
  onSaved: (value: MaterialDetailDto) => void;
}) {
  const popup = useCommonPopup();
  const [pending, startTransition] = useTransition();
  const open = variant !== undefined;
  const formId = `variant-${variant?.id ?? "none"}`;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!variant) return;
    const data = new FormData(event.currentTarget);
    const active = data.get("active") === "on";
    if (
      variant.active &&
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
        await materialRequest(`/api/v1/materials/${material.id}/variants/${variant.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            code: field(data, "code"),
            name: field(data, "name"),
            thicknessMm: field(data, "thickness"),
            defaultInsideRadiusMm: field(data, "radius"),
            sortOrder: Number(field(data, "sortOrder") || 0),
            active,
            expectedLockVersion: variant.lockVersion,
          }),
        });
        onClose();
        onSaved(await materialRequest<MaterialDetailDto>(`/api/v1/materials/${material.id}`));
      } catch (error) {
        await popup.alert({
          title: "저장 실패",
          message: error instanceof Error ? error.message : "두께를 저장하지 못했습니다.",
          variant: "danger",
        });
      }
    });
  }
  return (
    <CommonDialog
      open={open}
      onClose={onClose}
      title="두께 수정"
      description="두께와 코드는 등록 후 변경할 수 없습니다. 내측반경은 새 계산 기준의 제안값입니다."
      size="lg"
      footer={
        <>
          <button className="rounded border bg-white px-4 py-2 text-sm font-bold" onClick={onClose} disabled={pending} type="button">
            취소
          </button>
          <button form={formId} className="rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white" disabled={pending}>
            저장
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <label className="text-xs font-semibold text-slate-600">
          두께 코드
          <input className="field-control uppercase read-only:bg-slate-100" name="code" defaultValue={variant?.code ?? ""} readOnly required />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          표시 이름
          <input className="field-control" name="name" defaultValue={variant?.name ?? ""} required maxLength={100} />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          두께(mm)
          <input className="field-control read-only:bg-slate-100" name="thickness" defaultValue={variant?.thicknessMm ?? ""} readOnly required />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          기본 내측반경(mm)
          <input className="field-control" name="radius" defaultValue={variant?.defaultInsideRadiusMm ?? ""} required inputMode="decimal" pattern="[0-9]+([.][0-9]{1,3})?" />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          정렬 순서
          <input className="field-control" name="sortOrder" type="number" defaultValue={variant?.sortOrder ?? 0} />
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm font-semibold">
          <input name="active" type="checkbox" defaultChecked={variant?.active ?? true} />
          사용 중
        </label>
      </form>
    </CommonDialog>
  );
}

type VariantStage = "rule" | "review" | "publish" | "done";

/** 두께가 설계에서 쓰이기까지의 단계. 게시본이 있으면 끝, 없으면 진행 중 개정의 상태로 정한다. */
function stageOf(v: MaterialVariantDto): VariantStage {
  if (v.publishedRule) return "done";
  if (!v.openRule) return "rule";
  return v.openRule.status === "DRAFT" ? "review" : "publish";
}

const stageOrder: VariantStage[] = ["rule", "review", "publish", "done"];
const stageLabel: Record<VariantStage, string> = {
  rule: "계산 기준 작성",
  review: "검토 요청",
  publish: "게시",
  done: "설계 사용 가능",
};

/** 두께 행의 진행 표시. `두께 등록 ✓ · 계산 기준 · 검토 · 게시` 중 어디까지 왔는지 보여 준다. */
function StageTrack({ stage }: { stage: VariantStage }) {
  const reached = stageOrder.indexOf(stage);
  const steps = [
    { label: "두께 등록", done: true, active: false },
    ...(["rule", "review", "publish"] as const).map((key, index) => ({
      label: key === "rule" ? "계산 기준" : key === "review" ? "검토" : "게시",
      done: reached > index,
      active: reached === index,
    })),
  ];
  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] font-bold">
      {steps.map((step, index) => (
        <li className="flex items-center gap-1.5" key={step.label}>
          {index > 0 ? <span aria-hidden="true" className="h-px w-3 bg-slate-300" /> : null}
          <span
            className={`flex h-4 w-4 items-center justify-center rounded-full ${
              step.done ? "bg-teal-700 text-white" : step.active ? "border-2 border-amber-500" : "border border-slate-300"
            }`}
          >
            {step.done ? <Check className="h-2.5 w-2.5" /> : null}
          </span>
          <span className={step.done ? "text-teal-800" : step.active ? "text-amber-700" : "text-slate-400"}>{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

export function MaterialDetailPanel({
  initial,
  canWrite,
  canApprove,
  initialTab = "basic",
}: {
  initial: MaterialDetailDto;
  canWrite: boolean;
  canApprove: boolean;
  initialTab?: "basic" | "variants";
}) {
  const popup = useCommonPopup();
  const [material, setMaterial] = useState(initial);
  const [tab, setTab] = useState<string>(initialTab);
  const [dialog, setDialog] = useState<MaterialVariantDto | undefined>();
  /** 마법사: `null` 이면 새 두께, 두께가 있으면 그 두께의 계산 기준만 작성. `undefined` 는 닫힘. */
  const [wizard, setWizard] = useState<MaterialVariantDto | null | undefined>();
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();

  async function reload() {
    setMaterial(await materialRequest<MaterialDetailDto>(`/api/v1/materials/${material.id}`));
  }

  /** 두께 행의 "다음 단계" 버튼. 검토 요청·게시를 페이지 이동 없이 여기서 처리한다. */
  async function advance(v: MaterialVariantDto) {
    const stage = stageOf(v);
    if (stage === "rule") {
      setWizard(v);
      return;
    }
    if (!v.openRule) return;
    const ruleBase = `/api/v1/materials/${material.id}/variants/${v.id}/rules/${v.openRule.id}/transitions`;
    startTransition(async () => {
      try {
        let lockVersion = v.openRule!.lockVersion;
        if (stage === "review") {
          const reviewed = await materialRequest<{ lockVersion: number }>(ruleBase, {
            method: "POST",
            body: JSON.stringify({
              action: "review",
              expectedLockVersion: lockVersion,
              effectiveFrom: new Date().toISOString(),
              changeSummary: "최초 계산 기준 등록",
            }),
          });
          lockVersion = reviewed.lockVersion;
        }
        if (canApprove) {
          await materialRequest(ruleBase, {
            method: "POST",
            body: JSON.stringify({ action: "publish", expectedLockVersion: lockVersion }),
          });
          setNotice(`${v.name} 계산 기준을 게시했습니다. 이제 설계에서 선택할 수 있습니다.`);
        } else {
          setNotice(`${v.name} 계산 기준 검토를 요청했습니다. 승인자가 게시하면 설계에서 선택할 수 있습니다.`);
        }
        await reload();
      } catch (error) {
        await popup.alert({
          title: "처리 실패",
          message: error instanceof Error ? error.message : "상태를 변경하지 못했습니다.",
          variant: "danger",
        });
        await reload();
      }
    });
  }
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
        <BackLink href="/materials">재질 목록</BackLink>
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
              onClick={() => setWizard(null)}
              className="inline-flex items-center gap-2 rounded bg-teal-700 px-3 py-2 text-xs font-bold text-white"
            >
              <Plus className="h-4 w-4" />
              두께 추가
            </button>
          ) : null}
        </div>
        {notice ? (
          <p className="flex items-center gap-2 border-b border-teal-100 bg-teal-50 px-5 py-2.5 text-sm text-teal-900" role="status">
            <Check className="h-4 w-4 shrink-0" />
            {notice}
          </p>
        ) : null}
        {material.variants.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <CircleAlert className="mx-auto h-7 w-7 text-amber-400" />
            <p className="mt-2 text-sm font-bold">등록된 두께가 없습니다.</p>
            <p className="mt-1 text-xs text-slate-500">
              `두께 추가` 에서 두께 정보와 계산 기준을 한 번에 등록하면 바로 설계에서 쓸 수 있습니다.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {material.variants.map((v) => (
              <div
                key={v.id}
                className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)_auto] sm:items-center"
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
                  <StageTrack stage={stageOf(v)} />
                  <p className="mt-1.5 text-[11px] text-slate-500">
                    {v.publishedRule
                      ? `게시 r${v.publishedRule.revisionNumber} · 고정 내측반경 ${v.publishedRule.insideBendRadiusMm}mm${v.openRule ? ` · 새 개정 r${v.openRule.revisionNumber} ${v.openRule.status === "DRAFT" ? "초안" : "검토 중"}` : ""}`
                      : stageOf(v) === "rule"
                        ? "계산 기준이 없어 설계에서 선택할 수 없습니다."
                        : stageOf(v) === "review"
                          ? `초안 r${v.openRule!.revisionNumber} 작성됨 · 검토 요청이 남았습니다.`
                          : canApprove
                            ? `r${v.openRule!.revisionNumber} 검토 중 · 게시하면 설계에서 선택할 수 있습니다.`
                            : `r${v.openRule!.revisionNumber} 검토 중 · 승인자의 게시를 기다립니다.`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canWrite && stageOf(v) !== "done" && (stageOf(v) !== "publish" || canApprove) ? (
                    <button
                      className="inline-flex items-center justify-center gap-1 rounded bg-teal-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                      disabled={pending}
                      onClick={() => void advance(v)}
                      type="button"
                    >
                      {stageOf(v) === "rule"
                        ? stageLabel.rule
                        : stageOf(v) === "review" && canApprove
                          ? "검토 요청 후 게시"
                          : stageLabel[stageOf(v)]}
                    </button>
                  ) : null}
                  <Link
                    href={`/materials/${material.id}/variants/${v.id}/rules`}
                    className="inline-flex items-center justify-center gap-1 rounded border border-teal-200 px-3 py-2 text-xs font-bold text-teal-800"
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                    계산 기준
                  </Link>
                  <Link
                    href={`/materials/${material.id}/variants/${v.id}/sheet-items`}
                    className="inline-flex items-center justify-center gap-1 rounded border border-sky-200 px-3 py-2 text-xs font-bold text-sky-800"
                  >
                    <Layers3 className="h-3.5 w-3.5" />
                    원판 품목
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
        onSaved={(value) => {
          setMaterial(value);
          setNotice("두께 정보를 저장했습니다.");
        }}
      />
      {wizard !== undefined ? (
        <VariantWizardDialog
          canApprove={canApprove}
          material={material}
          onClose={() => setWizard(undefined)}
          onDone={async (message) => {
            setWizard(undefined);
            setNotice(message);
            await reload();
          }}
          variant={wizard}
        />
      ) : null}
    </div>
  );
}

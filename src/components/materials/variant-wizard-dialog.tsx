"use client";

import { Check, CircleAlert, Loader2 } from "lucide-react";
import { type FormEvent, useState } from "react";

import { CommonDialog } from "@/components/ui/common-popup";
import { fromDateTimeLocalInput, toDateTimeLocalInput } from "@/domain/format-date";
import type { MaterialRuleFields } from "@/server/material-rules/material-rule-types";
import type { MaterialDetailDto, MaterialVariantDto } from "@/server/materials/material-types";

import { materialRequest } from "./material-api";
import { blankFields, RuleFieldsForm, valuesFromForm } from "./rule-fields-form";

const field = (data: FormData, name: string) => String(data.get(name) ?? "").trim();

type VariantDraft = {
  code: string;
  name: string;
  thicknessMm: string;
  defaultInsideRadiusMm: string;
  sortOrder: number;
};

type Step = 1 | 2 | 3;

const stepLabels: Record<Step, string> = { 1: "두께 정보", 2: "계산 기준", 3: "확인·게시" };

/** 팝업 상단의 진행 표시. 어느 단계에 있고 몇 단계가 남았는지 한눈에 보인다. */
function StepHeader({ current, skipFirst }: { current: Step; skipFirst: boolean }) {
  const steps = (skipFirst ? [2, 3] : [1, 2, 3]) as Step[];
  return (
    <ol className="flex items-center gap-2 text-xs font-bold">
      {steps.map((step, index) => {
        const done = step < current;
        const active = step === current;
        return (
          <li className="flex items-center gap-2" key={step}>
            {index > 0 ? <span className="h-px w-6 bg-slate-300" aria-hidden="true" /> : null}
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${
                done ? "bg-teal-700 text-white" : active ? "border-2 border-teal-700 text-teal-800" : "border border-slate-300 text-slate-400"
              }`}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <span className={active ? "text-slate-900" : done ? "text-teal-800" : "text-slate-400"}>{stepLabels[step]}</span>
          </li>
        );
      })}
    </ol>
  );
}

type RunState = { label: string; status: "pending" | "running" | "done" | "failed" }[];

/**
 * 두께 등록 마법사. 두께 정보 → 계산 기준 → 확인·게시를 한 팝업에서 끝낸다.
 * 이미 있는 두께(`variant`)에 계산 기준만 붙일 때는 1단계를 건너뛴다.
 * 승인 권한(`canApprove`)이 있으면 검토 요청과 게시까지 한 번에 한다.
 */
export function VariantWizardDialog({
  material,
  variant,
  canApprove,
  onClose,
  onDone,
}: {
  material: MaterialDetailDto;
  /** 계산 기준만 붙일 기존 두께. 없으면 새 두께부터 만든다. */
  variant: MaterialVariantDto | null;
  canApprove: boolean;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const skipFirst = variant !== null;
  const [step, setStep] = useState<Step>(skipFirst ? 2 : 1);
  const [draft, setDraft] = useState<VariantDraft>(
    variant
      ? { code: variant.code, name: variant.name, thicknessMm: variant.thicknessMm, defaultInsideRadiusMm: variant.defaultInsideRadiusMm, sortOrder: variant.sortOrder }
      : { code: "", name: "", thicknessMm: "", defaultInsideRadiusMm: "", sortOrder: 0 },
  );
  const [rule, setRule] = useState<MaterialRuleFields | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState(() => toDateTimeLocalInput(new Date()));
  const [run, setRun] = useState<RunState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const base = `/api/v1/materials/${material.id}/variants`;

  function submitVariant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setDraft({
      code: field(data, "code").toUpperCase(),
      name: field(data, "name"),
      thicknessMm: field(data, "thickness"),
      defaultInsideRadiusMm: field(data, "radius"),
      sortOrder: Number(field(data, "sortOrder") || 0),
    });
    setError("");
    if ((event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "only") {
      void createVariantOnly(data);
      return;
    }
    setStep(2);
  }

  async function createVariantOnly(data: FormData) {
    setBusy(true);
    try {
      await materialRequest(base, {
        method: "POST",
        body: JSON.stringify({
          code: field(data, "code"),
          name: field(data, "name"),
          thicknessMm: field(data, "thickness"),
          defaultInsideRadiusMm: field(data, "radius"),
          sortOrder: Number(field(data, "sortOrder") || 0),
        }),
      });
      await onDone("두께를 등록했습니다. 계산 기준을 작성하고 게시해야 설계에서 선택할 수 있습니다.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "두께를 등록하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function submitRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRule(valuesFromForm(new FormData(event.currentTarget)));
    setError("");
    setStep(3);
  }

  /** 마지막 단계. 실패하면 어디까지 됐는지 그대로 보여 주고, 닫으면 두께 행이 그 다음 단계를 안내한다. */
  async function finish() {
    if (!rule) return;
    const plan: RunState = [
      ...(skipFirst ? [] : [{ label: "두께 등록", status: "pending" as const }]),
      { label: "계산 기준 초안 저장", status: "pending" },
      { label: "검토 요청", status: "pending" },
      ...(canApprove ? [{ label: "게시", status: "pending" as const }] : []),
    ];
    setRun(plan);
    setError("");
    setBusy(true);
    // 단계 번호를 인자로 넘긴다. 상태 갱신이 배치되면 클로저의 카운터는 이미 바뀐 뒤라 어긋난다.
    let index = 0;
    const mark = (at: number, status: "running" | "done" | "failed") =>
      setRun((current) => current?.map((item, i) => (i === at ? { ...item, status } : item)) ?? null);
    try {
      let variantId = variant?.id;
      if (!skipFirst) {
        mark(index, "running");
        const created = await materialRequest<{ id: string }>(base, {
          method: "POST",
          body: JSON.stringify({ ...draft }),
        });
        variantId = created.id;
        mark(index, "done");
        index += 1;
      }
      mark(index, "running");
      const ruleBase = `${base}/${variantId}/rules`;
      const createdRule = await materialRequest<{ id: string; lockVersion: number }>(ruleBase, {
        method: "POST",
        body: JSON.stringify({
          ...rule,
          // 검토 요청은 변경 요약이 있어야 한다. 마법사에서 비워 두면 최초 등록으로 적는다.
          changeSummary: rule.changeSummary ?? "최초 계산 기준 등록",
          sourceRuleRevisionId: null,
        }),
      });
      mark(index, "done");
      index += 1;

      mark(index, "running");
      const reviewed = await materialRequest<{ lockVersion: number }>(`${ruleBase}/${createdRule.id}/transitions`, {
        method: "POST",
        body: JSON.stringify({
          action: "review",
          expectedLockVersion: createdRule.lockVersion,
          effectiveFrom: fromDateTimeLocalInput(effectiveFrom),
        }),
      });
      mark(index, "done");
      index += 1;

      if (canApprove) {
        mark(index, "running");
        await materialRequest(`${ruleBase}/${createdRule.id}/transitions`, {
          method: "POST",
          body: JSON.stringify({ action: "publish", expectedLockVersion: reviewed.lockVersion }),
        });
        mark(index, "done");
      }
      await onDone(
        canApprove
          ? `${draft.name} 두께를 등록하고 계산 기준을 게시했습니다. 이제 설계에서 선택할 수 있습니다.`
          : `${draft.name} 두께를 등록하고 검토를 요청했습니다. 승인자가 게시하면 설계에서 선택할 수 있습니다.`,
      );
    } catch (caught) {
      mark(index, "failed");
      setError(
        `${caught instanceof Error ? caught.message : "처리하지 못했습니다."} 완료된 단계는 저장되어 있으니 닫은 뒤 두께 행의 다음 단계 버튼으로 이어서 진행해 주세요.`,
      );
    } finally {
      setBusy(false);
    }
  }

  const title = skipFirst ? `${variant.name} 계산 기준 작성` : "두께 추가";

  return (
    <CommonDialog
      description={
        step === 1
          ? "두께와 코드는 등록 후 변경할 수 없습니다. 계산값을 아직 모르면 두께만 먼저 등록할 수 있습니다."
          : step === 2
            ? "입력값은 mm 기준이며 0은 유효 값입니다. 게시 후에는 새 개정으로만 바꿀 수 있습니다."
            : canApprove
              ? "아래 내용으로 등록하고 바로 게시합니다. 게시되면 설계 화면에서 이 두께를 선택할 수 있습니다."
              : "아래 내용으로 등록하고 검토를 요청합니다. 승인 권한이 있는 사용자가 게시하면 설계에서 선택할 수 있습니다."
      }
      footer={
        step === 1 ? (
          <>
            <button className="rounded border bg-white px-4 py-2 text-sm font-bold" disabled={busy} onClick={onClose} type="button">
              취소
            </button>
            <button className="rounded border border-teal-700 bg-white px-4 py-2 text-sm font-bold text-teal-800 disabled:opacity-50" disabled={busy} form="variant-wizard-step1" type="submit" value="only">
              두께만 등록
            </button>
            <button className="rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={busy} form="variant-wizard-step1" type="submit" value="next">
              다음: 계산 기준
            </button>
          </>
        ) : step === 2 ? (
          <>
            {skipFirst ? (
              <button className="rounded border bg-white px-4 py-2 text-sm font-bold" onClick={onClose} type="button">취소</button>
            ) : (
              <button className="rounded border bg-white px-4 py-2 text-sm font-bold" onClick={() => setStep(1)} type="button">이전</button>
            )}
            <button className="rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white" form="variant-wizard-step2" type="submit">
              다음: 확인
            </button>
          </>
        ) : (
          <>
            <button className="rounded border bg-white px-4 py-2 text-sm font-bold" disabled={busy} onClick={() => setStep(2)} type="button">
              이전
            </button>
            <button className="inline-flex items-center gap-2 rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={busy || run?.some((item) => item.status === "failed")} onClick={() => void finish()} type="button">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {canApprove ? "등록하고 게시" : "등록하고 검토 요청"}
            </button>
          </>
        )
      }
      onClose={onClose}
      open
      size="xl"
      title={title}
    >
      <div className="space-y-5">
        <StepHeader current={step} skipFirst={skipFirst} />

        {step === 1 ? (
          <form className="grid gap-4 sm:grid-cols-2" id="variant-wizard-step1" onSubmit={submitVariant}>
            <label className="text-xs font-semibold text-slate-600">
              두께 코드
              <input autoFocus className="field-control uppercase" defaultValue={draft.code} name="code" pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,49}" placeholder="AL-1T" required />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              표시 이름
              <input className="field-control" defaultValue={draft.name} maxLength={100} name="name" placeholder="알루미늄 1T" required />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              두께(mm)
              <input className="field-control" defaultValue={draft.thicknessMm} inputMode="decimal" name="thickness" pattern="[0-9]+([.][0-9]{1,3})?" required />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              기본 내측반경(mm)
              <input className="field-control" defaultValue={draft.defaultInsideRadiusMm} inputMode="decimal" name="radius" pattern="[0-9]+([.][0-9]{1,3})?" required />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              정렬 순서
              <input className="field-control" defaultValue={draft.sortOrder} name="sortOrder" type="number" />
            </label>
          </form>
        ) : null}

        {step === 2 ? (
          <form id="variant-wizard-step2" onSubmit={submitRule}>
            <p className="mb-4 rounded bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <b>{draft.name}</b> · {draft.thicknessMm}T · 제안 내측반경 {draft.defaultInsideRadiusMm}mm
            </p>
            <RuleFieldsForm value={rule ?? { ...blankFields(draft.defaultInsideRadiusMm), changeSummary: "최초 계산 기준 등록" }} />
          </form>
        ) : null}

        {step === 3 && rule ? (
          <div className="space-y-4">
            <dl className="grid gap-x-6 gap-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs font-bold text-slate-500">두께</dt><dd>{draft.name} · {draft.code} · {draft.thicknessMm}T</dd></div>
              <div><dt className="text-xs font-bold text-slate-500">계산 방식</dt><dd>{rule.calculationMode === "FIXED" ? "FIX 고정값" : "RATIO 비율"} · 제한각 {rule.cutAngleDeg}° · 내측반경 {rule.insideBendRadiusMm}mm</dd></div>
              <div><dt className="text-xs font-bold text-slate-500">FIX 연신값 (V / A·U / NO)</dt><dd className="font-mono">{rule.elongationVCutMm} / {rule.elongationACutMm} / {rule.elongationNoCutMm}</dd></div>
              <div><dt className="text-xs font-bold text-slate-500">RATIO 컷 깊이 (V / A·U / NO)</dt><dd className="font-mono">{rule.cutDepthVCutMm} / {rule.cutDepthACutMm} / {rule.cutDepthNoCutMm}</dd></div>
            </dl>
            <label className="block text-xs font-bold text-slate-600 sm:w-72">
              효력 시작 시각
              <input className="field-control" onChange={(event) => setEffectiveFrom(event.target.value)} required type="datetime-local" value={effectiveFrom} />
              <span className="mt-1 block text-[11px] font-normal text-slate-500">지금 시각이면 바로 적용됩니다. 나중 시각을 주면 그때부터 적용됩니다.</span>
            </label>
            {run ? (
              <ol className="space-y-1.5 rounded-lg border border-slate-200 p-4 text-sm">
                {run.map((item) => (
                  <li className="flex items-center gap-2" key={item.label}>
                    {item.status === "done" ? <Check className="h-4 w-4 text-teal-700" /> : item.status === "running" ? <Loader2 className="h-4 w-4 animate-spin text-teal-700" /> : item.status === "failed" ? <CircleAlert className="h-4 w-4 text-red-700" /> : <span className="h-4 w-4 rounded-full border border-slate-300" />}
                    <span className={item.status === "pending" ? "text-slate-400" : ""}>{item.label}</span>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="text-sm font-semibold text-red-700">{error}</p> : null}
      </div>
    </CommonDialog>
  );
}

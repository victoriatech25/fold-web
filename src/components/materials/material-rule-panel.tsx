"use client";

import {
  ArrowLeft,
  Calculator,
  CheckCircle2,
  Clock3,
  CopyPlus,
  Eye,
  FileCheck2,
  Pencil,
  RotateCcw,
  Send,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, useMemo, useState, useTransition } from "react";

import { CommonDialog, useCommonPopup } from "@/components/ui/common-popup";
import { TabPanel, Tabs } from "@/components/ui/tabs";
import type {
  MaterialRuleFields,
  MaterialRulePreviewDto,
  MaterialRuleRevisionDto,
  MaterialRuleTransitionAction,
  MaterialRuleWorkspaceDto,
} from "@/server/material-rules/material-rule-types";

import { materialRequest, MaterialRequestError } from "./material-api";

const statusLabel = {
  DRAFT: "초안",
  REVIEW: "검토 중",
  SCHEDULED: "예약",
  ACTIVE: "사용 중",
  EXPIRED: "기간 종료",
  RETIRED: "사용 종료",
} as const;
const statusColor = {
  DRAFT: "bg-slate-100 text-slate-700",
  REVIEW: "bg-blue-100 text-blue-800",
  SCHEDULED: "bg-violet-100 text-violet-800",
  ACTIVE: "bg-teal-100 text-teal-800",
  EXPIRED: "bg-amber-100 text-amber-800",
  RETIRED: "bg-slate-200 text-slate-600",
} as const;
const field = (data: FormData, name: string) =>
  String(data.get(name) ?? "").trim();
const decimalPattern = "[0-9]+([.][0-9]{1,6})?";
const dateText = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("ko-KR", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "미정";
const localDateTime = (date = new Date()) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

function valuesFromForm(data: FormData): MaterialRuleFields {
  return {
    calculationMode: field(
      data,
      "calculationMode",
    ) as MaterialRuleFields["calculationMode"],
    elongationOption: field(
      data,
      "elongationOption",
    ) as MaterialRuleFields["elongationOption"],
    vCutEnabled: data.get("vCutEnabled") === "on",
    decimalPlaces: Number(field(data, "decimalPlaces")),
    decimalOperation: field(
      data,
      "decimalOperation",
    ) as MaterialRuleFields["decimalOperation"],
    cutAngleDeg: field(data, "cutAngleDeg"),
    insideBendRadiusMm: field(data, "insideBendRadiusMm"),
    elongationVCutMm: field(data, "elongationVCutMm"),
    elongationACutMm: field(data, "elongationACutMm"),
    elongationNoCutMm: field(data, "elongationNoCutMm"),
    cutDepthVCutMm: field(data, "cutDepthVCutMm"),
    cutDepthACutMm: field(data, "cutDepthACutMm"),
    cutDepthNoCutMm: field(data, "cutDepthNoCutMm"),
    changeSummary: field(data, "changeSummary") || null,
  };
}

function blankFields(radius: string): MaterialRuleFields {
  return {
    calculationMode: "FIXED",
    elongationOption: "STANDARD",
    vCutEnabled: true,
    decimalPlaces: 1,
    decimalOperation: "ROUND",
    cutAngleDeg: "",
    insideBendRadiusMm: radius,
    elongationVCutMm: "",
    elongationACutMm: "",
    elongationNoCutMm: "",
    cutDepthVCutMm: "",
    cutDepthACutMm: "",
    cutDepthNoCutMm: "",
    changeSummary: null,
  };
}

function copyFields(rule: MaterialRuleRevisionDto): MaterialRuleFields {
  return {
    calculationMode: rule.calculationMode,
    elongationOption: rule.elongationOption,
    vCutEnabled: rule.vCutEnabled,
    decimalPlaces: rule.decimalPlaces,
    decimalOperation: rule.decimalOperation,
    cutAngleDeg: rule.cutAngleDeg,
    insideBendRadiusMm: rule.insideBendRadiusMm,
    elongationVCutMm: rule.elongationVCutMm,
    elongationACutMm: rule.elongationACutMm,
    elongationNoCutMm: rule.elongationNoCutMm,
    cutDepthVCutMm: rule.cutDepthVCutMm,
    cutDepthACutMm: rule.cutDepthACutMm,
    cutDepthNoCutMm: rule.cutDepthNoCutMm,
    changeSummary: null,
  };
}

function DecimalInput({
  label,
  name,
  value,
}: {
  label: string;
  name: string;
  value: string;
}) {
  return (
    <label className="text-xs font-bold text-slate-600">
      {label}
      <input
        className="field-control font-mono"
        defaultValue={value}
        inputMode="decimal"
        name={name}
        pattern={decimalPattern}
        required
      />
    </label>
  );
}

function RuleEditorDialog({
  open,
  value,
  sourceRuleId,
  onClose,
  onSaved,
  workspace,
}: {
  open: boolean;
  value: MaterialRuleFields & {
    id?: string;
    lockVersion?: number;
    revisionNumber?: number;
  };
  sourceRuleId: string | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  workspace: MaterialRuleWorkspaceDto;
}) {
  const popup = useCommonPopup();
  const [pending, startTransition] = useTransition();
  const editing = Boolean(value.id);
  const formId = editing ? `material-rule-${value.id}` : "material-rule-new";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = valuesFromForm(new FormData(event.currentTarget));
    startTransition(async () => {
      try {
        const base = `/api/v1/materials/${workspace.material.id}/variants/${workspace.variant.id}/rules`;
        await materialRequest(editing ? `${base}/${value.id}` : base, {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify(
            editing
              ? { ...body, expectedLockVersion: value.lockVersion }
              : { ...body, sourceRuleRevisionId: sourceRuleId },
          ),
        });
        onClose();
        await onSaved();
        await popup.alert({
          title: "저장 완료",
          message: editing
            ? "계산 규칙 초안을 저장했습니다."
            : "새 계산 규칙 초안을 만들었습니다.",
        });
      } catch (error) {
        await popup.alert({
          title: "저장 실패",
          message:
            error instanceof Error
              ? error.message
              : "계산 규칙을 저장하지 못했습니다.",
          variant: "danger",
        });
        if (error instanceof MaterialRequestError && error.code === "CONFLICT")
          await onSaved();
      }
    });
  }
  return (
    <CommonDialog
      open={open}
      onClose={onClose}
      title={
        editing
          ? `계산 규칙 r${value.revisionNumber} 수정`
          : sourceRuleId
            ? "게시본에서 새 개정 만들기"
            : "최초 계산 규칙 만들기"
      }
      description="입력값은 mm 기준이며 0은 유효 값입니다. 게시 후에는 직접 수정할 수 없습니다."
      size="xl"
      footer={
        <>
          <button
            type="button"
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
            초안 저장
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-5">
        <section className="grid gap-4 rounded-lg bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-bold text-slate-600">
            계산 방식
            <select
              className="field-control bg-white"
              name="calculationMode"
              defaultValue={value.calculationMode}
            >
              <option value="FIXED">FIX 고정값</option>
              <option value="RATIO">RATIO 비율</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-600">
            FIX 적용 옵션
            <select
              className="field-control bg-white"
              name="elongationOption"
              defaultValue={value.elongationOption}
            >
              <option value="STANDARD">표준 · 항상 적용</option>
              <option value="TWO_LINE">2선 · 제한각 미만</option>
              <option value="DIAGONAL">대각선 우선</option>
              <option value="EXT1">확장1 · 앞각 우선</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-600">
            소수 처리
            <select
              className="field-control bg-white"
              name="decimalOperation"
              defaultValue={value.decimalOperation}
            >
              <option value="NONE">처리 안 함</option>
              <option value="ROUND">반올림</option>
              <option value="FLOOR">버림</option>
              <option value="CEIL">올림</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-600">
            소수 자릿수
            <select
              className="field-control bg-white"
              name="decimalPlaces"
              defaultValue={value.decimalPlaces}
            >
              {[0, 1, 2, 3, 4, 5, 6].map((item) => (
                <option key={item} value={item}>
                  {item}자리
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm font-bold sm:col-span-2 lg:col-span-4">
            <input
              type="checkbox"
              name="vCutEnabled"
              defaultChecked={value.vCutEnabled}
            />
            V-CUT 사용
          </label>
        </section>
        <section>
          <h3 className="mb-3 text-sm font-black">공통 형상 기준</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <DecimalInput
              label="제한각(°) · 미만만 적용"
              name="cutAngleDeg"
              value={value.cutAngleDeg}
            />
            <DecimalInput
              label="내측 절곡 반경(mm)"
              name="insideBendRadiusMm"
              value={value.insideBendRadiusMm}
            />
          </div>
        </section>
        <section>
          <h3 className="mb-3 text-sm font-black">FIX 연신값(mm)</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <DecimalInput
              label="V-CUT"
              name="elongationVCutMm"
              value={value.elongationVCutMm}
            />
            <DecimalInput
              label="A/U-CUT"
              name="elongationACutMm"
              value={value.elongationACutMm}
            />
            <DecimalInput
              label="NO-CUT"
              name="elongationNoCutMm"
              value={value.elongationNoCutMm}
            />
          </div>
        </section>
        <section>
          <h3 className="mb-3 text-sm font-black">RATIO 컷 깊이(mm)</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <DecimalInput
              label="V-CUT"
              name="cutDepthVCutMm"
              value={value.cutDepthVCutMm}
            />
            <DecimalInput
              label="A/U-CUT"
              name="cutDepthACutMm"
              value={value.cutDepthACutMm}
            />
            <DecimalInput
              label="NO-CUT"
              name="cutDepthNoCutMm"
              value={value.cutDepthNoCutMm}
            />
          </div>
        </section>
        <label className="block text-xs font-bold text-slate-600">
          변경 요약
          <textarea
            className="mt-1.5 min-h-20 w-full rounded border border-slate-300 p-3 text-sm"
            name="changeSummary"
            defaultValue={value.changeSummary ?? ""}
            maxLength={500}
            placeholder="검토자가 이해할 수 있도록 변경 목적을 기록합니다."
          />
        </label>
      </form>
    </CommonDialog>
  );
}

function ReviewDialog({
  rule,
  onClose,
  onSubmit,
  pending,
}: {
  rule: MaterialRuleRevisionDto | null;
  onClose: () => void;
  onSubmit: (iso: string) => void;
  pending: boolean;
}) {
  const formId = "material-rule-review";
  return (
    <CommonDialog
      open={Boolean(rule)}
      onClose={onClose}
      title="검토 요청"
      description="검토가 시작되면 계산값을 수정할 수 없습니다. 수정하려면 반려 후 다시 저장해야 합니다."
      footer={
        <>
          <button
            type="button"
            className="rounded border bg-white px-4 py-2 text-sm font-bold"
            onClick={onClose}
          >
            취소
          </button>
          <button
            form={formId}
            className="rounded bg-blue-700 px-4 py-2 text-sm font-bold text-white"
            disabled={pending}
          >
            검토 요청
          </button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          const value = field(
            new FormData(event.currentTarget),
            "effectiveFrom",
          );
          onSubmit(new Date(value).toISOString());
        }}
      >
        <label className="text-sm font-bold text-slate-700">
          효력 시작 시각
          <input
            className="field-control"
            type="datetime-local"
            name="effectiveFrom"
            defaultValue={localDateTime()}
            required
          />
        </label>
        <p className="mt-3 rounded bg-amber-50 p-3 text-xs leading-5 text-amber-800">
          미래 시각을 지정하면 예약 게시됩니다. 게시할 때 기존 게시본의 종료
          시각이 자동으로 연결됩니다.
        </p>
      </form>
    </CommonDialog>
  );
}

function PreviewDialog({
  preview,
  onClose,
}: {
  preview: MaterialRulePreviewDto | null;
  onClose: () => void;
}) {
  return (
    <CommonDialog
      open={Boolean(preview)}
      onClose={onClose}
      title="계산 영향 미리보기"
      description="현재 웹 계산 엔진의 대표 표본 비교이며 실제 제작 공차 승인을 대신하지 않습니다."
      size="xl"
      footer={
        <button
          className="rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white"
          onClick={onClose}
        >
          확인
        </button>
      }
    >
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="p-3">표본</th>
              <th className="p-3">현재 전개폭</th>
              <th className="p-3">작성본 전개폭</th>
              <th className="p-3">작성본 보정</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {preview?.cases.map((item) => (
              <tr key={item.key}>
                <th className="p-3 font-bold text-slate-800">{item.label}</th>
                <td className="p-3 font-mono">
                  {item.currentWidthMm ?? "—"} mm
                </td>
                <td className="p-3 font-mono font-bold text-teal-700">
                  {item.candidateWidthMm} mm
                </td>
                <td className="p-3 font-mono">
                  {item.candidateCorrectionMm} mm
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CommonDialog>
  );
}

export function MaterialRulePanel({
  initial,
  canWrite,
  canApprove,
}: {
  initial: MaterialRuleWorkspaceDto;
  canWrite: boolean;
  canApprove: boolean;
}) {
  const popup = useCommonPopup();
  const [workspace, setWorkspace] = useState(initial);
  const [tab, setTab] = useState("revisions");
  const [editor, setEditor] = useState<{
    value: MaterialRuleFields & {
      id?: string;
      lockVersion?: number;
      revisionNumber?: number;
    };
    sourceRuleId: string | null;
  } | null>(null);
  const [reviewRule, setReviewRule] = useState<MaterialRuleRevisionDto | null>(
    null,
  );
  const [preview, setPreview] = useState<MaterialRulePreviewDto | null>(null);
  const [pending, startTransition] = useTransition();
  const base = `/api/v1/materials/${workspace.material.id}/variants/${workspace.variant.id}/rules`;
  const current =
    workspace.revisions.find((item) => item.id === workspace.currentRuleId) ??
    null;
  const open =
    workspace.revisions.find((item) => item.id === workspace.openRuleId) ??
    null;
  const scheduled =
    workspace.revisions.find((item) => item.id === workspace.scheduledRuleId) ??
    null;
  const newestPublished = useMemo(
    () =>
      workspace.revisions.find((item) => item.status === "PUBLISHED") ?? null,
    [workspace.revisions],
  );
  async function refresh() {
    setWorkspace(await materialRequest<MaterialRuleWorkspaceDto>(base));
  }
  function openNew() {
    const source = current ?? newestPublished;
    setEditor({
      value: source
        ? copyFields(source)
        : blankFields(workspace.variant.defaultInsideRadiusMm),
      sourceRuleId: source?.id ?? null,
    });
  }
  async function transition(
    rule: MaterialRuleRevisionDto,
    action: MaterialRuleTransitionAction,
    extra: Record<string, unknown> = {},
  ) {
    startTransition(async () => {
      try {
        await materialRequest(`${base}/${rule.id}/transitions`, {
          method: "POST",
          body: JSON.stringify({
            action,
            expectedLockVersion: rule.lockVersion,
            ...extra,
          }),
        });
        setReviewRule(null);
        await refresh();
        await popup.alert({
          title: "처리 완료",
          message: {
            review: "검토를 요청했습니다.",
            return: "수정 반려했습니다.",
            publish: "계산 규칙을 게시했습니다.",
            retire: "계산 규칙 사용을 종료했습니다.",
            discard: "초안을 폐기했습니다.",
          }[action],
        });
      } catch (error) {
        await popup.alert({
          title: "처리 실패",
          message:
            error instanceof Error
              ? error.message
              : "상태를 변경하지 못했습니다.",
          variant: "danger",
        });
        if (error instanceof MaterialRequestError && error.code === "CONFLICT")
          await refresh();
      }
    });
  }
  async function returnRule(rule: MaterialRuleRevisionDto) {
    const reason = await popup.prompt({
      title: "수정 반려",
      message: "작성자가 수정할 내용을 구체적으로 입력해 주세요.",
      inputLabel: "반려 사유",
      required: true,
      maxLength: 500,
      confirmText: "반려",
      variant: "warning",
    });
    if (reason !== null) await transition(rule, "return", { reason });
  }
  async function retireRule(rule: MaterialRuleRevisionDto) {
    const reason = await popup.prompt({
      title:
        rule.effectiveStatus === "SCHEDULED"
          ? "예약 게시 취소"
          : "계산 규칙 사용 종료",
      message:
        rule.effectiveStatus === "SCHEDULED"
          ? "예약을 취소하면 직전 게시본의 적용 종료 시각이 복원됩니다."
          : "새 도면에서 이 규칙을 더 이상 선택할 수 없게 됩니다.",
      inputLabel: "처리 사유",
      required: true,
      maxLength: 500,
      confirmText:
        rule.effectiveStatus === "SCHEDULED" ? "예약 취소" : "사용 종료",
      variant: "warning",
    });
    if (reason !== null) await transition(rule, "retire", { reason });
  }
  async function publish(rule: MaterialRuleRevisionDto) {
    if (
      await popup.confirm({
        title: "계산 규칙 게시",
        message: `r${rule.revisionNumber}을 ${dateText(rule.effectiveFrom)}부터 적용합니다. 기존 게시본의 종료 시각도 함께 조정됩니다.`,
        confirmText: "게시",
        variant: "warning",
      })
    )
      await transition(rule, "publish");
  }
  async function discard(rule: MaterialRuleRevisionDto) {
    if (
      await popup.confirm({
        title: "초안 폐기",
        message: "이 초안은 복구할 수 없습니다.",
        confirmText: "폐기",
        variant: "danger",
      })
    )
      await transition(rule, "discard");
  }
  async function showPreview(rule: MaterialRuleRevisionDto) {
    startTransition(async () => {
      try {
        setPreview(
          await materialRequest<MaterialRulePreviewDto>(
            `${base}/${rule.id}/preview`,
            { method: "POST" },
          ),
        );
      } catch (error) {
        await popup.alert({
          title: "미리보기 실패",
          message:
            error instanceof Error
              ? error.message
              : "계산 미리보기를 만들지 못했습니다.",
          variant: "danger",
        });
      }
    });
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/materials/${workspace.material.id}`}
            className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            재질 상세
          </Link>
          <h1 className="mt-2 text-xl font-black">
            {workspace.variant.name} 계산 기준
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            {workspace.material.name} · {workspace.variant.thicknessMm}T ·{" "}
            {workspace.variant.code}
          </p>
        </div>
        {canWrite ? (
          <button
            onClick={
              open?.status === "DRAFT"
                ? () => setEditor({ value: { ...open }, sourceRuleId: null })
                : openNew
            }
            disabled={Boolean(open && open.status !== "DRAFT")}
            className="inline-flex items-center gap-2 rounded bg-teal-700 px-4 py-2.5 text-sm font-bold text-white disabled:bg-slate-300"
          >
            {open?.status === "DRAFT" ? (
              <>
                <Pencil className="h-4 w-4" />
                초안 계속 작성
              </>
            ) : (
              <>
                <CopyPlus className="h-4 w-4" />새 개정 만들기
              </>
            )}
          </button>
        ) : null}
      </div>
      <section className="grid gap-3 md:grid-cols-3">
        <SummaryCard
          title="현재 적용"
          value={current ? `r${current.revisionNumber}` : "없음"}
          detail={
            current
              ? current.effectiveFrom
                ? `${dateText(current.effectiveFrom)}부터`
                : "기존 게시 기준"
              : "설계 선택 불가"
          }
          tone={current ? "teal" : "amber"}
        />
        <SummaryCard
          title="예약 게시"
          value={scheduled ? `r${scheduled.revisionNumber}` : "없음"}
          detail={
            scheduled ? dateText(scheduled.effectiveFrom) : "예약된 변경 없음"
          }
        />
        <SummaryCard
          title="진행 중"
          value={
            open
              ? `r${open.revisionNumber} · ${statusLabel[open.effectiveStatus]}`
              : "없음"
          }
          detail={open?.changeSummary ?? "작성·검토 중인 개정 없음"}
        />
      </section>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <Tabs
          ariaLabel="계산 기준 상세"
          onChange={setTab}
          tabs={[
            { id: "revisions", label: "개정 이력", badge: workspace.revisions.length },
            { id: "audit", label: "처리 이력" },
          ]}
          value={tab}
        />
      </div>

      <TabPanel id="revisions" value={tab}>
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b px-5 py-4">
          <h2 className="font-black">개정 이력</h2>
          <p className="mt-1 text-xs text-slate-500">
            게시된 값은 읽기 전용이며 변경할 때 새 개정을 만듭니다.
          </p>
        </div>
        <div className="divide-y divide-slate-100">
          {workspace.revisions.length === 0 ? (
            <div className="p-10 text-center">
              <Calculator className="mx-auto h-7 w-7 text-amber-400" />
              <p className="mt-2 text-sm font-bold">계산 기준이 없습니다.</p>
              <p className="mt-1 text-xs text-slate-500">
                최초 개정은 내측반경 외 모든 계산값을 직접 입력합니다.
              </p>
            </div>
          ) : (
            workspace.revisions.map((rule) => (
              <article
                key={rule.id}
                className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,1fr)_auto] lg:items-center"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <b>r{rule.revisionNumber}</b>
                    <span
                      className={`rounded px-2 py-0.5 text-[11px] font-bold ${statusColor[rule.effectiveStatus]}`}
                    >
                      {statusLabel[rule.effectiveStatus]}
                    </span>
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold">
                      {rule.calculationMode}
                    </span>
                    <span className="text-xs text-slate-500">
                      {rule.elongationOption.replace("_", "-")}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-slate-700">
                    {rule.changeSummary ?? "변경 요약 없음"}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    효력 {rule.effectiveFrom
                      ? dateText(rule.effectiveFrom)
                      : "게시 시점"} →{" "}
                    {rule.effectiveTo ? dateText(rule.effectiveTo) : "계속"}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <Metric label="제한각" value={`${rule.cutAngleDeg}° 미만`} />
                  <Metric
                    label="내측반경"
                    value={`${rule.insideBendRadiusMm}mm`}
                  />
                  <Metric
                    label="소수 정책"
                    value={
                      rule.decimalOperation === "NONE"
                        ? "소수 유지"
                        : `${rule.decimalPlaces}자리`
                    }
                  />
                  <Metric
                    label="FIX V/A/N"
                    value={`${rule.elongationVCutMm}/${rule.elongationACutMm}/${rule.elongationNoCutMm}`}
                  />
                  <Metric
                    label="RATIO V/A/N"
                    value={`${rule.cutDepthVCutMm}/${rule.cutDepthACutMm}/${rule.cutDepthNoCutMm}`}
                  />
                  <Metric
                    label="V-CUT"
                    value={rule.vCutEnabled ? "사용" : "미사용"}
                  />
                </div>
                <div className="flex flex-wrap gap-2 lg:max-w-48 lg:justify-end">
                  <button
                    onClick={() => showPreview(rule)}
                    disabled={pending}
                    className="inline-flex items-center gap-1 rounded border px-3 py-2 text-xs font-bold"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    미리보기
                  </button>
                  {canWrite && rule.status === "DRAFT" ? (
                    <>
                      <button
                        onClick={() =>
                          setEditor({ value: { ...rule }, sourceRuleId: null })
                        }
                        className="inline-flex items-center gap-1 rounded border px-3 py-2 text-xs font-bold"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        수정
                      </button>
                      <button
                        onClick={() => setReviewRule(rule)}
                        className="inline-flex items-center gap-1 rounded bg-blue-700 px-3 py-2 text-xs font-bold text-white"
                      >
                        <Send className="h-3.5 w-3.5" />
                        검토 요청
                      </button>
                      <button
                        onClick={() => discard(rule)}
                        className="inline-flex items-center gap-1 rounded border border-red-200 px-3 py-2 text-xs font-bold text-red-700"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        폐기
                      </button>
                    </>
                  ) : null}
                  {canApprove && rule.status === "REVIEW" ? (
                    <>
                      <button
                        onClick={() => returnRule(rule)}
                        className="inline-flex items-center gap-1 rounded border px-3 py-2 text-xs font-bold"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        수정 반려
                      </button>
                      <button
                        onClick={() => publish(rule)}
                        className="inline-flex items-center gap-1 rounded bg-teal-700 px-3 py-2 text-xs font-bold text-white"
                      >
                        <FileCheck2 className="h-3.5 w-3.5" />
                        게시
                      </button>
                    </>
                  ) : null}
                  {canApprove &&
                  rule.status === "PUBLISHED" &&
                  (rule.effectiveStatus === "ACTIVE" ||
                    rule.effectiveStatus === "SCHEDULED") ? (
                    <button
                      onClick={() => retireRule(rule)}
                      className="inline-flex items-center gap-1 rounded border border-amber-200 px-3 py-2 text-xs font-bold text-amber-800"
                    >
                      <Clock3 className="h-3.5 w-3.5" />
                      {rule.effectiveStatus === "SCHEDULED"
                        ? "예약 취소"
                        : "사용 종료"}
                    </button>
                  ) : null}
                </div>
              </article>
            ))
          )}
        </div>
      </section>
      </TabPanel>

      <TabPanel id="audit" value={tab}>
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-black">처리 이력</h2>
        {workspace.history.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            아직 처리 이력이 없습니다.
          </p>
        ) : (
          <ol className="mt-4 space-y-3">
            {workspace.history.slice(0, 20).map((item) => (
              <li key={item.id} className="flex gap-3 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
                <div>
                  <b>{item.label}</b>
                  <p className="text-xs text-slate-500">
                    {item.actorDisplayName ?? "시스템"} ·{" "}
                    {dateText(item.occurredAt)}
                    {item.reason ? ` · ${item.reason}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
      </TabPanel>

      {editor ? (
        <RuleEditorDialog
          open
          value={editor.value}
          sourceRuleId={editor.sourceRuleId}
          onClose={() => setEditor(null)}
          onSaved={refresh}
          workspace={workspace}
        />
      ) : null}
      <ReviewDialog
        rule={reviewRule}
        onClose={() => setReviewRule(null)}
        onSubmit={(iso) =>
          reviewRule && transition(reviewRule, "review", { effectiveFrom: iso })
        }
        pending={pending}
      />
      <PreviewDialog preview={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function SummaryCard({
  title,
  value,
  detail,
  tone = "slate",
}: {
  title: string;
  value: string;
  detail: string;
  tone?: "slate" | "teal" | "amber";
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${tone === "teal" ? "border-teal-200 bg-teal-50" : tone === "amber" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}
    >
      <p className="text-xs font-bold text-slate-500">{title}</p>
      <p className="mt-1 text-lg font-black">{value}</p>
      <p className="mt-1 truncate text-xs text-slate-500">{detail}</p>
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-slate-50 p-2">
      <p className="text-[10px] font-bold text-slate-400">{label}</p>
      <p
        className="mt-1 truncate font-mono font-bold text-slate-700"
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

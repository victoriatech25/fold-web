"use client";

import type {
  MaterialRuleFields,
  MaterialRuleRevisionDto,
} from "@/server/material-rules/material-rule-types";

const field = (data: FormData, name: string) =>
  String(data.get(name) ?? "").trim();
export const decimalPattern = "[0-9]+([.][0-9]{1,6})?";

export function valuesFromForm(data: FormData): MaterialRuleFields {
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

export function blankFields(radius: string): MaterialRuleFields {
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

export function copyFields(rule: MaterialRuleRevisionDto): MaterialRuleFields {
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

export function DecimalInput({
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

/**
 * 계산 기준 입력 필드 묶음. 계산 기준 페이지의 개정 편집과 재질 상세의 두께 등록 마법사가 같이 쓴다.
 * `<form>` 안에 넣어 쓰고, 값은 `valuesFromForm(new FormData(form))` 으로 읽는다.
 */
export function RuleFieldsForm({ value }: { value: MaterialRuleFields }) {
  return (
    <div className="space-y-5">
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
    </div>
  );
}

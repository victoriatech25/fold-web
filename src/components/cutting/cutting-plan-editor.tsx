"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import {
  addSheet,
  canRotate,
  createEditorState,
  deleteSheet,
  insertPlacement,
  movePlacement,
  partSize,
  placementIssue,
  placementRect,
  redo,
  removePlacement,
  snapPosition,
  toSaveAnnotations,
  toSaveSheets,
  undo,
  unplacedCounts,
  usableRect,
  type EditorState,
  type RectMm,
} from "@/domain/cutting/editor-state";
import type { ManualEditViolation } from "@/domain/cutting/manual-edit";
import type { CuttingPart, CuttingSheet, CuttingSummary } from "@/domain/cutting/schema";
import { fromScreenRect, isLandscape, screenViewBox, toScreenRect } from "@/domain/cutting/screen-transform";
import { useCommonPopup } from "@/components/ui/common-popup";
import type { CuttingPlanDetailDto } from "@/server/cutting/cutting-plan-service";
import { cuttingRequest } from "./cutting-plan-list-panel";

/**
 * 재단 배치 편집기(`P2-B11` 4.6). 원판별 배치를 끌어 옮기고, 미배치 부품을 넣고,
 * 원판을 더하거나 지운다. 상태 조작은 전부 `editor-state.ts` 의 순수 함수로 한다.
 *
 * 드래그는 `pointerdown` 으로 "들고", 문서 전체의 `pointermove/up` 으로 놓는다.
 * 원판 SVG 가 여러 개라 요소 밖으로 나가도 추적해야 하기 때문이다.
 */

const SNAP_THRESHOLD_MM = 8;
const VALIDATE_DEBOUNCE_MS = 300;

type Carry = {
  kind: "move" | "insert";
  /** move 일 때 편집기 배치 키. */
  key?: string;
  partId: string;
  rotated: boolean;
  /** 잡은 점이 부품 왼쪽 위(화면 기준)에서 얼마나 떨어져 있는지. 화면 mm. */
  grabX: number;
  grabY: number;
  /** 놓을 자리. 원판 위에 있을 때만. */
  ghost: { sheetIndex: number; rect: RectMm; issue: ReturnType<typeof placementIssue> } | null;
};

type Validation = {
  violations: ManualEditViolation[];
  warnings: ManualEditViolation[];
  summary: CuttingSummary;
};

/** 어느 편집 상태를 검증한 결과인지 함께 든다. 상태가 바뀌면 그 결과는 낡은 것이다. */
type ValidationFor = Validation & { state: EditorState };

const violationLabels: Record<string, string> = {
  OVERLAP: "겹침",
  OUT_OF_USABLE_AREA: "사용 영역 이탈",
  QUANTITY_MISMATCH: "수량 불일치",
  NOT_GUILLOTINE: "직선 관통 불가",
  KERF_NOT_KEPT: "칼날 두께 미확보",
  ROTATION_NOT_ALLOWED: "회전 불가",
  GRAIN_CONFLICT: "결 방향 충돌",
  SHEET_LIMIT_EXCEEDED: "원판 장수 초과",
  LASER_GROUP_MIXED_PART: "레이저 그룹 부품 혼합",
  LASER_GROUP_NOT_RECTANGLE: "레이저 그룹 격자 아님",
  LASER_GROUP_OVERLAP: "레이저 그룹 중복",
  CUT_LINE_CROSSES_PART: "절단선이 부품 관통",
  CUT_LINE_OUT_OF_SHEET: "절단선 원판 밖",
};

function svgPoint(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } | null {
  const matrix = svg.getScreenCTM();
  if (!matrix) return null;
  const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
  return { x: point.x, y: point.y };
}

export function CuttingPlanEditor({ plan }: { plan: CuttingPlanDetailDto }) {
  const router = useRouter();
  const popup = useCommonPopup();
  const input = plan.input;
  const [state, setState] = useState<EditorState>(() => createEditorState(plan.result!, plan.annotations));
  const [carry, setCarry] = useState<Carry | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [validated, setValidated] = useState<ValidationFor | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newSheetItemId, setNewSheetItemId] = useState(input.sheets[0]?.sheetItemId ?? "");
  const svgRefs = useRef(new Map<number, SVGSVGElement>());
  const carryRef = useRef<Carry | null>(null);
  useEffect(() => {
    carryRef.current = carry;
  }, [carry]);

  const partById = useMemo(() => new Map(input.parts.map((part) => [part.id, part])), [input.parts]);
  const sheetSpecById = useMemo(() => new Map(input.sheets.map((sheet) => [sheet.sheetItemId, sheet])), [input.sheets]);
  const kerfMm = Number(input.options.bladeKerfMm);
  const unplaced = useMemo(() => unplacedCounts(input, state.sheets), [input, state.sheets]);
  const dirty = state.past.length > 0;

  const requestBody = useCallback(
    () => ({
      baseRevisionId: plan.currentRevision!.id,
      sheets: toSaveSheets(state.sheets),
      annotations: toSaveAnnotations(state),
    }),
    [plan.currentRevision, state],
  );

  // 이동이 멈추면 서버 검증을 부른다. 거부 항목이 있으면 저장이 잠긴다.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const outcome = await cuttingRequest<Validation>(`/api/v1/cutting-plans/${plan.id}/manual-revisions/validate`, {
          method: "POST",
          body: JSON.stringify(requestBody()),
        });
        if (!cancelled) setValidated({ ...outcome, state });
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "검증하지 못했습니다.");
      }
    }, VALIDATE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [plan.id, requestBody, state]);

  const validation = validated && validated.state === state ? validated : null;
  const validating = validation === null;

  /** 화면 좌표의 놓을 자리를 원판 좌표로 바꾸고 스냅·판정한다. */
  const proposeAt = useCallback(
    (sheetIndex: number, screenX: number, screenY: number, current: Carry): Carry["ghost"] => {
      const sheet = state.sheets[sheetIndex];
      const spec = sheet ? sheetSpecById.get(sheet.sheetItemId) : undefined;
      const part = partById.get(current.partId);
      if (!sheet || !spec || !part) return null;
      const landscape = isLandscape(spec);
      const size = partSize(part, current.rotated);
      const screenSize = toScreenRect({ x: 0, y: 0, ...size }, landscape);
      const proposedScreen = { ...screenSize, x: screenX - current.grabX, y: screenY - current.grabY };
      const proposed = fromScreenRect(proposedScreen, landscape);
      const neighbours = sheet.placements
        .filter((placement) => placement.key !== current.key)
        .map((placement) => placementRect(partById.get(placement.partId)!, placement));
      const usable = usableRect(spec);
      const snapped = snapPosition(proposed, neighbours, usable, { kerfMm, thresholdMm: SNAP_THRESHOLD_MM });
      const rect = { ...proposed, x: snapped.x, y: snapped.y };
      return { sheetIndex, rect, issue: placementIssue(rect, neighbours, usable) };
    },
    [kerfMm, partById, sheetSpecById, state.sheets],
  );

  // 문서 전체에서 이동·놓기를 받는다.
  useEffect(() => {
    if (!carry) return;
    function locateSheet(clientX: number, clientY: number) {
      for (const [sheetIndex, svg] of svgRefs.current) {
        const box = svg.getBoundingClientRect();
        if (clientX >= box.left && clientX <= box.right && clientY >= box.top && clientY <= box.bottom) {
          const point = svgPoint(svg, clientX, clientY);
          if (point) return { sheetIndex, point };
        }
      }
      return null;
    }
    function onMove(event: PointerEvent) {
      const current = carryRef.current;
      if (!current) return;
      const hit = locateSheet(event.clientX, event.clientY);
      setCarry({ ...current, ghost: hit ? proposeAt(hit.sheetIndex, hit.point.x, hit.point.y, current) : null });
    }
    function onUp(event: PointerEvent) {
      const current = carryRef.current;
      setCarry(null);
      if (!current) return;
      // 놓는 순간의 자리로 다시 판정한다. 마지막 move 와 up 사이에 움직였을 수 있다.
      const hit = locateSheet(event.clientX, event.clientY);
      const ghost = hit ? proposeAt(hit.sheetIndex, hit.point.x, hit.point.y, current) : null;
      if (!ghost || ghost.issue) return;
      const target = { sheetIndex: ghost.sheetIndex, xMm: ghost.rect.x, yMm: ghost.rect.y, rotated: current.rotated };
      setState((previous) =>
        current.kind === "move" && current.key
          ? movePlacement(previous, current.key, target)
          : insertPlacement(previous, input, current.partId, target),
      );
    }
    function onKey(event: KeyboardEvent) {
      const current = carryRef.current;
      if (!current) return;
      if (event.key === "Escape") setCarry(null);
      if (event.key.toLowerCase() === "r") {
        const part = partById.get(current.partId);
        const sheet = current.ghost ? sheetSpecById.get(state.sheets[current.ghost.sheetIndex]?.sheetItemId) : undefined;
        if (part && (!sheet || canRotate(part, sheet))) setCarry({ ...current, rotated: !current.rotated, ghost: null });
      }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [carry, input, partById, proposeAt, sheetSpecById, state.sheets]);

  // 선택한 배치의 키보드 조작: R 회전, Delete 미배치로.
  useEffect(() => {
    if (!selectedKey || carry) return;
    function onKey(event: KeyboardEvent) {
      if (!selectedKey) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        setState((previous) => removePlacement(previous, selectedKey));
        setSelectedKey(null);
      }
      if (event.key.toLowerCase() === "r") {
        setState((previous) => {
          const sheetIndex = previous.sheets.findIndex((sheet) => sheet.placements.some((p) => p.key === selectedKey));
          const placement = previous.sheets[sheetIndex]?.placements.find((p) => p.key === selectedKey);
          const spec = sheetIndex >= 0 ? sheetSpecById.get(previous.sheets[sheetIndex].sheetItemId) : undefined;
          const part = placement ? partById.get(placement.partId) : undefined;
          if (!placement || !spec || !part || !canRotate(part, spec)) return previous;
          return movePlacement(previous, selectedKey, {
            sheetIndex,
            xMm: placement.xMm,
            yMm: placement.yMm,
            rotated: !placement.rotated,
          });
        });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [carry, partById, selectedKey, sheetSpecById]);

  function startMove(event: ReactPointerEvent<SVGGElement>, sheetIndex: number, key: string) {
    if (event.button !== 0) return;
    const svg = svgRefs.current.get(sheetIndex);
    const sheet = state.sheets[sheetIndex];
    const placement = sheet?.placements.find((item) => item.key === key);
    const spec = sheet ? sheetSpecById.get(sheet.sheetItemId) : undefined;
    const part = placement ? partById.get(placement.partId) : undefined;
    if (!svg || !placement || !spec || !part) return;
    const point = svgPoint(svg, event.clientX, event.clientY);
    if (!point) return;
    const screen = toScreenRect(placementRect(part, placement), isLandscape(spec));
    event.preventDefault();
    setSelectedKey(key);
    setCarry({
      kind: "move",
      key,
      partId: placement.partId,
      rotated: placement.rotated,
      grabX: point.x - screen.x,
      grabY: point.y - screen.y,
      ghost: null,
    });
  }

  function startInsert(event: ReactPointerEvent<HTMLButtonElement>, part: CuttingPart) {
    if (event.button !== 0) return;
    event.preventDefault();
    setSelectedKey(null);
    // 목록에서 집어 올 때는 부품 중앙을 잡은 것으로 본다.
    const size = partSize(part, false);
    setCarry({ kind: "insert", partId: part.id, rotated: false, grabX: size.width / 2, grabY: size.height / 2, ghost: null });
  }

  async function save() {
    if (!validation || validation.violations.length > 0) return;
    if (validation.warnings.length > 0) {
      const confirmed = await popup.confirm({
        title: "경고와 함께 저장",
        message: `직선 관통·칼날 두께 경고 ${validation.warnings.length}건이 있습니다. 경고는 개정에 남아 승인자가 다시 봅니다. 저장할까요?`,
        confirmText: "저장",
        variant: "warning",
      });
      if (!confirmed) return;
    }
    setBusy(true);
    setError("");
    try {
      await cuttingRequest(`/api/v1/cutting-plans/${plan.id}/manual-revisions`, {
        method: "POST",
        body: JSON.stringify({ ...requestBody(), expectedLockVersion: plan.lockVersion }),
      });
      router.push(`/cutting/${plan.id}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "저장하지 못했습니다.");
      setBusy(false);
    }
  }

  async function leave() {
    if (dirty) {
      const confirmed = await popup.confirm({
        title: "편집 취소",
        message: "저장하지 않은 변경이 사라집니다. 편집을 끝낼까요?",
        confirmText: "편집 끝내기",
        variant: "danger",
      });
      if (!confirmed) return;
    }
    router.push(`/cutting/${plan.id}`);
  }

  const violations = useMemo(() => validation?.violations ?? [], [validation]);
  const warnings = useMemo(() => validation?.warnings ?? [], [validation]);
  const violationsBySheet = useMemo(() => {
    const map = new Map<number, ManualEditViolation[]>();
    for (const item of [...violations, ...warnings]) {
      if (item.sheetIndex === undefined) continue;
      map.set(item.sheetIndex, [...(map.get(item.sheetIndex) ?? []), item]);
    }
    return map;
  }, [violations, warnings]);

  return (
    <div className="space-y-3" data-testid="cutting-editor">
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="text-xl font-black">
          재단 편집{" "}
          <Link className="text-teal-800 underline" href={`/cutting/${plan.id}`}>
            {plan.orderNumber}
          </Link>
        </h1>
        <span className="text-xs text-slate-500">
          {plan.materialLabel} {plan.thicknessMm}T · 개정 {plan.currentRevision?.revisionNumber} 기준
        </span>
      </div>

      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
        <label className="flex items-center gap-1">
          <span className="text-slate-500">새 원판</span>
          <select
            className="rounded border border-slate-300 px-1 py-1"
            onChange={(event) => setNewSheetItemId(event.target.value)}
            value={newSheetItemId}
          >
            {input.sheets.map((sheet) => (
              <option key={sheet.sheetItemId} value={sheet.sheetItemId}>
                {sheet.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="rounded border border-teal-700 px-2 py-1 font-bold text-teal-800"
          onClick={() => setState((previous) => addSheet(previous, newSheetItemId))}
          type="button"
        >
          원판 추가
        </button>
        <span className="mx-1 h-4 w-px bg-slate-200" />
        <button
          className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40"
          disabled={state.past.length === 0}
          onClick={() => setState(undo)}
          type="button"
        >
          실행취소
        </button>
        <button
          className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40"
          disabled={state.future.length === 0}
          onClick={() => setState(redo)}
          type="button"
        >
          다시실행
        </button>
        <span className="ml-auto flex items-center gap-2">
          <span
            className={`rounded px-2 py-0.5 font-bold ${
              validating
                ? "bg-slate-100 text-slate-500"
                : violations.length > 0
                  ? "bg-red-100 text-red-800"
                  : warnings.length > 0
                    ? "bg-amber-100 text-amber-900"
                    : "bg-teal-100 text-teal-900"
            }`}
            data-testid="editor-validation-status"
          >
            {validating
              ? "검증 중"
              : violations.length > 0
                ? `저장 불가 ${violations.length}건`
                : warnings.length > 0
                  ? `경고 ${warnings.length}건`
                  : "저장 가능"}
          </span>
          <button className="rounded border border-slate-300 px-3 py-1" onClick={() => void leave()} type="button">
            취소
          </button>
          <button
            className="rounded bg-teal-700 px-3 py-1 font-bold text-white disabled:opacity-50"
            data-testid="editor-save"
            disabled={busy || validating || !validation || violations.length > 0 || !!carry}
            onClick={() => void save()}
            type="button"
          >
            저장
          </button>
        </span>
      </div>

      {error ? (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-800">{error}</p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[1fr_260px]">
        <div className="space-y-3">
          {state.sheets.map((sheet, sheetIndex) => {
            const spec = sheetSpecById.get(sheet.sheetItemId);
            if (!spec) return null;
            return (
              <EditorSheetFigure
                carry={carry}
                issues={violationsBySheet.get(sheetIndex) ?? []}
                key={sheet.key}
                onDelete={() => setState((previous) => deleteSheet(previous, sheetIndex))}
                onSelect={setSelectedKey}
                onStartMove={startMove}
                partById={partById}
                deletable={sheet.placements.length === 0 && state.sheets.length > 1}
                refCallback={(element) => {
                  if (element) svgRefs.current.set(sheetIndex, element);
                  else svgRefs.current.delete(sheetIndex);
                }}
                selectedKey={selectedKey}
                sheet={sheet}
                sheetIndex={sheetIndex}
                spec={spec}
              />
            );
          })}
        </div>

        <aside className="space-y-3">
          <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <h2 className="text-xs font-black">미배치 부품</h2>
            <p className="mt-1 text-[11px] text-slate-500">눌러서 원판 위로 끌어 놓습니다. 들고 있는 동안 R 로 회전합니다.</p>
            <ul className="mt-2 space-y-1">
              {input.parts.map((part) => {
                const remaining = unplaced.get(part.id) ?? 0;
                return (
                  <li key={part.id}>
                    <button
                      className={`flex w-full items-center justify-between rounded border px-2 py-1 text-left text-xs ${
                        remaining > 0
                          ? "cursor-grab border-teal-300 bg-teal-50 hover:bg-teal-100"
                          : remaining < 0
                            ? "border-red-300 bg-red-50 text-red-800"
                            : "border-slate-200 text-slate-400"
                      }`}
                      data-testid={`unplaced-${part.id}`}
                      disabled={remaining <= 0}
                      onPointerDown={(event) => startInsert(event, part)}
                      type="button"
                    >
                      <span>
                        {part.label}
                        <span className="ml-1 text-slate-500">
                          {part.widthMm}×{part.lengthMm}
                        </span>
                      </span>
                      <span className="font-bold">{remaining > 0 ? `${remaining}개` : remaining < 0 ? `${-remaining}개 초과` : "완료"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <h2 className="text-xs font-black">검증</h2>
            {validation ? (
              <>
                <p className="mt-1 text-[11px] text-slate-500">
                  원판 {validation.summary.sheetCount}장 · 수율 {validation.summary.yieldPercent}%
                </p>
                <ul className="mt-2 space-y-1 text-[11px]" data-testid="editor-issues">
                  {[...violations.map((v) => ({ ...v, level: "error" })), ...warnings.map((w) => ({ ...w, level: "warning" }))].map(
                    (item, index) => (
                      <li
                        className={item.level === "error" ? "text-red-800" : "text-amber-900"}
                        key={`${item.code}-${index}`}
                      >
                        <span className="font-bold">{violationLabels[item.code] ?? item.code}</span>
                        {item.sheetIndex !== undefined ? ` · 원판 ${item.sheetIndex + 1}` : ""} — {item.message}
                      </li>
                    ),
                  )}
                  {violations.length === 0 && warnings.length === 0 ? (
                    <li className="text-teal-800">문제가 없습니다.</li>
                  ) : null}
                </ul>
              </>
            ) : (
              <p className="mt-1 text-[11px] text-slate-500">검증 중입니다.</p>
            )}
            <p className="mt-2 text-[11px] text-slate-500">
              겹침·영역 이탈·수량은 저장을 막고, 직선 관통·칼날 두께는 경고로 남습니다.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function EditorSheetFigure({
  sheet,
  sheetIndex,
  spec,
  partById,
  carry,
  selectedKey,
  issues,
  deletable,
  onStartMove,
  onSelect,
  onDelete,
  refCallback,
}: {
  sheet: EditorState["sheets"][number];
  sheetIndex: number;
  spec: CuttingSheet;
  partById: Map<string, CuttingPart>;
  carry: Carry | null;
  selectedKey: string | null;
  issues: ManualEditViolation[];
  deletable: boolean;
  onStartMove: (event: ReactPointerEvent<SVGGElement>, sheetIndex: number, key: string) => void;
  onSelect: (key: string | null) => void;
  onDelete: () => void;
  refCallback: (element: SVGSVGElement | null) => void;
}) {
  const landscape = isLandscape(spec);
  const viewBox = screenViewBox(spec);
  const usable = toScreenRect(usableRect(spec), landscape);
  const ghost = carry?.ghost?.sheetIndex === sheetIndex ? carry.ghost : null;
  const issuePartIds = new Set(issues.map((issue) => issue.partId).filter((id): id is string => !!id));
  const errorCount = issues.filter((issue) => !["NOT_GUILLOTINE", "KERF_NOT_KEPT"].includes(issue.code)).length;
  const fontSize = Math.max(24, Math.min(viewBox.width, viewBox.height) / 30);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm" data-testid={`editor-sheet-${sheetIndex}`}>
      <div className="mb-2 flex flex-wrap items-baseline gap-2 text-xs">
        <h3 className="font-black">원판 {sheetIndex + 1}</h3>
        <span className="text-slate-500">{spec.label}</span>
        <span className="text-slate-500">부품 {sheet.placements.length}개</span>
        {errorCount > 0 ? <span className="font-bold text-red-700">저장 불가 {errorCount}건</span> : null}
        {issues.length - errorCount > 0 ? (
          <span className="font-bold text-amber-800">경고 {issues.length - errorCount}건</span>
        ) : null}
        {deletable ? (
          <button className="ml-auto text-red-700 underline" onClick={onDelete} type="button">
            빈 원판 삭제
          </button>
        ) : null}
      </div>
      <svg
        aria-label={`원판 ${sheetIndex + 1} 편집`}
        className={`w-full touch-none select-none border border-slate-300 bg-slate-50 ${landscape ? "max-w-3xl" : "max-w-md"} ${
          ghost ? (ghost.issue ? "ring-2 ring-red-400" : "ring-2 ring-teal-400") : ""
        }`}
        onPointerDown={() => onSelect(null)}
        ref={refCallback}
        role="img"
        viewBox={`0 0 ${viewBox.width} ${viewBox.height}`}
      >
        <rect fill="#ffffff" height={usable.height} stroke="#cbd5e1" strokeDasharray="12 12" strokeWidth={3} width={usable.width} x={usable.x} y={usable.y} />
        {sheet.placements.map((placement) => {
          const part = partById.get(placement.partId);
          if (!part) return null;
          const box = toScreenRect(placementRect(part, placement), landscape);
          const carrying = carry?.kind === "move" && carry.key === placement.key;
          const selected = selectedKey === placement.key;
          const flagged = issuePartIds.has(placement.partId);
          return (
            <g
              className="cursor-grab"
              data-testid={`placement-${placement.key}`}
              key={placement.key}
              onPointerDown={(event) => {
                event.stopPropagation();
                onStartMove(event, sheetIndex, placement.key);
              }}
              opacity={carrying ? 0.35 : 1}
            >
              <rect
                fill={flagged ? "#fecaca" : selected ? "#99f6e4" : "#ccfbf1"}
                height={box.height}
                stroke={flagged ? "#b91c1c" : selected ? "#0f766e" : "#14b8a6"}
                strokeWidth={selected ? 8 : 4}
                width={box.width}
                x={box.x}
                y={box.y}
              />
              <text
                fill="#134e4a"
                fontSize={fontSize}
                pointerEvents="none"
                textAnchor="middle"
                x={box.x + box.width / 2}
                y={box.y + box.height / 2 + fontSize / 3}
              >
                {part.label}
                {placement.rotated ? " ↻" : ""}
              </text>
            </g>
          );
        })}
        {ghost
          ? (() => {
              const box = toScreenRect(ghost.rect, landscape);
              return (
                <rect
                  data-testid="editor-ghost"
                  fill={ghost.issue ? "rgba(239,68,68,0.25)" : "rgba(20,184,166,0.25)"}
                  height={box.height}
                  pointerEvents="none"
                  stroke={ghost.issue ? "#dc2626" : "#0d9488"}
                  strokeDasharray="16 10"
                  strokeWidth={6}
                  width={box.width}
                  x={box.x}
                  y={box.y}
                />
              );
            })()
          : null}
      </svg>
      <p className="mt-1 text-[11px] text-slate-500">부품을 끌어 옮깁니다. 선택 후 R 회전, Delete 미배치로.</p>
    </div>
  );
}

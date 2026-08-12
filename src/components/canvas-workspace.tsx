"use client";

import dynamic from "next/dynamic";
import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Box, Calculator, Columns2, CornerDownRight, LayoutTemplate, ListOrdered, Minus, MousePointer2, PencilLine, Plus, Redo2, RotateCcw, Sigma, SlidersHorizontal, Square, Trash2, Undo2 } from "lucide-react";

import {
  FOLD_CALCULATION_ENGINE_VERSION,
  divideCanonicalDecimals,
  formatCanonicalDecimal,
  quantizeCanonicalDecimal,
} from "@/domain/calculation-decimal";
import type { ProductCalculation } from "@/domain/fold-calculation";
import { distanceMm, type BendDirection, type BendForm, type CutType, type DecimalOperation, type ElongationMode, type ElongationOption } from "@/domain/fold-profile";
import { findBoxBaseSegments } from "@/domain/3d";
import { createFoldPointList } from "@/domain/fold-point-info";
import { foldEditorStore } from "@/stores/fold-editor-store";
import { Tooltip } from "@/components/ui/tooltip";
import { useCommonPopup } from "@/components/ui/common-popup";
import { getFoldRevision, getFoldTemplate, listFoldTemplates } from "@/client/fold-library/fold-library-api";
import { serverDocumentToBrowserFoldProfileV4 } from "@/domain/fold-document/adapter";

type PanelTemplateOption = {
  templateId: string;
  name: string;
  revisionId: string;
  revisionNumber: number;
};

const KonvaStage = dynamic(() => import("@/components/konva-stage").then((module) => module.KonvaStage), {
  ssr: false,
  loading: () => <div className="flex h-full min-h-[280px] items-center justify-center bg-slate-50 text-sm text-slate-500">편집기를 준비하고 있습니다.</div>,
});

const FoldModelPreview = dynamic(() => import("@/components/model-3d/fold-model-preview").then((module) => module.FoldModelPreview), {
  ssr: false,
  loading: () => <div className="flex h-full min-h-[280px] items-center justify-center bg-slate-100 text-sm text-slate-500">3D 미리보기를 준비하고 있습니다.</div>,
});

const DevelopedPatternPreview = dynamic(() => import("@/components/developed-pattern-preview").then((module) => module.DevelopedPatternPreview), {
  ssr: false,
  loading: () => <div className="flex h-full min-h-[280px] items-center justify-center bg-slate-50 text-sm text-slate-500">전개도를 준비하고 있습니다.</div>,
});

const toolButton = "inline-flex h-9 w-9 items-center justify-center rounded border transition";

function formatCalculatedLength(
  value: string,
  decimalPlaces: number,
  decimalOperation: DecimalOperation,
) {
  return formatCanonicalDecimal(
    value,
    decimalOperation === "none" ? undefined : decimalPlaces,
  );
}

function formatArea(value: string) {
  return formatCanonicalDecimal(quantizeCanonicalDecimal(value, 4, "round"), 4);
}

export const CanvasWorkspace = observer(function CanvasWorkspace({
  readOnly = false,
}: {
  readOnly?: boolean;
}) {
  const [propertyTab, setPropertyTab] = useState<"segment" | "material" | "formula" | "points">("segment");
  const [viewMode, setViewMode] = useState<"2d" | "split" | "3d" | "developed">("2d");
  const [splitColumnPercent, setSplitColumnPercent] = useState(50);
  const [splitRowPercent, setSplitRowPercent] = useState(55);
  const [drawingAreaHeight, setDrawingAreaHeight] = useState(620);
  const [panelTemplates, setPanelTemplates] = useState<PanelTemplateOption[]>([]);
  const [panelTemplateRevisionId, setPanelTemplateRevisionId] = useState("");
  const [splitResize, setSplitResize] = useState<null | { axis: "column" | "row"; pointer: number; initial: number; extent: number }>(null);
  const splitResizeRef = useRef<typeof splitResize>(null);
  const drawingAreaRef = useRef<HTMLDivElement>(null);
  const { alert: alertPopup, confirm: confirmPopup } = useCommonPopup();
  const selected = foldEditorStore.selectedSegment;
  const selectedCalculation = foldEditorStore.selectedSegmentCalculation;
  const bend = selected?.bendAfter;
  const selectedPanel = foldEditorStore.profile.panelAttachments.find(
    (panel) => panel.hostSegmentId === selected?.id,
  );
  const calculation = foldEditorStore.calculation;
  const selectedBlockIndex = foldEditorStore.profile.blocks.findIndex((block) => block.id === foldEditorStore.activeBlockId);
  const selectedSegmentIndex = foldEditorStore.activeBlock?.segments.findIndex((segment) => segment.id === selected?.id) ?? -1;
  const selectedFormulaIssue = calculation.expressionIssues.find((issue) =>
    issue.path === `blocks[${selectedBlockIndex}].segments[${selectedSegmentIndex}].formula`,
  );
  const boxBases = foldEditorStore.profile.profileType === "box"
    ? findBoxBaseSegments(foldEditorStore.profile.blocks)
    : null;
  const boxWidth = boxBases ? distanceMm(boxBases[0].start, boxBases[0].end) : 0;
  const boxDepth = boxBases ? distanceMm(boxBases[1].start, boxBases[1].end) : 0;
  const splitTopHeight = Math.round(drawingAreaHeight * splitRowPercent / 100);
  const splitBottomHeight = Math.max(0, drawingAreaHeight - splitTopHeight);
  const updateBend = (partial: Partial<{ direction: BendDirection; cutType: CutType; angle: number }>) =>
    foldEditorStore.updateSelectedBend(partial.direction ?? bend?.direction ?? "front", partial.cutType ?? bend?.cutType ?? "v-cut", partial.angle ?? bend?.angle ?? 90);
  const changeViewMode = (next: "2d" | "split" | "3d" | "developed") => {
    if ((next === "3d" || next === "developed") && foldEditorStore.mode === "draw") foldEditorStore.finishDrawing();
    setViewMode(next);
  };
  const startSplitResize = (axis: "column" | "row") => (event: ReactPointerEvent<HTMLDivElement>) => {
    const container = event.currentTarget.parentElement;
    if (!container) return;
    event.preventDefault();
    const resize = {
      axis,
      pointer: axis === "column" ? event.clientX : event.clientY,
      initial: axis === "column" ? splitColumnPercent : splitRowPercent,
      extent: axis === "column" ? container.getBoundingClientRect().width : container.getBoundingClientRect().height,
    };
    splitResizeRef.current = resize;
    setSplitResize(resize);
  };
  const applySplitResize = (clientX: number, clientY: number) => {
    const resize = splitResizeRef.current;
    if (!resize) return;
    const pointer = resize.axis === "column" ? clientX : clientY;
    const delta = pointer - resize.pointer;
    if (resize.axis === "column") {
      setSplitColumnPercent(Math.max(28, Math.min(72, resize.initial + (delta / resize.extent) * 100)));
    } else {
      setSplitRowPercent(Math.max(25, Math.min(75, resize.initial + (delta / resize.extent) * 100)));
    }
  };
  const finishSplitResize = () => {
    splitResizeRef.current = null;
    setSplitResize(null);
  };
  const convertSelectedToLine = async () => {
    if (selected?.geometry?.kind !== "arc") return;
    const confirmed = await confirmPopup({
      title: "원호를 직선으로 전환",
      message: "곡 깊이와 좌우 방향 정보가 제거됩니다. 직선으로 전환할까요?",
      confirmText: "직선으로 전환",
      variant: "warning",
    });
    if (confirmed) foldEditorStore.setSelectedGeometry("line");
  };
  const removeSelectedPanel = async () => {
    if (!selectedPanel) return;
    const confirmed = await confirmPopup({
      title: "연결 패널 제거",
      message: `${selectedPanel.name} 연결과 내장 단면을 제거할까요?`,
      confirmText: "제거",
      variant: "danger",
    });
    if (confirmed) foldEditorStore.removePanelAttachment(selectedPanel.id);
  };
  const applySelectedPanelTemplate = async () => {
    if (!selectedPanel || !panelTemplateRevisionId) return;
    try {
      const revision = await getFoldRevision(panelTemplateRevisionId);
      const document = { ...revision.document, documentType: "normal" as const };
      const profile = serverDocumentToBrowserFoldProfileV4(document, {
        id: revision.revisionId,
        createdAt: revision.updatedAt,
        updatedAt: revision.updatedAt,
      });
      foldEditorStore.applyPanelTemplate(selectedPanel.id, profile.blocks[0], {
        name: revision.templateName,
        sourceRevisionId: revision.revisionId,
        sourceChecksum: revision.checksumSha256,
      });
    } catch (error) {
      await alertPopup({
        title: "패널 템플릿 적용 실패",
        message: error instanceof Error ? error.message : "패널 템플릿을 적용하지 못했습니다.",
        confirmText: "확인",
        variant: "danger",
      });
    }
  };

  useEffect(() => {
    void listFoldTemplates({ documentType: "PANEL", status: "PUBLISHED" })
      .then(async (result) => {
        const details = await Promise.all(result.items.map((item) => getFoldTemplate(item.templateId)));
        const published = details.flatMap((template) => {
          const revision = template.revisions.find((item) => item.status === "PUBLISHED");
          return revision ? [{
            templateId: template.templateId,
            name: template.name,
            revisionId: revision.revisionId,
            revisionNumber: revision.revisionNumber,
          }] : [];
        });
        setPanelTemplates(published);
        setPanelTemplateRevisionId((current) => current || published[0]?.revisionId || "");
      })
      .catch(() => setPanelTemplates([]));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (
        target.isContentEditable
        || target.matches("input, textarea, select, button")
      )) return;
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) foldEditorStore.redo();
        else foldEditorStore.undo();
      } else if (command && event.key.toLowerCase() === "y") {
        event.preventDefault();
        foldEditorStore.redo();
      } else if (event.key === "Escape") {
        foldEditorStore.finishDrawing();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const element = drawingAreaRef.current;
    if (!element) return;
    const resizeObserver = new ResizeObserver(([entry]) => {
      setDrawingAreaHeight(Math.max(1, entry.contentRect.height));
    });
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => applySplitResize(event.clientX, event.clientY);
    const onPointerUp = () => finishSplitResize();
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  });

  return (
    <section data-testid="fold-workspace" className={`overflow-hidden border-y border-slate-300 bg-white lg:border xl:flex xl:min-h-0 xl:flex-1 xl:flex-col ${readOnly ? "[&_input]:pointer-events-none [&_input]:bg-slate-100 [&_select]:pointer-events-none [&_select]:bg-slate-100" : ""}`}>
      {readOnly ? (
        <div className="border-b border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">
          조회 전용 권한입니다. 화면 검토는 가능하지만 문서를 변경하거나 저장할 수 없습니다.
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-3 py-2">
        <span className="text-xs font-bold text-slate-700">도면 타입</span>
        <div className="grid grid-cols-2 gap-1 rounded bg-slate-100 p-1">
          <button type="button" disabled={readOnly} className={`inline-flex h-8 items-center gap-1.5 rounded px-3 text-xs font-semibold disabled:opacity-50 ${foldEditorStore.profile.profileType === "normal" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`} onClick={() => foldEditorStore.setProfileType("normal")}><Minus size={14} /> 일반</button>
          <button type="button" disabled={readOnly} className={`inline-flex h-8 items-center gap-1.5 rounded px-3 text-xs font-semibold disabled:opacity-50 ${foldEditorStore.profile.profileType === "box" ? "bg-teal-700 text-white" : "text-slate-500"}`} onClick={() => foldEditorStore.setProfileType("box")}><Box size={14} /> 박스</button>
        </div>
        {foldEditorStore.profile.profileType === "box" ? (
          <div className="flex items-center gap-1 border-l border-slate-300 pl-3">
            {foldEditorStore.profile.blocks.map((block) => (
              <button key={block.id} type="button" className={`h-8 rounded px-3 text-xs font-semibold ${block.id === foldEditorStore.activeBlockId ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-600"}`} onClick={() => foldEditorStore.setActiveBlock(block.id)}>{block.name}</button>
            ))}
            <button type="button" disabled={readOnly} className="ml-1 inline-flex h-8 items-center gap-1 rounded border border-teal-700 px-2.5 text-xs font-semibold text-teal-800 hover:bg-teal-50 disabled:opacity-50" onClick={foldEditorStore.startSecondBlock}><Plus size={14} /> 두 번째 시작점</button>
          </div>
        ) : null}
      </div>
      <div className="flex min-h-14 flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex items-center gap-1 border-r border-slate-300 pr-2">
          <ToolButton label="선택 도구" active={foldEditorStore.mode === "select"} onClick={() => foldEditorStore.setMode("select")}><MousePointer2 size={17} /></ToolButton>
          <ToolButton label="연속 선 그리기" active={foldEditorStore.mode === "draw"} disabled={readOnly || foldEditorStore.isClosed} onClick={() => foldEditorStore.setMode("draw")}><PencilLine size={17} /></ToolButton>
        </div>
        <div className="flex items-center gap-1 border-r border-slate-300 pr-2" aria-label="화면 모드">
          <ViewButton label="절곡" active={viewMode === "2d"} onClick={() => changeViewMode("2d")}><Square size={15} /></ViewButton>
          <ViewButton label="3D" active={viewMode === "3d"} onClick={() => changeViewMode("3d")}><Box size={15} /></ViewButton>
          <ViewButton label="전개도" active={viewMode === "developed"} onClick={() => changeViewMode("developed")}><LayoutTemplate size={15} /></ViewButton>
          <span className="hidden xl:inline-flex"><ViewButton label="분할" active={viewMode === "split"} onClick={() => changeViewMode("split")}><Columns2 size={15} /></ViewButton></span>
        </div>
        <div className="flex items-center gap-1 border-r border-slate-300 pr-2">
          <ToolButton label="실행 취소" disabled={readOnly || !foldEditorStore.canUndo} onClick={foldEditorStore.undo}><Undo2 size={17} /></ToolButton>
          <ToolButton label="다시 실행" disabled={readOnly || !foldEditorStore.canRedo} onClick={foldEditorStore.redo}><Redo2 size={17} /></ToolButton>
          <ToolButton label="선 삭제" disabled={readOnly || !selected} danger onClick={foldEditorStore.deleteSelected}><Trash2 size={17} /></ToolButton>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <span className={`h-2 w-2 rounded-full ${foldEditorStore.mode === "draw" ? "bg-teal-600" : "bg-slate-400"}`} />
          {foldEditorStore.isClosed
            ? "닫힌 도형입니다. 마지막 선을 삭제하면 다시 이어 그릴 수 있습니다."
            : foldEditorStore.mode === "draw"
              ? "점을 클릭해 연속 선을 입력하세요. 시작점을 클릭하면 도형이 닫힙니다."
              : "빈 공간을 드래그해 이동하고, 휠로 확대·축소하세요."}
        </div>
        <button type="button" disabled={readOnly} className="ml-auto inline-flex h-9 items-center gap-2 rounded border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50" onClick={foldEditorStore.clearProfile}>
          <RotateCcw size={15} /> 내용 초기화
        </button>
      </div>

      <ProductCalculationSummary
        calculation={calculation}
        boxWidth={boxWidth}
        boxDepth={boxDepth}
      />

      <div className="grid min-h-0 lg:grid-cols-[minmax(0,1fr)_clamp(300px,24vw,380px)] xl:flex-1">
        <div
          ref={drawingAreaRef}
          data-testid="drawing-area"
          style={viewMode === "split" ? { gridTemplateColumns: `${splitColumnPercent}% ${100 - splitColumnPercent}%` } : undefined}
          className={`relative h-[clamp(360px,55dvh,620px)] min-w-0 border-b border-slate-200 lg:border-b-0 lg:border-r xl:h-full xl:min-h-0 ${viewMode === "split" ? "xl:grid xl:content-start" : ""}`}
        >
          <div className={`${viewMode === "split" ? "" : "h-full"} min-w-0 ${viewMode === "3d" || viewMode === "developed" ? "hidden" : ""}`}><KonvaStage height={viewMode === "split" ? splitTopHeight : undefined} /></div>
          <div className={`${viewMode === "split" ? "" : "h-full"} min-w-0 ${viewMode === "2d" || viewMode === "developed" ? "hidden" : ""}`}><FoldModelPreview compact={viewMode === "split"} height={viewMode === "split" ? splitTopHeight : undefined} onSelectSegment={() => setPropertyTab("segment")} /></div>
          {viewMode === "developed" || viewMode === "split" ? (
            <div className={`${viewMode === "split" ? "border-t border-slate-200 xl:col-span-2" : "h-full"}`}>
              <DevelopedPatternPreview compact={viewMode === "split"} height={viewMode === "split" ? splitBottomHeight : undefined} />
            </div>
          ) : null}
          {viewMode === "split" ? <>
            <div
              role="separator"
              aria-label="2D 3D 영역 너비 조절"
              aria-orientation="vertical"
              aria-valuemin={28}
              aria-valuemax={72}
              aria-valuenow={Math.round(splitColumnPercent)}
              style={{ left: `${splitColumnPercent}%`, height: splitTopHeight }}
              className={`absolute top-0 z-20 hidden w-3 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center xl:flex ${splitResize?.axis === "column" ? "bg-teal-500/15" : "hover:bg-teal-500/10"}`}
              onPointerDown={startSplitResize("column")}
              onDoubleClick={() => setSplitColumnPercent(50)}
            ><span className="h-12 w-1 rounded bg-slate-400 shadow-sm" /></div>
            <div
              role="separator"
              aria-label="전개도 영역 높이 조절"
              aria-orientation="horizontal"
              aria-valuemin={25}
              aria-valuemax={75}
              aria-valuenow={Math.round(splitRowPercent)}
              style={{ top: splitTopHeight }}
              className={`absolute left-0 right-0 z-20 hidden h-3 -translate-y-1/2 cursor-row-resize touch-none items-center justify-center xl:flex ${splitResize?.axis === "row" ? "bg-teal-500/15" : "hover:bg-teal-500/10"}`}
              onPointerDown={startSplitResize("row")}
              onDoubleClick={() => setSplitRowPercent(55)}
            ><span className="h-1 w-12 rounded bg-slate-400 shadow-sm" /></div>
          </> : null}
        </div>
        <aside data-testid="property-panel" className="flex min-w-0 flex-col bg-white xl:h-full xl:min-h-0 xl:overflow-y-auto">
          <div className="sticky top-0 z-20 grid grid-cols-4 border-b border-slate-200 bg-slate-50 p-1">
            <button type="button" onClick={() => setPropertyTab("segment")} className={`h-9 rounded text-xs font-semibold ${propertyTab === "segment" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>선 속성</button>
            <button type="button" onClick={() => setPropertyTab("material")} className={`inline-flex h-9 items-center justify-center gap-1.5 rounded text-xs font-semibold ${propertyTab === "material" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}><SlidersHorizontal size={14} /> 연신율 설정</button>
            <button type="button" onClick={() => setPropertyTab("formula")} className={`inline-flex h-9 items-center justify-center gap-1.5 rounded text-xs font-semibold ${propertyTab === "formula" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}><Sigma size={14} /> 변수·수식</button>
            <button type="button" onClick={() => setPropertyTab("points")} className={`inline-flex h-9 items-center justify-center gap-1.5 rounded text-xs font-semibold ${propertyTab === "points" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}><ListOrdered size={14} /> 포인트</button>
          </div>

          {propertyTab === "segment" ? selected ? (
            <div className="space-y-4 border-b border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900">선 {foldEditorStore.activeBlock.segments.indexOf(selected) + 1}</h2>
                <span className="font-mono text-[11px] text-slate-500">{foldEditorStore.activeBlock.name}</span>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 text-xs font-semibold text-slate-600">선 형상</p>
                <div className="grid grid-cols-2 gap-1 rounded bg-slate-200/70 p-1">
                  <button type="button" disabled={readOnly} aria-pressed={(selected.geometry?.kind ?? "line") === "line"} onClick={() => void convertSelectedToLine()} className={`h-8 rounded text-xs font-semibold disabled:opacity-50 ${(selected.geometry?.kind ?? "line") === "line" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600"}`}>직선</button>
                  <button type="button" disabled={readOnly} aria-pressed={selected.geometry?.kind === "arc"} onClick={() => foldEditorStore.setSelectedGeometry("arc")} className={`h-8 rounded text-xs font-semibold disabled:opacity-50 ${selected.geometry?.kind === "arc" ? "bg-teal-700 text-white" : "text-slate-600"}`}>원호</button>
                </div>
                {selected.geometry?.kind === "arc" ? <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-1 rounded bg-white p-1">
                    {(["left", "right"] as const).map((side) => <button key={side} type="button" disabled={readOnly} onClick={() => foldEditorStore.updateSelectedArc(side, selected.geometry!.kind === "arc" ? selected.geometry!.sagitta : 1)} className={`h-8 rounded text-xs font-semibold ${selected.geometry?.kind === "arc" && selected.geometry.side === side ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{side === "left" ? "진행 방향 왼쪽" : "진행 방향 오른쪽"}</button>)}
                  </div>
                  <Field label="곡 깊이 (mm)"><input aria-label="곡 깊이 (mm)" type="number" min="0.000001" step="0.1" disabled={readOnly} value={selected.geometry.sagitta} onChange={(event) => foldEditorStore.updateSelectedArc(selected.geometry!.kind === "arc" ? selected.geometry!.side : "left", Number(event.target.value))} className="field-control" /></Field>
                  <div className="grid grid-cols-2 gap-2 rounded bg-teal-50 px-3 py-2 text-[11px] text-teal-900">
                    <span>현 길이 <strong className="block font-mono text-xs">{selectedCalculation?.throughLengthDecimal ?? selected.inputLength} mm</strong></span>
                    <span>호 길이 <strong className="block font-mono text-xs">{selectedCalculation?.baseLengthDecimal ?? "-"} mm</strong></span>
                  </div>
                  <p className="text-[11px] leading-5 text-slate-500">캔버스의 원호 중앙 핸들을 드래그해 곡 깊이와 좌우 방향을 함께 바꿀 수 있습니다.</p>
                </div> : null}
              </div>
              <div className="rounded border border-sky-200 bg-sky-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div><p className="text-xs font-bold text-sky-950">연결 패널</p><p className="mt-0.5 text-[11px] text-sky-800">이 선에 독립 패널 단면을 연결합니다.</p></div>
                  {!selectedPanel ? <button type="button" disabled={readOnly} onClick={foldEditorStore.addPanelToSelected} className="h-8 shrink-0 rounded bg-sky-700 px-3 text-xs font-bold text-white disabled:opacity-40">패널 연결</button> : <button type="button" disabled={readOnly} onClick={() => void removeSelectedPanel()} className="h-8 shrink-0 rounded border border-red-300 bg-white px-3 text-xs font-bold text-red-700 disabled:opacity-40">연결 제거</button>}
                </div>
                {selectedPanel ? <div className="mt-3 space-y-3 border-t border-sky-200 pt-3">
                  <div className="rounded border border-sky-200 bg-white p-2">
                    <p className="mb-1 text-[11px] font-bold text-sky-900">게시 패널 템플릿</p>
                    <div className="flex gap-2">
                      <select aria-label="게시 패널 템플릿" className="field-control mt-0 min-w-0 flex-1 bg-white" disabled={readOnly || panelTemplates.length === 0} value={panelTemplateRevisionId} onChange={(event) => setPanelTemplateRevisionId(event.target.value)}>
                        {panelTemplates.length === 0 ? <option value="">게시된 패널 템플릿 없음</option> : panelTemplates.map((template) => <option key={template.templateId} value={template.revisionId}>{template.name} · r{template.revisionNumber}</option>)}
                      </select>
                      <button type="button" className="shrink-0 rounded bg-sky-700 px-3 text-xs font-bold text-white disabled:opacity-40" disabled={readOnly || !panelTemplateRevisionId} onClick={() => void applySelectedPanelTemplate()}>적용</button>
                    </div>
                    {selectedPanel.sourceRevisionId ? <p className="mt-1 truncate font-mono text-[10px] text-slate-500">원본 {selectedPanel.sourceRevisionId} · {selectedPanel.sourceChecksum?.slice(0, 12)}</p> : null}
                  </div>
                  <Field label="패널 이름"><input value={selectedPanel.name} disabled={readOnly} onChange={(event) => foldEditorStore.updatePanelAttachment(selectedPanel.id, { name: event.target.value })} className="field-control" /></Field>
                  <Field label="패널 최대 현 길이 (mm)"><input aria-label="패널 최대 현 길이 (mm)" type="number" min="0.000001" step="0.1" value={selectedPanel.block.segments[0]?.inputLength ?? 0} disabled={readOnly} onChange={(event) => foldEditorStore.updatePanelAttachment(selectedPanel.id, { spanMm: Number(event.target.value) })} className="field-control" /></Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="연결 방향"><select value={selectedPanel.direction} disabled={readOnly} onChange={(event) => foldEditorStore.updatePanelAttachment(selectedPanel.id, { direction: event.target.value as "clockwise" | "counterclockwise" })} className="field-control bg-white"><option value="clockwise">시계 방향</option><option value="counterclockwise">반시계 방향</option></select></Field>
                    <Field label="계산 역할"><select value={selectedPanel.dimensionRole} disabled={readOnly} onChange={(event) => foldEditorStore.updatePanelAttachment(selectedPanel.id, { dimensionRole: event.target.value as "none" | "secondary-product-dimension" })} className="field-control bg-white"><option value="none">형상만</option><option value="secondary-product-dimension">제품 두 번째 치수</option></select></Field>
                  </div>
                </div> : null}
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold text-slate-600">길이 입력 방식</p>
                <div className="grid grid-cols-2 gap-1 rounded bg-slate-100 p-1">
                  <button type="button" aria-pressed={!selected.formula} onClick={() => foldEditorStore.setSelectedFormula(null)} className={`h-8 rounded text-xs font-semibold ${!selected.formula ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>직접 입력</button>
                  <button type="button" aria-pressed={Boolean(selected.formula)} onClick={() => foldEditorStore.setSelectedFormula(selected.formula ?? String(selected.inputLength))} className={`h-8 rounded text-xs font-semibold ${selected.formula ? "bg-teal-700 text-white" : "text-slate-500"}`}>수식 입력</button>
                </div>
              </div>
              {selected.formula ? <>
                <Field label="구간 길이 수식"><input aria-invalid={Boolean(selectedFormulaIssue)} value={selected.formula} onChange={(event) => foldEditorStore.setSelectedFormula(event.target.value)} placeholder="예: (W-D1-D2)/2" className={`field-control font-mono ${selectedFormulaIssue ? "border-red-500" : ""}`} /></Field>
                {selectedFormulaIssue ? <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{selectedFormulaIssue.message}</p> : <p className="rounded bg-teal-50 px-3 py-2 text-xs text-teal-800">계산 길이: <strong className="font-mono">{selectedCalculation?.inputLengthDecimal ?? selected.inputLength} mm</strong></p>}
              </> : <Field label="입력 길이 (mm)"><input type="number" min="1" step="0.1" value={Number(selected.inputLength.toFixed(2))} onChange={(event) => foldEditorStore.updateSelectedLength(Number(event.target.value))} className="field-control" /></Field>}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-600">끝점 절곡</span>
                  {bend ? <button type="button" className="text-xs font-semibold text-red-700 hover:underline" onClick={foldEditorStore.removeSelectedBend}>제거</button> : null}
                </div>
                {!bend ? (
                  <button type="button" className="inline-flex h-9 w-full items-center justify-center gap-2 rounded border border-dashed border-slate-400 text-xs font-semibold text-slate-700 hover:border-teal-600 hover:text-teal-700" onClick={() => updateBend({})}><CornerDownRight size={15} /> 절곡 추가</button>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-1 rounded bg-slate-100 p-1">
                      {(["front", "back"] as const).map((direction) => (
                        <button key={direction} type="button" className={`h-8 rounded text-xs font-semibold ${bend.direction === direction ? direction === "front" ? "bg-red-600 text-white" : "bg-blue-600 text-white" : "text-slate-600 hover:bg-white"}`} onClick={() => updateBend({ direction })}>{direction === "front" ? "앞각" : "뒷각"}</button>
                      ))}
                    </div>
                    <Field label="절곡 형태"><select aria-label="절곡 형태" value={bend.form ?? "standard"} onChange={(event) => {
                      const form = event.target.value as BendForm;
                      foldEditorStore.updateSelectedBendOperations(
                        form,
                        bend.secondaryOperation ? { ...bend.secondaryOperation, form } : undefined,
                      );
                    }} className="field-control bg-white"><option value="standard">표준</option><option value="a">A형</option><option value="zero">ZERO형</option><option value="u">U형</option></select></Field>
                    <Field label="절곡 구성"><select aria-label="절곡 구성" value={bend.secondaryOperation ? `${bend.direction}-${bend.secondaryOperation.direction}` : "single"} onChange={(event) => {
                      const form = bend.form ?? "standard";
                      if (event.target.value === "single") {
                        foldEditorStore.updateSelectedBendOperations(form);
                      } else if (event.target.value === "front-back") {
                        foldEditorStore.updateSelectedBendOperations(form, { direction: "back", form }, "front");
                      } else {
                        foldEditorStore.updateSelectedBendOperations(form, { direction: "front", form }, "back");
                      }
                    }} className="field-control bg-white"><option value="single">단일 절곡</option><option value="front-back">앞각 → 뒷각</option><option value="back-front">뒷각 → 앞각</option></select></Field>
                    <Field label="컷 타입"><select value={bend.cutType} onChange={(event) => updateBend({ cutType: event.target.value as CutType })} className="field-control bg-white"><option value="v-cut">V-CUT</option><option value="a-cut">A-CUT</option><option value="no-cut">NO-CUT</option></select></Field>
                    <Field label="절곡 각도 (°)"><input type="number" min="0" max="180" value={bend.angle} onChange={(event) => updateBend({ angle: Number(event.target.value) })} className="field-control" /></Field>
                    <label className="flex items-start gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                      <input aria-label="이 절곡의 연신 계산 적용" type="checkbox" checked={selected.calculateElongation ?? true} onChange={(event) => foldEditorStore.setSelectedCalculateElongation(event.target.checked)} className="mt-0.5 h-4 w-4 accent-teal-700" />
                      <span><strong className="block">연신 계산 적용</strong><span className="mt-0.5 block text-[11px] text-slate-500">해제하면 이 절곡은 양쪽 구간 계산에서 제외됩니다.</span></span>
                    </label>
                  </div>
                )}
              </div>
              <div className="border-t border-slate-200 pt-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-600">선 연신 보정</span>
                  <span className="font-mono text-xs font-bold text-teal-700">{selectedCalculation ? formatCalculatedLength(selectedCalculation.appliedCorrectionDecimal, foldEditorStore.profile.calculation.decimalPlaces, foldEditorStore.profile.calculation.decimalOperation) : "0"} mm</span>
                </div>
                <div className="grid grid-cols-2 gap-1 rounded bg-slate-100 p-1">
                  <button type="button" onClick={() => foldEditorStore.setSelectedElongationOverride(null)} className={`h-8 rounded text-xs font-semibold ${selected.elongationOverride === undefined ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>자동</button>
                  <button type="button" onClick={() => foldEditorStore.setSelectedElongationOverride(selectedCalculation?.automaticCorrection ?? 0)} className={`h-8 rounded text-xs font-semibold ${selected.elongationOverride !== undefined ? "bg-teal-700 text-white" : "text-slate-500"}`}>수동</button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div><p className="text-[11px] text-slate-500">자동 계산</p><p className="mt-1 font-mono text-sm font-semibold text-slate-700">{selectedCalculation ? formatCanonicalDecimal(selectedCalculation.automaticCorrectionDecimal) : "0"} mm</p></div>
                  <Field label="적용값 (mm)"><input type="number" step="0.1" disabled={selected.elongationOverride === undefined} value={selected.elongationOverride ?? selectedCalculation?.automaticCorrection ?? 0} onChange={(event) => foldEditorStore.setSelectedElongationOverride(Number(event.target.value))} className="field-control disabled:bg-slate-100 disabled:text-slate-500" /></Field>
                </div>
              </div>
            </div>
          ) : <div className="border-b border-slate-200 px-4 py-8 text-center text-xs text-slate-500">캔버스에서 선을 선택하세요.</div> : propertyTab === "material" ? <MaterialSettings /> : propertyTab === "formula" ? <VariableSettings /> : <PointList />}
        </aside>
      </div>
    </section>
  );
});

const ProductCalculationSummary = observer(function ProductCalculationSummary({
  calculation,
  boxWidth,
  boxDepth,
}: {
  calculation: ProductCalculation;
  boxWidth: number;
  boxDepth: number;
}) {
  const profile = foldEditorStore.profile;
  const decimalPlaces = profile.calculation.decimalPlaces;
  const decimalOperation = profile.calculation.decimalOperation;
  const blocks = foldEditorStore.blockCalculations;
  const sheet = profile.sheetItemSnapshot;
  const sheetAreaRatio = sheet
    ? divideCanonicalDecimals(calculation.areaTotalM2Decimal, sheet.usableAreaM2, 3)
    : null;
  const calculatedWidth = `${formatCalculatedLength(calculation.calculatedWidthDecimal, decimalPlaces, decimalOperation)} mm`;

  return (
    <section
      aria-label={profile.profileType === "box" ? "박스 크기 계산 요약" : "제품 크기 계산 요약"}
      data-testid="product-calculation-summary"
      className="border-b border-teal-200 bg-gradient-to-r from-white via-teal-50/60 to-sky-50/70 px-3 py-2 text-slate-900 sm:px-4"
    >
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-teal-100 text-teal-700"><Calculator size={14} /></span>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className="text-xs font-bold sm:text-sm">{profile.profileType === "box" ? "박스 크기 계산" : "제품 크기 계산"}</h2>
            <p className="text-[10px] text-slate-500">도면과 입력값 변경이 즉시 반영됩니다.</p>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          {sheet ? <span className="max-w-[34rem] truncate whitespace-nowrap rounded-full border border-sky-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-sky-900 shadow-sm" title={`원판 ${sheet.name} · ${sheet.widthMm}×${sheet.lengthMm}mm · 유효 ${sheet.usableAreaM2}㎡ · ${sheet.effectiveWeightKg ? `${sheet.effectiveWeightKg}kg` : "중량 미산출"} · 총면적/유효면적 ${sheetAreaRatio ?? "-"} · 실제 장수 계산 아님`}>원판 {sheet.code} · 유효 {sheet.usableAreaM2}㎡ · {sheet.effectiveWeightKg ? `${sheet.effectiveWeightKg}kg` : "중량 미산출"} · 면적비 {sheetAreaRatio ?? "-"} (장수 아님)</span> : null}
          <span className="rounded-full border border-teal-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-teal-800 shadow-sm">
            {profile.calculation.mode === "fixed" ? "FIX" : "RATIO"} · {decimalOperation === "none" ? "소수 유지" : `${decimalPlaces}자리`}
          </span>
        </div>
      </div>

      {profile.profileType === "box" ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-7">
          {boxWidth <= 0 || boxDepth <= 0 ? <div role="alert" className="col-span-2 rounded-md border border-amber-300 bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-950 sm:col-span-3 xl:col-span-7">가로·세로 두 단면에 서로 교차하는 바닥 직선을 그리면 박스 크기와 전개도·3D가 자동 계산됩니다.</div> : null}
          <SummaryMetric label="바닥 크기" value={`${boxWidth.toFixed(1)} × ${boxDepth.toFixed(1)} mm`} emphasis wide />
          <SummaryMetric label="가로 단면 전개 폭" value={`${blocks[0] ? formatCalculatedLength(blocks[0].calculatedWidthDecimal, decimalPlaces, decimalOperation) : "0"} mm`} />
          <SummaryMetric label="세로 단면 전개 폭" value={`${blocks[1] ? formatCalculatedLength(blocks[1].calculatedWidthDecimal, decimalPlaces, decimalOperation) : "0"} mm`} />
          <SummaryMetric label="바닥 가로" value={`${boxWidth.toFixed(1)} mm`} />
          <SummaryMetric label="바닥 세로" value={`${boxDepth.toFixed(1)} mm`} />
          <SummaryQuantity value={calculation.quantity} />
          {calculation.panelSpanDecimal ? <SummaryMetric label="패널 두 번째 치수" value={`${formatCanonicalDecimal(calculation.panelSpanDecimal)} mm`} /> : null}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-8">
          <div className="col-span-2 rounded-md border border-teal-300 bg-teal-100/80 px-2.5 py-2 shadow-sm">
            <p className="text-[10px] font-semibold text-teal-800">최종 전개 폭</p>
            <p className="font-mono text-2xl font-black tracking-tight text-teal-950">{calculatedWidth}</p>
            <p className="text-[10px] text-teal-800/80">원래 {formatCanonicalDecimal(calculation.inputLengthTotalDecimal)} mm · 보정 {formatCalculatedLength(calculation.appliedCorrectionTotalDecimal, decimalPlaces, decimalOperation)} mm</p>
          </div>
          <SummaryProductLength calculation={calculation} />
          <SummaryQuantity value={calculation.quantity} />
          <SummaryMetric label="제품 1개 전개 크기" value={`${formatCalculatedLength(calculation.sizeDecimal.width, decimalPlaces, decimalOperation)} × ${formatCanonicalDecimal(calculation.sizeDecimal.length)} mm`} wide />
          <SummaryMetric label="제품 1개 면적" value={`${formatArea(calculation.areaEachM2Decimal)} m²`} />
          <SummaryMetric label="총면적" value={`${formatArea(calculation.areaTotalM2Decimal)} m²`} emphasis />
          {calculation.panelSpanDecimal ? <SummaryMetric label="패널 두 번째 치수" value={`${formatCanonicalDecimal(calculation.panelSpanDecimal)} mm`} /> : null}
        </div>
      )}
    </section>
  );
});

function SummaryProductLength({ calculation }: { calculation: ProductCalculation }) {
  const formulaEnabled = foldEditorStore.profile.product.formulaEnabled ?? false;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2.5 py-2 shadow-sm">
      <p className="text-[10px] font-semibold text-slate-500">제품 길이</p>
      <div className="mt-0.5 flex items-center gap-1">
        <p className="min-w-0 flex-1 whitespace-nowrap font-mono text-xs font-bold text-slate-900">{formatCanonicalDecimal(calculation.productLengthDecimal)} mm</p>
        <label className="shrink-0">
          <span className="sr-only">{formulaEnabled ? "수식 계산값" : "직접 입력"}</span>
          <input
            aria-label="길이 (mm)"
            type="number"
            min="0"
            disabled={formulaEnabled}
            value={formulaEnabled ? calculation.productLength : foldEditorStore.profile.product.length}
            onChange={(event) => foldEditorStore.setProductLength(Number(event.target.value))}
            className="h-7 w-16 rounded border border-slate-300 bg-slate-50 px-1.5 font-mono text-xs font-semibold text-slate-900 outline-none focus:border-teal-500 focus:bg-white disabled:bg-slate-100 disabled:text-slate-500"
          />
        </label>
      </div>
    </div>
  );
}

function SummaryQuantity({ value }: { value: number }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2.5 py-2 shadow-sm">
      <p className="text-[10px] font-semibold text-slate-500">수량</p>
      <div className="mt-0.5 flex items-center gap-1">
        <p className="min-w-0 flex-1 whitespace-nowrap font-mono text-xs font-bold text-slate-900">{value.toLocaleString()} 개</p>
        <label className="shrink-0">
          <span className="sr-only">수량 입력</span>
          <input
            aria-label="수량"
            type="number"
            min="1"
            step="1"
            value={foldEditorStore.profile.product.quantity}
            onChange={(event) => foldEditorStore.setQuantity(Number(event.target.value))}
            className="h-7 w-16 rounded border border-slate-300 bg-slate-50 px-1.5 font-mono text-xs font-semibold text-slate-900 outline-none focus:border-teal-500 focus:bg-white"
          />
        </label>
      </div>
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  emphasis = false,
  wide = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={`${wide ? "col-span-2" : ""} rounded-md border px-2.5 py-2 shadow-sm ${emphasis ? "border-teal-300 bg-teal-100/80" : "border-slate-200 bg-white"}`}>
      <p className={`text-[10px] font-semibold ${emphasis ? "text-teal-800" : "text-slate-500"}`}>{label}</p>
      <p className={`mt-0.5 font-mono font-bold tracking-tight ${emphasis ? "text-base text-teal-950" : "text-sm text-slate-900"}`}>{value}</p>
    </div>
  );
}

const PointList = observer(function PointList() {
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const blocks = foldEditorStore.profile.blocks.map((block) => ({ block, points: createFoldPointList(block) }));
  const cutLabel = { "v-cut": "V-CUT", "a-cut": "A-CUT", "no-cut": "NO-CUT" } as const;

  return (
    <div className="max-h-[620px] overflow-y-auto border-b border-slate-200 bg-white">
      {blocks.every(({ points }) => points.length === 0) ? <div className="px-4 py-8 text-center text-xs text-slate-500">절곡도를 그리면 포인트 정보가 표시됩니다.</div> : blocks.map(({ block, points }) => points.length > 0 ? (
        <section key={block.id} aria-label={`${block.name} 포인트 목록`}>
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-slate-100 px-3 py-2">
            <h2 className="text-xs font-bold text-slate-800">{block.name}</h2>
            <span className="font-mono text-[10px] text-slate-500">{points.length} POINTS</span>
          </div>
          <div className="grid grid-cols-[36px_1fr_1fr_58px_58px_42px] border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-center text-[10px] font-semibold text-slate-500">
            <span>번호</span><span>X</span><span>Y</span><span>방향</span><span>컷</span><span>각도</span>
          </div>
          {points.map((item) => {
            const selected = selectedPointId === item.id;
            return (
              <button key={item.id} type="button" onClick={() => { setSelectedPointId(item.id); foldEditorStore.selectSegment(item.segmentId, item.blockId); }} className={`block w-full border-b border-slate-100 px-2 py-2 text-left transition ${selected ? "bg-teal-50" : "hover:bg-slate-50"}`}>
                <span className="grid grid-cols-[36px_1fr_1fr_58px_58px_42px] items-center text-center font-mono text-[11px] text-slate-700">
                  <strong className={selected ? "text-teal-800" : "text-slate-900"}>P{item.index + 1}</strong>
                  <span>{item.point.x.toFixed(1)}</span>
                  <span>{item.point.y.toFixed(1)}</span>
                  <span className={item.bend?.direction === "front" ? "font-sans font-bold text-red-700" : item.bend ? "font-sans font-bold text-blue-700" : "text-slate-400"}>{item.bend ? item.bend.direction === "front" ? "앞각" : "뒷각" : "-"}</span>
                  <span className="font-sans text-[10px] font-semibold">{item.bend ? cutLabel[item.bend.cutType] : "-"}</span>
                  <span>{item.bend ? item.bend.angle.toFixed(0) : "-"}</span>
                </span>
                <span className="mt-1 block pl-9 text-[10px] text-slate-400">진입 {item.incomingLength?.toFixed(1) ?? "-"} mm · 진출 {item.outgoingLength?.toFixed(1) ?? "-"} mm</span>
              </button>
            );
          })}
        </section>
      ) : null)}
    </div>
  );
});

const VariableSettings = observer(function VariableSettings() {
  const { confirm: confirmPopup } = useCommonPopup();
  const profile = foldEditorStore.profile;
  const resolution = foldEditorStore.expressionResolution;
  const productIssue = resolution.issues.find((issue) => issue.path === "product.formula");

  async function removeVariable(index: number, name: string) {
    const confirmed = await confirmPopup({
      title: "변수 삭제",
      message: `${name || "이 변수"}를 삭제하면 참조 중인 수식에 오류가 표시됩니다. 삭제할까요?`,
      confirmText: "삭제",
      cancelText: "취소",
      variant: "danger",
    });
    if (confirmed) foldEditorStore.removeVariable(index);
  }

  return (
    <div className="max-h-[620px] space-y-4 overflow-y-auto border-b border-slate-200 p-4">
      <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-600">
        <p className="font-bold text-slate-800">수식 문법 · fold-expression-v1</p>
        <p>대문자 변수와 숫자, `+ - * / ( )`를 사용합니다. 예: `(W-D1-D2)/2`</p>
      </div>

      <section className="space-y-3" aria-label="문서 변수">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">문서 변수</h2>
          <button type="button" disabled={foldEditorStore.readOnly || profile.variables.length >= 256} onClick={foldEditorStore.addVariable} className="inline-flex h-8 items-center gap-1 rounded border border-teal-700 px-2.5 text-xs font-semibold text-teal-800 hover:bg-teal-50 disabled:opacity-50"><Plus size={13} /> 변수 추가</button>
        </div>
        {profile.variables.length === 0 ? <p className="rounded border border-dashed border-slate-300 px-3 py-5 text-center text-xs text-slate-500">변수를 추가하면 구간과 제품 길이 수식에서 사용할 수 있습니다.</p> : profile.variables.map((variable, index) => {
          const issue = resolution.issues.find((item) => item.path.startsWith(`variables[${index}]`));
          const resolved = resolution.variableValues[variable.name];
          return (
            <div key={index} className={`space-y-2 rounded border p-3 ${issue ? "border-red-300 bg-red-50/40" : "border-slate-200"}`}>
              <div className="grid grid-cols-[minmax(0,1fr)_80px] gap-2">
                <Field label={`변수 ${index + 1} 이름`}><input value={variable.name} onChange={(event) => foldEditorStore.updateVariable(index, { name: event.target.value })} placeholder="예: W" className="field-control font-mono uppercase" /></Field>
                <button type="button" onClick={() => void removeVariable(index, variable.name)} className="mt-5 h-9 rounded border border-slate-300 text-xs font-semibold text-red-700 hover:bg-red-50">삭제</button>
              </div>
              <div className="grid grid-cols-2 gap-1 rounded bg-slate-100 p-1">
                <button type="button" aria-pressed={!variable.formula} onClick={() => foldEditorStore.updateVariable(index, { formula: "" })} className={`h-8 rounded text-xs font-semibold ${!variable.formula ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>직접값</button>
                <button type="button" aria-pressed={Boolean(variable.formula)} onClick={() => foldEditorStore.updateVariable(index, { formula: variable.formula ?? String(variable.value) })} className={`h-8 rounded text-xs font-semibold ${variable.formula ? "bg-teal-700 text-white" : "text-slate-500"}`}>계산식</button>
              </div>
              {variable.formula ? <Field label={`변수 ${variable.name || index + 1} 수식`}><input aria-invalid={Boolean(issue)} value={variable.formula} onChange={(event) => foldEditorStore.updateVariable(index, { formula: event.target.value })} placeholder="예: BASE/2" className="field-control font-mono" /></Field> : <Field label={`변수 ${variable.name || index + 1} 값 (mm)`}><input type="number" step="0.1" value={variable.value} onChange={(event) => foldEditorStore.updateVariable(index, { value: Number(event.target.value) })} className="field-control" /></Field>}
              {issue ? <p className="text-xs text-red-700" role="alert">{issue.message}</p> : <p className="text-[11px] text-slate-500">계산값 <strong className="font-mono text-teal-800">{resolved ?? "-"} mm</strong></p>}
            </div>
          );
        })}
      </section>

      <section className="space-y-3 border-t border-slate-200 pt-4" aria-label="제품 길이 수식">
        <label className="flex items-center justify-between text-xs font-semibold text-slate-700">
          <span>제품 길이 수식 사용</span>
          <input type="checkbox" checked={profile.product.formulaEnabled ?? false} onChange={(event) => foldEditorStore.setProductFormula(profile.product.formula ?? String(profile.product.length), event.target.checked)} className="h-4 w-4 accent-teal-700" />
        </label>
        <Field label="제품 길이 수식"><input disabled={!profile.product.formulaEnabled} aria-invalid={Boolean(productIssue)} value={profile.product.formula ?? ""} onChange={(event) => foldEditorStore.setProductFormula(event.target.value, true)} placeholder="예: H-20" className="field-control font-mono disabled:bg-slate-100 disabled:text-slate-500" /></Field>
        {productIssue ? <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{productIssue.message}</p> : profile.product.formulaEnabled ? <p className="rounded bg-teal-50 px-3 py-2 text-xs text-teal-800">계산 제품 길이: <strong className="font-mono">{resolution.productLengthDecimal} mm</strong></p> : null}
      </section>

      {resolution.issues.length > 0 ? <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" role="status">수식 오류 {resolution.issues.length}건이 있습니다. 오류가 있는 수식은 마지막 직접 입력값을 유지합니다.</div> : null}
    </div>
  );
});

const MaterialSettings = observer(function MaterialSettings() {
  const material = foldEditorStore.profile.material;
  const calculation = foldEditorStore.profile.calculation;

  return (
    <div className="space-y-4 border-b border-slate-200 p-4">
      <p className="rounded bg-teal-50 px-3 py-2 text-xs leading-5 text-teal-800">
        서버에 발행된 재질 계산 기준입니다. 재질 변경은 상단 초안 도구에서 선택하세요.
      </p>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded border border-slate-200 bg-slate-50 p-3"><dt className="text-slate-500">재질·두께</dt><dd className="mt-1 font-bold text-slate-900">{material.name} · {material.thickness}T</dd></div>
        <div className="rounded border border-slate-200 bg-slate-50 p-3"><dt className="text-slate-500">내측반경</dt><dd className="mt-1 font-bold text-slate-900">{material.insideBendRadius} mm</dd></div>
        <div className="rounded border border-slate-200 bg-slate-50 p-3"><dt className="text-slate-500">연신율 V/A/N</dt><dd className="mt-1 font-mono font-bold text-slate-900">{material.elongation["v-cut"]} / {material.elongation["a-cut"]} / {material.elongation["no-cut"]}</dd></div>
        <div className="rounded border border-slate-200 bg-slate-50 p-3"><dt className="text-slate-500">컷 제한각</dt><dd className="mt-1 font-bold text-slate-900">{material.cutAngle}° 미만</dd></div>
      </dl>
      <fieldset disabled className="space-y-3 border-t border-slate-200 pt-4 opacity-65">
        <div>
          <p className="mb-2 text-xs font-semibold text-slate-600">계산 방식</p>
          <div className="grid grid-cols-2 gap-1 rounded bg-slate-100 p-1">
            {(["fixed", "ratio"] as ElongationMode[]).map((mode) => <button key={mode} type="button" aria-pressed={calculation.mode === mode} onClick={() => foldEditorStore.setCalculationPolicy(mode, calculation.elongationOption, calculation.vCutEnabled)} className={`h-8 rounded text-xs font-semibold ${calculation.mode === mode ? "bg-teal-700 text-white" : "text-slate-600 hover:bg-white"}`}>{mode === "fixed" ? "FIX 고정값" : "RATIO 비율"}</button>)}
          </div>
        </div>
        <Field label="연신 적용 옵션"><select aria-label="연신 적용 옵션" disabled={calculation.mode === "ratio"} value={calculation.elongationOption} onChange={(event) => foldEditorStore.setCalculationPolicy(calculation.mode, event.target.value as ElongationOption, calculation.vCutEnabled)} className="field-control bg-white disabled:bg-slate-100 disabled:text-slate-500"><option value="standard">표준 · 항상 적용</option><option value="two-line">2선 · 제한각 미만</option><option value="diagonal">대각선 우선</option><option value="ext1">확장1 · 앞각 우선</option></select></Field>
        <label className="flex items-center justify-between rounded border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">
          <span><span className="block">V-CUT 사용</span><span className="mt-0.5 block text-[11px] font-normal text-slate-500">끄면 모든 절곡에 NO-CUT 값을 적용합니다.</span></span>
          <input aria-label="V-CUT 사용" type="checkbox" checked={calculation.vCutEnabled} onChange={(event) => foldEditorStore.setCalculationPolicy(calculation.mode, calculation.elongationOption, event.target.checked)} className="h-4 w-4 accent-teal-700" />
        </label>
        <p className="rounded bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-600">{calculation.mode === "ratio" ? "RATIO는 절곡 각도가 제한각 미만일 때만 적용하며, 연신 적용 옵션과 무관합니다." : calculation.elongationOption === "standard" ? "모든 유효 절곡의 고정 연신값을 적용합니다." : calculation.elongationOption === "two-line" ? "절곡 각도가 제한각 미만인 양쪽 절곡만 적용합니다." : calculation.elongationOption === "diagonal" ? "대각 구간은 항상 적용하고, 수평·수직 구간은 제한각 미만만 적용합니다." : "앞각이 포함되면 양쪽을 감산하고, 양쪽이 모두 뒷각이면 적용하지 않습니다."}</p>
      </fieldset>
      <div className="pointer-events-none grid grid-cols-2 gap-3 border-t border-slate-200 pt-4 opacity-65">
        <Field label="계산 소수점"><select disabled value={calculation.decimalPlaces} onChange={(event) => foldEditorStore.setDecimalSettings(Number(event.target.value), calculation.decimalOperation)} className="field-control bg-white">{[0, 1, 2, 3, 4, 5, 6].map((places) => <option key={places} value={places}>{places}자리</option>)}</select></Field>
        <Field label="처리 방식"><select disabled value={calculation.decimalOperation} onChange={(event) => foldEditorStore.setDecimalSettings(calculation.decimalPlaces, event.target.value as DecimalOperation)} className="field-control bg-white"><option value="none">처리 안 함</option><option value="round">반올림 (절반은 0에서 멀리)</option><option value="floor">버림 (0 방향)</option><option value="ceil">올림 (0에서 먼 방향)</option></select></Field>
      </div>
      <div className="rounded border border-teal-200 bg-teal-50 px-3 py-2 text-[11px] leading-5 text-teal-900" role="note" aria-label="Decimal 계산 정책">
        <p className="font-bold">정확한 Decimal 계산 · {FOLD_CALCULATION_ENGINE_VERSION}</p>
        <p>중간 보정값은 소수 6자리까지 보존하며, 선택한 처리는 각 구간의 최종 길이에만 적용합니다.</p>
      </div>
    </div>
  );
});

function ToolButton({ label, active = false, disabled = false, danger = false, onClick, children }: { label: string; active?: boolean; disabled?: boolean; danger?: boolean; onClick: () => void; children: React.ReactNode }) {
  const color = active ? "border-teal-700 bg-teal-700 text-white" : danger ? "border-slate-300 bg-white text-red-700 hover:bg-red-50" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100";
  return <Tooltip label={label}><button type="button" aria-label={label} aria-pressed={active} disabled={disabled} className={`${toolButton} ${color} disabled:cursor-not-allowed disabled:opacity-35`} onClick={onClick}>{children}</button></Tooltip>;
}

function ViewButton({ label, active, disabled = false, onClick, children }: { label: string; active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={active} disabled={disabled} onClick={onClick} className={`inline-flex h-9 items-center gap-1.5 rounded px-2.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-35 ${active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-200 disabled:hover:bg-transparent"}`}>{children}{label}</button>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs font-semibold text-slate-600">{label}{children}</label>;
}

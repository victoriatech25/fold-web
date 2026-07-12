"use client";

import dynamic from "next/dynamic";
import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Box, Columns2, CornerDownRight, LayoutTemplate, ListOrdered, Minus, MousePointer2, PencilLine, Plus, Redo2, RotateCcw, Save, SlidersHorizontal, Square, Trash2, Undo2 } from "lucide-react";

import { distanceMm, type BendDirection, type CutType, type DecimalOperation } from "@/domain/fold-profile";
import { findBoxBaseSegments } from "@/domain/3d";
import { createFoldPointList } from "@/domain/fold-point-info";
import { materialFromPreset } from "@/domain/material-preset";
import { foldEditorStore } from "@/stores/fold-editor-store";
import { materialPresetStore } from "@/stores/material-preset-store";
import { Tooltip } from "@/components/ui/tooltip";

const KonvaStage = dynamic(() => import("@/components/konva-stage").then((module) => module.KonvaStage), {
  ssr: false,
  loading: () => <div className="flex h-[620px] items-center justify-center bg-slate-50 text-sm text-slate-500">편집기를 준비하고 있습니다.</div>,
});

const FoldModelPreview = dynamic(() => import("@/components/model-3d/fold-model-preview").then((module) => module.FoldModelPreview), {
  ssr: false,
  loading: () => <div className="flex h-[620px] items-center justify-center bg-slate-100 text-sm text-slate-500">3D 미리보기를 준비하고 있습니다.</div>,
});

const DevelopedPatternPreview = dynamic(() => import("@/components/developed-pattern-preview").then((module) => module.DevelopedPatternPreview), {
  ssr: false,
  loading: () => <div className="flex h-[620px] items-center justify-center bg-slate-50 text-sm text-slate-500">전개도를 준비하고 있습니다.</div>,
});

const toolButton = "inline-flex h-9 w-9 items-center justify-center rounded border transition";
const SPLIT_TOTAL_HEIGHT = 660;

export const CanvasWorkspace = observer(function CanvasWorkspace() {
  const [propertyTab, setPropertyTab] = useState<"segment" | "material" | "points">("segment");
  const [viewMode, setViewMode] = useState<"2d" | "split" | "3d" | "developed">("2d");
  const [splitColumnPercent, setSplitColumnPercent] = useState(50);
  const [splitTopHeight, setSplitTopHeight] = useState(360);
  const [splitResize, setSplitResize] = useState<null | { axis: "column" | "row"; pointer: number; initial: number; extent: number }>(null);
  const splitResizeRef = useRef<typeof splitResize>(null);
  const selected = foldEditorStore.selectedSegment;
  const selectedCalculation = foldEditorStore.selectedSegmentCalculation;
  const bend = selected?.bendAfter;
  const calculation = foldEditorStore.calculation;
  const boxBases = foldEditorStore.profile.profileType === "box" ? findBoxBaseSegments(foldEditorStore.profile.blocks) : null;
  const boxWidth = boxBases ? distanceMm(boxBases[0].start, boxBases[0].end) : 0;
  const boxDepth = boxBases ? distanceMm(boxBases[1].start, boxBases[1].end) : 0;
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
      initial: axis === "column" ? splitColumnPercent : splitTopHeight,
      extent: axis === "column" ? container.getBoundingClientRect().width : SPLIT_TOTAL_HEIGHT,
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
      setSplitTopHeight(Math.max(240, Math.min(480, resize.initial + delta)));
    }
  };
  const finishSplitResize = () => {
    splitResizeRef.current = null;
    setSplitResize(null);
  };

  useEffect(() => {
    materialPresetStore.hydrate(window.localStorage);
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
    <section className="overflow-hidden border-y border-slate-300 bg-white lg:border">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-3 py-2">
        <span className="text-xs font-bold text-slate-700">도면 타입</span>
        <div className="grid grid-cols-2 gap-1 rounded bg-slate-100 p-1">
          <button type="button" className={`inline-flex h-8 items-center gap-1.5 rounded px-3 text-xs font-semibold ${foldEditorStore.profile.profileType === "normal" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`} onClick={() => foldEditorStore.setProfileType("normal")}><Minus size={14} /> 일반</button>
          <button type="button" className={`inline-flex h-8 items-center gap-1.5 rounded px-3 text-xs font-semibold ${foldEditorStore.profile.profileType === "box" ? "bg-teal-700 text-white" : "text-slate-500"}`} onClick={() => foldEditorStore.setProfileType("box")}><Box size={14} /> 박스</button>
        </div>
        {foldEditorStore.profile.profileType === "box" ? (
          <div className="flex items-center gap-1 border-l border-slate-300 pl-3">
            {foldEditorStore.profile.blocks.map((block) => (
              <button key={block.id} type="button" className={`h-8 rounded px-3 text-xs font-semibold ${block.id === foldEditorStore.activeBlockId ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-600"}`} onClick={() => foldEditorStore.setActiveBlock(block.id)}>{block.name}</button>
            ))}
            <button type="button" className="ml-1 inline-flex h-8 items-center gap-1 rounded border border-teal-700 px-2.5 text-xs font-semibold text-teal-800 hover:bg-teal-50" onClick={foldEditorStore.startSecondBlock}><Plus size={14} /> 두 번째 시작점</button>
          </div>
        ) : null}
      </div>
      <div className="flex min-h-14 flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex items-center gap-1 border-r border-slate-300 pr-2">
          <ToolButton label="선택 도구" active={foldEditorStore.mode === "select"} onClick={() => foldEditorStore.setMode("select")}><MousePointer2 size={17} /></ToolButton>
          <ToolButton label="연속 선 그리기" active={foldEditorStore.mode === "draw"} disabled={foldEditorStore.isClosed} onClick={() => foldEditorStore.setMode("draw")}><PencilLine size={17} /></ToolButton>
        </div>
        <div className="flex items-center gap-1 border-r border-slate-300 pr-2" aria-label="화면 모드">
          <ViewButton label="절곡" active={viewMode === "2d"} onClick={() => changeViewMode("2d")}><Square size={15} /></ViewButton>
          <ViewButton label="3D" active={viewMode === "3d"} onClick={() => changeViewMode("3d")}><Box size={15} /></ViewButton>
          <ViewButton label="전개도" active={viewMode === "developed"} onClick={() => changeViewMode("developed")}><LayoutTemplate size={15} /></ViewButton>
          <span className="hidden xl:inline-flex"><ViewButton label="분할" active={viewMode === "split"} onClick={() => changeViewMode("split")}><Columns2 size={15} /></ViewButton></span>
        </div>
        <div className="flex items-center gap-1 border-r border-slate-300 pr-2">
          <ToolButton label="실행 취소" disabled={!foldEditorStore.canUndo} onClick={foldEditorStore.undo}><Undo2 size={17} /></ToolButton>
          <ToolButton label="다시 실행" disabled={!foldEditorStore.canRedo} onClick={foldEditorStore.redo}><Redo2 size={17} /></ToolButton>
          <ToolButton label="선 삭제" disabled={!selected} danger onClick={foldEditorStore.deleteSelected}><Trash2 size={17} /></ToolButton>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <span className={`h-2 w-2 rounded-full ${foldEditorStore.mode === "draw" ? "bg-teal-600" : "bg-slate-400"}`} />
          {foldEditorStore.isClosed
            ? "닫힌 도형입니다. 마지막 선을 삭제하면 다시 이어 그릴 수 있습니다."
            : foldEditorStore.mode === "draw"
              ? "점을 클릭해 연속 선을 입력하세요. 시작점을 클릭하면 도형이 닫힙니다."
              : "빈 공간을 드래그해 이동하고, 휠로 확대·축소하세요."}
        </div>
        <button type="button" className="ml-auto inline-flex h-9 items-center gap-2 rounded border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100" onClick={foldEditorStore.clearProfile}>
          <RotateCcw size={15} /> 새 도면
        </button>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px]">
        <div
          style={viewMode === "split" ? { gridTemplateColumns: `${splitColumnPercent}% ${100 - splitColumnPercent}%` } : undefined}
          className={`relative min-w-0 border-b border-slate-200 lg:border-b-0 lg:border-r ${viewMode === "split" ? "xl:grid xl:content-start" : ""}`}
        >
          <div className={`min-w-0 ${viewMode === "3d" || viewMode === "developed" ? "hidden" : ""}`}><KonvaStage height={viewMode === "split" ? splitTopHeight : 620} /></div>
          <div className={`min-w-0 ${viewMode === "2d" || viewMode === "developed" ? "hidden" : ""}`}><FoldModelPreview compact={viewMode === "split"} height={viewMode === "split" ? splitTopHeight : undefined} onSelectSegment={() => setPropertyTab("segment")} /></div>
          {viewMode === "developed" || viewMode === "split" ? (
            <div className={viewMode === "split" ? "border-t border-slate-200 xl:col-span-2" : undefined}>
              <DevelopedPatternPreview compact={viewMode === "split"} height={viewMode === "split" ? SPLIT_TOTAL_HEIGHT - splitTopHeight : undefined} />
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
              aria-valuemin={240}
              aria-valuemax={480}
              aria-valuenow={Math.round(splitTopHeight)}
              style={{ top: splitTopHeight }}
              className={`absolute left-0 right-0 z-20 hidden h-3 -translate-y-1/2 cursor-row-resize touch-none items-center justify-center xl:flex ${splitResize?.axis === "row" ? "bg-teal-500/15" : "hover:bg-teal-500/10"}`}
              onPointerDown={startSplitResize("row")}
              onDoubleClick={() => setSplitTopHeight(360)}
            ><span className="h-1 w-12 rounded bg-slate-400 shadow-sm" /></div>
          </> : null}
        </div>
        <aside className="flex min-w-0 flex-col bg-white">
          <div className="grid grid-cols-3 border-b border-slate-200 bg-slate-50 p-1">
            <button type="button" onClick={() => setPropertyTab("segment")} className={`h-9 rounded text-xs font-semibold ${propertyTab === "segment" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>선 속성</button>
            <button type="button" onClick={() => setPropertyTab("material")} className={`inline-flex h-9 items-center justify-center gap-1.5 rounded text-xs font-semibold ${propertyTab === "material" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}><SlidersHorizontal size={14} /> 연신율 설정</button>
            <button type="button" onClick={() => setPropertyTab("points")} className={`inline-flex h-9 items-center justify-center gap-1.5 rounded text-xs font-semibold ${propertyTab === "points" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}><ListOrdered size={14} /> 포인트</button>
          </div>

          {propertyTab === "segment" ? selected ? (
            <div className="space-y-4 border-b border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900">선 {foldEditorStore.activeBlock.segments.indexOf(selected) + 1}</h2>
                <span className="font-mono text-[11px] text-slate-500">{foldEditorStore.activeBlock.name}</span>
              </div>
              <Field label="입력 길이 (mm)"><input type="number" min="1" step="0.1" value={Number(selected.inputLength.toFixed(2))} onChange={(event) => foldEditorStore.updateSelectedLength(Number(event.target.value))} className="field-control" /></Field>
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
                    <Field label="컷 타입"><select value={bend.cutType} onChange={(event) => updateBend({ cutType: event.target.value as CutType })} className="field-control bg-white"><option value="v-cut">V-CUT</option><option value="a-cut">A-CUT</option><option value="no-cut">NO-CUT</option></select></Field>
                    <Field label="절곡 각도 (°)"><input type="number" min="0" max="180" value={bend.angle} onChange={(event) => updateBend({ angle: Number(event.target.value) })} className="field-control" /></Field>
                  </div>
                )}
              </div>
              <div className="border-t border-slate-200 pt-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-600">선 연신 보정</span>
                  <span className="font-mono text-xs font-bold text-teal-700">{(selectedCalculation?.appliedCorrection ?? 0).toFixed(2)} mm</span>
                </div>
                <div className="grid grid-cols-2 gap-1 rounded bg-slate-100 p-1">
                  <button type="button" onClick={() => foldEditorStore.setSelectedElongationOverride(null)} className={`h-8 rounded text-xs font-semibold ${selected.elongationOverride === undefined ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>자동</button>
                  <button type="button" onClick={() => foldEditorStore.setSelectedElongationOverride(selectedCalculation?.automaticCorrection ?? 0)} className={`h-8 rounded text-xs font-semibold ${selected.elongationOverride !== undefined ? "bg-teal-700 text-white" : "text-slate-500"}`}>수동</button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div><p className="text-[11px] text-slate-500">자동 계산</p><p className="mt-1 font-mono text-sm font-semibold text-slate-700">{(selectedCalculation?.automaticCorrection ?? 0).toFixed(2)} mm</p></div>
                  <Field label="적용값 (mm)"><input type="number" step="0.1" disabled={selected.elongationOverride === undefined} value={selected.elongationOverride ?? selectedCalculation?.automaticCorrection ?? 0} onChange={(event) => foldEditorStore.setSelectedElongationOverride(Number(event.target.value))} className="field-control disabled:bg-slate-100 disabled:text-slate-500" /></Field>
                </div>
              </div>
            </div>
          ) : <div className="border-b border-slate-200 px-4 py-8 text-center text-xs text-slate-500">캔버스에서 선을 선택하세요.</div> : propertyTab === "material" ? <MaterialSettings /> : <PointList />}

          <div className="space-y-3 border-b border-slate-200 p-4">
            <h2 className="text-sm font-bold text-slate-900">제품</h2>
            {foldEditorStore.profile.profileType === "box" ? <>
              <div className="grid grid-cols-2 gap-3"><Readout label="바닥 가로" value={`${boxWidth.toFixed(1)} mm`} /><Readout label="바닥 세로" value={`${boxDepth.toFixed(1)} mm`} /></div>
              <Field label="수량"><input type="number" min="1" step="1" value={foldEditorStore.profile.product.quantity} onChange={(event) => foldEditorStore.setQuantity(Number(event.target.value))} className="field-control" /></Field>
            </> : <div className="grid grid-cols-2 gap-3">
              <Field label="길이 (mm)"><input type="number" min="0" value={foldEditorStore.profile.product.length} onChange={(event) => foldEditorStore.setProductLength(Number(event.target.value))} className="field-control" /></Field>
              <Field label="수량"><input type="number" min="1" step="1" value={foldEditorStore.profile.product.quantity} onChange={(event) => foldEditorStore.setQuantity(Number(event.target.value))} className="field-control" /></Field>
            </div>}
          </div>

          <div className="mt-auto bg-slate-950 p-4 text-white">
            <p className="text-[11px] font-semibold text-slate-400">{foldEditorStore.profile.profileType === "box" ? "박스 크기" : "제품 크기 계산"}</p>
            {foldEditorStore.profile.profileType === "box" ? <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
              <Result label="가로 단면 전개 폭" value={`${(foldEditorStore.blockCalculations[0]?.calculatedWidth ?? 0).toFixed(1)} mm`} />
              <Result label="세로 단면 전개 폭" value={`${(foldEditorStore.blockCalculations[1]?.calculatedWidth ?? 0).toFixed(1)} mm`} />
              <Result label="바닥 가로" value={`${boxWidth.toFixed(1)} mm`} strong />
              <Result label="바닥 세로" value={`${boxDepth.toFixed(1)} mm`} strong />
              <Result label="바닥 크기" value={`${boxWidth.toFixed(1)} × ${boxDepth.toFixed(1)} mm`} wide />
              <Result label="수량" value={`${calculation.quantity.toLocaleString()} 개`} />
            </div> : <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
              <Result label="단면 원래 길이 합계" value={`${calculation.inputLengthTotal.toFixed(1)} mm`} />
              <Result label="연신율 보정 합계" value={`${calculation.appliedCorrectionTotal.toFixed(1)} mm`} />
              <Result label="최종 전개 폭" value={`${calculation.calculatedWidth.toFixed(1)} mm`} strong />
              <Result label="제품 길이" value={`${calculation.productLength.toFixed(1)} mm`} />
              <Result label="제품 1개 전개 크기" value={`${calculation.size.width.toFixed(1)} × ${calculation.size.length.toFixed(1)} mm`} wide />
              <Result label="제품 1개 면적" value={`${calculation.areaEachM2.toFixed(4)} m²`} />
              <Result label="수량" value={`${calculation.quantity.toLocaleString()} 개`} />
              <Result label="총면적" value={`${calculation.areaTotalM2.toFixed(4)} m²`} strong />
            </div>}
          </div>
        </aside>
      </div>
    </section>
  );
});

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

const MaterialSettings = observer(function MaterialSettings() {
  const material = foldEditorStore.profile.material;
  const calculation = foldEditorStore.profile.calculation;
  const updateElongation = (cutType: CutType, value: number) =>
    foldEditorStore.updateMaterial({ elongation: { ...material.elongation, [cutType]: value } });
  const updateDefaultDepth = (value: number) =>
    foldEditorStore.updateMaterial({ cutDepth: { "v-cut": value, "a-cut": value, "no-cut": value } });

  return (
    <div className="space-y-4 border-b border-slate-200 p-4">
      <Field label="재질 프리셋">
        <select value={material.id} onChange={(event) => {
          const preset = materialPresetStore.presets.find((item) => item.id === event.target.value);
          if (preset) foldEditorStore.updateMaterial(materialFromPreset(preset));
        }} className="field-control bg-white">
          {materialPresetStore.presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name} · {preset.thickness}T</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-[minmax(0,1fr)_100px] gap-3">
        <Field label="재질명"><input value={material.name} onChange={(event) => foldEditorStore.updateMaterial({ name: event.target.value })} className="field-control" /></Field>
        <Field label="두께 (mm)"><input type="number" min="0.1" step="0.1" value={material.thickness} onChange={(event) => foldEditorStore.updateMaterial({ thickness: Number(event.target.value) })} className="field-control" /></Field>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold text-slate-600">컷별 연신율 (mm)</p>
        <div className="grid grid-cols-3 gap-2">
          <Field label="V-CUT"><input type="number" step="0.1" value={material.elongation["v-cut"]} onChange={(event) => updateElongation("v-cut", Number(event.target.value))} className="field-control" /></Field>
          <Field label="A-CUT"><input type="number" step="0.1" value={material.elongation["a-cut"]} onChange={(event) => updateElongation("a-cut", Number(event.target.value))} className="field-control" /></Field>
          <Field label="NO-CUT"><input type="number" step="0.1" value={material.elongation["no-cut"]} onChange={(event) => updateElongation("no-cut", Number(event.target.value))} className="field-control" /></Field>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="내부 절곡 반경 (mm)"><input type="number" min="0" step="0.1" value={material.insideBendRadius} onChange={(event) => foldEditorStore.updateMaterial({ insideBendRadius: Number(event.target.value) })} className="field-control" /></Field>
        <Field label="기본 컷 깊이 (mm)"><input type="number" min="0" step="0.1" value={material.cutDepth["v-cut"]} onChange={(event) => updateDefaultDepth(Number(event.target.value))} className="field-control" /></Field>
      </div>
      <div>
        <Field label="적용 제한 각도 (°)"><input type="number" min="0" max="180" value={material.cutAngle} onChange={(event) => foldEditorStore.updateMaterial({ cutAngle: Number(event.target.value) })} className="field-control" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3 border-t border-slate-200 pt-4">
        <Field label="계산 소수점"><select value={calculation.decimalPlaces} onChange={(event) => foldEditorStore.setDecimalSettings(Number(event.target.value), calculation.decimalOperation)} className="field-control bg-white">{[0, 1, 2, 3, 4].map((places) => <option key={places} value={places}>{places}자리</option>)}</select></Field>
        <Field label="처리 방식"><select value={calculation.decimalOperation} onChange={(event) => foldEditorStore.setDecimalSettings(calculation.decimalPlaces, event.target.value as DecimalOperation)} className="field-control bg-white"><option value="none">처리 안 함</option><option value="round">반올림</option><option value="floor">버림</option><option value="ceil">올림</option></select></Field>
      </div>
      <button type="button" onClick={() => materialPresetStore.save(material)} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"><Save size={15} /> 현재 값을 프리셋에 저장</button>
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

function Readout({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[11px] font-semibold text-slate-500">{label}</p><p className="mt-1 font-mono text-sm font-bold text-slate-800">{value}</p></div>;
}

function Result({ label, value, strong = false, wide = false }: { label: string; value: string; strong?: boolean; wide?: boolean }) {
  return <div className={wide ? "col-span-2" : undefined}><p className="text-[11px] text-slate-400">{label}</p><p className={`mt-0.5 tabular-nums ${strong ? "text-base font-bold text-teal-300" : "text-sm font-semibold"}`}>{value}</p></div>;
}

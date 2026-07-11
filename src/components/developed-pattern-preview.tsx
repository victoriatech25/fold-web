"use client";

import { observer } from "mobx-react-lite";
import { Minus, Plus, Scan } from "lucide-react";
import { useEffect, useId, useState, type PointerEvent as ReactPointerEvent } from "react";

import { createBoxDevelopedPattern, createNormalDevelopedPattern, type BoxDevelopedPattern, type DevelopedFoldLine, type DevelopedPattern } from "@/domain/developed-pattern";
import { foldEditorStore } from "@/stores/fold-editor-store";
import { Tooltip } from "@/components/ui/tooltip";

const lineStyle = (line: DevelopedFoldLine) => {
  if (line.kind === "v-cut") return { color: "#dc2626", dash: undefined, label: "V-CUT" };
  if (line.kind === "a-cut") return { color: "#2563eb", dash: "10 6", label: "A-CUT" };
  return { color: "#64748b", dash: "4 5", label: "절곡선" };
};

export const DevelopedPatternPreview = observer(function DevelopedPatternPreview({ compact = false, height }: { compact?: boolean; height?: number }) {
  const isBox = foldEditorStore.profile.profileType === "box";
  const normalPattern = createNormalDevelopedPattern(foldEditorStore.profile);
  const boxPattern = createBoxDevelopedPattern(foldEditorStore.profile);
  const available = isBox
    ? boxPattern && boxPattern.width > 0 && boxPattern.height > 0
    : normalPattern && normalPattern.width > 0 && normalPattern.length > 0;

  if (!available) {
    return <div style={{ height: height ?? (compact ? 300 : 620) }} className="flex items-center justify-center bg-slate-50 px-6 text-center text-sm text-slate-500">{isBox ? "교차하는 두 단면을 완성하면 박스 전개도가 표시됩니다." : "단면과 제품 길이를 입력하면 전개도가 표시됩니다."}</div>;
  }

  return isBox
    ? <BoxPattern pattern={boxPattern!} compact={compact} height={height} />
    : <NormalPattern pattern={normalPattern!} compact={compact} height={height} />;
});

function NormalPattern({ pattern, compact, height }: { pattern: DevelopedPattern; compact: boolean; height?: number }) {
  const viewport = usePatternViewport();
  const viewWidth = 1000;
  const viewHeight = 620;
  const padding = 60;
  const scale = Math.min((viewWidth - padding * 2) / pattern.length, (viewHeight - padding * 2) / pattern.width);
  const drawingWidth = pattern.length * scale;
  const drawingHeight = pattern.width * scale;
  const originX = (viewWidth - drawingWidth) / 2;
  const originY = (viewHeight - drawingHeight) / 2;

  return (
    <section style={{ height: height ?? (compact ? 300 : 620) }} className={`relative overflow-hidden bg-slate-100 ${viewport.dragging ? "cursor-grabbing" : "cursor-grab"}`} aria-label="일반 절곡 전개도">
      <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-3 rounded border border-slate-300 bg-white/95 px-3 py-2 text-[11px] font-semibold text-slate-600 shadow-sm">
        <span className="text-slate-900">전개도 {pattern.length.toFixed(1)} × {pattern.width.toFixed(1)} mm</span>
        <Legend color="#111827" label="재단선" />
        <Legend color="#dc2626" label="V-CUT" />
        <Legend color="#2563eb" label="A-CUT" dashed />
        <Legend color="#64748b" label="절곡선" dashed />
      </div>
      <svg id={viewport.svgId} className="h-full w-full" viewBox={`0 0 ${viewWidth} ${viewHeight}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`제품 전개 크기 ${pattern.length.toFixed(1)} 곱하기 ${pattern.width.toFixed(1)} 밀리미터`} onPointerDown={viewport.onPointerDown} onPointerMove={viewport.onPointerMove} onPointerUp={viewport.onPointerUp} onPointerCancel={viewport.onPointerUp}>
        <g transform={viewport.transform}>
        <rect x={originX} y={originY} width={drawingWidth} height={drawingHeight} fill="#f8fafc" stroke="#111827" strokeWidth="3" />
        {pattern.foldLines.map((line) => {
          const style = lineStyle(line);
          const selected = line.segmentId === foldEditorStore.selectedSegmentId;
          const y = originY + line.position * scale;
          const selectLine = () => foldEditorStore.selectSegment(line.segmentId, foldEditorStore.profile.blocks[0].id);
          return (
            <g
              key={line.segmentId}
              className="cursor-pointer outline-none"
              role="button"
              tabIndex={0}
              aria-label={`${style.label} ${line.position.toFixed(1)} mm`}
              onClick={selectLine}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  selectLine();
                }
              }}
            >
              <line x1={originX} y1={y} x2={originX + drawingWidth} y2={y} stroke="transparent" strokeWidth="16" />
              <line x1={originX} y1={y} x2={originX + drawingWidth} y2={y} stroke={selected ? "#0f766e" : style.color} strokeWidth={selected ? 5 : 2.5} strokeDasharray={style.dash} />
              <text x={originX + 8} y={y - 8} fill={selected ? "#0f766e" : style.color} fontSize="13" fontWeight="700">{style.label} · {line.direction === "front" ? "앞각" : "뒷각"} {line.angle}° · {line.position.toFixed(1)} mm</text>
            </g>
          );
        })}
        <text x={viewWidth / 2} y={originY - 20} textAnchor="middle" fill="#334155" fontSize="14" fontWeight="700">제품 길이 {pattern.length.toFixed(1)} mm</text>
        <text x={originX - 24} y={viewHeight / 2} textAnchor="middle" fill="#334155" fontSize="14" fontWeight="700" transform={`rotate(-90 ${originX - 24} ${viewHeight / 2})`}>전개 폭 {pattern.width.toFixed(1)} mm</text>
        </g>
      </svg>
      <ViewportControls viewport={viewport} />
    </section>
  );
}

function BoxPattern({ pattern, compact, height }: { pattern: BoxDevelopedPattern; compact: boolean; height?: number }) {
  const viewport = usePatternViewport();
  const viewWidth = 1000;
  const viewHeight = 620;
  const padding = 90;
  const scale = Math.min((viewWidth - padding * 2) / pattern.width, (viewHeight - padding * 2) / pattern.height);
  const drawingWidth = pattern.width * scale;
  const drawingHeight = pattern.height * scale;
  const originX = (viewWidth - drawingWidth) / 2;
  const originY = (viewHeight - drawingHeight) / 2 + 18;
  const point = (value: { x: number; y: number }) => `${originX + value.x * scale},${originY + value.y * scale}`;

  return (
    <section style={{ height: height ?? (compact ? 300 : 620) }} className={`relative overflow-hidden bg-slate-100 ${viewport.dragging ? "cursor-grabbing" : "cursor-grab"}`} aria-label="박스 절곡 전개도">
      <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-3 rounded border border-slate-300 bg-white/95 px-3 py-2 text-[11px] font-semibold text-slate-600 shadow-sm">
        <span className="text-slate-900">박스 전개도 {pattern.width.toFixed(1)} × {pattern.height.toFixed(1)} mm</span>
        <Legend color="#111827" label="재단선·코너 절개" />
        <Legend color="#dc2626" label="V-CUT" />
        <Legend color="#2563eb" label="A-CUT" dashed />
        <Legend color="#64748b" label="절곡선" dashed />
      </div>
      <svg id={viewport.svgId} className="h-full w-full" viewBox={`0 0 ${viewWidth} ${viewHeight}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`박스 전개 크기 ${pattern.width.toFixed(1)} 곱하기 ${pattern.height.toFixed(1)} 밀리미터`} onPointerDown={viewport.onPointerDown} onPointerMove={viewport.onPointerMove} onPointerUp={viewport.onPointerUp} onPointerCancel={viewport.onPointerUp}>
        <g transform={viewport.transform}>
        {pattern.panels.map((panel) => {
          const selected = panel.segmentId === foldEditorStore.selectedSegmentId;
          return <rect key={`${panel.blockId}-${panel.segmentId}`} x={originX + panel.x * scale} y={originY + panel.y * scale} width={panel.width * scale} height={panel.height * scale} fill={panel.role === "floor" ? "#ccfbf1" : selected ? "#99f6e4" : "#f8fafc"} />;
        })}
        <polygon points={pattern.outline.map(point).join(" ")} fill="none" stroke="#111827" strokeWidth="3" strokeLinejoin="miter" />
        <rect x={originX + pattern.base.x * scale} y={originY + pattern.base.y * scale} width={pattern.base.width * scale} height={pattern.base.height * scale} fill="none" stroke="#0f766e" strokeWidth="1.5" strokeDasharray="5 4" />
        {pattern.foldLines.map((line) => {
          const style = lineStyle(line);
          const selected = line.segmentId === foldEditorStore.selectedSegmentId;
          const selectLine = () => foldEditorStore.selectSegment(line.segmentId, line.blockId);
          const x1 = originX + line.x1 * scale;
          const y1 = originY + line.y1 * scale;
          const x2 = originX + line.x2 * scale;
          const y2 = originY + line.y2 * scale;
          return (
            <g key={`${line.blockId}-${line.segmentId}-${line.position}`} role="button" tabIndex={0} aria-label={`${style.label} ${line.position.toFixed(1)} mm`} className="cursor-pointer outline-none" onClick={selectLine} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectLine(); } }}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth="16" />
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={selected ? "#0f766e" : style.color} strokeWidth={selected ? 5 : 2.5} strokeDasharray={style.dash} />
            </g>
          );
        })}
        <text x={originX + (pattern.base.x + pattern.base.width / 2) * scale} y={originY + (pattern.base.y + pattern.base.height / 2) * scale} textAnchor="middle" dominantBaseline="middle" fill="#0f766e" fontSize="14" fontWeight="800">바닥 {pattern.finishedBase.width.toFixed(1)} × {pattern.finishedBase.height.toFixed(1)}</text>
        <text x={viewWidth / 2} y={originY - 22} textAnchor="middle" fill="#334155" fontSize="14" fontWeight="700">전체 가로 {pattern.width.toFixed(1)} mm</text>
        <text x={originX - 28} y={originY + drawingHeight / 2} textAnchor="middle" fill="#334155" fontSize="14" fontWeight="700" transform={`rotate(-90 ${originX - 28} ${originY + drawingHeight / 2})`}>전체 세로 {pattern.height.toFixed(1)} mm</text>
        </g>
      </svg>
      <ViewportControls viewport={viewport} />
    </section>
  );
}

function Legend({ color, label, dashed = false }: { color: string; label: string; dashed?: boolean }) {
  return <span className="inline-flex items-center gap-1.5"><span className="block w-6 border-t-2" style={{ borderColor: color, borderTopStyle: dashed ? "dashed" : "solid" }} />{label}</span>;
}

type PatternViewport = ReturnType<typeof usePatternViewport>;
const clampPatternZoom = (zoom: number) => Math.max(0.5, Math.min(6, zoom));

function usePatternViewport() {
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [drag, setDrag] = useState<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);
  const svgId = useId();
  const zoomAt = (nextZoom: number, centerX = 500, centerY = 310) => setView((current) => {
    const zoom = clampPatternZoom(nextZoom);
    const ratio = zoom / current.zoom;
    return { zoom, x: centerX - (centerX - current.x) * ratio, y: centerY - (centerY - current.y) * ratio };
  });
  useEffect(() => {
    const svg = document.getElementById(svgId) as unknown as SVGSVGElement | null;
    if (!svg) return;
    const onWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const centerX = ((event.clientX - rect.left) / rect.width) * 1000;
      const centerY = ((event.clientY - rect.top) / rect.height) * 620;
      setView((current) => {
        const zoom = clampPatternZoom(current.zoom * (event.deltaY > 0 ? 0.9 : 1.1));
        const ratio = zoom / current.zoom;
        return { zoom, x: centerX - (centerX - current.x) * ratio, y: centerY - (centerY - current.y) * ratio };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [svgId]);
  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('[role="button"]')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ pointerX: event.clientX, pointerY: event.clientY, x: view.x, y: view.y });
  };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setView((current) => ({ ...current, x: drag.x + ((event.clientX - drag.pointerX) / rect.width) * 1000, y: drag.y + ((event.clientY - drag.pointerY) / rect.height) * 620 }));
  };
  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDrag(null);
  };
  return {
    zoom: view.zoom,
    svgId,
    dragging: drag !== null,
    transform: `translate(${view.x} ${view.y}) scale(${view.zoom})`,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    zoomIn: () => zoomAt(view.zoom * 1.2),
    zoomOut: () => zoomAt(view.zoom / 1.2),
    reset: () => setView({ zoom: 1, x: 0, y: 0 }),
  };
}

function ViewportControls({ viewport }: { viewport: PatternViewport }) {
  const buttonClass = "inline-flex h-8 w-8 items-center justify-center border-l border-slate-300 text-slate-700 hover:bg-slate-100";
  return <><span className="pointer-events-none absolute bottom-3 left-3 z-10 rounded bg-slate-900/75 px-2 py-1 font-mono text-[11px] text-white">{Math.round(viewport.zoom * 100)}%</span><div className="absolute bottom-3 right-3 z-10 flex overflow-hidden rounded border border-slate-300 bg-white shadow-sm">
    <Tooltip label="전개도 축소"><button type="button" aria-label="전개도 축소" className={`${buttonClass} border-l-0`} onClick={viewport.zoomOut}><Minus size={15} /></button></Tooltip>
    <Tooltip label="전개도 확대"><button type="button" aria-label="전개도 확대" className={buttonClass} onClick={viewport.zoomIn}><Plus size={15} /></button></Tooltip>
    <Tooltip label="전개도 화면 맞춤"><button type="button" aria-label="전개도 화면 맞춤" className={buttonClass} onClick={viewport.reset}><Scan size={15} /></button></Tooltip>
  </div></>;
}

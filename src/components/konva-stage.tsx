"use client";

import Konva from "konva";
import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useRef, useState } from "react";
import { Circle, Group, Layer, Line, Rect, Stage, Text } from "react-konva";

import { distanceMm, type PointMm } from "@/domain/fold-profile";
import { foldEditorStore } from "@/stores/fold-editor-store";

const DEFAULT_STAGE_HEIGHT = 620;
const GRID_SIZE = 25;
const MIN_SCALE = 0.35;
const MAX_SCALE = 4;

const snapOrthogonal = (start: PointMm, point: PointMm): PointMm => {
  const dx = Math.abs(point.x - start.x);
  const dy = Math.abs(point.y - start.y);
  if (dx < dy * 0.25) return { x: start.x, y: point.y };
  if (dy < dx * 0.25) return { x: point.x, y: start.y };
  return point;
};

export const KonvaStage = observer(function KonvaStage({ height = DEFAULT_STAGE_HEIGHT }: { height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const dragOriginRef = useRef<PointMm | null>(null);
  const panOriginRef = useRef<{
    pointer: PointMm;
    camera: { x: number; y: number; scale: number };
  } | null>(null);
  const spacePressedRef = useRef(false);
  const [width, setWidth] = useState(900);
  const [camera, setCamera] = useState({ x: 120, y: 310, scale: 2 });
  const [isPanning, setIsPanning] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isSegmentHovered, setIsSegmentHovered] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const resizeObserver = new ResizeObserver(([entry]) => setWidth(Math.max(320, entry.contentRect.width)));
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.matches("input, select, textarea")) return;
      if (event.code === "Space") {
        event.preventDefault();
        spacePressedRef.current = true;
        setIsSpacePressed(true);
        return;
      }
      if (event.key === "Escape") foldEditorStore.finishDrawing();
      if (event.key === "Delete" || event.key === "Backspace") foldEditorStore.deleteSelected();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) foldEditorStore.redo();
        else foldEditorStore.undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        foldEditorStore.redo();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      spacePressedRef.current = false;
      setIsSpacePressed(false);
    };
    const resetPanKeys = () => {
      spacePressedRef.current = false;
      panOriginRef.current = null;
      setIsSpacePressed(false);
      setIsPanning(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", resetPanKeys);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", resetPanKeys);
    };
  }, []);

  const toWorld = (point: PointMm) => ({
    x: (point.x - camera.x) / camera.scale,
    y: (point.y - camera.y) / camera.scale,
  });
  const activeSegments = foldEditorStore.activeBlock?.segments ?? [];
  const firstJoint = activeSegments[0]?.start;
  const joints = firstJoint
    ? [firstJoint, ...activeSegments.map((segment) => segment.end)]
    : [];

  const fitView = useCallback(() => {
    const points = foldEditorStore.profile.blocks.flatMap((block) =>
      block.segments.flatMap((segment) => [segment.start, segment.end]),
    );
    if (points.length === 0) {
      setCamera({ x: width / 2, y: height / 2, scale: 2 });
      return;
    }
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const scale = Math.min(3, (width - 160) / Math.max(80, maxX - minX), (height - 120) / Math.max(80, maxY - minY));
    setCamera({
      x: width / 2 - ((minX + maxX) / 2) * scale,
      y: height / 2 - ((minY + maxY) / 2) * scale,
      scale,
    });
  }, [height, width]);

  useEffect(() => {
    fitView();
  }, [fitView]);

  const pointerWorld = () => {
    const pointer = stageRef.current?.getPointerPosition();
    return pointer ? toWorld(pointer) : null;
  };

  const gridLines = [];
  const worldLeft = -camera.x / camera.scale;
  const worldTop = -camera.y / camera.scale;
  const worldRight = worldLeft + width / camera.scale;
  const worldBottom = worldTop + height / camera.scale;
  for (let x = Math.floor(worldLeft / GRID_SIZE) * GRID_SIZE; x <= worldRight; x += GRID_SIZE) {
    gridLines.push(<Line key={`x-${x}`} points={[x, worldTop, x, worldBottom]} stroke={x === 0 ? "#94a3b8" : "#e2e8f0"} strokeWidth={(x === 0 ? 1.2 : 0.6) / camera.scale} listening={false} />);
  }
  for (let y = Math.floor(worldTop / GRID_SIZE) * GRID_SIZE; y <= worldBottom; y += GRID_SIZE) {
    gridLines.push(<Line key={`y-${y}`} points={[worldLeft, y, worldRight, y]} stroke={y === 0 ? "#94a3b8" : "#e2e8f0"} strokeWidth={(y === 0 ? 1.2 : 0.6) / camera.scale} listening={false} />);
  }

  const closureTarget =
    foldEditorStore.mode === "draw" &&
    foldEditorStore.canClose &&
    firstJoint &&
    foldEditorStore.pointerWorld &&
    distanceMm(firstJoint, foldEditorStore.pointerWorld) <= 14 / camera.scale
      ? firstJoint
      : null;
  const draftEnd = foldEditorStore.draftStart && foldEditorStore.pointerWorld
    ? closureTarget ?? snapOrthogonal(foldEditorStore.draftStart, foldEditorStore.pointerWorld)
    : null;

  return (
    <div
      ref={containerRef}
      style={{ height }}
      className={`relative w-full overflow-hidden bg-[#f8fafc] ${isPanning ? "cursor-grabbing" : isSegmentHovered ? "cursor-default" : foldEditorStore.mode === "draw" ? "cursor-crosshair" : "cursor-grab"}`}
    >
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        onMouseDown={(event) => {
          const pointer = stageRef.current?.getPointerPosition();
          if (!pointer) return;
          const isMiddleButton = event.evt.button === 1;
          const isSpaceDrag = event.evt.button === 0 && spacePressedRef.current;
          const isBlankSelectDrag =
            event.evt.button === 0 &&
            foldEditorStore.mode === "select" &&
            event.target === event.target.getStage();
          if (!isMiddleButton && !isSpaceDrag && !isBlankSelectDrag) return;
          event.evt.preventDefault();
          panOriginRef.current = { pointer: { ...pointer }, camera: { ...camera } };
          setIsPanning(true);
        }}
        onMouseMove={() => {
          const pointer = stageRef.current?.getPointerPosition();
          const panOrigin = panOriginRef.current;
          if (pointer && panOrigin) {
            setCamera({
              ...panOrigin.camera,
              x: panOrigin.camera.x + pointer.x - panOrigin.pointer.x,
              y: panOrigin.camera.y + pointer.y - panOrigin.pointer.y,
            });
            return;
          }
          const point = pointerWorld();
          if (point) foldEditorStore.setPointerWorld(point);
        }}
        onMouseUp={() => {
          panOriginRef.current = null;
          setIsPanning(false);
        }}
        onMouseLeave={() => {
          panOriginRef.current = null;
          setIsPanning(false);
          foldEditorStore.setPointerWorld(null);
        }}
        onClick={(event) => {
          if (event.target !== event.target.getStage() || foldEditorStore.mode !== "draw") return;
          const point = pointerWorld();
          if (!point) return;
          if (closureTarget) {
            foldEditorStore.closeProfile();
            return;
          }
          foldEditorStore.addDrawPoint(foldEditorStore.draftStart ? snapOrthogonal(foldEditorStore.draftStart, point) : point);
        }}
        onWheel={(event) => {
          event.evt.preventDefault();
          const pointer = stageRef.current?.getPointerPosition();
          if (!pointer) return;
          const world = toWorld(pointer);
          const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, camera.scale * (event.evt.deltaY > 0 ? 0.9 : 1.1)));
          setCamera({ x: pointer.x - world.x * nextScale, y: pointer.y - world.y * nextScale, scale: nextScale });
        }}
      >
        <Layer>
          <Rect width={width} height={height} fill="#f8fafc" listening={false} />
        </Layer>
        <Layer x={camera.x} y={camera.y} scaleX={camera.scale} scaleY={camera.scale}>
          {gridLines}
          {foldEditorStore.profile.blocks.map((block, blockIndex) =>
            block.segments.map((segment, index) => {
            const active = block.id === foldEditorStore.activeBlockId;
            const selected = active && segment.id === foldEditorStore.selectedSegmentId;
            const result = foldEditorStore.blockCalculations[blockIndex]?.segments[index];
            const middle = { x: (segment.start.x + segment.end.x) / 2, y: (segment.start.y + segment.end.y) / 2 };
            const label = `${segment.inputLength.toFixed(1)} mm${result && result.calculatedLength !== segment.inputLength ? `  →  ${result.calculatedLength.toFixed(1)}` : ""}`;
            return (
              <Group key={segment.id}>
                <Line
                  points={[segment.start.x, segment.start.y, segment.end.x, segment.end.y]}
                  stroke="transparent"
                  strokeWidth={14 / camera.scale}
                  onMouseEnter={() => setIsSegmentHovered(true)}
                  onMouseLeave={() => setIsSegmentHovered(false)}
                  onClick={(event) => { event.cancelBubble = true; foldEditorStore.selectSegment(segment.id, block.id); }}
                />
                <Line points={[segment.start.x, segment.start.y, segment.end.x, segment.end.y]} stroke={selected ? "#0f766e" : active ? "#1e293b" : "#64748b"} strokeWidth={(selected ? 4 : 3) / camera.scale} lineCap="round" dash={active ? undefined : [5 / camera.scale, 3 / camera.scale]} listening={false} />
                <Group x={middle.x} y={middle.y} listening={false}>
                  <Rect x={-42 / camera.scale} y={-26 / camera.scale} width={84 / camera.scale} height={18 / camera.scale} fill="#ffffff" opacity={0.94} cornerRadius={3 / camera.scale} />
                  <Text x={-60 / camera.scale} y={-24 / camera.scale} width={120 / camera.scale} text={label} align="center" fontSize={11 / camera.scale} fill="#334155" />
                </Group>
                {segment.bendAfter ? <Circle x={segment.end.x} y={segment.end.y} radius={7 / camera.scale} fill={segment.bendAfter.direction === "front" ? "#dc2626" : "#2563eb"} stroke="#fff" strokeWidth={2 / camera.scale} listening={false} /> : null}
              </Group>
            );
          }))}
          {foldEditorStore.profile.blocks.map((block, blockIndex) => {
            const start = block.segments[0]?.start;
            const end = block.segments.at(-1)?.end;
            if (!start || !end) return null;

            const closed = distanceMm(start, end) < 0.001;
            const active = block.id === foldEditorStore.activeBlockId;
            const markers = closed
              ? [{ point: start, label: "시작·끝", color: "#7c3aed" }]
              : [
                  { point: start, label: "시작", color: "#047857" },
                  { point: end, label: "끝", color: "#c2410c" },
                ];

            return markers.map(({ point, label, color }) => {
              const displayLabel = foldEditorStore.profile.profileType === "box" ? `면 ${blockIndex + 1} ${label}` : label;
              const labelWidth = Math.max(34, displayLabel.length * 11 + 10) / camera.scale;
              return (
                <Group key={`${block.id}-${label}`} x={point.x} y={point.y} listening={false} opacity={active ? 1 : 0.78}>
                  <Circle radius={7 / camera.scale} fill="#ffffff" stroke={color} strokeWidth={3 / camera.scale} />
                  <Rect
                    x={9 / camera.scale}
                    y={-22 / camera.scale}
                    width={labelWidth}
                    height={17 / camera.scale}
                    fill={color}
                    cornerRadius={3 / camera.scale}
                  />
                  <Text
                    x={9 / camera.scale}
                    y={-20 / camera.scale}
                    width={labelWidth}
                    text={displayLabel}
                    align="center"
                    fontSize={10 / camera.scale}
                    fill="#ffffff"
                  />
                </Group>
              );
            });
          })}
          {draftEnd && foldEditorStore.draftStart ? <Line points={[foldEditorStore.draftStart.x, foldEditorStore.draftStart.y, draftEnd.x, draftEnd.y]} stroke="#0f766e" strokeWidth={2 / camera.scale} dash={[8 / camera.scale, 5 / camera.scale]} listening={false} /> : null}
          {joints.map((joint, index) => (
            <Circle
              key={`joint-${index}`}
              x={joint.x}
              y={joint.y}
              radius={5 / camera.scale}
              fill="#fff"
              stroke={index === 0 && foldEditorStore.mode === "draw" && foldEditorStore.canClose ? "#0f766e" : "#0f172a"}
              strokeWidth={2 / camera.scale}
              draggable={foldEditorStore.mode === "select" && !isSpacePressed}
              onDragStart={() => { dragOriginRef.current = { ...joint }; }}
              onClick={(event) => {
                if (index === 0 && foldEditorStore.mode === "draw" && foldEditorStore.canClose) {
                  event.cancelBubble = true;
                  foldEditorStore.closeProfile();
                }
              }}
              onDragMove={(event) => foldEditorStore.moveJoint(index, { x: event.target.x(), y: event.target.y() }, false)}
              onDragEnd={(event) => {
                const origin = dragOriginRef.current;
                if (origin) {
                  const end = { x: event.target.x(), y: event.target.y() };
                  foldEditorStore.moveJoint(index, origin, false);
                  foldEditorStore.moveJoint(index, end, true);
                }
                dragOriginRef.current = null;
              }}
            />
          ))}
          {closureTarget && firstJoint ? (
            <Group x={firstJoint.x} y={firstJoint.y} listening={false}>
              <Circle radius={11 / camera.scale} stroke="#0f766e" strokeWidth={2 / camera.scale} dash={[3 / camera.scale, 2 / camera.scale]} />
              <Rect x={10 / camera.scale} y={-24 / camera.scale} width={78 / camera.scale} height={18 / camera.scale} fill="#0f766e" cornerRadius={3 / camera.scale} />
              <Text x={10 / camera.scale} y={-22 / camera.scale} width={78 / camera.scale} text="도형 닫기" align="center" fontSize={11 / camera.scale} fill="#ffffff" />
            </Group>
          ) : null}
        </Layer>
      </Stage>
      <button type="button" onClick={fitView} className="absolute bottom-3 right-3 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50">화면 맞춤</button>
      <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-slate-900/75 px-2 py-1 font-mono text-[11px] text-white">{Math.round(camera.scale * 100)}%</div>
    </div>
  );
});

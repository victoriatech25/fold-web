"use client";

import { Edges, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { observer } from "mobx-react-lite";
import { Box, Scan, Square, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { createBoxSolidModel, createFoldSolidModel, type Bounds3D, type FoldSurfaceBlock } from "@/domain/3d";
import { foldEditorStore } from "@/stores/fold-editor-store";
import { Tooltip } from "@/components/ui/tooltip";

type StandardView = "iso" | "front" | "side" | "top";
type RenderMode = "solid" | "edges" | "transparent";
type Projection = "perspective" | "orthographic";

const BLOCK_COLORS = ["#b8c2c8", "#78a6a3"];
const SELECTED_COLOR = "#0f766e";

function viewMetrics(bounds: Bounds3D, view: StandardView) {
  const [x, y, z] = bounds.size.map((value) => Math.max(value, 1));
  if (view === "front") return { direction: new THREE.Vector3(0, 0, 1), width: x, height: y, depth: z };
  if (view === "side") return { direction: new THREE.Vector3(1, 0, 0), width: z, height: y, depth: x };
  if (view === "top") return { direction: new THREE.Vector3(0, 1, 0), width: x, height: z, depth: y };
  const maximum = Math.max(x, y, z);
  return { direction: new THREE.Vector3(0.85, 0.62, 1).normalize(), width: maximum, height: maximum, depth: maximum };
}

function fitCamera(camera: THREE.Camera, bounds: Bounds3D, viewport: { width: number; height: number }, view: StandardView) {
  const center = new THREE.Vector3(...bounds.center);
  const metrics = viewMetrics(bounds, view);
  camera.up.set(0, view === "top" ? 0 : 1, view === "top" ? -1 : 0);

  if (camera instanceof THREE.OrthographicCamera) {
    const zoom = Math.min(
      viewport.width / (metrics.width * 1.3),
      viewport.height / (metrics.height * 1.3),
    );
    camera.zoom = Math.max(0.001, zoom);
    camera.position.copy(center).addScaledVector(metrics.direction, metrics.depth / 2 + Math.max(metrics.width, metrics.height) * 2);
    camera.updateProjectionMatrix();
  } else if (camera instanceof THREE.PerspectiveCamera) {
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(viewport.width / viewport.height, 0.5));
    const widthDistance = metrics.width / (2 * Math.tan(horizontalFov / 2));
    const heightDistance = metrics.height / (2 * Math.tan(verticalFov / 2));
    camera.position.copy(center).addScaledVector(metrics.direction, metrics.depth / 2 + Math.max(widthDistance, heightDistance) * 1.35);
  }
  camera.lookAt(center);
}

function SegmentSurfaceMesh({
  block,
  segmentIndex,
  color,
  selected,
  renderMode,
  onSelect,
}: {
  block: FoldSurfaceBlock;
  segmentIndex: number;
  color: string;
  selected: boolean;
  renderMode: RenderMode;
  onSelect?: () => void;
}) {
  const range = block.segmentRanges[segmentIndex];
  const geometry = useMemo(() => {
    const positions = block.positions.slice(range.vertexStart * 3, (range.vertexStart + range.vertexCount) * 3);
    const indices = block.indices
      .slice(range.indexStart, range.indexStart + range.indexCount)
      .map((index) => index - range.vertexStart);
    const value = new THREE.BufferGeometry();
    value.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    value.setIndex(indices);
    value.computeVertexNormals();
    value.computeBoundingBox();
    value.computeBoundingSphere();
    return value;
  }, [block.indices, block.positions, range.indexCount, range.indexStart, range.vertexCount, range.vertexStart]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const opacity = selected ? 0.92 : renderMode === "solid" ? 1 : renderMode === "transparent" ? 0.34 : 0.06;

  return (
    <mesh
      geometry={geometry}
      onClick={(event) => {
        event.stopPropagation();
        foldEditorStore.selectSegment(range.segmentId, block.blockId);
        onSelect?.();
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        const target = event.nativeEvent.target;
        if (target instanceof HTMLCanvasElement) target.style.cursor = "pointer";
      }}
      onPointerOut={(event) => {
        const target = event.nativeEvent.target;
        if (target instanceof HTMLCanvasElement) target.style.cursor = "grab";
      }}
    >
      <meshStandardMaterial
        color={selected ? SELECTED_COLOR : color}
        emissive={selected ? "#064e3b" : "#000000"}
        emissiveIntensity={selected ? 0.22 : 0}
        metalness={0.72}
        roughness={0.34}
        side={THREE.DoubleSide}
        transparent={opacity < 1}
        opacity={opacity}
        depthWrite={renderMode === "solid" || selected}
      />
      {renderMode !== "solid" ? <Edges color={selected ? "#14b8a6" : "#334155"} threshold={8} /> : null}
    </mesh>
  );
}

function CameraController({ bounds, fitRequest, view }: { bounds: Bounds3D; fitRequest: number; view: StandardView }) {
  const { camera, controls, size } = useThree();
  const appliedFitRequestRef = useRef<number | null>(null);
  const appliedCameraRef = useRef<THREE.Camera | null>(null);
  const [minX, minY, minZ] = bounds.min;
  const [maxX, maxY, maxZ] = bounds.max;
  const [centerX, centerY, centerZ] = bounds.center;
  const [sizeX, sizeY, sizeZ] = bounds.size;
  const stableBounds = useMemo<Bounds3D>(() => ({
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    center: [centerX, centerY, centerZ],
    size: [sizeX, sizeY, sizeZ],
  }), [centerX, centerY, centerZ, maxX, maxY, maxZ, minX, minY, minZ, sizeX, sizeY, sizeZ]);

  useFrame(() => {
    const requiresFit = appliedFitRequestRef.current !== fitRequest || appliedCameraRef.current !== camera;
    if (!requiresFit) return;
    if (!controls || !("target" in controls) || !("update" in controls)) return;
    fitCamera(camera, stableBounds, size, view);
    const center = new THREE.Vector3(...stableBounds.center);
    const orbit = controls as unknown as { target: THREE.Vector3; update: () => void };
    orbit.target.copy(center);
    orbit.update();
    appliedFitRequestRef.current = fitRequest;
    appliedCameraRef.current = camera;
  });

  return null;
}

function ModelScene({
  blocks,
  bounds,
  fitRequest,
  view,
  projection,
  renderMode,
  hiddenBlockIds,
  onSelectSegment,
}: {
  blocks: FoldSurfaceBlock[];
  bounds: Bounds3D;
  fitRequest: number;
  view: StandardView;
  projection: Projection;
  renderMode: RenderMode;
  hiddenBlockIds: Set<string>;
  onSelectSegment?: () => void;
}) {
  return (
    <>
      <color attach="background" args={["#edf1f3"]} />
      {projection === "perspective" ? <PerspectiveCamera makeDefault fov={38} near={0.1} far={100000} /> : <OrthographicCamera makeDefault near={-100000} far={100000} />}
      <hemisphereLight args={["#ffffff", "#64748b", 1.7]} />
      <directionalLight position={[800, 1200, 900]} intensity={2.4} />
      <directionalLight position={[-700, -300, -500]} intensity={0.65} />
      <group>
        {blocks.flatMap((block, blockIndex) =>
          hiddenBlockIds.has(block.blockId) ? [] : block.segmentRanges.map((range, segmentIndex) => (
            <SegmentSurfaceMesh
              key={`${block.blockId}-${range.segmentId}-${segmentIndex}`}
              block={block}
              segmentIndex={segmentIndex}
              color={BLOCK_COLORS[blockIndex % BLOCK_COLORS.length]}
              selected={range.segmentId === foldEditorStore.selectedSegmentId}
              renderMode={renderMode}
              onSelect={onSelectSegment}
            />
          )),
        )}
      </group>
      <CameraController bounds={bounds} fitRequest={fitRequest} view={view} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={1} />
    </>
  );
}

export const FoldModelPreview = observer(function FoldModelPreview({ compact = false, height, onSelectSegment }: { compact?: boolean; height?: number; onSelectSegment?: () => void }) {
  const [fitRequest, setFitRequest] = useState(0);
  const [view, setView] = useState<StandardView>("iso");
  const [renderMode, setRenderMode] = useState<RenderMode>("solid");
  const [projection, setProjection] = useState<Projection>("perspective");
  const [hiddenBlockIds, setHiddenBlockIds] = useState<Set<string>>(() => new Set());
  const model = foldEditorStore.profile.profileType === "box"
    ? createBoxSolidModel(foldEditorStore.profile)
    : createFoldSolidModel(foldEditorStore.profile);
  const visibleCount = model.blocks.filter((block) => !hiddenBlockIds.has(block.blockId)).length;
  const requestView = (next: StandardView) => {
    setView(next);
    setFitRequest((value) => value + 1);
  };

  return (
    <section style={{ height: height ?? (compact ? 360 : 620) }} className={`bg-[#edf1f3] ${compact ? "xl:border-l xl:border-slate-300" : ""}`} aria-label="3D 미리보기">
      <div className="flex h-12 items-center gap-2 overflow-x-auto border-b border-slate-300 bg-white px-3">
        <Box size={16} className="shrink-0 text-teal-700" />
        <h2 className="shrink-0 text-sm font-bold text-slate-900">3D 미리보기</h2>
        <span className="shrink-0 rounded bg-teal-50 px-2 py-1 text-[11px] font-semibold text-teal-800">{foldEditorStore.profile.profileType === "box" ? "박스 · " : ""}{foldEditorStore.profile.material.thickness.toFixed(1)}T 솔리드</span>
        <select aria-label="3D 표준 시점" value={view} onChange={(event) => requestView(event.target.value as StandardView)} className="ml-auto h-8 shrink-0 rounded border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700">
          <option value="iso">등각</option><option value="front">정면</option><option value="side">측면</option><option value="top">평면</option>
        </select>
        <select aria-label="3D 표시 방식" value={renderMode} onChange={(event) => setRenderMode(event.target.value as RenderMode)} className="h-8 shrink-0 rounded border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700">
          <option value="solid">음영</option><option value="edges">모서리</option><option value="transparent">투명</option>
        </select>
        <Tooltip label={projection === "perspective" ? "직교 투영으로 전환" : "원근 투영으로 전환"}><button type="button" aria-label="3D 투영 전환" onClick={() => { setProjection((value) => value === "perspective" ? "orthographic" : "perspective"); setFitRequest((value) => value + 1); }} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100">{projection === "perspective" ? <Box size={15} /> : <Square size={15} />}</button></Tooltip>
        <Tooltip label="3D 모델 초기화"><button type="button" aria-label="3D 모델 초기화" disabled={!model.valid} onClick={() => setFitRequest((value) => value + 1)} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"><Scan size={16} /></button></Tooltip>
      </div>
      <div style={{ height: (height ?? (compact ? 360 : 620)) - 48 }} className="relative w-full">
        {model.valid && model.bounds ? (
          <>
            {model.blocks.length > 1 ? <div className="absolute left-3 top-3 z-10 flex gap-1 rounded bg-white/90 p-1 shadow-sm">{model.blocks.map((block) => {
              const visible = !hiddenBlockIds.has(block.blockId);
              return <button key={block.blockId} type="button" aria-pressed={visible} disabled={visible && visibleCount === 1} onClick={() => setHiddenBlockIds((current) => { const next = new Set(current); if (next.has(block.blockId)) next.delete(block.blockId); else next.add(block.blockId); return next; })} className={`h-7 rounded px-2 text-[11px] font-semibold ${visible ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"} disabled:cursor-not-allowed`}>{block.name}</button>;
            })}</div> : null}
            {model.warnings.length > 0 ? <div className="absolute right-3 top-3 z-10 flex max-w-[360px] items-start gap-2 rounded border border-amber-300 bg-amber-50/95 px-3 py-2 text-xs text-amber-950 shadow-sm"><TriangleAlert size={16} className="mt-0.5 shrink-0 text-amber-700" /><span>{model.warnings[0].message}</span></div> : null}
            <Canvas style={{ cursor: "grab" }} dpr={[1, 2]} gl={{ antialias: true, alpha: false }} fallback={<ModelFallback message="이 브라우저에서는 WebGL 3D 미리보기를 사용할 수 없습니다." />}>
              <ModelScene blocks={model.blocks} bounds={model.bounds} fitRequest={fitRequest} view={view} projection={projection} renderMode={renderMode} hiddenBlockIds={hiddenBlockIds} onSelectSegment={onSelectSegment} />
            </Canvas>
          </>
        ) : (
          <ModelFallback message={model.issues[0]?.message ?? "3D로 표시할 도면이 없습니다."} />
        )}
      </div>
    </section>
  );
});

function ModelFallback({ message }: { message: string }) {
  return <div className="flex h-full w-full items-center justify-center px-6 text-center text-sm font-semibold text-slate-500">{message}</div>;
}

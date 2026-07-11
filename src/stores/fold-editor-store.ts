import { makeAutoObservable } from "mobx";

import { calculateFoldProfileDocument, calculateProfile } from "../domain/fold-calculation";
import {
  createFoldBlock,
  createFoldProfile,
  createFoldSegment,
  distanceMm,
  isFoldBlockClosed,
  type BendDirection,
  type CutType,
  type DecimalOperation,
  type FoldProfile,
  type MaterialSnapshot,
  type PointMm,
  type ProfileType,
} from "../domain/fold-profile";

export type EditorMode = "select" | "draw";

const cloneProfile = (profile: FoldProfile): FoldProfile =>
  JSON.parse(JSON.stringify(profile)) as FoldProfile;
const now = () => new Date().toISOString();

const createExampleProfile = () => {
  const profile = createFoldProfile({
    name: "알루미늄 절곡 예제",
    material: {
      id: "al-2t",
      name: "알루미늄",
      thickness: 2,
      insideBendRadius: 2,
      cutAngle: 135,
      elongation: { "v-cut": 1.2, "a-cut": 0.8, "no-cut": 2 },
      cutDepth: { "v-cut": 0.5, "a-cut": 0.8, "no-cut": 0 },
    },
    product: { length: 2400, quantity: 10 },
  });

  profile.blocks[0].segments = [
    createFoldSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {
      bendAfter: { direction: "front", cutType: "v-cut", angle: 90 },
    }),
    createFoldSegment({ x: 100, y: 0 }, { x: 100, y: -50 }, {
      bendAfter: { direction: "back", cutType: "v-cut", angle: 90 },
    }),
    createFoldSegment({ x: 100, y: -50 }, { x: 180, y: -50 }),
  ];
  return profile;
};

export class FoldEditorStore {
  profile = createExampleProfile();
  activeBlockId = this.profile.blocks[0].id;
  selectedSegmentId: string | null = this.profile.blocks[0].segments[0]?.id ?? null;
  mode: EditorMode = "select";
  draftStart: PointMm | null = null;
  pointerWorld: PointMm | null = null;
  history: FoldProfile[] = [];
  future: FoldProfile[] = [];

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  get activeBlock() {
    return this.profile.blocks.find((block) => block.id === this.activeBlockId) ?? this.profile.blocks[0];
  }

  get selectedSegment() {
    return this.activeBlock?.segments.find((segment) => segment.id === this.selectedSegmentId) ?? null;
  }

  get calculation() {
    return calculateFoldProfileDocument(this.profile);
  }

  get blockCalculations() {
    return this.profile.blocks.map((block) =>
      calculateProfile(block.segments, this.profile.material, this.profile.calculation),
    );
  }

  get activeCalculation() {
    const index = this.profile.blocks.findIndex((block) => block.id === this.activeBlockId);
    return this.blockCalculations[Math.max(0, index)];
  }

  get selectedSegmentCalculation() {
    return this.activeCalculation?.segments.find((segment) => segment.id === this.selectedSegmentId) ?? null;
  }

  get isClosed() {
    return this.activeBlock ? isFoldBlockClosed(this.activeBlock) : false;
  }

  get canClose() {
    if (this.isClosed || !this.activeBlock || this.activeBlock.segments.length < 2) return false;
    const first = this.activeBlock.segments[0].start;
    const last = this.activeBlock.segments.at(-1)!.end;
    return distanceMm(first, last) >= 1;
  }

  get canUndo() {
    return this.history.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  private checkpoint() {
    this.history.push(cloneProfile(this.profile));
    if (this.history.length > 50) this.history.shift();
    this.future = [];
  }

  private touch() {
    this.profile.updatedAt = now();
  }

  setMode(mode: EditorMode) {
    if (mode === "draw" && this.isClosed) return;
    this.mode = mode;
    this.draftStart = mode === "draw" ? this.activeBlock?.segments.at(-1)?.end ?? null : null;
  }

  setProfileType(profileType: ProfileType) {
    if (profileType === this.profile.profileType) return;
    this.checkpoint();
    this.profile.profileType = profileType;
    if (profileType === "box") {
      if (this.profile.blocks.length < 2) this.profile.blocks.push(createFoldBlock(2));
    } else {
      this.profile.blocks = [this.profile.blocks[0]];
    }
    this.activeBlockId = this.profile.blocks[0].id;
    this.selectedSegmentId = this.profile.blocks[0].segments[0]?.id ?? null;
    this.finishDrawing();
    this.touch();
  }

  setActiveBlock(blockId: string) {
    const block = this.profile.blocks.find((item) => item.id === blockId);
    if (!block) return;
    this.activeBlockId = blockId;
    this.selectedSegmentId = block.segments[0]?.id ?? null;
    this.finishDrawing();
  }

  startSecondBlock() {
    if (this.profile.profileType !== "box") return;
    if (this.profile.blocks.length < 2) this.profile.blocks.push(createFoldBlock(2));
    const block = this.profile.blocks[1];
    this.activeBlockId = block.id;
    this.selectedSegmentId = block.segments.at(-1)?.id ?? null;
    this.mode = "draw";
    this.draftStart = block.segments.at(-1)?.end ?? null;
  }

  setPointerWorld(point: PointMm | null) {
    this.pointerWorld = point;
  }

  selectSegment(id: string | null, blockId = this.activeBlockId) {
    this.activeBlockId = blockId;
    this.selectedSegmentId = id;
    if (id) this.mode = "select";
  }

  addDrawPoint(point: PointMm) {
    if (this.isClosed || !this.activeBlock) return;
    if (!this.draftStart) {
      this.draftStart = point;
      return;
    }
    if (distanceMm(this.draftStart, point) < 1) return;

    this.checkpoint();
    const segment = createFoldSegment(this.draftStart, point);
    this.activeBlock.segments.push(segment);
    this.selectedSegmentId = segment.id;
    this.draftStart = point;
    this.touch();
  }

  closeProfile() {
    if (!this.canClose) {
      if (this.isClosed) this.finishDrawing();
      return;
    }
    if (!this.activeBlock) return;
    const start = this.activeBlock.segments[0].start;
    const end = this.activeBlock.segments.at(-1)!.end;
    this.checkpoint();
    const closingSegment = createFoldSegment(end, start);
    this.activeBlock.segments.push(closingSegment);
    this.selectedSegmentId = closingSegment.id;
    this.touch();
    this.finishDrawing();
  }

  finishDrawing() {
    this.mode = "select";
    this.draftStart = null;
    this.pointerWorld = null;
  }

  deleteSelected() {
    if (!this.activeBlock) return;
    const segments = this.activeBlock.segments;
    const index = segments.findIndex((segment) => segment.id === this.selectedSegmentId);
    if (index < 0) return;
    this.checkpoint();
    segments.splice(index, 1);

    for (let i = index; i < segments.length; i += 1) {
      const previousEnd = segments[i - 1]?.end;
      if (previousEnd) {
        segments[i].start = { ...previousEnd };
        segments[i].inputLength = distanceMm(
          segments[i].start,
          segments[i].end,
        );
      }
    }
    this.selectedSegmentId = segments[Math.min(index, segments.length - 1)]?.id ?? null;
    this.touch();
  }

  clearProfile() {
    if (this.profile.blocks.every((block) => block.segments.length === 0)) return;
    this.checkpoint();
    this.profile.blocks = this.profile.profileType === "box"
      ? [createFoldBlock(1), createFoldBlock(2)]
      : [createFoldBlock(1)];
    this.activeBlockId = this.profile.blocks[0].id;
    this.selectedSegmentId = null;
    this.mode = "draw";
    this.draftStart = null;
    this.touch();
  }

  moveJoint(index: number, point: PointMm, saveHistory = true) {
    if (!this.activeBlock) return;
    const segments = this.activeBlock.segments;
    if (saveHistory) this.checkpoint();
    if (index === 0 && segments[0]) {
      segments[0].start = { ...point };
      segments[0].inputLength = distanceMm(point, segments[0].end);
    } else {
      const previous = segments[index - 1];
      const next = segments[index];
      if (previous) {
        previous.end = { ...point };
        previous.inputLength = distanceMm(previous.start, point);
      }
      if (next) {
        next.start = { ...point };
        next.inputLength = distanceMm(point, next.end);
      }
    }
    this.touch();
  }

  updateSelectedLength(length: number) {
    if (!this.activeBlock) return;
    const segments = this.activeBlock.segments;
    const index = segments.findIndex((segment) => segment.id === this.selectedSegmentId);
    const segment = segments[index];
    if (!segment || !Number.isFinite(length) || length <= 0) return;

    const currentLength = distanceMm(segment.start, segment.end);
    if (currentLength === 0) return;
    this.checkpoint();
    const direction = {
      x: (segment.end.x - segment.start.x) / currentLength,
      y: (segment.end.y - segment.start.y) / currentLength,
    };
    const newEnd = {
      x: segment.start.x + direction.x * length,
      y: segment.start.y + direction.y * length,
    };
    const delta = { x: newEnd.x - segment.end.x, y: newEnd.y - segment.end.y };
    segment.end = newEnd;
    segment.inputLength = length;
    for (let i = index + 1; i < segments.length; i += 1) {
      segments[i].start.x += delta.x;
      segments[i].start.y += delta.y;
      segments[i].end.x += delta.x;
      segments[i].end.y += delta.y;
    }
    this.touch();
  }

  updateSelectedBend(direction: BendDirection, cutType: CutType, angle: number) {
    if (!this.selectedSegment) return;
    this.checkpoint();
    this.selectedSegment.bendAfter = { direction, cutType, angle };
    this.touch();
  }

  removeSelectedBend() {
    if (!this.selectedSegment?.bendAfter) return;
    this.checkpoint();
    delete this.selectedSegment.bendAfter;
    this.touch();
  }

  setSelectedElongationOverride(value: number | null) {
    if (!this.selectedSegment || (value !== null && !Number.isFinite(value))) return;
    this.checkpoint();
    if (value === null) delete this.selectedSegment.elongationOverride;
    else this.selectedSegment.elongationOverride = value;
    this.touch();
  }

  updateMaterial(partial: Partial<MaterialSnapshot>) {
    if (partial.thickness !== undefined && (!Number.isFinite(partial.thickness) || partial.thickness <= 0)) return;
    if (partial.insideBendRadius !== undefined && (!Number.isFinite(partial.insideBendRadius) || partial.insideBendRadius < 0)) return;
    if (partial.cutAngle !== undefined && (!Number.isFinite(partial.cutAngle) || partial.cutAngle < 0 || partial.cutAngle > 180)) return;
    if (partial.elongation && Object.values(partial.elongation).some((value) => !Number.isFinite(value))) return;
    if (partial.cutDepth && Object.values(partial.cutDepth).some((value) => !Number.isFinite(value) || value < 0)) return;
    this.checkpoint();
    this.profile.material = {
      ...this.profile.material,
      ...partial,
      elongation: { ...this.profile.material.elongation, ...partial.elongation },
      cutDepth: { ...this.profile.material.cutDepth, ...partial.cutDepth },
    };
    this.touch();
  }

  setDecimalSettings(decimalPlaces: number, decimalOperation: DecimalOperation) {
    if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 4) return;
    this.checkpoint();
    this.profile.calculation.decimalPlaces = decimalPlaces;
    this.profile.calculation.decimalOperation = decimalOperation;
    this.touch();
  }

  setProductLength(value: number) {
    if (!Number.isFinite(value) || value < 0) return;
    this.profile.product.length = value;
    this.touch();
  }

  setQuantity(value: number) {
    if (!Number.isFinite(value) || value < 1) return;
    this.profile.product.quantity = Math.round(value);
    this.touch();
  }

  undo() {
    const previous = this.history.pop();
    if (!previous) return;
    const selectedId = this.selectedSegmentId;
    this.future.push(cloneProfile(this.profile));
    this.profile = previous;
    if (!this.profile.blocks.some((block) => block.id === this.activeBlockId)) this.activeBlockId = this.profile.blocks[0].id;
    const segments = this.activeBlock.segments;
    this.selectedSegmentId = segments.some((segment) => segment.id === selectedId)
      ? selectedId
      : segments.at(-1)?.id ?? null;
    this.finishDrawing();
  }

  redo() {
    const next = this.future.pop();
    if (!next) return;
    const selectedId = this.selectedSegmentId;
    this.history.push(cloneProfile(this.profile));
    this.profile = next;
    if (!this.profile.blocks.some((block) => block.id === this.activeBlockId)) this.activeBlockId = this.profile.blocks[0].id;
    const segments = this.activeBlock.segments;
    this.selectedSegmentId = segments.some((segment) => segment.id === selectedId)
      ? selectedId
      : segments.at(-1)?.id ?? null;
    this.finishDrawing();
  }
}

export const foldEditorStore = new FoldEditorStore();

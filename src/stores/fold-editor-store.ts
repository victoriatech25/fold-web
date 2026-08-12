import { makeAutoObservable } from "mobx";

import { calculateFoldProfileDocument, calculateProfile } from "../domain/fold-calculation";
import {
  normalizeFoldVariableName,
  replaceFoldExpressionIdentifier,
  resolveFoldProfileExpressions,
} from "../domain/fold-expression";
import {
  createFoldBlock,
  createFoldProfile,
  createFoldSegment,
  distanceMm,
  isFoldBlockClosed,
  normalizeEditorAngleDeg,
  normalizeEditorLengthMm,
  normalizeEditorPoint,
  type BendDirection,
  type BendForm,
  type BendOperation,
  type CalculationSettings,
  type CutType,
  type DecimalOperation,
  type ElongationMode,
  type ElongationOption,
  type FoldProfile,
  type FoldBlock,
  type FoldVariable,
  type MaterialSnapshot,
  type ArcSide,
  type PanelDimensionRole,
  type PanelDirection,
  type PointMm,
  type ProfileType,
} from "../domain/fold-profile";

export type EditorMode = "select" | "draw";

const cloneProfile = (profile: FoldProfile): FoldProfile =>
  JSON.parse(JSON.stringify(profile)) as FoldProfile;
const now = () => new Date().toISOString();

function defaultBendAtJoint(previous: PointMm, joint: PointMm, next: PointMm) {
  const incoming = { x: joint.x - previous.x, y: joint.y - previous.y };
  const outgoing = { x: next.x - joint.x, y: next.y - joint.y };
  const incomingLength = Math.hypot(incoming.x, incoming.y);
  const outgoingLength = Math.hypot(outgoing.x, outgoing.y);
  if (incomingLength < 0.001 || outgoingLength < 0.001) return null;

  const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
  const dot = incoming.x * outgoing.x + incoming.y * outgoing.y;
  const normalizedCross = cross / (incomingLength * outgoingLength);
  if (Math.abs(normalizedCross) < 0.0001) return null;

  const cosine = Math.max(-1, Math.min(1, dot / (incomingLength * outgoingLength)));
  return {
    direction: (cross < 0 ? "front" : "back") as BendDirection,
    cutType: "v-cut" as const,
    angle: Math.round((Math.acos(cosine) * 180 / Math.PI) * 100) / 100,
  };
}

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
  readOnly = false;
  serverManagedMaterial = false;
  activeBlockId = this.profile.blocks[0].id;
  selectedSegmentId: string | null = this.profile.blocks[0].segments[0]?.id ?? null;
  mode: EditorMode = "select";
  draftStart: PointMm | null = null;
  pointerWorld: PointMm | null = null;
  history: FoldProfile[] = [];
  future: FoldProfile[] = [];
  drawingCompletionRevision = 0;

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
    const resolution = this.expressionResolution;
    return this.profile.blocks.map((block) =>
      calculateProfile(
        block.segments,
        this.profile.material,
        this.profile.calculation,
        resolution.segmentLengths,
      ),
    );
  }

  get expressionResolution() {
    return resolveFoldProfileExpressions(this.profile);
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

  loadProfile(
    profile: FoldProfile,
    readOnly = false,
    serverManagedMaterial = false,
  ) {
    this.profile = cloneProfile(profile);
    this.readOnly = readOnly;
    this.serverManagedMaterial = serverManagedMaterial;
    this.activeBlockId = this.profile.blocks[0].id;
    this.selectedSegmentId = this.profile.blocks[0].segments[0]?.id ?? null;
    this.mode = "select";
    this.draftStart = null;
    this.pointerWorld = null;
    this.history = [];
    this.future = [];
    this.drawingCompletionRevision += 1;
  }

  synchronizeProfile(profile: FoldProfile) {
    const activeBlockId = this.activeBlockId;
    const selectedSegmentId = this.selectedSegmentId;
    this.profile = cloneProfile(profile);
    this.activeBlockId = this.profile.blocks.some(
      (block) => block.id === activeBlockId,
    )
      ? activeBlockId
      : this.profile.blocks[0].id;
    this.selectedSegmentId = this.activeBlock.segments.some(
      (segment) => segment.id === selectedSegmentId,
    )
      ? selectedSegmentId
      : this.activeBlock.segments[0]?.id ?? null;
  }

  setReadOnly(readOnly: boolean) {
    this.readOnly = readOnly;
    if (readOnly) this.finishDrawing();
  }

  setProfileName(name: string) {
    if (this.readOnly) return;
    const normalized = name.slice(0, 200);
    if (normalized === this.profile.name) return;
    this.checkpoint();
    this.profile.name = normalized;
    this.touch();
  }

  private touch() {
    this.profile.updatedAt = now();
  }

  private applyExpressionGeometry() {
    const resolution = this.expressionResolution;
    this.profile.blocks.forEach((block) => {
      const directions = block.segments.map((segment) => {
        const dx = segment.end.x - segment.start.x;
        const dy = segment.end.y - segment.start.y;
        const length = Math.hypot(dx, dy);
        return length > 1e-9 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 };
      });
      block.segments.forEach((segment, index) => {
        if (index > 0) segment.start = { ...block.segments[index - 1].end };
        const resolved = resolution.segmentLengths[segment.id];
        const length = resolved === undefined ? segment.inputLength : Number(resolved);
        segment.end = normalizeEditorPoint({
          x: segment.start.x + directions[index].x * length,
          y: segment.start.y + directions[index].y * length,
        });
      });
    });
  }

  setMode(mode: EditorMode) {
    if (this.readOnly && mode === "draw") return;
    if (mode === "draw" && this.isClosed) return;
    if (mode === "select" && this.mode === "draw") {
      this.finishDrawing();
      return;
    }
    this.mode = mode;
    this.draftStart = mode === "draw" ? this.activeBlock?.segments.at(-1)?.end ?? null : null;
  }

  setProfileType(profileType: ProfileType) {
    if (this.readOnly) return;
    if (profileType === this.profile.profileType) return;
    this.checkpoint();
    this.profile.profileType = profileType;
    if (profileType === "box") {
      if (this.profile.blocks.length < 2) this.profile.blocks.push(createFoldBlock(2));
    } else {
      this.profile.blocks = [this.profile.blocks[0]];
      this.profile.boxDefinition = undefined;
    }
    this.activeBlockId = this.profile.blocks[0].id;
    this.selectedSegmentId = this.profile.blocks[0].segments[0]?.id ?? null;
    this.finishDrawing();
    this.touch();
  }

  setSelectedGeometry(kind: "line" | "arc") {
    if (this.readOnly || !this.selectedSegment) return;
    if ((this.selectedSegment.geometry?.kind ?? "line") === kind) return;
    this.checkpoint();
    this.selectedSegment.geometry = kind === "line"
      ? { kind: "line" }
      : {
          kind: "arc",
          side: "left",
          sagitta: normalizeEditorLengthMm(Math.max(1, this.selectedSegment.inputLength / 5)),
        };
    this.touch();
  }

  updateSelectedArc(side: ArcSide, sagitta: number, saveHistory = true) {
    if (this.readOnly || !this.selectedSegment || !Number.isFinite(sagitta) || sagitta <= 0) return;
    if (saveHistory) this.checkpoint();
    this.selectedSegment.geometry = {
      kind: "arc",
      side,
      sagitta: normalizeEditorLengthMm(sagitta),
    };
    this.touch();
  }

  addPanelToSelected() {
    if (this.readOnly || !this.selectedSegment || !this.activeBlock) return;
    if (this.profile.panelAttachments.some((panel) => panel.hostSegmentId === this.selectedSegmentId)) return;
    this.checkpoint();
    const order = this.profile.panelAttachments.length + 1;
    const block = createFoldBlock(1, `패널 ${order}`);
    block.id = `panel-block-${crypto.randomUUID()}`;
    block.segments = [createFoldSegment({ x: 0, y: 0 }, { x: 100, y: 0 })];
    this.profile.panelAttachments.push({
      id: `panel-${crypto.randomUUID()}`,
      name: `연결 패널 ${order}`,
      hostBlockId: this.activeBlock.id,
      hostSegmentId: this.selectedSegment.id,
      direction: "clockwise",
      dimensionRole: "none",
      block,
    });
    this.touch();
  }

  applyPanelTemplate(
    panelId: string,
    source: FoldBlock,
    provenance: { name: string; sourceRevisionId: string; sourceChecksum: string },
  ) {
    if (this.readOnly) return;
    const panel = this.profile.panelAttachments.find((item) => item.id === panelId);
    if (!panel) return;
    this.checkpoint();
    const block = cloneProfile({ ...this.profile, blocks: [source] }).blocks[0];
    block.id = `panel-block-${crypto.randomUUID()}`;
    block.order = 1;
    block.segments.forEach((segment) => {
      segment.id = `panel-segment-${crypto.randomUUID()}`;
    });
    panel.name = provenance.name.slice(0, 100);
    panel.block = block;
    panel.sourceRevisionId = provenance.sourceRevisionId;
    panel.sourceChecksum = provenance.sourceChecksum;
    this.touch();
  }

  removePanelAttachment(panelId: string) {
    if (this.readOnly) return;
    const index = this.profile.panelAttachments.findIndex((panel) => panel.id === panelId);
    if (index < 0) return;
    this.checkpoint();
    this.profile.panelAttachments.splice(index, 1);
    this.touch();
  }

  updatePanelAttachment(
    panelId: string,
    input: Partial<{ name: string; direction: PanelDirection; dimensionRole: PanelDimensionRole; spanMm: number }>,
  ) {
    if (this.readOnly) return;
    const panel = this.profile.panelAttachments.find((item) => item.id === panelId);
    if (!panel) return;
    this.checkpoint();
    if (input.name !== undefined) panel.name = input.name.slice(0, 100);
    if (input.direction !== undefined) panel.direction = input.direction;
    if (input.dimensionRole !== undefined) {
      if (input.dimensionRole === "secondary-product-dimension") {
        this.profile.panelAttachments.forEach((item) => {
          if (item.id !== panel.id) item.dimensionRole = "none";
        });
      }
      panel.dimensionRole = input.dimensionRole;
    }
    if (input.spanMm !== undefined && Number.isFinite(input.spanMm) && input.spanMm > 0) {
      const segment = panel.block.segments[0];
      const normalized = normalizeEditorLengthMm(input.spanMm);
      if (segment) {
        segment.inputLength = normalized;
        segment.end = { x: normalized, y: 0 };
      }
    }
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
    if (this.readOnly) return;
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
    if (id && this.mode === "draw") this.finishDrawing();
    this.activeBlockId = blockId;
    this.selectedSegmentId = id;
    if (id) this.mode = "select";
  }

  addDrawPoint(point: PointMm) {
    if (this.readOnly) return;
    point = normalizeEditorPoint(point);
    if (this.isClosed || !this.activeBlock) return;
    if (!this.draftStart) {
      this.draftStart = point;
      return;
    }
    if (distanceMm(this.draftStart, point) < 1) return;

    this.checkpoint();
    const previousSegment = this.activeBlock.segments.at(-1);
    if (previousSegment && !previousSegment.bendAfter) {
      const bend = defaultBendAtJoint(previousSegment.start, previousSegment.end, point);
      if (bend) previousSegment.bendAfter = bend;
    }
    const segment = createFoldSegment(this.draftStart, point);
    this.activeBlock.segments.push(segment);
    this.selectedSegmentId = segment.id;
    this.draftStart = point;
    this.touch();
  }

  closeProfile() {
    if (this.readOnly) return;
    if (!this.canClose) {
      if (this.isClosed) this.finishDrawing();
      return;
    }
    if (!this.activeBlock) return;
    const start = this.activeBlock.segments[0].start;
    const end = this.activeBlock.segments.at(-1)!.end;
    this.checkpoint();
    const closingSegment = createFoldSegment(end, start);
    const previousSegment = this.activeBlock.segments.at(-1)!;
    if (!previousSegment.bendAfter) {
      const bend = defaultBendAtJoint(previousSegment.start, end, start);
      if (bend) previousSegment.bendAfter = bend;
    }
    const firstSegment = this.activeBlock.segments[0];
    const closingBend = defaultBendAtJoint(end, start, firstSegment.end);
    if (closingBend) closingSegment.bendAfter = closingBend;
    this.activeBlock.segments.push(closingSegment);
    this.selectedSegmentId = closingSegment.id;
    this.touch();
    this.finishDrawing();
  }

  finishDrawing() {
    const completed = this.mode === "draw";
    this.mode = "select";
    this.draftStart = null;
    this.pointerWorld = null;
    if (completed) this.drawingCompletionRevision += 1;
  }

  deleteSelected() {
    if (this.readOnly) return;
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
        segments[i].inputLength = normalizeEditorLengthMm(segments[i].inputLength);
      }
    }
    this.selectedSegmentId = segments[Math.min(index, segments.length - 1)]?.id ?? null;
    this.touch();
  }

  clearProfile() {
    if (this.readOnly) return;
    if (this.profile.blocks.every((block) => block.segments.length === 0)) return;
    this.checkpoint();
    this.profile.blocks = this.profile.profileType === "box"
      ? [createFoldBlock(1), createFoldBlock(2)]
      : [createFoldBlock(1)];
    this.profile.boxDefinition = undefined;
    this.profile.panelAttachments = [];
    this.activeBlockId = this.profile.blocks[0].id;
    this.selectedSegmentId = null;
    this.mode = "draw";
    this.draftStart = null;
    this.touch();
  }

  moveJoint(index: number, point: PointMm, saveHistory = true) {
    if (this.readOnly) return;
    if (!this.activeBlock) return;
    point = normalizeEditorPoint(point);
    const segments = this.activeBlock.segments;
    if (saveHistory) this.checkpoint();
    if (index === 0 && segments[0]) {
      segments[0].start = { ...point };
      segments[0].inputLength = normalizeEditorLengthMm(
        distanceMm(point, segments[0].end),
      );
    } else {
      const previous = segments[index - 1];
      const next = segments[index];
      if (previous) {
        previous.end = { ...point };
        previous.inputLength = normalizeEditorLengthMm(
          distanceMm(previous.start, point),
        );
      }
      if (next) {
        next.start = { ...point };
        next.inputLength = normalizeEditorLengthMm(
          distanceMm(point, next.end),
        );
      }
    }
    this.touch();
  }

  updateSelectedLength(length: number) {
    if (this.readOnly) return;
    if (!this.activeBlock) return;
    const segments = this.activeBlock.segments;
    const index = segments.findIndex((segment) => segment.id === this.selectedSegmentId);
    const segment = segments[index];
    if (!segment || !Number.isFinite(length) || length <= 0) return;

    const currentLength = distanceMm(segment.start, segment.end);
    if (currentLength === 0) return;
    length = normalizeEditorLengthMm(length);
    this.checkpoint();
    const direction = {
      x: (segment.end.x - segment.start.x) / currentLength,
      y: (segment.end.y - segment.start.y) / currentLength,
    };
    const newEnd = normalizeEditorPoint({
      x: segment.start.x + direction.x * length,
      y: segment.start.y + direction.y * length,
    });
    const delta = normalizeEditorPoint({
      x: newEnd.x - segment.end.x,
      y: newEnd.y - segment.end.y,
    });
    segment.end = newEnd;
    segment.inputLength = length;
    for (let i = index + 1; i < segments.length; i += 1) {
      segments[i].start = normalizeEditorPoint({
        x: segments[i].start.x + delta.x,
        y: segments[i].start.y + delta.y,
      });
      segments[i].end = normalizeEditorPoint({
        x: segments[i].end.x + delta.x,
        y: segments[i].end.y + delta.y,
      });
    }
    this.touch();
  }

  updateSelectedBend(direction: BendDirection, cutType: CutType, angle: number) {
    if (this.readOnly) return;
    if (!this.selectedSegment) return;
    this.checkpoint();
    this.selectedSegment.bendAfter = {
      direction,
      ...(this.selectedSegment.bendAfter?.form && {
        form: this.selectedSegment.bendAfter.form,
      }),
      ...(this.selectedSegment.bendAfter?.secondaryOperation && {
        secondaryOperation: this.selectedSegment.bendAfter.secondaryOperation,
      }),
      cutType,
      angle: normalizeEditorAngleDeg(angle),
    };
    this.touch();
  }

  updateSelectedBendOperations(
    form: BendForm,
    secondaryOperation?: BendOperation,
    primaryDirection?: BendDirection,
  ) {
    if (this.readOnly || !this.selectedSegment?.bendAfter) return;
    this.checkpoint();
    if (primaryDirection) this.selectedSegment.bendAfter.direction = primaryDirection;
    if (form === "standard") delete this.selectedSegment.bendAfter.form;
    else this.selectedSegment.bendAfter.form = form;
    if (secondaryOperation) this.selectedSegment.bendAfter.secondaryOperation = secondaryOperation;
    else delete this.selectedSegment.bendAfter.secondaryOperation;
    this.touch();
  }

  setSelectedCalculateElongation(enabled: boolean) {
    if (this.readOnly || !this.selectedSegment?.bendAfter) return;
    this.checkpoint();
    this.selectedSegment.calculateElongation = enabled;
    this.touch();
  }

  removeSelectedBend() {
    if (this.readOnly) return;
    if (!this.selectedSegment?.bendAfter) return;
    this.checkpoint();
    delete this.selectedSegment.bendAfter;
    this.touch();
  }

  setSelectedElongationOverride(value: number | null) {
    if (this.readOnly) return;
    if (!this.selectedSegment || (value !== null && !Number.isFinite(value))) return;
    this.checkpoint();
    if (value === null) delete this.selectedSegment.elongationOverride;
    else this.selectedSegment.elongationOverride = normalizeEditorLengthMm(value);
    this.touch();
  }

  setSelectedFormula(source: string | null) {
    if (this.readOnly || !this.selectedSegment) return;
    this.checkpoint();
    const formula = source?.trim();
    if (formula) this.selectedSegment.formula = formula.slice(0, 512).toUpperCase();
    else delete this.selectedSegment.formula;
    this.applyExpressionGeometry();
    this.touch();
  }

  addVariable() {
    if (this.readOnly) return;
    this.checkpoint();
    let sequence = this.profile.variables.length + 1;
    while (this.profile.variables.some((variable) => variable.name === `V${sequence}`)) sequence += 1;
    this.profile.variables.push({ name: `V${sequence}`, value: 1 });
    this.applyExpressionGeometry();
    this.touch();
  }

  updateVariable(index: number, partial: Partial<FoldVariable>) {
    if (this.readOnly) return;
    const variable = this.profile.variables[index];
    if (!variable) return;
    if (partial.value !== undefined && !Number.isFinite(partial.value)) return;
    this.checkpoint();

    if (partial.name !== undefined) {
      const previous = variable.name;
      const next = normalizeFoldVariableName(partial.name).slice(0, 32);
      variable.name = next;
      if (previous && next && previous !== next) {
        this.profile.variables.forEach((item) => {
          if (item.formula) item.formula = replaceFoldExpressionIdentifier(item.formula, previous, next);
        });
        this.profile.blocks.forEach((block) => block.segments.forEach((segment) => {
          if (segment.formula) segment.formula = replaceFoldExpressionIdentifier(segment.formula, previous, next);
        }));
        if (this.profile.product.formula) {
          this.profile.product.formula = replaceFoldExpressionIdentifier(
            this.profile.product.formula,
            previous,
            next,
          );
        }
      }
    }
    if (partial.value !== undefined) variable.value = normalizeEditorLengthMm(partial.value);
    if (partial.formula !== undefined) {
      const formula = partial.formula.trim();
      if (formula) variable.formula = formula.slice(0, 512).toUpperCase();
      else delete variable.formula;
    }
    this.applyExpressionGeometry();
    this.touch();
  }

  removeVariable(index: number) {
    if (this.readOnly || !this.profile.variables[index]) return;
    this.checkpoint();
    this.profile.variables.splice(index, 1);
    this.applyExpressionGeometry();
    this.touch();
  }

  setProductFormula(source: string | null, enabled: boolean) {
    if (this.readOnly) return;
    this.checkpoint();
    const formula = source?.trim();
    if (formula) this.profile.product.formula = formula.slice(0, 512).toUpperCase();
    else delete this.profile.product.formula;
    this.profile.product.formulaEnabled = enabled;
    this.touch();
  }

  updateMaterial(partial: Partial<MaterialSnapshot>) {
    if (this.readOnly) return;
    if (partial.thickness !== undefined && (!Number.isFinite(partial.thickness) || partial.thickness <= 0)) return;
    if (partial.insideBendRadius !== undefined && (!Number.isFinite(partial.insideBendRadius) || partial.insideBendRadius < 0)) return;
    if (partial.cutAngle !== undefined && (!Number.isFinite(partial.cutAngle) || partial.cutAngle < 0 || partial.cutAngle > 180)) return;
    if (partial.elongation && Object.values(partial.elongation).some((value) => !Number.isFinite(value))) return;
    if (partial.cutDepth && Object.values(partial.cutDepth).some((value) => !Number.isFinite(value) || value < 0)) return;
    this.checkpoint();
    this.profile.material = {
      ...this.profile.material,
      ...partial,
      ...(partial.thickness !== undefined && {
        thickness: normalizeEditorLengthMm(partial.thickness),
      }),
      ...(partial.insideBendRadius !== undefined && {
        insideBendRadius: normalizeEditorLengthMm(partial.insideBendRadius),
      }),
      ...(partial.cutAngle !== undefined && {
        cutAngle: normalizeEditorAngleDeg(partial.cutAngle),
      }),
      elongation: Object.fromEntries(
        Object.entries({
          ...this.profile.material.elongation,
          ...partial.elongation,
        }).map(([key, value]) => [key, normalizeEditorLengthMm(value)]),
      ) as MaterialSnapshot["elongation"],
      cutDepth: Object.fromEntries(
        Object.entries({
          ...this.profile.material.cutDepth,
          ...partial.cutDepth,
        }).map(([key, value]) => [key, normalizeEditorLengthMm(value)]),
      ) as MaterialSnapshot["cutDepth"],
    };
    this.touch();
  }

  applyServerMaterial(
    material: MaterialSnapshot,
    calculation: CalculationSettings,
  ) {
    if (this.readOnly) return;
    this.checkpoint();
    this.profile.material = cloneProfile({
      ...this.profile,
      material,
    }).material;
    this.profile.calculation = { ...calculation };
    this.touch();
  }

  applyServerSheet(sheetItemSnapshot: FoldProfile["sheetItemSnapshot"]) {
    if (this.readOnly) return;
    this.checkpoint();
    this.profile.sheetItemSnapshot = sheetItemSnapshot
      ? cloneProfile({ ...this.profile, sheetItemSnapshot }).sheetItemSnapshot
      : undefined;
    this.touch();
  }

  setDecimalSettings(decimalPlaces: number, decimalOperation: DecimalOperation) {
    if (this.readOnly) return;
    if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 6) return;
    this.checkpoint();
    this.profile.calculation.decimalPlaces = decimalPlaces;
    this.profile.calculation.decimalOperation = decimalOperation;
    this.touch();
  }

  setCalculationPolicy(
    mode: ElongationMode,
    elongationOption: ElongationOption,
    vCutEnabled: boolean,
  ) {
    if (this.readOnly) return;
    this.checkpoint();
    this.profile.calculation.mode = mode;
    this.profile.calculation.elongationOption = elongationOption;
    this.profile.calculation.vCutEnabled = vCutEnabled;
    this.touch();
  }

  setProductLength(value: number) {
    if (this.readOnly) return;
    if (!Number.isFinite(value) || value < 0) return;
    this.profile.product.length = normalizeEditorLengthMm(value);
    this.touch();
  }

  setQuantity(value: number) {
    if (this.readOnly) return;
    if (!Number.isFinite(value) || value < 1) return;
    this.profile.product.quantity = Math.round(value);
    this.touch();
  }

  undo() {
    if (this.readOnly) return;
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
    if (this.readOnly) return;
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

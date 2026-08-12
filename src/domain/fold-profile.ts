export const FOLD_PROFILE_SCHEMA_VERSION = 4 as const;

export type PointMm = {
  x: number;
  y: number;
};

export type BendDirection = "front" | "back";
export type BendForm = "standard" | "a" | "zero" | "u";
export type BendOperation = {
  direction: BendDirection;
  form: BendForm;
};
export type CutType = "v-cut" | "a-cut" | "no-cut";
export type ElongationMode = "fixed" | "ratio";
export type ElongationOption = "standard" | "two-line" | "diagonal" | "ext1";
export type DecimalOperation = "none" | "round" | "floor" | "ceil";
export type ProfileType = "normal" | "box";
export type ArcSide = "left" | "right";
export type SegmentGeometry =
  | { kind: "line" }
  | { kind: "arc"; side: ArcSide; sagitta: number };

export type Bend = {
  direction: BendDirection;
  form?: BendForm;
  secondaryOperation?: BendOperation;
  cutType: CutType;
  angle: number;
};

export type FoldSegment = {
  id: string;
  start: PointMm;
  end: PointMm;
  inputLength: number;
  geometry?: SegmentGeometry;
  formula?: string;
  bendAfter?: Bend;
  calculateElongation?: boolean;
  elongationOverride?: number;
};

export type BoxDefinition = {
  widthBaseSegmentId: string;
  depthBaseSegmentId: string;
};

export type PanelDirection = "clockwise" | "counterclockwise";
export type PanelDimensionRole = "none" | "secondary-product-dimension";

export type PanelAttachment = {
  id: string;
  name: string;
  hostBlockId: string;
  hostSegmentId: string;
  direction: PanelDirection;
  dimensionRole: PanelDimensionRole;
  sourceRevisionId?: string;
  sourceChecksum?: string;
  block: FoldBlock;
};

export type FoldVariable = {
  name: string;
  value: number;
  formula?: string;
};

export type FoldBlock = {
  id: string;
  name: string;
  order: number;
  segments: FoldSegment[];
};

export type MaterialRule = {
  thickness: number;
  insideBendRadius: number;
  cutAngle: number;
  elongation: Record<CutType, number>;
  cutDepth: Record<CutType, number>;
};

export type MaterialSnapshot = MaterialRule & {
  id: string;
  name: string;
};

export type SheetItemSnapshot = {
  sheetItemId: string;
  materialVariantId: string;
  code: string;
  name: string;
  finishName: string | null;
  widthMm: string;
  lengthMm: string;
  rotationPolicy: "FREE" | "KEEP_GRAIN";
  grainAxis: "NONE" | "WIDTH" | "LENGTH";
  trimTopMm: string;
  trimRightMm: string;
  trimBottomMm: string;
  trimLeftMm: string;
  nominalAreaM2: string;
  usableWidthMm: string;
  usableLengthMm: string;
  usableAreaM2: string;
  effectiveWeightKg: string | null;
  weightSource: "CALCULATED" | "OVERRIDE" | "UNAVAILABLE";
};

export type CalculationSettings = {
  mode: ElongationMode;
  elongationOption: ElongationOption;
  vCutEnabled: boolean;
  decimalPlaces: number;
  decimalOperation: DecimalOperation;
};

export type ProductSpec = {
  length: number;
  quantity: number;
  formula?: string;
  formulaEnabled?: boolean;
};

export type FoldProfile = {
  schemaVersion: typeof FOLD_PROFILE_SCHEMA_VERSION;
  id: string;
  name: string;
  profileType: ProfileType;
  material: MaterialSnapshot;
  sheetItemSnapshot?: SheetItemSnapshot;
  product: ProductSpec;
  calculation: CalculationSettings;
  variables: FoldVariable[];
  blocks: FoldBlock[];
  boxDefinition?: BoxDefinition;
  panelAttachments: PanelAttachment[];
  createdAt: string;
  updatedAt: string;
};

export type CreateFoldProfileInput = {
  id?: string;
  name?: string;
  material?: Partial<MaterialSnapshot>;
  sheetItemSnapshot?: SheetItemSnapshot;
  product?: Partial<ProductSpec>;
  calculation?: Partial<CalculationSettings>;
  profileType?: ProfileType;
  now?: string;
};

export const DEFAULT_MATERIAL: MaterialSnapshot = {
  id: "material-default",
  name: "기본 재질",
  thickness: 1,
  insideBendRadius: 1,
  cutAngle: 135,
  elongation: { "v-cut": 1, "a-cut": 1, "no-cut": 1 },
  cutDepth: { "v-cut": 0, "a-cut": 0, "no-cut": 0 },
};

export const DEFAULT_CALCULATION: CalculationSettings = {
  mode: "fixed",
  elongationOption: "standard",
  vCutEnabled: true,
  decimalPlaces: 0,
  decimalOperation: "round",
};

export function bendOperations(bend: Bend): BendOperation[] {
  return [
    { direction: bend.direction, form: bend.form ?? "standard" },
    ...(bend.secondaryOperation ? [bend.secondaryOperation] : []),
  ];
}

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

function normalizeEditorNumber(value: number, decimalPlaces: number): number {
  if (!Number.isFinite(value)) return value;
  const normalized = Number(value.toFixed(decimalPlaces));
  return Object.is(normalized, -0) ? 0 : normalized;
}

export function normalizeEditorLengthMm(value: number): number {
  return normalizeEditorNumber(value, 6);
}

export function normalizeEditorAngleDeg(value: number): number {
  return normalizeEditorNumber(value, 4);
}

export function normalizeEditorPoint(point: PointMm): PointMm {
  return {
    x: normalizeEditorLengthMm(point.x),
    y: normalizeEditorLengthMm(point.y),
  };
}

export function distanceMm(start: PointMm, end: PointMm): number {
  return Math.hypot(end.x - start.x, end.y - start.y);
}

export function createFoldBlock(order: number, name = `면 ${order}`): FoldBlock {
  return { id: newId("block"), name, order, segments: [] };
}

export function isFoldBlockClosed(block: FoldBlock, tolerance = 0.001): boolean {
  if (block.segments.length < 3) return false;
  const start = block.segments[0].start;
  const end = block.segments.at(-1)!.end;
  return distanceMm(start, end) <= tolerance;
}

export function isFoldProfileClosed(profile: FoldProfile, tolerance = 0.001): boolean {
  return profile.blocks.length > 0 && profile.blocks.every((block) => isFoldBlockClosed(block, tolerance));
}

export function createFoldSegment(
  start: PointMm,
  end: PointMm,
  options: Partial<Omit<FoldSegment, "id" | "start" | "end" | "inputLength">> & {
    id?: string;
    inputLength?: number;
  } = {},
): FoldSegment {
  const normalizedStart = normalizeEditorPoint(start);
  const normalizedEnd = normalizeEditorPoint(end);
  return {
    id: options.id ?? newId("segment"),
    start: normalizedStart,
    end: normalizedEnd,
    inputLength: normalizeEditorLengthMm(
      options.inputLength ?? distanceMm(normalizedStart, normalizedEnd),
    ),
    geometry: options.geometry ?? { kind: "line" },
    ...(options.formula !== undefined && { formula: options.formula }),
    ...(options.bendAfter !== undefined && { bendAfter: { ...options.bendAfter } }),
    ...(options.calculateElongation !== undefined && {
      calculateElongation: options.calculateElongation,
    }),
    ...(options.elongationOverride !== undefined && {
      elongationOverride: options.elongationOverride,
    }),
  };
}

export function createFoldProfile(input: CreateFoldProfileInput = {}): FoldProfile {
  const now = input.now ?? new Date().toISOString();

  return {
    schemaVersion: FOLD_PROFILE_SCHEMA_VERSION,
    id: input.id ?? newId("profile"),
    name: input.name ?? "새 절곡 단면",
    profileType: input.profileType ?? "normal",
    material: {
      ...DEFAULT_MATERIAL,
      ...input.material,
      elongation: { ...DEFAULT_MATERIAL.elongation, ...input.material?.elongation },
      cutDepth: { ...DEFAULT_MATERIAL.cutDepth, ...input.material?.cutDepth },
    },
    ...(input.sheetItemSnapshot && { sheetItemSnapshot: { ...input.sheetItemSnapshot } }),
    product: { length: 0, quantity: 1, ...input.product },
    calculation: { ...DEFAULT_CALCULATION, ...input.calculation },
    variables: [],
    blocks: [createFoldBlock(1)],
    panelAttachments: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function appendFoldSegment(
  profile: FoldProfile,
  end: PointMm,
  options: Parameters<typeof createFoldSegment>[2] = {},
  blockIndex = 0,
): FoldProfile {
  const block = profile.blocks[blockIndex];
  if (!block) return profile;
  const start = block.segments.at(-1)?.end ?? { x: 0, y: 0 };
  const segment = createFoldSegment(start, end, options);
  const blocks = profile.blocks.map((item, index) =>
    index === blockIndex ? { ...item, segments: [...item.segments, segment] } : item,
  );

  return {
    ...profile,
    blocks,
    updatedAt: new Date().toISOString(),
  };
}

export const FOLD_PROFILE_SCHEMA_VERSION = 3 as const;

export type PointMm = {
  x: number;
  y: number;
};

export type BendDirection = "front" | "back";
export type CutType = "v-cut" | "a-cut" | "no-cut";
export type ElongationMode = "fixed" | "ratio";
export type DecimalOperation = "none" | "round" | "floor" | "ceil";
export type ProfileType = "normal" | "box";

export type Bend = {
  direction: BendDirection;
  cutType: CutType;
  angle: number;
};

export type FoldSegment = {
  id: string;
  start: PointMm;
  end: PointMm;
  inputLength: number;
  formula?: string;
  bendAfter?: Bend;
  calculateElongation?: boolean;
  elongationOverride?: number;
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

export type CalculationSettings = {
  mode: ElongationMode;
  vCutEnabled: boolean;
  decimalPlaces: number;
  decimalOperation: DecimalOperation;
};

export type ProductSpec = {
  length: number;
  quantity: number;
};

export type FoldProfile = {
  schemaVersion: typeof FOLD_PROFILE_SCHEMA_VERSION;
  id: string;
  name: string;
  profileType: ProfileType;
  material: MaterialSnapshot;
  product: ProductSpec;
  calculation: CalculationSettings;
  blocks: FoldBlock[];
  createdAt: string;
  updatedAt: string;
};

export type CreateFoldProfileInput = {
  id?: string;
  name?: string;
  material?: Partial<MaterialSnapshot>;
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
  vCutEnabled: true,
  decimalPlaces: 0,
  decimalOperation: "round",
};

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

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
  return {
    id: options.id ?? newId("segment"),
    start: { ...start },
    end: { ...end },
    inputLength: options.inputLength ?? distanceMm(start, end),
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
    product: { length: 0, quantity: 1, ...input.product },
    calculation: { ...DEFAULT_CALCULATION, ...input.calculation },
    blocks: [createFoldBlock(1)],
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

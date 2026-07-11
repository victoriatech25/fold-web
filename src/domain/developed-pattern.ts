import { calculateProfile } from "./fold-calculation";
import type { Bend, BendDirection, CutType, FoldBlock, FoldProfile } from "./fold-profile";
import { findBoxBaseSegments } from "./3d/box-solid-geometry";

export type DevelopedLineKind = "v-cut" | "a-cut" | "bend";

export type DevelopedFoldLine = {
  segmentId: string;
  position: number;
  kind: DevelopedLineKind;
  cutType: CutType;
  direction: BendDirection;
  angle: number;
};

export type DevelopedPattern = {
  width: number;
  length: number;
  foldLines: DevelopedFoldLine[];
};

export type BoxDevelopedPanel = {
  segmentId: string;
  blockId: string;
  role: "floor" | "wall";
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BoxDevelopedLine = DevelopedFoldLine & {
  blockId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type BoxDevelopedPattern = {
  width: number;
  height: number;
  base: { x: number; y: number; width: number; height: number };
  finishedBase: { width: number; height: number };
  panels: BoxDevelopedPanel[];
  foldLines: BoxDevelopedLine[];
  outline: Array<{ x: number; y: number }>;
};

function developedLine(segmentId: string, bend: Bend, position: number, profile: FoldProfile): DevelopedFoldLine {
  const cutType = profile.calculation.vCutEnabled ? bend.cutType : "no-cut";
  return {
    segmentId,
    position,
    kind: cutType === "no-cut" ? "bend" : cutType,
    cutType,
    direction: bend.direction,
    angle: bend.angle,
  };
}

export function createNormalDevelopedPattern(profile: FoldProfile): DevelopedPattern | null {
  if (profile.profileType !== "normal") return null;

  const segments = profile.blocks[0]?.segments ?? [];
  const calculation = calculateProfile(segments, profile.material, profile.calculation);
  let position = 0;
  const foldLines: DevelopedFoldLine[] = [];

  segments.forEach((segment, index) => {
    position += calculation.segments[index]?.calculatedLength ?? 0;
    if (!segment.bendAfter || index === segments.length - 1) return;

    foldLines.push(developedLine(segment.id, segment.bendAfter, position, profile));
  });

  return {
    width: calculation.calculatedWidth,
    length: profile.product.length,
    foldLines,
  };
}

function sideLengths(block: FoldBlock, baseIndex: number, profile: FoldProfile) {
  const calculation = calculateProfile(block.segments, profile.material, profile.calculation);
  const before = calculation.segments.slice(0, baseIndex).reduce((sum, item) => sum + item.calculatedLength, 0);
  const after = calculation.segments.slice(baseIndex + 1).reduce((sum, item) => sum + item.calculatedLength, 0);
  return { calculation, before, after };
}

export function createBoxDevelopedPattern(profile: FoldProfile): BoxDevelopedPattern | null {
  if (profile.profileType !== "box") return null;
  const bases = findBoxBaseSegments(profile.blocks);
  const [horizontal, vertical] = profile.blocks;
  if (!bases || !horizontal || !vertical) return null;
  const horizontalBaseIndex = horizontal.segments.findIndex((segment) => segment.id === bases[0].id);
  const verticalBaseIndex = vertical.segments.findIndex((segment) => segment.id === bases[1].id);
  if (horizontalBaseIndex < 0 || verticalBaseIndex < 0) return null;

  const horizontalSides = sideLengths(horizontal, horizontalBaseIndex, profile);
  const verticalSides = sideLengths(vertical, verticalBaseIndex, profile);
  const baseWidth = horizontalSides.calculation.segments[horizontalBaseIndex]?.calculatedLength ?? 0;
  const baseHeight = verticalSides.calculation.segments[verticalBaseIndex]?.calculatedLength ?? 0;
  if (baseWidth <= 0 || baseHeight <= 0) return null;

  const base = { x: horizontalSides.before, y: verticalSides.before, width: baseWidth, height: baseHeight };
  const panels: BoxDevelopedPanel[] = [{
    segmentId: bases[0].id,
    blockId: horizontal.id,
    role: "floor",
    ...base,
  }];
  const foldLines: BoxDevelopedLine[] = [];

  let cursor = base.x;
  for (let index = horizontalBaseIndex - 1; index >= 0; index -= 1) {
    const segment = horizontal.segments[index];
    const length = horizontalSides.calculation.segments[index].calculatedLength;
    const bend = segment.bendAfter;
    if (bend) foldLines.push({ ...developedLine(segment.id, bend, cursor, profile), blockId: horizontal.id, x1: cursor, y1: base.y, x2: cursor, y2: base.y + base.height });
    cursor -= length;
    panels.push({ segmentId: segment.id, blockId: horizontal.id, role: "wall", x: cursor, y: base.y, width: length, height: base.height });
  }

  cursor = base.x + base.width;
  for (let index = horizontalBaseIndex + 1; index < horizontal.segments.length; index += 1) {
    const segment = horizontal.segments[index];
    const previous = horizontal.segments[index - 1];
    if (previous.bendAfter) foldLines.push({ ...developedLine(previous.id, previous.bendAfter, cursor, profile), blockId: horizontal.id, x1: cursor, y1: base.y, x2: cursor, y2: base.y + base.height });
    const length = horizontalSides.calculation.segments[index].calculatedLength;
    panels.push({ segmentId: segment.id, blockId: horizontal.id, role: "wall", x: cursor, y: base.y, width: length, height: base.height });
    cursor += length;
  }

  cursor = base.y;
  for (let index = verticalBaseIndex - 1; index >= 0; index -= 1) {
    const segment = vertical.segments[index];
    const length = verticalSides.calculation.segments[index].calculatedLength;
    const bend = segment.bendAfter;
    if (bend) foldLines.push({ ...developedLine(segment.id, bend, cursor, profile), blockId: vertical.id, x1: base.x, y1: cursor, x2: base.x + base.width, y2: cursor });
    cursor -= length;
    panels.push({ segmentId: segment.id, blockId: vertical.id, role: "wall", x: base.x, y: cursor, width: base.width, height: length });
  }

  cursor = base.y + base.height;
  for (let index = verticalBaseIndex + 1; index < vertical.segments.length; index += 1) {
    const segment = vertical.segments[index];
    const previous = vertical.segments[index - 1];
    if (previous.bendAfter) foldLines.push({ ...developedLine(previous.id, previous.bendAfter, cursor, profile), blockId: vertical.id, x1: base.x, y1: cursor, x2: base.x + base.width, y2: cursor });
    const length = verticalSides.calculation.segments[index].calculatedLength;
    panels.push({ segmentId: segment.id, blockId: vertical.id, role: "wall", x: base.x, y: cursor, width: base.width, height: length });
    cursor += length;
  }

  const left = 0;
  const right = base.x + base.width + horizontalSides.after;
  const top = 0;
  const bottom = base.y + base.height + verticalSides.after;
  const outline = [
    { x: base.x, y: top }, { x: base.x + base.width, y: top },
    { x: base.x + base.width, y: base.y }, { x: right, y: base.y },
    { x: right, y: base.y + base.height }, { x: base.x + base.width, y: base.y + base.height },
    { x: base.x + base.width, y: bottom }, { x: base.x, y: bottom },
    { x: base.x, y: base.y + base.height }, { x: left, y: base.y + base.height },
    { x: left, y: base.y }, { x: base.x, y: base.y },
  ];

  return {
    width: right,
    height: bottom,
    base,
    finishedBase: { width: bases[0].inputLength, height: bases[1].inputLength },
    panels,
    foldLines,
    outline,
  };
}

import type { FoldModelBlockInput, FoldModelInput, FoldModelSegmentInput } from "./fold-model-input";
import type { ModelGeometryWarning } from "./surface-geometry";

type Point2D = { x: number; y: number };
type Fillet = {
  tangentIn: Point2D;
  tangentOut: Point2D;
  center: Point2D;
  sweep: number;
  appliedRadius: number;
  segmentId: string;
};

const EPSILON = 0.000001;
const point = (value: Point2D): Point2D => ({ x: value.x, y: value.y });
const direction = (start: Point2D, end: Point2D) => {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  return { x: (end.x - start.x) / length, y: (end.y - start.y) / length, length };
};
const add = (value: Point2D, vector: Point2D, scale: number): Point2D => ({ x: value.x + vector.x * scale, y: value.y + vector.y * scale });
const cross = (left: Point2D, right: Point2D) => left.x * right.y - left.y * right.x;
const dot = (left: Point2D, right: Point2D) => left.x * right.x + left.y * right.y;

function createFillet(
  previous: Point2D,
  joint: Point2D,
  next: Point2D,
  block: FoldModelBlockInput,
  bendSegment: FoldModelSegmentInput,
  input: FoldModelInput,
  warnings: ModelGeometryWarning[],
): Fillet | null {
  if (!bendSegment.bendAfter || input.insideBendRadius <= 0) return null;
  const incoming = direction(previous, joint);
  const outgoing = direction(joint, next);
  const turn = Math.atan2(cross(incoming, outgoing), dot(incoming, outgoing));
  if (Math.abs(turn) < 0.001 || Math.abs(Math.PI - Math.abs(turn)) < 0.001) return null;

  const requestedRadius = input.insideBendRadius + input.thickness / 2;
  const tangentFactor = Math.tan(Math.abs(turn) / 2);
  const requestedTrim = requestedRadius * tangentFactor;
  const maximumTrim = Math.min(incoming.length, outgoing.length) * 0.45;
  const trim = Math.min(requestedTrim, maximumTrim);
  const appliedRadius = trim / tangentFactor;
  if (trim + EPSILON < requestedTrim) {
    warnings.push({
      code: "BEND_RADIUS_CLAMPED",
      message: `${block.name}의 절곡 반경이 인접 선보다 커서 ${(appliedRadius - input.thickness / 2).toFixed(2)} mm로 제한되었습니다.`,
      blockId: block.id,
      segmentId: bendSegment.id,
      requestedRadius: input.insideBendRadius,
      appliedRadius: Math.max(0, appliedRadius - input.thickness / 2),
    });
  }

  const tangentIn = add(joint, incoming, -trim);
  const tangentOut = add(joint, outgoing, trim);
  const sign = Math.sign(turn);
  const normal = { x: -incoming.y * sign, y: incoming.x * sign };
  const center = add(tangentIn, normal, appliedRadius);
  return { tangentIn, tangentOut, center, sweep: turn, appliedRadius, segmentId: bendSegment.id };
}

function appendSegment(target: FoldModelSegmentInput[], id: string, start: Point2D, end: Point2D) {
  if (Math.hypot(end.x - start.x, end.y - start.y) <= EPSILON) return;
  target.push({ id, start: point(start), end: point(end) });
}

function appendArc(target: FoldModelSegmentInput[], fillet: Fillet) {
  const steps = Math.max(2, Math.ceil(Math.abs(fillet.sweep) / (Math.PI / 36)));
  const startAngle = Math.atan2(fillet.tangentIn.y - fillet.center.y, fillet.tangentIn.x - fillet.center.x);
  let previous = fillet.tangentIn;
  for (let step = 1; step <= steps; step += 1) {
    const angle = startAngle + fillet.sweep * (step / steps);
    const next = step === steps ? fillet.tangentOut : {
      x: fillet.center.x + Math.cos(angle) * fillet.appliedRadius,
      y: fillet.center.y + Math.sin(angle) * fillet.appliedRadius,
    };
    appendSegment(target, fillet.segmentId, previous, next);
    previous = next;
  }
}

function roundBlock(block: FoldModelBlockInput, input: FoldModelInput, warnings: ModelGeometryWarning[]): FoldModelBlockInput {
  if (block.segments.length < 2) return block;
  const rawPoints = [block.segments[0].start, ...block.segments.map((segment) => segment.end)].map(point);
  const points = block.closed ? rawPoints.slice(0, -1) : rawPoints;
  const segmentCount = block.segments.length;
  const fillets = new Map<number, Fillet>();
  const firstJoint = block.closed ? 0 : 1;
  const lastJoint = block.closed ? points.length - 1 : points.length - 2;

  for (let jointIndex = firstJoint; jointIndex <= lastJoint; jointIndex += 1) {
    const previousIndex = (jointIndex - 1 + points.length) % points.length;
    const nextIndex = (jointIndex + 1) % points.length;
    const bendIndex = (jointIndex - 1 + segmentCount) % segmentCount;
    const fillet = createFillet(points[previousIndex], points[jointIndex], points[nextIndex], block, block.segments[bendIndex], input, warnings);
    if (fillet) fillets.set(jointIndex, fillet);
  }

  const rounded: FoldModelSegmentInput[] = [];
  let current = block.closed ? fillets.get(0)?.tangentOut ?? points[0] : points[0];
  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    const endJoint = (segmentIndex + 1) % points.length;
    const fillet = fillets.get(endJoint);
    const end = fillet?.tangentIn ?? points[endJoint];
    appendSegment(rounded, block.segments[segmentIndex].id, current, end);
    if (fillet) appendArc(rounded, fillet);
    current = fillet?.tangentOut ?? end;
  }

  return { ...block, segments: rounded };
}

export function createRoundedFoldModelInput(input: FoldModelInput) {
  const warnings: ModelGeometryWarning[] = [];
  return {
    input: { ...input, blocks: input.blocks.map((block) => roundBlock(block, input, warnings)) },
    warnings,
  };
}

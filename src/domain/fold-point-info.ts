import { isFoldBlockClosed, type Bend, type FoldBlock, type PointMm } from "./fold-profile";

export type FoldPointInfo = {
  id: string;
  blockId: string;
  blockName: string;
  index: number;
  point: PointMm;
  bend?: Bend;
  segmentId: string;
  incomingLength?: number;
  outgoingLength?: number;
};

export function createFoldPointList(block: FoldBlock): FoldPointInfo[] {
  const first = block.segments[0];
  if (!first) return [];

  const closed = isFoldBlockClosed(block);
  const points = [first.start, ...block.segments.map((segment) => segment.end)];
  if (closed) points.pop();

  return points.map((point, index) => {
    const incomingIndex = index === 0 ? (closed ? block.segments.length - 1 : -1) : index - 1;
    const outgoingIndex = index < block.segments.length ? index : closed ? 0 : -1;
    const incoming = block.segments[incomingIndex];
    const outgoing = block.segments[outgoingIndex];
    return {
      id: `${block.id}-point-${index}`,
      blockId: block.id,
      blockName: block.name,
      index,
      point: { ...point },
      ...(incoming?.bendAfter && { bend: { ...incoming.bendAfter } }),
      segmentId: incoming?.id ?? outgoing.id,
      ...(incoming && { incomingLength: incoming.inputLength }),
      ...(outgoing && { outgoingLength: outgoing.inputLength }),
    };
  });
}

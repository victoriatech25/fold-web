import { describe, expect, it } from "vitest";

import { createFoldBlock, createFoldSegment } from "./fold-profile";
import { createFoldPointList } from "./fold-point-info";

describe("createFoldPointList", () => {
  it("lists open profile points with bend information from the incoming segment", () => {
    const block = createFoldBlock(1);
    block.id = "face-1";
    block.segments = [
      createFoldSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, { id: "s1", bendAfter: { direction: "front", cutType: "v-cut", angle: 90 } }),
      createFoldSegment({ x: 100, y: 0 }, { x: 100, y: -50 }, { id: "s2" }),
    ];

    const points = createFoldPointList(block);

    expect(points).toHaveLength(3);
    expect(points[0]).toMatchObject({ index: 0, point: { x: 0, y: 0 }, segmentId: "s1", outgoingLength: 100 });
    expect(points[1]).toMatchObject({ index: 1, point: { x: 100, y: 0 }, segmentId: "s1", incomingLength: 100, outgoingLength: 50, bend: { direction: "front", cutType: "v-cut", angle: 90 } });
    expect(points[2]).toMatchObject({ index: 2, point: { x: 100, y: -50 }, segmentId: "s2", incomingLength: 50 });
  });

  it("does not duplicate the closing point", () => {
    const block = createFoldBlock(1);
    block.segments = [
      createFoldSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, { id: "s1" }),
      createFoldSegment({ x: 100, y: 0 }, { x: 100, y: 100 }, { id: "s2" }),
      createFoldSegment({ x: 100, y: 100 }, { x: 0, y: 0 }, { id: "s3", bendAfter: { direction: "back", cutType: "a-cut", angle: 45 } }),
    ];

    const points = createFoldPointList(block);

    expect(points).toHaveLength(3);
    expect(points[0]).toMatchObject({ segmentId: "s3", bend: { direction: "back", cutType: "a-cut", angle: 45 } });
  });
});

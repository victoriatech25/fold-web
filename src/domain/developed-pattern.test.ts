import { describe, expect, it } from "vitest";

import { createBoxDevelopedPattern, createNormalDevelopedPattern } from "./developed-pattern";
import { createFoldBlock, createFoldProfile, createFoldSegment } from "./fold-profile";

describe("createNormalDevelopedPattern", () => {
  it("creates an outer size and cumulative cutting lines", () => {
    const profile = createFoldProfile({ product: { length: 2400, quantity: 1 } });
    profile.blocks[0].segments = [
      createFoldSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, { id: "s1", bendAfter: { direction: "front", cutType: "v-cut", angle: 90 } }),
      createFoldSegment({ x: 100, y: 0 }, { x: 100, y: 50 }, { id: "s2", bendAfter: { direction: "back", cutType: "a-cut", angle: 90 } }),
      createFoldSegment({ x: 100, y: 50 }, { x: 180, y: 50 }, { id: "s3" }),
    ];

    const pattern = createNormalDevelopedPattern(profile)!;

    expect(pattern.length).toBe(2400);
    expect(pattern.width).toBe(230);
    expect(pattern.foldLines).toEqual([
      expect.objectContaining({ segmentId: "s1", position: 99, kind: "v-cut" }),
      expect.objectContaining({ segmentId: "s2", position: 149, kind: "a-cut" }),
    ]);
  });

  it("uses bend lines when cutting is disabled", () => {
    const profile = createFoldProfile({ product: { length: 1000, quantity: 1 } });
    profile.calculation.vCutEnabled = false;
    profile.blocks[0].segments = [
      createFoldSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, { id: "s1", bendAfter: { direction: "front", cutType: "v-cut", angle: 90 } }),
      createFoldSegment({ x: 100, y: 0 }, { x: 200, y: 0 }, { id: "s2" }),
    ];

    expect(createNormalDevelopedPattern(profile)?.foldLines[0]).toEqual(
      expect.objectContaining({ kind: "bend", cutType: "no-cut" }),
    );
  });

  it("does not create a normal pattern for a box profile", () => {
    const profile = createFoldProfile({ profileType: "box" });
    expect(createNormalDevelopedPattern(profile)).toBeNull();
  });
});

describe("createBoxDevelopedPattern", () => {
  it("unfolds four sides around the intersecting rectangular base", () => {
    const profile = createFoldProfile({ profileType: "box" });
    profile.material.elongation = { "v-cut": 0, "a-cut": 0, "no-cut": 0 };
    const horizontal = profile.blocks[0];
    horizontal.segments = [
      createFoldSegment({ x: 0, y: -20 }, { x: 0, y: 0 }, { id: "left", bendAfter: { direction: "front", cutType: "v-cut", angle: 90 } }),
      createFoldSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, { id: "h-base", bendAfter: { direction: "front", cutType: "v-cut", angle: 90 } }),
      createFoldSegment({ x: 100, y: 0 }, { x: 100, y: -30 }, { id: "right" }),
    ];
    const vertical = createFoldBlock(2);
    vertical.segments = [
      createFoldSegment({ x: 50, y: -40 }, { x: 50, y: 0 }, { id: "top", bendAfter: { direction: "back", cutType: "a-cut", angle: 90 } }),
      createFoldSegment({ x: 50, y: 0 }, { x: 50, y: 80 }, { id: "v-base", bendAfter: { direction: "front", cutType: "no-cut", angle: 90 } }),
      createFoldSegment({ x: 50, y: 80 }, { x: 90, y: 80 }, { id: "bottom" }),
    ];
    profile.blocks.push(vertical);

    const pattern = createBoxDevelopedPattern(profile)!;

    expect(pattern.finishedBase).toEqual({ width: 100, height: 80 });
    expect(pattern.base).toEqual({ x: 20, y: 40, width: 100, height: 80 });
    expect(pattern.width).toBe(150);
    expect(pattern.height).toBe(160);
    expect(pattern.panels).toHaveLength(5);
    expect(pattern.foldLines).toHaveLength(4);
    expect(pattern.foldLines.map((line) => line.kind)).toEqual(["v-cut", "v-cut", "a-cut", "bend"]);
    expect(pattern.outline).toHaveLength(12);
  });

  it("returns null until two box sections are available", () => {
    expect(createBoxDevelopedPattern(createFoldProfile({ profileType: "box" }))).toBeNull();
  });
});

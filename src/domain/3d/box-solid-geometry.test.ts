import { describe, expect, it } from "vitest";

import { createFoldBlock, createFoldProfile, createFoldSegment } from "../fold-profile";
import { createBoxSolidModel, findBoxBaseSegments } from "./box-solid-geometry";

const bend = { direction: "front", cutType: "v-cut", angle: 90 } as const;

const createBoxProfile = () => {
  const profile = createFoldProfile({
    profileType: "box",
    material: { thickness: 2, insideBendRadius: 2 },
    product: { length: 9999, quantity: 1 },
  });
  const horizontal = profile.blocks[0];
  horizontal.id = "horizontal";
  horizontal.name = "가로 단면";
  horizontal.segments = [
    createFoldSegment({ x: 0, y: -20 }, { x: 0, y: 0 }, { id: "x-left", bendAfter: bend }),
    createFoldSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, { id: "x-base", bendAfter: bend }),
    createFoldSegment({ x: 100, y: 0 }, { x: 100, y: -20 }, { id: "x-right" }),
  ];
  const vertical = createFoldBlock(2, "세로 단면");
  vertical.id = "vertical";
  vertical.segments = [
    createFoldSegment({ x: 70, y: -40 }, { x: 50, y: -40 }, { id: "y-front", bendAfter: bend }),
    createFoldSegment({ x: 50, y: -40 }, { x: 50, y: 40 }, { id: "y-base", bendAfter: bend }),
    createFoldSegment({ x: 50, y: 40 }, { x: 70, y: 40 }, { id: "y-back" }),
  ];
  profile.blocks.push(vertical);
  return profile;
};

describe("box solid geometry", () => {
  it("finds the intersecting horizontal and vertical base segments", () => {
    const bases = findBoxBaseSegments(createBoxProfile().blocks);
    expect(bases?.map((segment) => segment.id)).toEqual(["x-base", "y-base"]);
  });

  it("creates a rectangular base and four walls from two cross sections", () => {
    const model = createBoxSolidModel(createBoxProfile());

    expect(model.valid).toBe(true);
    expect(model.blocks).toHaveLength(2);
    expect(model.blocks[0].segmentRanges.some((range) => range.segmentId === "x-left")).toBe(true);
    expect(model.blocks[0].segmentRanges.some((range) => range.segmentId === "x-right")).toBe(true);
    expect(model.blocks[1].segmentRanges.some((range) => range.segmentId === "y-front")).toBe(true);
    expect(model.blocks[1].segmentRanges.some((range) => range.segmentId === "y-back")).toBe(true);
    expect(model.bounds?.size[0]).toBeCloseTo(102, 1);
    expect(model.bounds?.size[1]).toBeCloseTo(82, 1);
    expect(model.bounds!.max[2]).toBeGreaterThanOrEqual(20);
  });

  it("does not use the normal product extrusion length", () => {
    const profile = createBoxProfile();
    const first = createBoxSolidModel(profile).bounds;
    profile.product.length = 25000;
    const second = createBoxSolidModel(profile).bounds;

    expect(second).toEqual(first);
    expect(Math.max(...second!.size)).toBeLessThan(200);
  });

  it("keeps source segment ids after radius sampling", () => {
    const model = createBoxSolidModel(createBoxProfile());
    const ids = model.blocks.flatMap((block) => block.segmentRanges.map((range) => range.segmentId));
    expect(ids).toEqual(expect.arrayContaining(["x-left", "x-base", "x-right", "y-front", "y-base", "y-back"]));
  });
});


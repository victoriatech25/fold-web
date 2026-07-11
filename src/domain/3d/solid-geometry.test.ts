import { describe, expect, it } from "vitest";

import { createFoldBlock, createFoldProfile, createFoldSegment } from "../fold-profile";
import { createFoldModelInput } from "./fold-model-input";
import { createFoldSolidModel, createSolidGeometry } from "./solid-geometry";

const createProfile = () => {
  const profile = createFoldProfile({
    id: "solid-profile",
    material: { thickness: 2 },
    product: { length: 1000, quantity: 1 },
  });
  profile.blocks[0].segments = [
    createFoldSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, { id: "solid-1" }),
    createFoldSegment({ x: 100, y: 0 }, { x: 100, y: -50 }, { id: "solid-2" }),
  ];
  return profile;
};

describe("solid geometry", () => {
  it("creates a closed eight-vertex prism for each segment", () => {
    const [solid] = createSolidGeometry(createFoldModelInput(createProfile()).input);

    expect(solid.positions).toHaveLength(48);
    expect(solid.indices).toHaveLength(72);
    expect(solid.segmentRanges).toEqual([
      { segmentId: "solid-1", vertexStart: 0, vertexCount: 8, indexStart: 0, indexCount: 36 },
      { segmentId: "solid-2", vertexStart: 8, vertexCount: 8, indexStart: 36, indexCount: 36 },
    ]);
    expect(Math.max(...solid.indices)).toBe(15);
  });

  it("shares mitered thickness endpoints between connected segments", () => {
    const [solid] = createSolidGeometry(createFoldModelInput(createProfile()).input);
    const firstEnd = solid.positions.slice(6, 12);
    const secondStart = solid.positions.slice(24, 30);

    expect(firstEnd.slice(0, 3)).toEqual(secondStart.slice(3, 6));
    expect(firstEnd.slice(3, 6)).toEqual(secondStart.slice(0, 3));
    expect(firstEnd).toEqual([101, -1, 0, 99, 1, 0]);
  });

  it("expands model bounds by half the material thickness", () => {
    const model = createFoldSolidModel(createProfile());

    expect(model.valid).toBe(true);
    expect(model.bounds).toMatchObject({
      min: [0, -1, 0],
      max: [101, 50, 1000],
      size: [101, 51, 1000],
    });
  });

  it("updates the solid bounds when thickness changes", () => {
    const profile = createProfile();
    const thin = createFoldSolidModel(profile).bounds!;
    profile.material.thickness = 6;
    const thick = createFoldSolidModel(profile).bounds!;

    expect(thick.min[1]).toBe(-3);
    expect(thick.max[0]).toBe(103);
    expect(thick.size[0]).toBeGreaterThan(thin.size[0]);
  });

  it("joins the closing segment back to the first miter in a closed block", () => {
    const profile = createProfile();
    profile.blocks[0].segments.push(
      createFoldSegment({ x: 100, y: -50 }, { x: 0, y: -50 }, { id: "solid-3" }),
      createFoldSegment({ x: 0, y: -50 }, { x: 0, y: 0 }, { id: "solid-4" }),
    );
    const block = createFoldSolidModel(profile).blocks[0];
    const firstStart = block.positions.slice(0, 6);
    const closingEndStart = block.positions.slice(78, 84);

    expect(block.closed).toBe(true);
    expect(closingEndStart.slice(0, 3)).toEqual(firstStart.slice(3, 6));
    expect(closingEndStart.slice(3, 6)).toEqual(firstStart.slice(0, 3));
  });

  it("keeps box faces as independent solid blocks", () => {
    const profile = createProfile();
    profile.profileType = "box";
    const second = createFoldBlock(2);
    second.id = "solid-block-2";
    second.segments = [createFoldSegment({ x: 40, y: 0 }, { x: 40, y: 80 }, { id: "box-solid" })];
    profile.blocks.push(second);
    const model = createFoldSolidModel(profile);

    expect(model.blocks).toHaveLength(2);
    expect(model.blocks[1].segmentRanges[0]).toMatchObject({ segmentId: "box-solid", vertexCount: 8, indexCount: 36 });
  });
});

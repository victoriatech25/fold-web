import { describe, expect, it } from "vitest";

import { createFoldBlock, createFoldProfile, createFoldSegment } from "../fold-profile";
import { createFoldModelInput } from "./fold-model-input";
import { createFoldSurfaceModel, createSurfaceGeometry } from "./surface-geometry";

const createProfile = () => {
  const profile = createFoldProfile({
    id: "profile-3d",
    material: { thickness: 2 },
    product: { length: 2400, quantity: 1 },
  });
  profile.blocks[0].segments = [
    createFoldSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, { id: "segment-1" }),
    createFoldSegment({ x: 100, y: 0 }, { x: 100, y: -50 }, { id: "segment-2" }),
  ];
  return profile;
};

describe("3D model input", () => {
  it("normalizes profile data without sharing mutable points", () => {
    const profile = createProfile();
    const result = createFoldModelInput(profile);

    expect(result.valid).toBe(true);
    expect(result.input).toMatchObject({
      profileId: "profile-3d",
      profileType: "normal",
      thickness: 2,
      productLength: 2400,
    });
    result.input.blocks[0].segments[0].start.x = 99;
    expect(profile.blocks[0].segments[0].start.x).toBe(0);
  });

  it("recognizes a closed block", () => {
    const profile = createProfile();
    profile.blocks[0].segments.push(
      createFoldSegment({ x: 100, y: -50 }, { x: 0, y: -50 }, { id: "segment-3" }),
      createFoldSegment({ x: 0, y: -50 }, { x: 0, y: 0 }, { id: "segment-4" }),
    );

    expect(createFoldModelInput(profile).input.blocks[0].closed).toBe(true);
  });

  it("reports invalid product, zero-length, and disconnected segments", () => {
    const profile = createProfile();
    profile.product.length = 0;
    profile.blocks[0].segments.push(
      createFoldSegment({ x: 200, y: 0 }, { x: 200, y: 0 }, { id: "invalid-segment" }),
    );
    const result = createFoldModelInput(profile);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "INVALID_PRODUCT_LENGTH",
      "ZERO_LENGTH_SEGMENT",
      "DISCONNECTED_SEGMENT",
    ]));
  });
});

describe("surface geometry", () => {
  it("creates one quad and selection range for every segment", () => {
    const input = createFoldModelInput(createProfile()).input;
    const [surface] = createSurfaceGeometry(input);

    expect(surface.positions).toHaveLength(24);
    expect(surface.indices).toEqual([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    expect(surface.segmentRanges).toEqual([
      { segmentId: "segment-1", vertexStart: 0, vertexCount: 4, indexStart: 0, indexCount: 6 },
      { segmentId: "segment-2", vertexStart: 4, vertexCount: 4, indexStart: 6, indexCount: 6 },
    ]);
  });

  it("maps 2D Y upward and product length onto the Z axis", () => {
    const model = createFoldSurfaceModel(createProfile());

    expect(model.valid).toBe(true);
    expect(model.bounds).toEqual({
      min: [0, 0, 0],
      max: [100, 50, 2400],
      center: [50, 25, 1200],
      size: [100, 50, 2400],
    });
    expect(model.blocks[0].positions).toContain(50);
    expect(model.blocks[0].positions).toContain(2400);
  });

  it("keeps box faces and their segment ids in independent blocks", () => {
    const profile = createProfile();
    profile.profileType = "box";
    const second = createFoldBlock(2);
    second.id = "block-2";
    second.segments = [
      createFoldSegment({ x: 40, y: -20 }, { x: 40, y: 80 }, { id: "box-segment" }),
    ];
    profile.blocks.push(second);
    const model = createFoldSurfaceModel(profile);

    expect(model.blocks).toHaveLength(2);
    expect(model.blocks[0].segmentRanges.map((range) => range.segmentId)).toEqual(["segment-1", "segment-2"]);
    expect(model.blocks[1]).toMatchObject({
      blockId: "block-2",
      segmentRanges: [{ segmentId: "box-segment", vertexStart: 0, vertexCount: 4, indexStart: 0, indexCount: 6 }],
    });
  });

  it("does not emit partial geometry when validation fails", () => {
    const profile = createProfile();
    profile.material.thickness = 0;
    const model = createFoldSurfaceModel(profile);

    expect(model.valid).toBe(false);
    expect(model.blocks).toEqual([]);
    expect(model.bounds).toBeNull();
  });
});

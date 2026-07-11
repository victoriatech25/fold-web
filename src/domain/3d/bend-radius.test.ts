import { describe, expect, it } from "vitest";

import { createFoldProfile, createFoldSegment } from "../fold-profile";
import { createRoundedFoldModelInput } from "./bend-radius";
import { createFoldModelInput } from "./fold-model-input";

const createProfile = (radius = 2) => {
  const profile = createFoldProfile({
    material: { thickness: 2, insideBendRadius: radius },
    product: { length: 1000, quantity: 1 },
  });
  profile.blocks[0].segments = [
    createFoldSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {
      id: "bend-owner",
      bendAfter: { direction: "front", cutType: "v-cut", angle: 90 },
    }),
    createFoldSegment({ x: 100, y: 0 }, { x: 100, y: -50 }, { id: "outgoing" }),
  ];
  return profile;
};

describe("bend radius path", () => {
  it("replaces a 90 degree corner with tangent arc segments", () => {
    const source = createFoldModelInput(createProfile()).input;
    const rounded = createRoundedFoldModelInput(source);
    const segments = rounded.input.blocks[0].segments;

    expect(rounded.warnings).toEqual([]);
    expect(segments).toHaveLength(20);
    expect(segments[0]).toMatchObject({ id: "bend-owner", end: { x: 97, y: 0 } });
    expect(segments.at(-1)?.id).toBe("outgoing");
    expect(segments.at(-1)?.start.x).toBeCloseTo(100);
    expect(segments.at(-1)?.start.y).toBeCloseTo(-3);
    expect(segments.slice(0, -1).every((segment) => segment.id === "bend-owner")).toBe(true);
  });

  it("keeps every sampled arc point on the centreline radius", () => {
    const source = createFoldModelInput(createProfile()).input;
    const segments = createRoundedFoldModelInput(source).input.blocks[0].segments;
    const center = { x: 97, y: -3 };
    const arcPoints = segments.slice(1, -1).map((segment) => segment.end);

    for (const arcPoint of arcPoints) {
      expect(Math.hypot(arcPoint.x - center.x, arcPoint.y - center.y)).toBeCloseTo(3, 6);
    }
  });

  it("clamps an oversized radius and returns a manufacturing warning", () => {
    const source = createFoldModelInput(createProfile(100)).input;
    const rounded = createRoundedFoldModelInput(source);

    expect(rounded.warnings).toHaveLength(1);
    expect(rounded.warnings[0]).toMatchObject({
      code: "BEND_RADIUS_CLAMPED",
      segmentId: "bend-owner",
      requestedRadius: 100,
    });
    expect(rounded.warnings[0].appliedRadius).toBeCloseTo(21.5);
  });

  it("keeps a sharp joint when the preceding segment has no bend", () => {
    const profile = createProfile();
    delete profile.blocks[0].segments[0].bendAfter;
    const source = createFoldModelInput(profile).input;
    const rounded = createRoundedFoldModelInput(source);

    expect(rounded.input.blocks[0].segments).toHaveLength(2);
  });
});

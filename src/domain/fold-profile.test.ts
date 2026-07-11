import { describe, expect, it } from "vitest";

import { calculateFoldProfileDocument } from "./fold-calculation";
import {
  appendFoldSegment,
  createFoldProfile,
  createFoldSegment,
  distanceMm,
} from "./fold-profile";
import {
  deserializeFoldProfile,
  FoldProfileParseError,
  serializeFoldProfile,
} from "./fold-profile-serialization";
import { validateFoldProfile } from "./fold-profile-validation";

describe("fold profile model", () => {
  it("creates a versioned profile with stable defaults", () => {
    const profile = createFoldProfile({ id: "profile-1", now: "2026-07-11T00:00:00.000Z" });
    expect(profile.schemaVersion).toBe(3);
    expect(profile.profileType).toBe("normal");
    expect(profile.blocks).toHaveLength(1);
    expect(profile.product).toEqual({ length: 0, quantity: 1 });
    expect(profile.material.insideBendRadius).toBe(1);
    expect(profile.calculation.mode).toBe("fixed");
  });

  it("creates segment length from millimetre coordinates", () => {
    expect(distanceMm({ x: 0, y: 0 }, { x: 30, y: 40 })).toBe(50);
    expect(createFoldSegment({ x: 0, y: 0 }, { x: 30, y: 40 }, { id: "s1" }).inputLength).toBe(50);
  });

  it("appends a segment from the previous endpoint", () => {
    const first = appendFoldSegment(createFoldProfile(), { x: 100, y: 0 }, { id: "s1" });
    const second = appendFoldSegment(first, { x: 100, y: 50 }, { id: "s2" });
    expect(second.blocks[0].segments[1].start).toEqual({ x: 100, y: 0 });
    expect(second.blocks[0].segments[1].inputLength).toBe(50);
  });
});

describe("fold profile validation", () => {
  it("detects disconnected and duplicated segments", () => {
    const profile = createFoldProfile();
    profile.blocks[0].segments = [
      createFoldSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, { id: "same" }),
      createFoldSegment({ x: 20, y: 20 }, { x: 20, y: 70 }, { id: "same" }),
    ];
    const codes = validateFoldProfile(profile).issues.map((issue) => issue.code);
    expect(codes).toContain("DUPLICATE_SEGMENT_ID");
    expect(codes).toContain("DISCONNECTED_SEGMENT");
  });

  it("allows an empty new profile with a warning", () => {
    const result = validateFoldProfile(createFoldProfile());
    expect(result.valid).toBe(true);
    expect(result.issues[0].severity).toBe("warning");
  });
});

describe("serialization and calculation adapter", () => {
  it("round-trips a profile without losing domain data", () => {
    const profile = appendFoldSegment(
      createFoldProfile({ id: "profile-1", now: "2026-07-11T00:00:00.000Z" }),
      { x: 239, y: 0 },
      { id: "s1" },
    );
    profile.product = { length: 2400, quantity: 10 };
    const restored = deserializeFoldProfile(serializeFoldProfile(profile));
    expect(restored).toEqual(profile);
    expect(calculateFoldProfileDocument(restored).areaTotalM2).toBeCloseTo(5.736);
  });

  it("rejects malformed and unsupported documents", () => {
    expect(() => deserializeFoldProfile("not-json")).toThrow(FoldProfileParseError);
    expect(() => deserializeFoldProfile('{"schemaVersion":4}')).toThrow(
      "지원하지 않는 도면 버전",
    );
    expect(() =>
      deserializeFoldProfile(
        JSON.stringify({
          schemaVersion: 3,
          id: "broken",
          name: "broken",
          material: {},
          product: {},
          calculation: {},
          profileType: "normal",
          blocks: [],
          createdAt: "",
          updatedAt: "",
        }),
      ),
    ).toThrow("필드가 누락되었습니다");
  });

  it("migrates a version 1 segment list into the first normal block", () => {
    const current = createFoldProfile({ id: "legacy", now: "2026-07-11T00:00:00.000Z" });
    const legacy = {
      ...current,
      schemaVersion: 1,
      segments: [createFoldSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, { id: "s1" })],
    } as Record<string, unknown>;
    delete legacy.blocks;
    delete legacy.profileType;
    const restored = deserializeFoldProfile(JSON.stringify(legacy));
    expect(restored.schemaVersion).toBe(3);
    expect(restored.profileType).toBe("normal");
    expect(restored.blocks[0].segments).toHaveLength(1);
  });

  it("migrates a version 2 material to an explicit inside bend radius", () => {
    const legacy = createFoldProfile({ id: "legacy-v2", material: { thickness: 3 } }) as unknown as Record<string, unknown>;
    legacy.schemaVersion = 2;
    const material = legacy.material as Record<string, unknown>;
    delete material.insideBendRadius;

    const restored = deserializeFoldProfile(JSON.stringify(legacy));
    expect(restored.schemaVersion).toBe(3);
    expect(restored.material.insideBendRadius).toBe(3);
  });
});

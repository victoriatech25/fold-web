import { describe, expect, it } from "vitest";

import { browserFoldProfileV3ToServerDocumentV1 } from "@/domain/fold-document/adapter";
import {
  createFoldProfile,
  createFoldSegment,
  normalizeEditorAngleDeg,
  normalizeEditorLengthMm,
} from "@/domain/fold-profile";

describe("editor storage precision", () => {
  it("normalizes length, angle and negative zero at explicit edit boundaries", () => {
    expect(normalizeEditorLengthMm(1.123456789)).toBe(1.123457);
    expect(normalizeEditorAngleDeg(89.123456)).toBe(89.1235);
    expect(Object.is(normalizeEditorLengthMm(-0.0000001), -0)).toBe(false);
  });

  it("creates geometry that the strict server Decimal adapter can store", () => {
    const profile = createFoldProfile({
      material: {
        id: "00000000-0000-4000-8000-000000000001",
      },
      product: { length: 1000 },
    });
    profile.blocks[0].segments = [
      createFoldSegment(
        { x: 0.00000001, y: -0.00000001 },
        { x: 12.123456789, y: 3.987654321 },
      ),
    ];
    const server = browserFoldProfileV3ToServerDocumentV1(
      profile,
      profile.material.id,
    );
    expect(server.blocks[0].segments[0]).toMatchObject({
      geometry: {
        start: { xMm: "0", yMm: "0" },
        end: { xMm: "12.123457", yMm: "3.987654" },
      },
    });
  });
});

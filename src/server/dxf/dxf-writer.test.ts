import { describe, expect, it } from "vitest";

import type { ManufacturingGeometry } from "@/domain/manufacturing-geometry";

import { createDxfDocument } from "./dxf-writer";

const geometry: ManufacturingGeometry = {
  version: "manufacturing-geometry-v1",
  unit: "mm",
  profileId: "profile-test",
  profileType: "normal",
  bounds: { minX: 0, minY: -20, maxX: 100, maxY: 20, width: 100, height: 40 },
  entities: [
    { kind: "line", id: "line-1", layer: "CUT", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    { kind: "arc", id: "arc-1", layer: "PROFILE_REFERENCE", center: { x: 50, y: 0 }, radius: 20, startAngleDeg: 0, endAngleDeg: 180 },
  ],
};

describe("independent ASCII DXF R2000 writer", () => {
  it("writes millimetre header, layer table, line and arc entities", () => {
    const result = createDxfDocument(geometry);

    expect(result).toMatchObject({
      version: "dxf-r2000-v1",
      acadVersion: "AC1015",
      unit: "mm",
      entityCount: 2,
      layers: ["CUT", "PROFILE_REFERENCE"],
    });
    expect(result.content).toContain("9\r\n$ACADVER\r\n1\r\nAC1015\r\n");
    expect(result.content).toContain("9\r\n$INSUNITS\r\n70\r\n4\r\n");
    expect(result.content).toContain("0\r\nLINE\r\n8\r\nCUT\r\n");
    expect(result.content).toContain("0\r\nARC\r\n8\r\nPROFILE_REFERENCE\r\n");
    expect(result.content.endsWith("0\r\nEOF\r\n")).toBe(true);
    expect(result.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.sizeBytes).toBe(new TextEncoder().encode(result.content).byteLength);
  });

  it("is byte-for-byte deterministic for the same geometry", () => {
    expect(createDxfDocument(geometry)).toEqual(createDxfDocument(structuredClone(geometry)));
  });
});

import { describe, expect, it } from "vitest";

import { calculateProfile } from "./fold-calculation";
import { arcBulgePoint, arcMetrics, circularArcDefinition, sampleSegmentPoints } from "./fold-geometry";
import { createFoldProfile, createFoldSegment } from "./fold-profile";

describe("circular arc geometry", () => {
  it("calculates shallow, semicircular and major arcs from chord and sagitta", () => {
    const shallow = arcMetrics(100, 10)!;
    const semicircle = arcMetrics(100, 50)!;
    const major = arcMetrics(100, 100)!;

    expect(shallow.centralAngleDeg).toBeCloseTo(45.2397, 4);
    expect(semicircle.radius).toBe(50);
    expect(semicircle.centralAngleDeg).toBeCloseTo(180, 8);
    expect(semicircle.arcLength).toBeCloseTo(Math.PI * 50, 8);
    expect(major.centralAngleDeg).toBeGreaterThan(180);
    expect(major.centralAngleDeg).toBeLessThan(360);
  });

  it("keeps left and right bulges on opposite directed sides", () => {
    expect(arcBulgePoint({ x: 0, y: 0 }, { x: 100, y: 0 }, 20, "left")).toEqual({ x: 50, y: 20 });
    expect(arcBulgePoint({ x: 0, y: 0 }, { x: 100, y: 0 }, 20, "right")).toEqual({ x: 50, y: -20 });
    const segment = createFoldSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {
      geometry: { kind: "arc", side: "left", sagitta: 20 },
    });
    const points = sampleSegmentPoints(segment);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points.at(-1)?.x).toBeCloseTo(100, 8);
    expect(Math.max(...points.map((point) => point.y))).toBeCloseTo(20, 6);
  });

  it("uses arc length before the approved junction correction and decimal policy", () => {
    const profile = createFoldProfile();
    const segment = createFoldSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {
      geometry: { kind: "arc", side: "left", sagitta: 50 },
    });
    const result = calculateProfile([segment], profile.material, {
      ...profile.calculation,
      decimalPlaces: 3,
      decimalOperation: "round",
    }).segments[0];
    expect(result.throughLength).toBe(100);
    expect(result.baseLength).toBeCloseTo(157.079633, 6);
    expect(result.calculatedLengthDecimal).toBe("157.08");
  });

  it("converts left, right and major arcs to deterministic DXF angles", () => {
    const left = createFoldSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {
      geometry: { kind: "arc", side: "left", sagitta: 20 },
    });
    const right = createFoldSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {
      geometry: { kind: "arc", side: "right", sagitta: 20 },
    });
    const major = createFoldSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {
      geometry: { kind: "arc", side: "left", sagitta: 100 },
    });

    expect(circularArcDefinition(left)).toMatchObject({
      center: { x: 50, y: -52.5 },
      startAngleDeg: expect.closeTo(46.397, 3),
      endAngleDeg: expect.closeTo(133.603, 3),
    });
    expect(circularArcDefinition(right)).toMatchObject({
      center: { x: 50, y: 52.5 },
      startAngleDeg: expect.closeTo(226.397, 3),
      endAngleDeg: expect.closeTo(313.603, 3),
    });
    expect(circularArcDefinition(major)?.centralAngleDeg).toBeGreaterThan(180);
  });
});

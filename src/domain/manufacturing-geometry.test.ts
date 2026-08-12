import { describe, expect, it } from "vitest";

import { createFoldBlock, createFoldProfile, createFoldSegment } from "./fold-profile";
import { createManufacturingGeometry } from "./manufacturing-geometry";

const bend = { direction: "front", cutType: "v-cut", angle: 90 } as const;

describe("manufacturing geometry v1", () => {
  it("creates a closed normal cut outline and deterministic bend layers in millimetres", () => {
    const profile = createFoldProfile({ product: { length: 2400, quantity: 1 } });
    profile.blocks[0].segments = [
      createFoldSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, { id: "s1", bendAfter: bend }),
      createFoldSegment({ x: 100, y: 0 }, { x: 100, y: 50 }, { id: "s2" }),
    ];

    const result = createManufacturingGeometry(profile);

    expect(result.valid).toBe(true);
    expect(result.geometry).toMatchObject({ unit: "mm", profileType: "normal" });
    expect(result.geometry?.entities.filter((entity) => entity.layer === "CUT")).toHaveLength(4);
    expect(result.geometry?.entities).toContainEqual(expect.objectContaining({
      layer: "V_CUT",
      sourceSegmentId: "s1",
      start: { x: 0, y: 99 },
      end: { x: 2400, y: 99 },
    }));
    expect(result.geometry?.bounds).toMatchObject({ width: 2400, height: 148 });
  });

  it("creates a closed cross outline for an automatically inferred box without product length", () => {
    const profile = createFoldProfile({ profileType: "box", product: { length: 0, quantity: 1 } });
    profile.blocks[0].segments = [
      createFoldSegment({ x: 0, y: -20 }, { x: 0, y: 0 }, { id: "x-left", bendAfter: bend }),
      createFoldSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, { id: "x-base", bendAfter: bend }),
      createFoldSegment({ x: 100, y: 0 }, { x: 100, y: -20 }, { id: "x-right" }),
    ];
    const vertical = createFoldBlock(2);
    vertical.segments = [
      createFoldSegment({ x: 20, y: -40 }, { x: 50, y: -40 }, { id: "y-front", bendAfter: bend }),
      createFoldSegment({ x: 50, y: -40 }, { x: 50, y: 40 }, { id: "y-base", bendAfter: bend }),
      createFoldSegment({ x: 50, y: 40 }, { x: 80, y: 40 }, { id: "y-back" }),
    ];
    profile.blocks.push(vertical);
    const boxPanel = createFoldBlock(1, "박스 연결 패널");
    boxPanel.segments = [createFoldSegment({ x: 0, y: 0 }, { x: 30, y: 0 })];
    profile.panelAttachments.push({
      id: "box-panel",
      name: "박스 연결 패널",
      hostBlockId: profile.blocks[0].id,
      hostSegmentId: "x-left",
      direction: "clockwise",
      dimensionRole: "none",
      block: boxPanel,
    });

    const result = createManufacturingGeometry(profile);
    const panelCut = result.geometry?.entities.filter((entity) => entity.layer === "PANEL_CUT") ?? [];

    expect(result.valid).toBe(true);
    expect(result.geometry?.entities.filter((entity) => entity.layer === "CUT")).toHaveLength(12);
    expect(result.geometry?.entities.filter((entity) => entity.layer === "V_CUT")).toHaveLength(4);
    expect(panelCut).toHaveLength(4);
    const panelX = panelCut.flatMap((entity) => entity.kind === "line" ? [entity.start.x, entity.end.x] : []);
    expect(Math.max(...panelX) - Math.min(...panelX)).toBe(80);
  });

  it("lays embedded panels beside the primary pattern without overlapping its bounds", () => {
    const profile = createFoldProfile({ product: { length: 1000, quantity: 1 } });
    profile.blocks[0].segments = [createFoldSegment({ x: 0, y: 0 }, { x: 100, y: 0 })];
    const panelBlock = createFoldBlock(1, "패널");
    panelBlock.segments = [createFoldSegment({ x: 0, y: 0 }, { x: 320, y: 0 })];
    profile.panelAttachments.push({
      id: "panel-1",
      name: "패널 1",
      hostBlockId: profile.blocks[0].id,
      hostSegmentId: profile.blocks[0].segments[0].id,
      direction: "clockwise",
      dimensionRole: "secondary-product-dimension",
      block: panelBlock,
    });

    const result = createManufacturingGeometry(profile);
    const panelLines = result.geometry?.entities.filter((entity) => entity.layer === "PANEL_CUT") ?? [];

    expect(result.valid).toBe(true);
    expect(panelLines).toHaveLength(4);
    expect(Math.min(...panelLines.flatMap((entity) => entity.kind === "line" ? [entity.start.x, entity.end.x] : []))).toBe(1020);
    expect(result.geometry?.bounds.width).toBe(2020);
  });

  it("rejects missing normal product length and non-intersecting box sections", () => {
    const normal = createFoldProfile({ product: { length: 0, quantity: 1 } });
    normal.blocks[0].segments = [createFoldSegment({ x: 0, y: 0 }, { x: 100, y: 0 })];
    expect(createManufacturingGeometry(normal).issues.map((issue) => issue.code)).toContain("INVALID_PRODUCT_LENGTH");

    const box = createFoldProfile({ profileType: "box", product: { length: 100, quantity: 1 } });
    box.blocks[0].segments = [createFoldSegment({ x: 0, y: 0 }, { x: 100, y: 0 })];
    box.blocks.push(createFoldBlock(2));
    box.blocks[1].segments = [createFoldSegment({ x: 0, y: 50 }, { x: 80, y: 50 })];
    expect(createManufacturingGeometry(box).issues.map((issue) => issue.code)).toContain("INVALID_PROFILE");
  });
});

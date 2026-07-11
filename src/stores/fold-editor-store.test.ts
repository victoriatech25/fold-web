import { describe, expect, it } from "vitest";

import { FoldEditorStore } from "./fold-editor-store";

const segments = (store: FoldEditorStore, blockIndex = 0) =>
  store.profile.blocks[blockIndex].segments;

describe("FoldEditorStore", () => {
  it("updates a selected length while preserving downstream connectivity", () => {
    const store = new FoldEditorStore();
    store.selectSegment(segments(store)[0].id);
    store.updateSelectedLength(120);

    expect(segments(store)[0].inputLength).toBe(120);
    expect(segments(store)[0].end).toEqual(segments(store)[1].start);
    expect(segments(store)[1].end.x).toBe(120);
    expect(store.calculation.calculatedWidth).toBe(250);
  });

  it("undoes and redoes an edit using plain domain snapshots", () => {
    const store = new FoldEditorStore();
    store.selectSegment(segments(store)[0].id);
    store.updateSelectedLength(120);
    store.undo();
    expect(segments(store)[0].inputLength).toBe(100);
    store.redo();
    expect(segments(store)[0].inputLength).toBe(120);
  });

  it("moves a joint and updates both adjacent lengths", () => {
    const store = new FoldEditorStore();
    store.moveJoint(1, { x: 120, y: 0 });
    expect(segments(store)[0].inputLength).toBe(120);
    expect(segments(store)[1].start).toEqual({ x: 120, y: 0 });
    expect(segments(store)[1].inputLength).toBeCloseTo(Math.hypot(20, 50));
  });

  it("adds consecutive segments from the last endpoint", () => {
    const store = new FoldEditorStore();
    const lastEnd = { ...segments(store).at(-1)!.end };
    store.setMode("draw");
    store.addDrawPoint({ x: 230, y: -50 });

    expect(segments(store)).toHaveLength(4);
    expect(segments(store)[3].start).toEqual(lastEnd);
    expect(segments(store)[3].inputLength).toBe(50);
    expect(store.selectedSegmentId).toBe(segments(store)[3].id);
    expect(store.canUndo).toBe(true);
  });

  it("uses the first two clicks as start and end after clearing", () => {
    const store = new FoldEditorStore();
    store.clearProfile();
    store.addDrawPoint({ x: 10, y: 20 });
    expect(segments(store)).toHaveLength(0);
    store.addDrawPoint({ x: 110, y: 20 });

    expect(segments(store)).toHaveLength(1);
    expect(segments(store)[0].start).toEqual({ x: 10, y: 20 });
    expect(segments(store)[0].end).toEqual({ x: 110, y: 20 });
  });

  it("reconnects and recalculates the next segment after deleting a middle segment", () => {
    const store = new FoldEditorStore();
    store.selectSegment(segments(store)[1].id);
    store.deleteSelected();

    expect(segments(store)).toHaveLength(2);
    expect(segments(store)[1].start).toEqual(segments(store)[0].end);
    expect(segments(store)[1].inputLength).toBeCloseTo(Math.hypot(80, 50));
  });

  it("updates and removes a bend while recalculating the unfolded width", () => {
    const store = new FoldEditorStore();
    store.selectSegment(segments(store)[0].id);
    const initialWidth = store.calculation.calculatedWidth;
    store.updateSelectedBend("back", "a-cut", 120);

    expect(store.selectedSegment?.bendAfter).toEqual({
      direction: "back",
      cutType: "a-cut",
      angle: 120,
    });
    expect(store.calculation.calculatedWidth).not.toBe(initialWidth);
    store.removeSelectedBend();
    expect(store.selectedSegment?.bendAfter).toBeUndefined();
  });

  it("updates material elongation and recalculates the unfolded width", () => {
    const store = new FoldEditorStore();
    store.selectSegment(segments(store)[1].id);
    store.removeSelectedBend();
    const initialWidth = store.calculation.calculatedWidth;
    store.updateMaterial({ elongation: { "v-cut": 4, "a-cut": 0.8, "no-cut": 2 } });

    expect(store.profile.material.elongation["v-cut"]).toBe(4);
    expect(store.calculation.calculatedWidth).not.toBe(initialWidth);
  });

  it("overrides and restores the selected segment elongation", () => {
    const store = new FoldEditorStore();
    store.selectSegment(segments(store)[0].id);
    const automatic = store.selectedSegmentCalculation?.automaticCorrection;

    store.setSelectedElongationOverride(5);
    expect(store.selectedSegmentCalculation).toMatchObject({ correctionSource: "manual", appliedCorrection: 5 });
    store.setSelectedElongationOverride(null);
    expect(store.selectedSegmentCalculation).toMatchObject({ correctionSource: "automatic", appliedCorrection: automatic });
  });

  it("updates product dimensions used by the area calculation", () => {
    const store = new FoldEditorStore();
    store.setProductLength(3000);
    store.setQuantity(5);

    expect(store.calculation.productLength).toBe(3000);
    expect(store.calculation.quantity).toBe(5);
    expect(store.calculation.areaTotalM2).toBeCloseTo(
      (store.calculation.calculatedWidth * 3000 * 5) / 1_000_000,
    );
  });

  it("ignores invalid length and quantity input", () => {
    const store = new FoldEditorStore();
    const originalLength = segments(store)[0].inputLength;
    store.updateSelectedLength(0);
    store.setQuantity(0);

    expect(segments(store)[0].inputLength).toBe(originalLength);
    expect(store.profile.product.quantity).toBe(10);
    expect(store.canUndo).toBe(false);
  });

  it("closes a profile by adding an exact segment back to the first point", () => {
    const store = new FoldEditorStore();
    const first = { ...segments(store)[0].start };
    const previousEnd = { ...segments(store).at(-1)!.end };
    store.setMode("draw");
    store.closeProfile();

    const closing = segments(store).at(-1)!;
    expect(segments(store)).toHaveLength(4);
    expect(closing.start).toEqual(previousEnd);
    expect(closing.end).toEqual(first);
    expect(store.isClosed).toBe(true);
    expect(store.mode).toBe("select");
  });

  it("does not close a profile before it has enough sides", () => {
    const store = new FoldEditorStore();
    store.clearProfile();
    store.addDrawPoint({ x: 0, y: 0 });
    store.addDrawPoint({ x: 100, y: 0 });
    store.closeProfile();

    expect(segments(store)).toHaveLength(1);
    expect(store.isClosed).toBe(false);
  });

  it("reopens a closed profile when the closing segment is deleted", () => {
    const store = new FoldEditorStore();
    store.closeProfile();
    store.deleteSelected();

    expect(store.isClosed).toBe(false);
    store.setMode("draw");
    expect(store.mode).toBe("draw");
  });

  it("creates a second independent block when box mode is selected", () => {
    const store = new FoldEditorStore();
    store.setProfileType("box");
    store.startSecondBlock();
    store.addDrawPoint({ x: 40, y: -20 });
    store.addDrawPoint({ x: 40, y: 100 });

    expect(store.profile.profileType).toBe("box");
    expect(store.profile.blocks).toHaveLength(2);
    expect(segments(store, 1)[0].start).toEqual({ x: 40, y: -20 });
    expect(segments(store, 1)[0].inputLength).toBe(120);
    expect(segments(store, 0)).toHaveLength(3);
  });

  it("keeps separate calculations for both box faces", () => {
    const store = new FoldEditorStore();
    store.setProfileType("box");
    store.startSecondBlock();
    store.addDrawPoint({ x: 20, y: 20 });
    store.addDrawPoint({ x: 20, y: 120 });

    expect(store.blockCalculations[0].calculatedWidth).toBe(230);
    expect(store.blockCalculations[1].calculatedWidth).toBe(100);
    expect(store.calculation.calculatedWidth).toBe(330);
    expect(store.calculation.areaEachM2).toBeCloseTo(0.792);
  });
});

import { describe, expect, it } from "vitest";

import { createFoldBlock, createFoldProfile, createFoldSegment } from "./fold-profile";
import {
  calculateFoldPrice,
  calculateSheetPrice,
  extractFoldPricingMetrics,
  PricingCalculationError,
  type PriceSourceTrace,
} from "./pricing";

const bend = { direction: "front", cutType: "v-cut", angle: 90 } as const;
const trace: PriceSourceTrace = {
  scopeType: "STANDARD",
  priceBookId: "book",
  revisionId: "revision",
  rateId: "rate",
  contentChecksumSha256: "checksum",
  effectiveAt: "2026-08-01T00:00:00.000Z",
};

describe("pricing metrics v1", () => {
  it("extracts normal area, physical operations and enabled V-CUT length", () => {
    const profile = createFoldProfile({ product: { length: 2000, quantity: 3 } });
    profile.material.elongation = { "v-cut": 0, "a-cut": 0, "no-cut": 0 };
    profile.blocks[0].segments = [
      createFoldSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, { id: "s1", bendAfter: bend }),
      createFoldSegment({ x: 100, y: 0 }, { x: 100, y: 50 }, { id: "s2" }),
    ];

    expect(extractFoldPricingMetrics(profile)).toEqual({
      version: "pricing-metrics-v1",
      areaEachM2: "0.3",
      bendOperationsEach: 1,
      vCutLengthEachM: "2",
      quantity: 3,
    });
  });

  it("counts compound bend operations once per operation and its V-CUT line once", () => {
    const profile = createFoldProfile({ product: { length: 1000, quantity: 1 } });
    profile.material.elongation = { "v-cut": 0, "a-cut": 0, "no-cut": 0 };
    profile.blocks[0].segments = [
      createFoldSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {
        id: "s1",
        bendAfter: { ...bend, secondaryOperation: { direction: "back", form: "u" } },
      }),
      createFoldSegment({ x: 100, y: 0 }, { x: 100, y: 50 }, { id: "s2" }),
    ];
    const metrics = extractFoldPricingMetrics(profile);
    expect(metrics.bendOperationsEach).toBe(2);
    expect(metrics.vCutLengthEachM).toBe("1");
  });

  it("prices a box from intersecting base lines without product length", () => {
    const profile = createFoldProfile({ profileType: "box", product: { length: 0, quantity: 2 } });
    profile.material.elongation = { "v-cut": 0, "a-cut": 0, "no-cut": 0 };
    profile.blocks[0].segments = [
      createFoldSegment({ x: 0, y: -20 }, { x: 0, y: 0 }, { id: "x-left", bendAfter: bend }),
      createFoldSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, { id: "x-base", bendAfter: bend }),
      createFoldSegment({ x: 100, y: 0 }, { x: 100, y: -20 }, { id: "x-right" }),
    ];
    const vertical = createFoldBlock(2);
    vertical.segments = [
      createFoldSegment({ x: 20, y: -30 }, { x: 50, y: -30 }, { id: "y-front", bendAfter: bend }),
      createFoldSegment({ x: 50, y: -30 }, { x: 50, y: 50 }, { id: "y-base", bendAfter: bend }),
      createFoldSegment({ x: 50, y: 50 }, { x: 80, y: 50 }, { id: "y-back" }),
    ];
    profile.blocks.push(vertical);

    expect(extractFoldPricingMetrics(profile)).toMatchObject({
      areaEachM2: "0.0172",
      bendOperationsEach: 4,
      vCutLengthEachM: "0.36",
      quantity: 2,
    });
  });
});

describe("pricing engine v1", () => {
  it("rounds quantity-applied components and surcharges processing only", () => {
    const result = calculateFoldPrice({
      metrics: { version: "pricing-metrics-v1", areaEachM2: "0.33333333", bendOperationsEach: 2, vCutLengthEachM: "1.25", quantity: 3 },
      rate: { materialRatePerM2Krw: "20000", bendRatePerOperationKrw: "1000", vCutRatePerMeterKrw: "500" },
      surchargePolicy: { minimumBendOperations: 3, ratePercent: "10", baseType: "PROCESSING_ONLY" },
      trace: { foldRate: trace, surcharge: trace },
    });

    expect(result.amounts).toEqual({
      materialKrw: "20000",
      bendKrw: "6000",
      vCutKrw: "1875",
      surchargeKrw: "788",
      supplyKrw: "28663",
    });
    expect(result.surchargeApplied).toBe(true);
  });

  it("does not apply surcharge at the minimum bend boundary", () => {
    const result = calculateFoldPrice({
      metrics: { version: "pricing-metrics-v1", areaEachM2: "1", bendOperationsEach: 3, vCutLengthEachM: "0", quantity: 1 },
      rate: { materialRatePerM2Krw: "20000", bendRatePerOperationKrw: "1000", vCutRatePerMeterKrw: "500" },
      surchargePolicy: { minimumBendOperations: 3, ratePercent: "10", baseType: "PROCESSING_ONLY" },
      trace: { foldRate: trace, surcharge: trace },
    });
    expect(result.surchargeApplied).toBe(false);
    expect(result.amounts.supplyKrw).toBe("23000");
  });

  it("keeps explicit zero rates distinct from invalid negative inputs", () => {
    expect(calculateFoldPrice({
      metrics: { version: "pricing-metrics-v1", areaEachM2: "1", bendOperationsEach: 0, vCutLengthEachM: "0", quantity: 1 },
      rate: { materialRatePerM2Krw: "0", bendRatePerOperationKrw: "0", vCutRatePerMeterKrw: "0" },
      surchargePolicy: null,
      trace: { foldRate: trace, surcharge: null },
    }).amounts.supplyKrw).toBe("0");
    expect(() => calculateFoldPrice({
      metrics: { version: "pricing-metrics-v1", areaEachM2: "1", bendOperationsEach: 0, vCutLengthEachM: "0", quantity: 1 },
      rate: { materialRatePerM2Krw: "-1", bendRatePerOperationKrw: "0", vCutRatePerMeterKrw: "0" },
      surchargePolicy: null,
      trace: { foldRate: trace, surcharge: null },
    })).toThrowError(PricingCalculationError);
  });

  it("calculates independent sheet sale amounts", () => {
    expect(calculateSheetPrice({ materialPricePerSheetKrw: "47000", processingPricePerSheetKrw: "18000", quantity: 3 })).toEqual({
      engineVersion: "pricing-engine-v1",
      rates: { materialPricePerSheetKrw: "47000", processingPricePerSheetKrw: "18000" },
      quantity: 3,
      amounts: { materialKrw: "141000", processingKrw: "54000", supplyKrw: "195000" },
    });
  });
});

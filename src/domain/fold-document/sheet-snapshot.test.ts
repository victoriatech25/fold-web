import { describe, expect, it } from "vitest";
import { browserFoldProfileV4ToServerDocumentV3, serverDocumentToBrowserFoldProfileV4 } from "./adapter";
import { createFoldProfile } from "../fold-profile";

const ruleId = "11111111-1111-4111-8111-111111111111";
const sheetItemId = "22222222-2222-4222-8222-222222222222";
const materialVariantId = "33333333-3333-4333-8333-333333333333";

describe("fold document sheet snapshot", () => {
  it("round-trips a physical sheet snapshot in server schema v3", () => {
    const profile = createFoldProfile({
      material: { id: ruleId },
      sheetItemSnapshot: {
        sheetItemId,
        materialVariantId,
        code: "AL-2-SHEET",
        name: "알루미늄 2T 원판",
        finishName: "평판",
        widthMm: "1220",
        lengthMm: "2440",
        rotationPolicy: "FREE",
        grainAxis: "NONE",
        trimTopMm: "0",
        trimRightMm: "0",
        trimBottomMm: "0",
        trimLeftMm: "0",
        nominalAreaM2: "2.9768",
        usableWidthMm: "1220",
        usableLengthMm: "2440",
        usableAreaM2: "2.9768",
        effectiveWeightKg: "16.07472",
        weightSource: "CALCULATED",
      },
    });
    const document = browserFoldProfileV4ToServerDocumentV3(profile, ruleId);
    expect(document).toMatchObject({ schemaVersion: 3, sheetItemSnapshot: { sheetItemId } });
    expect(serverDocumentToBrowserFoldProfileV4(document, { id: profile.id, createdAt: profile.createdAt, updatedAt: profile.updatedAt }).sheetItemSnapshot).toEqual(profile.sheetItemSnapshot);
  });
});

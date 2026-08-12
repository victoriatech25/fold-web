import { describe, expect, it } from "vitest";

import { parseServerFoldDocumentV1 } from "@/domain/fold-document/schema";

import { calculateFoldDocumentChecksum, verifyFoldDocumentChecksum } from "./checksum";

function document() {
  return parseServerFoldDocumentV1({
    schemaVersion: 1,
    documentType: "normal",
    name: "checksum",
    product: { lengthMm: "1000", quantity: 1 },
    material: {
      ruleRevisionId: "00000000-0000-4000-8000-000000000001",
      name: "알루미늄 1T",
      thicknessMm: "1",
      insideBendRadiusMm: "1",
      cutAngleDeg: "135",
      elongationMm: { vCut: "0.6", aCut: "0.4", noCut: "1" },
      cutDepthMm: { vCut: "0.5", aCut: "0.5", noCut: "0" },
    },
    calculation: {
      mode: "fixed",
      elongationOption: "standard",
      vCutEnabled: true,
      decimalPlaces: 1,
      decimalOperation: "round",
    },
    variables: [],
    blocks: [{
      id: "block-1",
      name: "면 1",
      order: 1,
      segments: [{
        id: "segment-1",
        order: 1,
        geometry: {
          kind: "line",
          start: { xMm: "0", yMm: "0" },
          end: { xMm: "100", yMm: "0" },
          direction: "e",
        },
        nominalLengthMm: "100",
      }],
    }],
  });
}

describe("fold document checksum", () => {
  it("creates and verifies a stable lowercase SHA-256", () => {
    const checksum = calculateFoldDocumentChecksum(document());
    expect(checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(checksum).toBe("6a50b43533bc1e4f816edf57f47f4719cbeb9a801d2344f66af3edfcfc9291c7");
    expect(() => verifyFoldDocumentChecksum(document(), checksum)).not.toThrow();
  });

  it("detects a changed document and malformed checksum", () => {
    const changed = { ...document(), name: "changed" };
    expect(() => verifyFoldDocumentChecksum(changed, calculateFoldDocumentChecksum(document())))
      .toThrow("일치하지 않습니다");
    expect(() => verifyFoldDocumentChecksum(document(), "bad")).toThrow("일치하지 않습니다");
  });
});

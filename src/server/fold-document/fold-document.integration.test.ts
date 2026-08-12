import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { migrateFoldDocumentToCurrent, parseServerFoldDocumentV1 } from "@/domain/fold-document/schema";
import { disconnectPrisma, getPrisma } from "@/server/db/prisma";

import {
  FoldMaterialRuleNotFoundError,
  resolvePublishedMaterialRuleSnapshot,
} from "./material-snapshot";
import { prepareFoldRevisionDocument, readFoldRevisionDocument } from "./revision-contract";

const runIntegration = process.env.RUN_DB_INTEGRATION === "1";
const integration = runIntegration ? describe : describe.skip;

let prisma: PrismaClient;
let organizationId: string;
let otherOrganizationId: string;
let materialRuleRevisionId: string;
let otherMaterialRuleRevisionId: string;
let templateId: string;

async function createMaterialRule(organizationIdValue: string, suffix: string) {
  const material = await prisma.material.create({
    data: {
      organizationId: organizationIdValue,
      code: `AL-${suffix}`,
      name: `알루미늄 ${suffix}`,
      normalizedName: `알루미늄 ${suffix}`.toLocaleLowerCase("ko-KR"),
      densityKgPerM3: "2700",
    },
  });
  const variant = await prisma.materialVariant.create({
    data: {
      organizationId: organizationIdValue,
      materialId: material.id,
      code: `AL-1T-${suffix}`,
      name: `알루미늄 1T ${suffix}`,
      thicknessMm: "1.000000",
      defaultInsideRadiusMm: "1.000000",
    },
  });
  return prisma.materialRuleRevision.create({
    data: {
      organizationId: organizationIdValue,
      materialVariantId: variant.id,
      revisionNumber: 1,
      status: "PUBLISHED",
      calculationMode: "FIXED",
      vCutEnabled: true,
      decimalPlaces: 1,
      decimalOperation: "ROUND",
      cutAngleDeg: "135.0000",
      insideBendRadiusMm: "1.000000",
      elongationVCutMm: "0.600000",
      elongationACutMm: "0.400000",
      elongationNoCutMm: "1.000000",
      cutDepthVCutMm: "0.500000",
      cutDepthACutMm: "0.500000",
      cutDepthNoCutMm: "0.000000",
      publishedAt: new Date("2026-07-25T00:00:00.000Z"),
    },
  });
}

integration.sequential("fold document v1 PostgreSQL integration", () => {
  beforeAll(async () => {
    prisma = getPrisma();
    organizationId = (
      await prisma.organization.create({
        data: { code: "FOLD_DOCUMENT", name: "절곡 문서 통합 테스트" },
        select: { id: true },
      })
    ).id;
    otherOrganizationId = (
      await prisma.organization.create({
        data: { code: "FOLD_DOCUMENT_OTHER", name: "절곡 문서 타 조직" },
        select: { id: true },
      })
    ).id;
    materialRuleRevisionId = (await createMaterialRule(organizationId, "OWN")).id;
    otherMaterialRuleRevisionId = (await createMaterialRule(otherOrganizationId, "OTHER")).id;
    const category = await prisma.foldCategory.create({
      data: {
        organizationId,
        code: "GENERAL",
        name: "일반 절곡",
      },
    });
    templateId = (
      await prisma.foldTemplate.create({
        data: {
          organizationId,
          categoryId: category.id,
          code: "FOLD-DOC-001",
          name: "절곡 문서 계약 시험",
          documentType: "NORMAL",
        },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("creates a canonical material snapshot only inside the organization", async () => {
    const snapshot = await resolvePublishedMaterialRuleSnapshot(
      prisma,
      organizationId,
      materialRuleRevisionId,
    );
    expect(snapshot).toEqual({
      ruleRevisionId: materialRuleRevisionId,
      name: "알루미늄 1T OWN",
      thicknessMm: "1",
      insideBendRadiusMm: "1",
      cutAngleDeg: "135",
      elongationMm: { vCut: "0.6", aCut: "0.4", noCut: "1" },
      cutDepthMm: { vCut: "0.5", aCut: "0.5", noCut: "0" },
    });
    await expect(
      resolvePublishedMaterialRuleSnapshot(prisma, organizationId, otherMaterialRuleRevisionId),
    ).rejects.toBeInstanceOf(FoldMaterialRuleNotFoundError);
  });

  it("round-trips JSONB with matching version, material rule and checksum", async () => {
    const material = await resolvePublishedMaterialRuleSnapshot(
      prisma,
      organizationId,
      materialRuleRevisionId,
    );
    const document = parseServerFoldDocumentV1({
      schemaVersion: 1,
      documentType: "normal",
      name: "PostgreSQL 왕복",
      product: { lengthMm: "1000", quantity: 1 },
      material,
      calculation: {
        mode: "fixed",
        elongationOption: "standard",
        vCutEnabled: true,
        decimalPlaces: 1,
        decimalOperation: "round",
      },
      variables: [
        { name: "W", valueMm: "120" },
        {
          name: "HALF",
          valueMm: "60",
          expression: {
            grammarVersion: "fold-expression-v1",
            source: "W/2",
          },
        },
      ],
      productExpression: {
        enabled: true,
        grammarVersion: "fold-expression-v1",
        source: "W*10",
      },
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
          nominalLengthMm: "70",
          lengthExpression: {
            grammarVersion: "fold-expression-v1",
            source: "HALF+10",
          },
        }],
      }],
    });
    const prepared = prepareFoldRevisionDocument(document);
    const created = await prisma.foldRevision.create({
      data: {
        organizationId,
        templateId,
        revisionNumber: 1,
        status: "DRAFT",
        name: document.name,
        ...prepared,
      },
      select: {
        materialRuleRevisionId: true,
        documentSchemaVersion: true,
        document: true,
        documentChecksumSha256: true,
      },
    });

    expect(readFoldRevisionDocument(created)).toEqual(migrateFoldDocumentToCurrent(document));
    expect(() => readFoldRevisionDocument({
      ...created,
      documentSchemaVersion: 1,
    })).toThrowError(expect.objectContaining({
      issues: [expect.objectContaining({ code: "SCHEMA_VERSION_MISMATCH" })],
    }));
    expect(() => readFoldRevisionDocument({
      ...created,
      materialRuleRevisionId: otherMaterialRuleRevisionId,
    })).toThrowError(expect.objectContaining({
      issues: [expect.objectContaining({ code: "MATERIAL_RULE_MISMATCH" })],
    }));
    expect(() => readFoldRevisionDocument({
      ...created,
      documentChecksumSha256: "0".repeat(64),
    })).toThrow("checksum");
  });
});

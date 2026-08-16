import "dotenv/config";

import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";

import {
  PrismaClient,
  RevisionStatus,
} from "../src/generated/prisma/client";
import {
  permissionCatalog,
  systemRoleDefinitions,
} from "../src/domain/permission";
import { calculateMaterialRuleChecksum } from "../src/server/material-rules/material-rule-policy";
import { calculatePriceRevisionChecksum } from "../src/server/pricing/pricing-policy";
import { projectCanonicalJsonV1 } from "../src/domain/fold-document/canonical";
import { parseServerFoldDocument, type ServerFoldDocumentV1 } from "../src/domain/fold-document/schema";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://fold_web_app@127.0.0.1:5432/fold_web_dev?schema=public";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

function prepareSeedFoldDocument(input: ServerFoldDocumentV1) {
  const document = parseServerFoldDocument(input);
  const canonical = projectCanonicalJsonV1(document);
  return {
    materialRuleRevisionId: document.material.ruleRevisionId,
    documentSchemaVersion: document.schemaVersion,
    document: JSON.parse(canonical),
    documentChecksumSha256: createHash("sha256").update(canonical, "utf8").digest("hex"),
  };
}

async function seed() {
  const organizationCode = process.env.SEED_ORGANIZATION_CODE ?? "LOCAL_DEV";
  const organizationName = process.env.SEED_ORGANIZATION_NAME ?? "로컬 개발 조직";

  await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.upsert({
      where: { code: organizationCode },
      update: { name: organizationName },
      create: {
        code: organizationCode,
        name: organizationName,
        companyProfile: { create: {} },
      },
    });

    await tx.companyProfile.upsert({
      where: { organizationId: organization.id },
      update: {},
      create: { organizationId: organization.id },
    });

    const existingDefaultSite = await tx.businessSite.findFirst({
      where: {
        organizationId: organization.id,
        isDefault: true,
        active: true,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!existingDefaultSite) {
      await tx.businessSite.upsert({
        where: {
          organizationId_code: {
            organizationId: organization.id,
            code: "MAIN",
          },
        },
        update: { active: true, isDefault: true, deletedAt: null },
        create: {
          organizationId: organization.id,
          code: "MAIN",
          name: "본사",
          type: "HEAD_OFFICE",
          isDefault: true,
        },
      });
    }

    const permissionRows = await Promise.all(
      permissionCatalog.map(({ key, description }) =>
        tx.permission.upsert({
          where: { key },
          update: { description },
          create: { key, description },
        }),
      ),
    );
    const permissionByKey = new Map(
      permissionRows.map((permission) => [permission.key, permission]),
    );

    for (const definition of systemRoleDefinitions) {
      const role = await tx.role.upsert({
        where: {
          organizationId_key: {
            organizationId: organization.id,
            key: definition.key,
          },
        },
        update: {
          name: definition.name,
          description: definition.description,
          system: true,
          active: true,
        },
        create: {
          organizationId: organization.id,
          key: definition.key,
          name: definition.name,
          description: definition.description,
          system: true,
        },
      });
      const allowedPermissionIds = definition.permissions.map((key) => {
        const permission = permissionByKey.get(key);
        if (!permission) throw new Error(`Seed permission is missing: ${key}`);
        return permission.id;
      });
      await tx.rolePermission.deleteMany({
        where: {
          roleId: role.id,
          permissionId: { notIn: allowedPermissionIds },
        },
      });
      await Promise.all(
        allowedPermissionIds.map((permissionId) =>
          tx.rolePermission.upsert({
            where: {
              roleId_permissionId: {
                roleId: role.id,
                permissionId,
              },
            },
            update: {},
            create: {
              roleId: role.id,
              permissionId,
            },
          }),
        ),
      );
    }

    await tx.machineIntegrationConfig.upsert({
      where: { organizationId: organization.id },
      update: {
        status: "PLANNED",
        contractVersion: "placeholder-v1",
      },
      create: {
        organizationId: organization.id,
        status: "PLANNED",
        contractVersion: "placeholder-v1",
        note: "1단계에서는 항목만 제공하며 실제 기계 통신은 구현하지 않습니다.",
      },
    });

    const material = await tx.material.upsert({
      where: {
        organizationId_code: {
          organizationId: organization.id,
          code: "AL",
        },
      },
      update: {
        name: "알루미늄",
        normalizedName: "알루미늄",
        active: true,
      },
      create: {
        organizationId: organization.id,
        code: "AL",
        name: "알루미늄",
        normalizedName: "알루미늄",
        densityKgPerM3: "2700",
      },
    });

    const presets = [
      { code: "AL-1T", name: "알루미늄 1T", thickness: "1", v: "0.6", a: "0.4", noCut: "1" },
      { code: "AL-2T", name: "알루미늄 2T", thickness: "2", v: "1.2", a: "0.8", noCut: "2" },
      { code: "AL-3T", name: "알루미늄 3T", thickness: "3", v: "1.8", a: "1.2", noCut: "3" },
    ] as const;

    const pricingVariants: Array<{ id: string; code: string; material: string; bend: string; vCut: string; sheetItemId: string; ruleRevisionId: string }> = [];
    const localPriceRates = [
      { material: "20000", bend: "1000", vCut: "500" },
      { material: "30000", bend: "1200", vCut: "600" },
      { material: "40000", bend: "1500", vCut: "800" },
    ] as const;

    for (const [index, preset] of presets.entries()) {
      const variant = await tx.materialVariant.upsert({
        where: {
          organizationId_code: {
            organizationId: organization.id,
            code: preset.code,
          },
        },
        update: {
          name: preset.name,
          active: true,
        },
        create: {
          organizationId: organization.id,
          materialId: material.id,
          code: preset.code,
          name: preset.name,
          thicknessMm: preset.thickness,
          defaultInsideRadiusMm: preset.thickness,
        },
      });

      const ruleFields = {
        calculationMode: "FIXED" as const,
        elongationOption: "STANDARD" as const,
        vCutEnabled: true,
        decimalPlaces: 1,
        decimalOperation: "ROUND" as const,
        cutAngleDeg: "135",
        insideBendRadiusMm: preset.thickness,
        elongationVCutMm: preset.v,
        elongationACutMm: preset.a,
        elongationNoCutMm: preset.noCut,
        cutDepthVCutMm: "0.5",
        cutDepthACutMm: "0.5",
        cutDepthNoCutMm: "0",
        changeSummary: "로컬 기준 계산 규칙",
      };
      const contentChecksumSha256 = calculateMaterialRuleChecksum(ruleFields);
      const ruleRevision = await tx.materialRuleRevision.upsert({
        where: {
          materialVariantId_revisionNumber: {
            materialVariantId: variant.id,
            revisionNumber: 1,
          },
        },
        update: { elongationOption: "STANDARD", contentChecksumSha256 },
        create: {
          organizationId: organization.id,
          materialVariantId: variant.id,
          revisionNumber: 1,
          status: RevisionStatus.PUBLISHED,
          ...ruleFields,
          contentChecksumSha256,
          publishedAt: new Date("2026-07-19T00:00:00.000Z"),
        },
      });

      const sheetCode = `${preset.code}-SHEET-1220X2440`;
      const existingDefaultSheet = await tx.sheetItem.findFirst({
        where: { organizationId: organization.id, materialVariantId: variant.id, isDefault: true, active: true, deletedAt: null },
        select: { code: true },
      });
      const keepSeedSheetAsDefault = !existingDefaultSheet || existingDefaultSheet.code === sheetCode;
      const sheetItem = await tx.sheetItem.upsert({
        where: {
          organizationId_code: {
            organizationId: organization.id,
            code: sheetCode,
          },
        },
        update: {
          name: `${preset.name} 1220×2440 기본 원판`,
          finishName: "평판",
          normalizedFinishName: "평판",
          active: true,
          isDefault: keepSeedSheetAsDefault,
          deletedAt: null,
        },
        create: {
          organizationId: organization.id,
          materialVariantId: variant.id,
          code: sheetCode,
          name: `${preset.name} 1220×2440 기본 원판`,
          finishName: "평판",
          normalizedFinishName: "평판",
          widthMm: "1220",
          lengthMm: "2440",
          isDefault: keepSeedSheetAsDefault,
        },
      });
      const localRates = localPriceRates[index]!;
      pricingVariants.push({ id: variant.id, code: variant.code, ...localRates, sheetItemId: sheetItem.id, ruleRevisionId: ruleRevision.id });
    }

    const defaultTier = await tx.priceTier.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: "BASIC" } },
      update: { name: "기본", description: "로컬 화면 검수용 기본 가격등급", isDefault: true, active: true, deletedAt: null },
      create: { organizationId: organization.id, code: "BASIC", name: "기본", description: "로컬 화면 검수용 기본 가격등급", isDefault: true },
    });
    const preferredTier = await tx.priceTier.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: "SCREEN_PREFERRED" } },
      update: { name: "화면검수 우대", description: "LOCAL TEST ONLY / 운영 사용 금지", active: true, deletedAt: null },
      create: { organizationId: organization.id, code: "SCREEN_PREFERRED", name: "화면검수 우대", description: "LOCAL TEST ONLY / 운영 사용 금지", sortOrder: 10 },
    });
    const testCustomer = await tx.customer.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: "SCREEN-PRICE" } },
      update: { name: "화면검수 가격 거래처", normalizedName: "화면검수가격거래처", priceTierId: preferredTier.id, active: true, deletedAt: null },
      create: { organizationId: organization.id, code: "SCREEN-PRICE", name: "화면검수 가격 거래처", normalizedName: "화면검수가격거래처", type: "SALES", priceTierId: preferredTier.id, memo: "LOCAL TEST ONLY / 운영 사용 금지" },
    });

    async function ensurePublishedPriceBook(input: {
      code: string;
      name: string;
      scopeType: "STANDARD" | "TIER" | "CUSTOMER";
      priceTierId?: string;
      customerId?: string;
      rates: Array<{ materialVariantId: string; material: string; bend: string; vCut: string }>;
      includeSheetRates?: boolean;
      includeSurcharge?: boolean;
    }) {
      const book = await tx.priceBook.upsert({
        where: { organizationId_code: { organizationId: organization.id, code: input.code } },
        update: { name: input.name, active: true, deletedAt: null },
        create: { organizationId: organization.id, code: input.code, name: input.name, scopeType: input.scopeType, priceTierId: input.priceTierId, customerId: input.customerId },
      });
      const foldRates = input.rates.map((item) => ({ materialVariantId: item.materialVariantId, materialRatePerM2Krw: item.material, bendRatePerOperationKrw: item.bend, vCutRatePerMeterKrw: item.vCut }));
      const sheetRates = input.includeSheetRates
        ? pricingVariants.map((item, index) => ({ sheetItemId: item.sheetItemId, materialPricePerSheetKrw: ["47000", "65000", "88000"][index], processingPricePerSheetKrw: ["18000", "22000", "28000"][index] }))
        : [];
      const surchargePolicy = input.includeSurcharge ? { minimumBendOperations: 3, ratePercent: "10", baseType: "PROCESSING_ONLY" as const } : null;
      const fields = { changeSummary: "LOCAL TEST ONLY / 운영 사용 금지", foldRates, sheetRates, surchargePolicy };
      const revision = await tx.priceBookRevision.upsert({
        where: { priceBookId_revisionNumber: { priceBookId: book.id, revisionNumber: 1 } },
        update: { contentChecksumSha256: calculatePriceRevisionChecksum(fields), status: "PUBLISHED", effectiveFrom: new Date("2026-07-19T00:00:00.000Z") },
        create: { organizationId: organization.id, priceBookId: book.id, revisionNumber: 1, status: "PUBLISHED", changeSummary: fields.changeSummary, contentChecksumSha256: calculatePriceRevisionChecksum(fields), effectiveFrom: new Date("2026-07-19T00:00:00.000Z"), publishedAt: new Date("2026-07-19T00:00:00.000Z") },
      });
      for (const item of foldRates) {
        await tx.foldPriceRate.upsert({
          where: { priceBookRevisionId_materialVariantId: { priceBookRevisionId: revision.id, materialVariantId: item.materialVariantId } },
          update: item,
          create: { organizationId: organization.id, priceBookRevisionId: revision.id, ...item },
        });
      }
      for (const item of sheetRates) {
        await tx.sheetPriceRate.upsert({
          where: { priceBookRevisionId_sheetItemId: { priceBookRevisionId: revision.id, sheetItemId: item.sheetItemId } },
          update: item,
          create: { organizationId: organization.id, priceBookRevisionId: revision.id, ...item },
        });
      }
      if (surchargePolicy) {
        await tx.surchargePolicy.upsert({
          where: { priceBookRevisionId: revision.id },
          update: surchargePolicy,
          create: { organizationId: organization.id, priceBookRevisionId: revision.id, ...surchargePolicy },
        });
      }
    }

    await ensurePublishedPriceBook({
      code: "STANDARD",
      name: "기본 가격표 · LOCAL TEST ONLY",
      scopeType: "STANDARD",
      rates: pricingVariants.map((item) => ({ materialVariantId: item.id, material: item.material, bend: item.bend, vCut: item.vCut })),
      includeSheetRates: true,
      includeSurcharge: true,
    });
    await ensurePublishedPriceBook({
      code: "TIER-SCREEN-PREFERRED",
      name: "화면검수 우대 가격표",
      scopeType: "TIER",
      priceTierId: preferredTier.id,
      rates: [{ materialVariantId: pricingVariants[0]!.id, material: "18000", bend: "900", vCut: "450" }],
    });
    await ensurePublishedPriceBook({
      code: "CUSTOMER-SCREEN-PRICE",
      name: "화면검수 거래처 전용 가격표",
      scopeType: "CUSTOMER",
      customerId: testCustomer.id,
      rates: [{ materialVariantId: pricingVariants[0]!.id, material: "17000", bend: "800", vCut: "400" }],
    });

    void defaultTier;

    const foldCategory = await tx.foldCategory.upsert({
      where: {
        organizationId_code: {
          organizationId: organization.id,
          code: "DEFAULT",
        },
      },
      update: {
        name: "기본",
        active: true,
      },
      create: {
        organizationId: organization.id,
        code: "DEFAULT",
        name: "기본",
      },
    });

    const screenTemplate = await tx.foldTemplate.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: "SCREEN-FOLD-L" } },
      update: { name: "화면검수 ㄱ자 절곡", categoryId: foldCategory.id, active: true, deletedAt: null },
      create: { organizationId: organization.id, categoryId: foldCategory.id, code: "SCREEN-FOLD-L", name: "화면검수 ㄱ자 절곡", documentType: "NORMAL" },
    });
    const primaryRule = pricingVariants[0]!;
    const screenDocument: ServerFoldDocumentV1 = {
      schemaVersion: 1,
      documentType: "normal",
      name: "화면검수 ㄱ자 절곡",
      product: { lengthMm: "1200", quantity: 2 },
      material: {
        ruleRevisionId: primaryRule.ruleRevisionId,
        name: "알루미늄 1T",
        thicknessMm: "1",
        insideBendRadiusMm: "1",
        cutAngleDeg: "135",
        elongationMm: { vCut: "0.6", aCut: "0.4", noCut: "1" },
        cutDepthMm: { vCut: "0.5", aCut: "0.5", noCut: "0" },
      },
      calculation: { mode: "fixed", elongationOption: "standard", vCutEnabled: true, decimalPlaces: 1, decimalOperation: "round" },
      variables: [{ name: "A", valueMm: "100" }],
      blocks: [{
        id: "screen-block-1",
        name: "ㄱ자 단면",
        order: 1,
        segments: [
          { id: "screen-segment-1", order: 1, geometry: { kind: "line", start: { xMm: "0", yMm: "0" }, end: { xMm: "100", yMm: "0" }, direction: "e" }, nominalLengthMm: "100", junctionAfter: { angleDeg: "90", calculateElongation: true, cutType: "no-cut", operations: [{ direction: "front", form: "standard" }] } },
          { id: "screen-segment-2", order: 2, geometry: { kind: "line", start: { xMm: "100", yMm: "0" }, end: { xMm: "100", yMm: "80" }, direction: "n" }, nominalLengthMm: "80" },
        ],
      }],
    };
    const preparedScreenDocument = prepareSeedFoldDocument(screenDocument);
    await tx.foldRevision.upsert({
      where: { templateId_revisionNumber: { templateId: screenTemplate.id, revisionNumber: 1 } },
      update: { status: "PUBLISHED", name: screenDocument.name, publishedAt: new Date("2026-08-17T00:00:00.000Z"), deletedAt: null, ...preparedScreenDocument },
      create: { organizationId: organization.id, templateId: screenTemplate.id, revisionNumber: 1, status: "PUBLISHED", name: screenDocument.name, publishedAt: new Date("2026-08-17T00:00:00.000Z"), ...preparedScreenDocument },
    });
  });
}

seed()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error("Prisma seed failed.", error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });

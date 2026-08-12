import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { PermissionDeniedError } from "@/server/authorization/authorization";
import { disconnectPrisma, getPrisma } from "@/server/db/prisma";
import { createMaterial, createMaterialVariant } from "@/server/materials/material-service";

import {
  assignCustomerPriceTier,
  calculateManualFoldPrice,
  createPriceBook,
  createPriceRevision,
  createPriceTier,
  getPriceBookWorkspace,
  transitionPriceRevision,
  updatePriceRevision,
} from "./pricing-service";
import type { PriceRevisionFields } from "./pricing-types";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

integration.sequential("pricing integration", () => {
  let prisma: PrismaClient;
  let context: AuthenticatedContext;
  let customerId: string;
  let customerLockVersion: number;
  let primaryVariantId: string;
  let secondaryVariantId: string;
  let tierId: string;

  beforeAll(async () => {
    prisma = getPrisma();
    const organization = await prisma.organization.create({
      data: { code: "PRICE-INTEGRATION", name: "가격 통합 조직" },
    });
    const user = await prisma.user.create({
      data: {
        email: "price-integration@example.test",
        normalizedEmail: "price-integration@example.test",
        displayName: "가격 관리자",
        status: "ACTIVE",
      },
    });
    context = {
      sessionId: crypto.randomUUID(),
      userId: user.id,
      displayName: user.displayName,
      membershipId: crypto.randomUUID(),
      departmentId: null,
      organizationId: organization.id,
      organizationCode: organization.code,
      organizationName: organization.name,
      roleKeys: ["APPROVER"],
      permissions: ["pricing.read", "pricing.write", "pricing.approve", "material.read", "material.write"],
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    };
    const material = await createMaterial(prisma, context, {
      code: "PRICE-AL",
      name: "가격 알루미늄",
      densityKgPerM3: "2700",
      sortOrder: 0,
      memo: null,
      requestId: "price-material",
    });
    primaryVariantId = (await createMaterialVariant(prisma, context, {
      materialId: material.id,
      code: "PRICE-AL-1",
      name: "가격 알루미늄 1T",
      thicknessMm: "1",
      defaultInsideRadiusMm: "1",
      sortOrder: 0,
      requestId: "price-variant-1",
    })).id;
    secondaryVariantId = (await createMaterialVariant(prisma, context, {
      materialId: material.id,
      code: "PRICE-AL-2",
      name: "가격 알루미늄 2T",
      thicknessMm: "2",
      defaultInsideRadiusMm: "2",
      sortOrder: 1,
      requestId: "price-variant-2",
    })).id;
    const customer = await prisma.customer.create({
      data: {
        organizationId: organization.id,
        code: "PRICE-CUSTOMER",
        name: "가격 검증 거래처",
        normalizedName: "가격 검증 거래처",
        type: "SALES",
      },
    });
    customerId = customer.id;
    customerLockVersion = customer.lockVersion;
  });

  afterAll(async () => disconnectPrisma());

  async function publishBook(input: {
    code: string;
    name: string;
    scopeType: "STANDARD" | "TIER" | "CUSTOMER";
    priceTierId?: string;
    customerId?: string;
    fields: PriceRevisionFields;
  }) {
    const book = await createPriceBook(prisma, context, {
      ...input,
      requestId: `book-${input.code}`,
    });
    const draft = await createPriceRevision(prisma, context, {
      bookId: book.id,
      requestId: `revision-${input.code}`,
    });
    const saved = await updatePriceRevision(prisma, context, {
      ...input.fields,
      bookId: book.id,
      revisionId: draft.id,
      expectedLockVersion: draft.lockVersion,
      requestId: `save-${input.code}`,
    });
    const reviewed = await transitionPriceRevision(prisma, context, {
      bookId: book.id,
      revisionId: saved.id,
      action: "review",
      expectedLockVersion: saved.lockVersion,
      effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
      requestId: `review-${input.code}`,
    });
    return transitionPriceRevision(prisma, context, {
      bookId: book.id,
      revisionId: saved.id,
      action: "publish",
      expectedLockVersion: reviewed!.lockVersion,
      requestId: `publish-${input.code}`,
    });
  }

  it("creates a tier, assigns it with optimistic locking, and enforces permissions", async () => {
    const tier = await createPriceTier(prisma, context, {
      code: "PREFERRED",
      name: "우대",
      description: "통합 검증용",
      requestId: "tier-create",
    });
    tierId = tier.id;
    const assigned = await assignCustomerPriceTier(prisma, context, {
      customerId,
      priceTierId: tier.id,
      expectedLockVersion: customerLockVersion,
      requestId: "tier-assign",
    });
    customerLockVersion = assigned.lockVersion;
    expect(assigned.priceTierId).toBe(tier.id);
    await expect(assignCustomerPriceTier(prisma, context, {
      customerId,
      priceTierId: null,
      expectedLockVersion: 1,
      requestId: "tier-stale",
    })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(createPriceTier(prisma, { ...context, permissions: ["pricing.read"] }, {
      code: "DENIED",
      name: "거부",
      requestId: "tier-denied",
    })).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("publishes immutable standard, tier, and customer price revisions", async () => {
    const standard = await publishBook({
      code: "STANDARD",
      name: "표준 가격표",
      scopeType: "STANDARD",
      fields: {
        changeSummary: "표준 가격 최초 게시",
        foldRates: [{ materialVariantId: primaryVariantId, materialRatePerM2Krw: "100", bendRatePerOperationKrw: "10", vCutRatePerMeterKrw: "5" }],
        sheetRates: [],
        surchargePolicy: { minimumBendOperations: 3, ratePercent: "10", baseType: "PROCESSING_ONLY" },
      },
    });
    const tier = await publishBook({
      code: "TIER-PREFERRED",
      name: "우대 가격표",
      scopeType: "TIER",
      priceTierId: tierId,
      fields: {
        changeSummary: "우대 가격 최초 게시",
        foldRates: [{ materialVariantId: primaryVariantId, materialRatePerM2Krw: "80", bendRatePerOperationKrw: "8", vCutRatePerMeterKrw: "4" }],
        sheetRates: [],
        surchargePolicy: null,
      },
    });
    const customer = await publishBook({
      code: "CUSTOMER-PRICE",
      name: "거래처 전용 가격표",
      scopeType: "CUSTOMER",
      customerId,
      fields: {
        changeSummary: "다른 두께만 거래처 단가 적용",
        foldRates: [{ materialVariantId: secondaryVariantId, materialRatePerM2Krw: "60", bendRatePerOperationKrw: "6", vCutRatePerMeterKrw: "3" }],
        sheetRates: [],
        surchargePolicy: null,
      },
    });
    expect(standard).toMatchObject({ status: "PUBLISHED", effectiveStatus: "ACTIVE" });
    expect(tier).toMatchObject({ status: "PUBLISHED", effectiveStatus: "ACTIVE" });
    expect(customer).toMatchObject({ status: "PUBLISHED", effectiveStatus: "ACTIVE" });
    const tierBook = await prisma.priceBook.findFirstOrThrow({
      where: { code: "TIER-PREFERRED", organizationId: context.organizationId },
    });
    const workspace = await getPriceBookWorkspace(prisma, context, tierBook.id);
    expect(workspace.revisions[0].contentChecksumSha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(updatePriceRevision(prisma, context, {
      ...workspace.revisions[0],
      bookId: workspace.book.id,
      revisionId: workspace.revisions[0].id,
      expectedLockVersion: workspace.revisions[0].lockVersion,
      requestId: "published-update-denied",
    })).rejects.toMatchObject({ code: "PRICE_REVISION_LOCKED" });
  });

  it("resolves a complete tier row before standard and applies the independent standard surcharge policy", async () => {
    const result = await calculateManualFoldPrice(prisma, context, {
      customerId,
      materialVariantId: primaryVariantId,
      metrics: {
        version: "pricing-metrics-v1",
        areaEachM2: "1",
        bendOperationsEach: 2,
        vCutLengthEachM: "1",
        quantity: 1,
      },
    });
    expect(result.trace.foldRate.scopeType).toBe("TIER");
    expect(result.trace.surcharge?.scopeType).toBe("STANDARD");
    expect(result.amounts).toMatchObject({
      materialKrw: "80",
      bendKrw: "16",
      vCutKrw: "4",
      surchargeKrw: "2",
      supplyKrw: "102",
    });
    expect(result).toMatchObject({ preview: true, notForOrder: true });
  });
});

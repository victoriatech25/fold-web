import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { disconnectPrisma, getPrisma } from "@/server/db/prisma";
import { resolveSheetItemSnapshot } from "@/server/fold-document/sheet-item-snapshot";
import { createMaterial, createMaterialVariant } from "@/server/materials/material-service";
import type { SheetItemFields } from "./sheet-item-types";
import { createSheetItem, getSheetItemWorkspace, transitionSheetItem, updateSheetItem } from "./sheet-item-service";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const fields: SheetItemFields = {
  code: "AL-2-SHEET-1220X2440", name: "AL 2T 기본 원판", finishName: "평판",
  widthMm: "1220", lengthMm: "2440", rotationPolicy: "FREE", grainAxis: "NONE",
  trimTopMm: "10", trimRightMm: "5", trimBottomMm: "10", trimLeftMm: "5",
  weightOverrideKg: null, weightOverrideReason: null, standardPurchaseCostKrw: null,
  minRemnantWidthMm: "100", minRemnantLengthMm: "100", minRemnantAreaM2: "0.05",
  sortOrder: 0, memo: null,
};

integration.sequential("sheet item integration", () => {
  let prisma: PrismaClient;
  let context: AuthenticatedContext;
  let materialId: string;
  let variantId: string;
  let ruleId: string;

  beforeAll(async () => {
    prisma = getPrisma();
    const organization = await prisma.organization.create({ data: { code: "SHEETS", name: "원판 통합 조직" } });
    const user = await prisma.user.create({ data: { email: "sheet-integration@example.test", normalizedEmail: "sheet-integration@example.test", displayName: "원판 관리자", status: "ACTIVE" } });
    context = { sessionId: crypto.randomUUID(), userId: user.id, displayName: user.displayName, membershipId: crypto.randomUUID(), departmentId: null, organizationId: organization.id, organizationCode: organization.code, organizationName: organization.name, roleKeys: ["MATERIAL_MANAGER"], permissions: ["material.read", "material.write"], expiresAt: new Date("2027-01-01T00:00:00Z") };
    const material = await createMaterial(prisma, context, { code: "AL", name: "알루미늄", densityKgPerM3: "2700", sortOrder: 0, memo: null, requestId: "sheet-material" });
    materialId = material.id;
    const variant = await createMaterialVariant(prisma, context, { materialId, code: "AL-2", name: "알루미늄 2T", thicknessMm: "2", defaultInsideRadiusMm: "2", sortOrder: 0, requestId: "sheet-variant" });
    variantId = variant.id;
    ruleId = (await prisma.materialRuleRevision.create({ data: { organizationId: context.organizationId, materialVariantId: variantId, revisionNumber: 1, status: "PUBLISHED", calculationMode: "FIXED", vCutEnabled: true, decimalPlaces: 1, decimalOperation: "ROUND", cutAngleDeg: "135", insideBendRadiusMm: "2", elongationVCutMm: "1.2", elongationACutMm: "0.8", elongationNoCutMm: "2", cutDepthVCutMm: "0.5", cutDepthACutMm: "0.5", cutDepthNoCutMm: "0", publishedAt: new Date() } })).id;
  });

  afterAll(async () => disconnectPrisma());

  it("creates a default sheet and calculates its immutable physical snapshot", async () => {
    const created = await createSheetItem(prisma, context, { ...fields, materialId, variantId, isDefault: false, requestId: "sheet-create" });
    expect(created).toMatchObject({ isDefault: true, active: true, calculation: { usableAreaM2: "2.9282", effectiveWeightKg: "16.07472" } });
    const snapshot = await resolveSheetItemSnapshot(prisma, context.organizationId, created.id, ruleId);
    expect(snapshot).toMatchObject({ sheetItemId: created.id, materialVariantId: variantId, usableAreaM2: "2.9282" });
    await expect(updateSheetItem(prisma, context, { ...fields, widthMm: "1250", materialId, variantId, sheetItemId: created.id, expectedLockVersion: created.lockVersion, requestId: "sheet-immutable" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("enforces one active default and soft lifecycle transitions", async () => {
    const first = (await getSheetItemWorkspace(prisma, context, materialId, variantId)).items[0];
    const second = await createSheetItem(prisma, context, { ...fields, code: "AL-2-SHEET-1000X2000", name: "보조 원판", widthMm: "1000", lengthMm: "2000", materialId, variantId, isDefault: false, requestId: "sheet-second" });
    const defaulted = await transitionSheetItem(prisma, context, { materialId, variantId, sheetItemId: second.id, action: "set_default", expectedLockVersion: second.lockVersion, requestId: "sheet-default" });
    expect(defaulted.isDefault).toBe(true);
    expect((await getSheetItemWorkspace(prisma, context, materialId, variantId)).items.find((item) => item.id === first.id)?.isDefault).toBe(false);
    const inactive = await transitionSheetItem(prisma, context, { materialId, variantId, sheetItemId: defaulted.id, action: "deactivate", expectedLockVersion: defaulted.lockVersion, requestId: "sheet-off" });
    expect(inactive).toMatchObject({ active: false, isDefault: false });
    const reactivated = await transitionSheetItem(prisma, context, { materialId, variantId, sheetItemId: inactive.id, action: "reactivate", expectedLockVersion: inactive.lockVersion, requestId: "sheet-on" });
    expect(reactivated).toMatchObject({ active: true, isDefault: true });
  });
});

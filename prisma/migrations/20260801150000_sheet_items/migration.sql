CREATE TYPE "SheetRotationPolicy" AS ENUM ('FREE', 'KEEP_GRAIN');
CREATE TYPE "SheetGrainAxis" AS ENUM ('NONE', 'WIDTH', 'LENGTH');
CREATE TYPE "SheetInventoryUnit" AS ENUM ('SHEET');

CREATE TABLE "SheetItem" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "materialVariantId" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "finishName" VARCHAR(100),
    "normalizedFinishName" VARCHAR(100) NOT NULL DEFAULT '',
    "widthMm" DECIMAL(18,6) NOT NULL,
    "lengthMm" DECIMAL(18,6) NOT NULL,
    "rotationPolicy" "SheetRotationPolicy" NOT NULL DEFAULT 'FREE',
    "grainAxis" "SheetGrainAxis" NOT NULL DEFAULT 'NONE',
    "trimTopMm" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "trimRightMm" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "trimBottomMm" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "trimLeftMm" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "weightOverrideKg" DECIMAL(18,6),
    "weightOverrideReason" VARCHAR(500),
    "standardPurchaseCostKrw" DECIMAL(20,2),
    "minRemnantWidthMm" DECIMAL(18,6),
    "minRemnantLengthMm" DECIMAL(18,6),
    "minRemnantAreaM2" DECIMAL(18,6),
    "inventoryUnit" "SheetInventoryUnit" NOT NULL DEFAULT 'SHEET',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "memo" TEXT,
    "lockVersion" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SheetItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SheetItem_positive_dimensions_check" CHECK ("widthMm" > 0 AND "lengthMm" > 0),
    CONSTRAINT "SheetItem_trim_nonnegative_check" CHECK ("trimTopMm" >= 0 AND "trimRightMm" >= 0 AND "trimBottomMm" >= 0 AND "trimLeftMm" >= 0),
    CONSTRAINT "SheetItem_trim_within_dimensions_check" CHECK ("trimLeftMm" + "trimRightMm" < "widthMm" AND "trimTopMm" + "trimBottomMm" < "lengthMm"),
    CONSTRAINT "SheetItem_rotation_grain_check" CHECK (("rotationPolicy" = 'FREE' AND "grainAxis" = 'NONE') OR ("rotationPolicy" = 'KEEP_GRAIN' AND "grainAxis" IN ('WIDTH', 'LENGTH'))),
    CONSTRAINT "SheetItem_weight_override_check" CHECK (("weightOverrideKg" IS NULL AND "weightOverrideReason" IS NULL) OR ("weightOverrideKg" > 0 AND "weightOverrideReason" IS NOT NULL AND length(btrim("weightOverrideReason")) > 0)),
    CONSTRAINT "SheetItem_purchase_cost_check" CHECK ("standardPurchaseCostKrw" IS NULL OR "standardPurchaseCostKrw" >= 0),
    CONSTRAINT "SheetItem_remnant_check" CHECK (("minRemnantWidthMm" IS NULL OR "minRemnantWidthMm" > 0) AND ("minRemnantLengthMm" IS NULL OR "minRemnantLengthMm" > 0) AND ("minRemnantAreaM2" IS NULL OR "minRemnantAreaM2" > 0))
);

CREATE UNIQUE INDEX "SheetItem_organizationId_code_key" ON "SheetItem"("organizationId", "code");
CREATE UNIQUE INDEX "SheetItem_one_active_default_per_variant_key" ON "SheetItem"("materialVariantId") WHERE "isDefault" = true AND "active" = true AND "deletedAt" IS NULL;
CREATE INDEX "SheetItem_organizationId_active_deletedAt_idx" ON "SheetItem"("organizationId", "active", "deletedAt");
CREATE INDEX "SheetItem_materialVariantId_active_sortOrder_idx" ON "SheetItem"("materialVariantId", "active", "sortOrder");
CREATE INDEX "SheetItem_materialVariantId_widthMm_lengthMm_idx" ON "SheetItem"("materialVariantId", "widthMm", "lengthMm");
CREATE INDEX "SheetItem_organizationId_name_idx" ON "SheetItem"("organizationId", "name");

ALTER TABLE "SheetItem" ADD CONSTRAINT "SheetItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SheetItem" ADD CONSTRAINT "SheetItem_materialVariantId_fkey" FOREIGN KEY ("materialVariantId") REFERENCES "MaterialVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

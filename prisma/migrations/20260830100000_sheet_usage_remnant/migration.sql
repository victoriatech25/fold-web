CREATE TYPE "SheetUsageStatus" AS ENUM ('ACTIVE', 'VOID');
CREATE TYPE "SheetRemnantStatus" AS ENUM ('AVAILABLE', 'CONSUMED', 'DISCARDED');

CREATE TABLE "SheetUsageRecord" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "salesOrderId" UUID NOT NULL,
  "cuttingPlanId" UUID NOT NULL,
  "cuttingPlanRevisionId" UUID NOT NULL,
  "sheetItemId" UUID NOT NULL,
  "sheetKey" VARCHAR(150) NOT NULL,
  "sourceRemnantId" UUID,
  "status" "SheetUsageStatus" NOT NULL DEFAULT 'ACTIVE',
  "label" VARCHAR(200) NOT NULL,
  "widthMm" DECIMAL(18, 6) NOT NULL,
  "lengthMm" DECIMAL(18, 6) NOT NULL,
  "sheetCount" INTEGER NOT NULL,
  "totalAreaM2" DECIMAL(18, 8) NOT NULL,
  "placedAreaM2" DECIMAL(18, 8) NOT NULL,
  "remnantAreaM2" DECIMAL(18, 8) NOT NULL,
  "lossAreaM2" DECIMAL(18, 8) NOT NULL,
  "yieldPercent" DECIMAL(6, 2) NOT NULL,
  "unitWeightKg" DECIMAL(18, 6),
  "totalWeightKg" DECIMAL(18, 6),
  "unitCostKrw" DECIMAL(20, 2),
  "totalCostKrw" DECIMAL(20, 2),
  "voidedAt" TIMESTAMPTZ(6),
  "voidReason" VARCHAR(500),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "SheetUsageRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SheetUsageRecord_revision_sheet_key" UNIQUE ("cuttingPlanRevisionId", "sheetKey"),
  CONSTRAINT "SheetUsageRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SheetUsageRecord_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SheetUsageRecord_cuttingPlanId_fkey" FOREIGN KEY ("cuttingPlanId") REFERENCES "CuttingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SheetUsageRecord_cuttingPlanRevisionId_fkey" FOREIGN KEY ("cuttingPlanRevisionId") REFERENCES "CuttingPlanRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SheetUsageRecord_sheetItemId_fkey" FOREIGN KEY ("sheetItemId") REFERENCES "SheetItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SheetUsageRecord_quantity_check" CHECK ("sheetCount" >= 1),
  CONSTRAINT "SheetUsageRecord_area_check" CHECK (
    "totalAreaM2" >= 0 AND "placedAreaM2" >= 0 AND "remnantAreaM2" >= 0 AND "lossAreaM2" >= 0
  ),
  -- 무효 기록은 무효 시각이 함께 있어야 왜 사라졌는지 남는다(`D2-B06-F`).
  CONSTRAINT "SheetUsageRecord_void_check" CHECK (
    ("status" = 'VOID' AND "voidedAt" IS NOT NULL) OR ("status" = 'ACTIVE' AND "voidedAt" IS NULL)
  )
);

CREATE INDEX "SheetUsageRecord_organization_status_idx" ON "SheetUsageRecord"("organizationId", "status", "createdAt");
CREATE INDEX "SheetUsageRecord_sheet_item_idx" ON "SheetUsageRecord"("organizationId", "sheetItemId", "status");
CREATE INDEX "SheetUsageRecord_order_idx" ON "SheetUsageRecord"("salesOrderId");
CREATE INDEX "SheetUsageRecord_cuttingPlanId_idx" ON "SheetUsageRecord"("cuttingPlanId");

CREATE TABLE "SheetRemnant" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "sheetItemId" UUID NOT NULL,
  "materialVariantId" UUID NOT NULL,
  "code" VARCHAR(80) NOT NULL,
  "status" "SheetRemnantStatus" NOT NULL DEFAULT 'AVAILABLE',
  "widthMm" DECIMAL(18, 6) NOT NULL,
  "lengthMm" DECIMAL(18, 6) NOT NULL,
  "areaM2" DECIMAL(18, 8) NOT NULL,
  "originCuttingPlanId" UUID,
  "consumedByCuttingPlanId" UUID,
  "consumedAt" TIMESTAMPTZ(6),
  "discardedAt" TIMESTAMPTZ(6),
  "discardReason" VARCHAR(500),
  "lockVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "SheetRemnant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SheetRemnant_organization_code_key" UNIQUE ("organizationId", "code"),
  CONSTRAINT "SheetRemnant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SheetRemnant_sheetItemId_fkey" FOREIGN KEY ("sheetItemId") REFERENCES "SheetItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SheetRemnant_materialVariantId_fkey" FOREIGN KEY ("materialVariantId") REFERENCES "MaterialVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SheetRemnant_originCuttingPlanId_fkey" FOREIGN KEY ("originCuttingPlanId") REFERENCES "CuttingPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "SheetRemnant_consumedByCuttingPlanId_fkey" FOREIGN KEY ("consumedByCuttingPlanId") REFERENCES "CuttingPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "SheetRemnant_size_check" CHECK ("widthMm" > 0 AND "lengthMm" > 0 AND "areaM2" > 0 AND "lockVersion" >= 1),
  -- 소진·폐기는 시각이 함께 있어야 한다. 남아 있는 조각은 둘 다 비어 있다.
  CONSTRAINT "SheetRemnant_status_check" CHECK (
    ("status" = 'AVAILABLE' AND "consumedAt" IS NULL AND "discardedAt" IS NULL)
    OR ("status" = 'CONSUMED' AND "consumedAt" IS NOT NULL AND "discardedAt" IS NULL)
    OR ("status" = 'DISCARDED' AND "discardedAt" IS NOT NULL)
  )
);

CREATE INDEX "SheetRemnant_variant_status_idx" ON "SheetRemnant"("organizationId", "materialVariantId", "status");
CREATE INDEX "SheetRemnant_sheet_item_idx" ON "SheetRemnant"("organizationId", "sheetItemId", "status");
CREATE INDEX "SheetRemnant_originCuttingPlanId_idx" ON "SheetRemnant"("originCuttingPlanId");

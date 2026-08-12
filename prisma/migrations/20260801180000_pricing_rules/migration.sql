CREATE TYPE "PriceScopeType" AS ENUM ('STANDARD', 'TIER', 'CUSTOMER');
CREATE TYPE "SurchargeBaseType" AS ENUM ('PROCESSING_ONLY');

ALTER TABLE "Customer" ADD COLUMN "priceTierId" UUID;

CREATE TABLE "PriceTier" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "lockVersion" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "PriceTier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PriceBook" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "scopeType" "PriceScopeType" NOT NULL,
    "priceTierId" UUID,
    "customerId" UUID,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lockVersion" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "PriceBook_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PriceBook_scope_target_check" CHECK (
      ("scopeType" = 'STANDARD' AND "priceTierId" IS NULL AND "customerId" IS NULL)
      OR ("scopeType" = 'TIER' AND "priceTierId" IS NOT NULL AND "customerId" IS NULL)
      OR ("scopeType" = 'CUSTOMER' AND "priceTierId" IS NULL AND "customerId" IS NOT NULL)
    )
);

CREATE TABLE "PriceBookRevision" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "priceBookId" UUID NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "status" "RevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL DEFAULT 'KRW',
    "taxIncluded" BOOLEAN NOT NULL DEFAULT false,
    "changeSummary" VARCHAR(500),
    "contentChecksumSha256" CHAR(64),
    "effectiveFrom" TIMESTAMPTZ(6),
    "effectiveTo" TIMESTAMPTZ(6),
    "lockVersion" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" UUID,
    "updatedByUserId" UUID,
    "statusChangedByUserId" UUID,
    "deletedByUserId" UUID,
    "publishedByUserId" UUID,
    "statusChangedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(6),
    "publishedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "PriceBookRevision_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PriceBookRevision_currency_tax_check" CHECK ("currency" = 'KRW' AND "taxIncluded" = false),
    CONSTRAINT "PriceBookRevision_effective_period_check" CHECK ("effectiveTo" IS NULL OR "effectiveFrom" IS NULL OR "effectiveTo" > "effectiveFrom"),
    CONSTRAINT "PriceBookRevision_checksum_check" CHECK ("contentChecksumSha256" IS NULL OR "contentChecksumSha256" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "FoldPriceRate" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "priceBookRevisionId" UUID NOT NULL,
    "materialVariantId" UUID NOT NULL,
    "materialRatePerM2Krw" DECIMAL(20,4) NOT NULL,
    "bendRatePerOperationKrw" DECIMAL(20,4) NOT NULL,
    "vCutRatePerMeterKrw" DECIMAL(20,4) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "FoldPriceRate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FoldPriceRate_non_negative_check" CHECK (
      "materialRatePerM2Krw" >= 0 AND "bendRatePerOperationKrw" >= 0 AND "vCutRatePerMeterKrw" >= 0
    )
);

CREATE TABLE "SheetPriceRate" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "priceBookRevisionId" UUID NOT NULL,
    "sheetItemId" UUID NOT NULL,
    "materialPricePerSheetKrw" DECIMAL(20,4) NOT NULL,
    "processingPricePerSheetKrw" DECIMAL(20,4),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "SheetPriceRate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SheetPriceRate_non_negative_check" CHECK (
      "materialPricePerSheetKrw" >= 0 AND ("processingPricePerSheetKrw" IS NULL OR "processingPricePerSheetKrw" >= 0)
    )
);

CREATE TABLE "SurchargePolicy" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "priceBookRevisionId" UUID NOT NULL,
    "minimumBendOperations" INTEGER NOT NULL,
    "ratePercent" DECIMAL(9,4) NOT NULL,
    "baseType" "SurchargeBaseType" NOT NULL DEFAULT 'PROCESSING_ONLY',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "SurchargePolicy_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SurchargePolicy_values_check" CHECK (
      "minimumBendOperations" BETWEEN 0 AND 999 AND "ratePercent" >= 0 AND "ratePercent" <= 100 AND "baseType" = 'PROCESSING_ONLY'
    )
);

CREATE UNIQUE INDEX "PriceTier_organizationId_code_key" ON "PriceTier"("organizationId", "code");
CREATE UNIQUE INDEX "PriceTier_one_active_default_idx" ON "PriceTier"("organizationId") WHERE "isDefault" = true AND "active" = true AND "deletedAt" IS NULL;
CREATE INDEX "PriceTier_organizationId_active_deletedAt_idx" ON "PriceTier"("organizationId", "active", "deletedAt");
CREATE INDEX "PriceTier_organizationId_isDefault_idx" ON "PriceTier"("organizationId", "isDefault");

CREATE UNIQUE INDEX "PriceBook_organizationId_code_key" ON "PriceBook"("organizationId", "code");
CREATE UNIQUE INDEX "PriceBook_one_active_standard_idx" ON "PriceBook"("organizationId") WHERE "scopeType" = 'STANDARD' AND "active" = true AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX "PriceBook_one_active_tier_idx" ON "PriceBook"("organizationId", "priceTierId") WHERE "scopeType" = 'TIER' AND "active" = true AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX "PriceBook_one_active_customer_idx" ON "PriceBook"("organizationId", "customerId") WHERE "scopeType" = 'CUSTOMER' AND "active" = true AND "deletedAt" IS NULL;
CREATE INDEX "PriceBook_organizationId_scopeType_active_deletedAt_idx" ON "PriceBook"("organizationId", "scopeType", "active", "deletedAt");
CREATE INDEX "PriceBook_priceTierId_idx" ON "PriceBook"("priceTierId");
CREATE INDEX "PriceBook_customerId_idx" ON "PriceBook"("customerId");

CREATE UNIQUE INDEX "PriceBookRevision_priceBookId_revisionNumber_key" ON "PriceBookRevision"("priceBookId", "revisionNumber");
CREATE UNIQUE INDEX "PriceBookRevision_one_open_revision_idx" ON "PriceBookRevision"("priceBookId") WHERE "status" IN ('DRAFT', 'REVIEW') AND "deletedAt" IS NULL;
CREATE INDEX "PriceBookRevision_organizationId_status_idx" ON "PriceBookRevision"("organizationId", "status");
CREATE INDEX "PriceBookRevision_priceBookId_status_effectiveFrom_idx" ON "PriceBookRevision"("priceBookId", "status", "effectiveFrom");
CREATE INDEX "PriceBookRevision_createdByUserId_idx" ON "PriceBookRevision"("createdByUserId");
CREATE INDEX "PriceBookRevision_updatedByUserId_idx" ON "PriceBookRevision"("updatedByUserId");
CREATE INDEX "PriceBookRevision_statusChangedByUserId_idx" ON "PriceBookRevision"("statusChangedByUserId");
CREATE INDEX "PriceBookRevision_deletedByUserId_idx" ON "PriceBookRevision"("deletedByUserId");
CREATE INDEX "PriceBookRevision_publishedByUserId_idx" ON "PriceBookRevision"("publishedByUserId");

CREATE UNIQUE INDEX "FoldPriceRate_priceBookRevisionId_materialVariantId_key" ON "FoldPriceRate"("priceBookRevisionId", "materialVariantId");
CREATE INDEX "FoldPriceRate_organizationId_materialVariantId_idx" ON "FoldPriceRate"("organizationId", "materialVariantId");
CREATE INDEX "FoldPriceRate_materialVariantId_idx" ON "FoldPriceRate"("materialVariantId");

CREATE UNIQUE INDEX "SheetPriceRate_priceBookRevisionId_sheetItemId_key" ON "SheetPriceRate"("priceBookRevisionId", "sheetItemId");
CREATE INDEX "SheetPriceRate_organizationId_sheetItemId_idx" ON "SheetPriceRate"("organizationId", "sheetItemId");
CREATE INDEX "SheetPriceRate_sheetItemId_idx" ON "SheetPriceRate"("sheetItemId");

CREATE UNIQUE INDEX "SurchargePolicy_priceBookRevisionId_key" ON "SurchargePolicy"("priceBookRevisionId");
CREATE INDEX "SurchargePolicy_organizationId_idx" ON "SurchargePolicy"("organizationId");
CREATE INDEX "Customer_priceTierId_idx" ON "Customer"("priceTierId");

ALTER TABLE "Customer" ADD CONSTRAINT "Customer_priceTierId_fkey" FOREIGN KEY ("priceTierId") REFERENCES "PriceTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PriceTier" ADD CONSTRAINT "PriceTier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceBook" ADD CONSTRAINT "PriceBook_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceBook" ADD CONSTRAINT "PriceBook_priceTierId_fkey" FOREIGN KEY ("priceTierId") REFERENCES "PriceTier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceBook" ADD CONSTRAINT "PriceBook_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceBookRevision" ADD CONSTRAINT "PriceBookRevision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceBookRevision" ADD CONSTRAINT "PriceBookRevision_priceBookId_fkey" FOREIGN KEY ("priceBookId") REFERENCES "PriceBook"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceBookRevision" ADD CONSTRAINT "PriceBookRevision_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PriceBookRevision" ADD CONSTRAINT "PriceBookRevision_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PriceBookRevision" ADD CONSTRAINT "PriceBookRevision_statusChangedByUserId_fkey" FOREIGN KEY ("statusChangedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PriceBookRevision" ADD CONSTRAINT "PriceBookRevision_deletedByUserId_fkey" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PriceBookRevision" ADD CONSTRAINT "PriceBookRevision_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FoldPriceRate" ADD CONSTRAINT "FoldPriceRate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoldPriceRate" ADD CONSTRAINT "FoldPriceRate_priceBookRevisionId_fkey" FOREIGN KEY ("priceBookRevisionId") REFERENCES "PriceBookRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FoldPriceRate" ADD CONSTRAINT "FoldPriceRate_materialVariantId_fkey" FOREIGN KEY ("materialVariantId") REFERENCES "MaterialVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SheetPriceRate" ADD CONSTRAINT "SheetPriceRate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SheetPriceRate" ADD CONSTRAINT "SheetPriceRate_priceBookRevisionId_fkey" FOREIGN KEY ("priceBookRevisionId") REFERENCES "PriceBookRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SheetPriceRate" ADD CONSTRAINT "SheetPriceRate_sheetItemId_fkey" FOREIGN KEY ("sheetItemId") REFERENCES "SheetItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SurchargePolicy" ADD CONSTRAINT "SurchargePolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SurchargePolicy" ADD CONSTRAINT "SurchargePolicy_priceBookRevisionId_fkey" FOREIGN KEY ("priceBookRevisionId") REFERENCES "PriceBookRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

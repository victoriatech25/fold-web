ALTER TABLE "SalesOrder"
ADD COLUMN "nextCalculationNumber" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "SalesOrder"
ADD CONSTRAINT "SalesOrder_next_calculation_number_check"
CHECK ("nextCalculationNumber" BETWEEN 1 AND 2147483647);

CREATE TABLE "SalesOrderCalculationSnapshot" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "salesOrderId" UUID NOT NULL,
  "snapshotNumber" INTEGER NOT NULL,
  "inputChecksumSha256" CHAR(64) NOT NULL,
  "resultChecksumSha256" CHAR(64) NOT NULL,
  "pricingEngineVersion" VARCHAR(50) NOT NULL,
  "pricingMetricsVersion" VARCHAR(50) NOT NULL,
  "priceEffectiveAt" TIMESTAMPTZ(6) NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'KRW',
  "vatRatePercent" DECIMAL(9,4) NOT NULL DEFAULT 10,
  "supplyAmountKrw" DECIMAL(20,0) NOT NULL,
  "vatAmountKrw" DECIMAL(20,0) NOT NULL,
  "totalAmountKrw" DECIMAL(20,0) NOT NULL,
  "itemCount" INTEGER NOT NULL,
  "createdByMembershipId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalesOrderCalculationSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SalesOrderCalculationSnapshot_salesOrderId_snapshotNumber_key" UNIQUE ("salesOrderId", "snapshotNumber"),
  CONSTRAINT "SalesOrderCalculationSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesOrderCalculationSnapshot_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesOrderCalculationSnapshot_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "OrganizationMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesOrderCalculationSnapshot_checksum_format_check" CHECK (
    "inputChecksumSha256" ~ '^[a-f0-9]{64}$' AND "resultChecksumSha256" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "SalesOrderCalculationSnapshot_amount_check" CHECK (
    "snapshotNumber" > 0 AND "itemCount" > 0 AND "currency" = 'KRW'
    AND "vatRatePercent" = 10 AND "supplyAmountKrw" >= 0
    AND "vatAmountKrw" >= 0 AND "totalAmountKrw" = "supplyAmountKrw" + "vatAmountKrw"
  )
);

CREATE INDEX "SalesOrderCalculationSnapshot_organizationId_salesOrderId_snapshotNumber_idx"
ON "SalesOrderCalculationSnapshot"("organizationId", "salesOrderId", "snapshotNumber");
CREATE INDEX "SalesOrderCalculationSnapshot_createdByMembershipId_idx"
ON "SalesOrderCalculationSnapshot"("createdByMembershipId");

CREATE TABLE "SalesOrderFoldCalculationSnapshot" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "orderCalculationSnapshotId" UUID NOT NULL,
  "salesOrderFoldItemId" UUID NOT NULL,
  "lineNumber" INTEGER NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "materialRuleRevisionId" UUID NOT NULL,
  "itemDocumentChecksumSha256" CHAR(64) NOT NULL,
  "inputChecksumSha256" CHAR(64) NOT NULL,
  "resultChecksumSha256" CHAR(64) NOT NULL,
  "metrics" JSONB NOT NULL,
  "pricingResult" JSONB NOT NULL,
  "materialAmountKrw" DECIMAL(20,0) NOT NULL,
  "bendAmountKrw" DECIMAL(20,0) NOT NULL,
  "vCutAmountKrw" DECIMAL(20,0) NOT NULL,
  "surchargeAmountKrw" DECIMAL(20,0) NOT NULL,
  "supplyAmountKrw" DECIMAL(20,0) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalesOrderFoldCalculationSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SalesOrderFoldCalculationSnapshot_order_item_key" UNIQUE ("orderCalculationSnapshotId", "salesOrderFoldItemId"),
  CONSTRAINT "SalesOrderFoldCalculationSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesOrderFoldCalculationSnapshot_orderCalculationSnapshotId_fkey" FOREIGN KEY ("orderCalculationSnapshotId") REFERENCES "SalesOrderCalculationSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SalesOrderFoldCalculationSnapshot_salesOrderFoldItemId_fkey" FOREIGN KEY ("salesOrderFoldItemId") REFERENCES "SalesOrderFoldItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesOrderFoldCalculationSnapshot_checksum_format_check" CHECK (
    "itemDocumentChecksumSha256" ~ '^[a-f0-9]{64}$'
    AND "inputChecksumSha256" ~ '^[a-f0-9]{64}$'
    AND "resultChecksumSha256" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "SalesOrderFoldCalculationSnapshot_amount_check" CHECK (
    "lineNumber" > 0 AND "quantity" BETWEEN 1 AND 1000000
    AND "materialAmountKrw" >= 0 AND "bendAmountKrw" >= 0
    AND "vCutAmountKrw" >= 0 AND "surchargeAmountKrw" >= 0
    AND "supplyAmountKrw" = "materialAmountKrw" + "bendAmountKrw" + "vCutAmountKrw" + "surchargeAmountKrw"
  )
);

CREATE INDEX "SalesOrderFoldCalculationSnapshot_order_line_idx"
ON "SalesOrderFoldCalculationSnapshot"("organizationId", "orderCalculationSnapshotId", "lineNumber");
CREATE INDEX "SalesOrderFoldCalculationSnapshot_salesOrderFoldItemId_idx"
ON "SalesOrderFoldCalculationSnapshot"("salesOrderFoldItemId");

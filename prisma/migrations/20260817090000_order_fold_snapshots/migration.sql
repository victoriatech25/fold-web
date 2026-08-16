ALTER TABLE "SalesOrder"
ADD COLUMN "partySnapshotSchemaVersion" INTEGER,
ADD COLUMN "partySnapshot" JSONB,
ADD COLUMN "partySnapshotChecksumSha256" CHAR(64),
ADD COLUMN "partySnapshotCapturedAt" TIMESTAMPTZ(6),
ADD COLUMN "nextFoldLineNumber" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "SalesOrder"
ADD CONSTRAINT "SalesOrder_party_snapshot_state_check"
CHECK (
  (
    "partySnapshotSchemaVersion" IS NULL
    AND "partySnapshot" IS NULL
    AND "partySnapshotChecksumSha256" IS NULL
    AND "partySnapshotCapturedAt" IS NULL
  )
  OR
  (
    "partySnapshotSchemaVersion" = 1
    AND "partySnapshot" IS NOT NULL
    AND "partySnapshotChecksumSha256" ~ '^[a-f0-9]{64}$'
    AND "partySnapshotCapturedAt" IS NOT NULL
  )
);

ALTER TABLE "SalesOrder"
ADD CONSTRAINT "SalesOrder_next_fold_line_number_check"
CHECK ("nextFoldLineNumber" BETWEEN 1 AND 2147483647);

CREATE TABLE "SalesOrderFoldItem" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "salesOrderId" UUID NOT NULL,
  "lineNumber" INTEGER NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "sourceFoldTemplateId" UUID NOT NULL,
  "sourceFoldRevisionId" UUID NOT NULL,
  "sourceTemplateCode" VARCHAR(50) NOT NULL,
  "sourceTemplateName" VARCHAR(200) NOT NULL,
  "sourceRevisionNumber" INTEGER NOT NULL,
  "sourceDocumentChecksumSha256" CHAR(64) NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "materialRuleRevisionId" UUID NOT NULL,
  "sheetItemId" UUID,
  "documentSchemaVersion" INTEGER NOT NULL,
  "document" JSONB NOT NULL,
  "documentChecksumSha256" CHAR(64) NOT NULL,
  "lockVersion" INTEGER NOT NULL DEFAULT 1,
  "createdByMembershipId" UUID NOT NULL,
  "updatedByMembershipId" UUID NOT NULL,
  "removedByMembershipId" UUID,
  "removedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "SalesOrderFoldItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SalesOrderFoldItem_salesOrderId_lineNumber_key" UNIQUE ("salesOrderId", "lineNumber"),
  CONSTRAINT "SalesOrderFoldItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesOrderFoldItem_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesOrderFoldItem_sourceFoldTemplateId_fkey" FOREIGN KEY ("sourceFoldTemplateId") REFERENCES "FoldTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesOrderFoldItem_sourceFoldRevisionId_fkey" FOREIGN KEY ("sourceFoldRevisionId") REFERENCES "FoldRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesOrderFoldItem_materialRuleRevisionId_fkey" FOREIGN KEY ("materialRuleRevisionId") REFERENCES "MaterialRuleRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesOrderFoldItem_sheetItemId_fkey" FOREIGN KEY ("sheetItemId") REFERENCES "SheetItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesOrderFoldItem_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "OrganizationMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesOrderFoldItem_updatedByMembershipId_fkey" FOREIGN KEY ("updatedByMembershipId") REFERENCES "OrganizationMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesOrderFoldItem_removedByMembershipId_fkey" FOREIGN KEY ("removedByMembershipId") REFERENCES "OrganizationMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesOrderFoldItem_positive_values_check" CHECK (
    "lineNumber" > 0 AND "sortOrder" > 0 AND "sourceRevisionNumber" > 0
    AND "quantity" BETWEEN 1 AND 1000000 AND "lockVersion" > 0
  ),
  CONSTRAINT "SalesOrderFoldItem_checksum_format_check" CHECK (
    "sourceDocumentChecksumSha256" ~ '^[a-f0-9]{64}$'
    AND "documentChecksumSha256" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "SalesOrderFoldItem_removal_state_check" CHECK (
    ("removedAt" IS NULL AND "removedByMembershipId" IS NULL)
    OR ("removedAt" IS NOT NULL AND "removedByMembershipId" IS NOT NULL)
  )
);

CREATE INDEX "SalesOrderFoldItem_order_active_sort_idx"
ON "SalesOrderFoldItem"("organizationId", "salesOrderId", "removedAt", "sortOrder", "id");
CREATE INDEX "SalesOrderFoldItem_sourceFoldTemplateId_idx" ON "SalesOrderFoldItem"("sourceFoldTemplateId");
CREATE INDEX "SalesOrderFoldItem_sourceFoldRevisionId_idx" ON "SalesOrderFoldItem"("sourceFoldRevisionId");
CREATE INDEX "SalesOrderFoldItem_materialRuleRevisionId_idx" ON "SalesOrderFoldItem"("materialRuleRevisionId");
CREATE INDEX "SalesOrderFoldItem_sheetItemId_idx" ON "SalesOrderFoldItem"("sheetItemId");

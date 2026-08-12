CREATE TYPE "MaterialElongationOption" AS ENUM ('STANDARD', 'TWO_LINE', 'DIAGONAL', 'EXT1');

ALTER TABLE "MaterialRuleRevision"
  ADD COLUMN "elongationOption" "MaterialElongationOption" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "changeSummary" VARCHAR(500),
  ADD COLUMN "contentChecksumSha256" CHAR(64),
  ADD COLUMN "lockVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "updatedByUserId" UUID,
  ADD COLUMN "statusChangedByUserId" UUID,
  ADD COLUMN "deletedByUserId" UUID,
  ADD COLUMN "statusChangedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "deletedAt" TIMESTAMPTZ(6),
  ADD COLUMN "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "MaterialRuleRevision"
  ADD CONSTRAINT "MaterialRuleRevision_updatedByUserId_fkey"
    FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "MaterialRuleRevision_statusChangedByUserId_fkey"
    FOREIGN KEY ("statusChangedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "MaterialRuleRevision_deletedByUserId_fkey"
    FOREIGN KEY ("deletedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "MaterialRuleRevision_updatedByUserId_idx" ON "MaterialRuleRevision"("updatedByUserId");
CREATE INDEX "MaterialRuleRevision_statusChangedByUserId_idx" ON "MaterialRuleRevision"("statusChangedByUserId");
CREATE INDEX "MaterialRuleRevision_deletedByUserId_idx" ON "MaterialRuleRevision"("deletedByUserId");
CREATE INDEX "MaterialRuleRevision_materialVariantId_effectiveFrom_effectiveTo_idx"
  ON "MaterialRuleRevision"("materialVariantId", "effectiveFrom", "effectiveTo");

CREATE UNIQUE INDEX "MaterialRuleRevision_one_open_revision_idx"
  ON "MaterialRuleRevision"("materialVariantId")
  WHERE "status" IN ('DRAFT', 'REVIEW') AND "deletedAt" IS NULL;

ALTER TABLE "MaterialRuleRevision"
  ADD CONSTRAINT "MaterialRuleRevision_decimalPlaces_check"
    CHECK ("decimalPlaces" BETWEEN 0 AND 6),
  ADD CONSTRAINT "MaterialRuleRevision_cutAngleDeg_check"
    CHECK ("cutAngleDeg" > 0 AND "cutAngleDeg" <= 180),
  ADD CONSTRAINT "MaterialRuleRevision_values_non_negative_check"
    CHECK (
      "insideBendRadiusMm" >= 0
      AND "elongationVCutMm" >= 0
      AND "elongationACutMm" >= 0
      AND "elongationNoCutMm" >= 0
      AND "cutDepthVCutMm" >= 0
      AND "cutDepthACutMm" >= 0
      AND "cutDepthNoCutMm" >= 0
    ),
  ADD CONSTRAINT "MaterialRuleRevision_effective_period_check"
    CHECK ("effectiveTo" IS NULL OR "effectiveFrom" IS NULL OR "effectiveTo" > "effectiveFrom"),
  ADD CONSTRAINT "MaterialRuleRevision_checksum_check"
    CHECK ("contentChecksumSha256" IS NULL OR "contentChecksumSha256" ~ '^[0-9a-f]{64}$');

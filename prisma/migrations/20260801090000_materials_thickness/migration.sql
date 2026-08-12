ALTER TABLE "Material"
  ADD COLUMN "normalizedName" VARCHAR(100),
  ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "memo" TEXT,
  ADD COLUMN "lockVersion" INTEGER NOT NULL DEFAULT 1;

UPDATE "Material"
SET "normalizedName" = LOWER(REGEXP_REPLACE(TRIM("name"), '\\s+', ' ', 'g'));

ALTER TABLE "Material"
  ALTER COLUMN "normalizedName" SET NOT NULL;

ALTER TABLE "MaterialVariant"
  ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lockVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "MaterialRuleRevision"
  ADD COLUMN "insideBendRadiusMm" DECIMAL(18,6);

UPDATE "MaterialRuleRevision" AS revision
SET "insideBendRadiusMm" = variant."defaultInsideRadiusMm"
FROM "MaterialVariant" AS variant
WHERE variant."id" = revision."materialVariantId";

ALTER TABLE "MaterialRuleRevision"
  ALTER COLUMN "insideBendRadiusMm" SET NOT NULL;

CREATE UNIQUE INDEX "Material_organizationId_normalizedName_key"
  ON "Material"("organizationId", "normalizedName");
CREATE INDEX "Material_organizationId_sortOrder_normalizedName_idx"
  ON "Material"("organizationId", "sortOrder", "normalizedName");
CREATE INDEX "MaterialVariant_materialId_sortOrder_thicknessMm_idx"
  ON "MaterialVariant"("materialId", "sortOrder", "thicknessMm");

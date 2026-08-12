ALTER TABLE "MaterialRuleRevision"
  ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER INDEX "MaterialRuleRevision_materialVariantId_effectiveFrom_effectiveT"
  RENAME TO "MaterialRuleRevision_effective_period_idx";

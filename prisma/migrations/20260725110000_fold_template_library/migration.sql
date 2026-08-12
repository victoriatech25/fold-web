CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "FoldCategory"
  ADD COLUMN "lockVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "deletedAt" TIMESTAMPTZ(6);

ALTER TABLE "FoldTemplate"
  ADD COLUMN "lockVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "FoldRevision"
  ADD COLUMN "statusChangedByUserId" UUID,
  ADD COLUMN "deletedByUserId" UUID,
  ADD COLUMN "statusChangedAt" TIMESTAMPTZ(6),
  ADD COLUMN "deletedAt" TIMESTAMPTZ(6);

UPDATE "FoldRevision"
SET
  "statusChangedAt" = "updatedAt",
  "statusChangedByUserId" = "updatedByUserId";

ALTER TABLE "FoldRevision"
  ALTER COLUMN "statusChangedAt" SET NOT NULL,
  ALTER COLUMN "statusChangedAt" SET DEFAULT CURRENT_TIMESTAMP;

UPDATE "FoldTemplate"
SET "code" = 'FOLD-' || SUBSTRING("code" FROM 7)
WHERE "code" LIKE 'DRAFT-%';

ALTER TABLE "FoldCategory"
  ADD CONSTRAINT "FoldCategory_lockVersion_positive" CHECK ("lockVersion" > 0);

ALTER TABLE "FoldTemplate"
  ADD CONSTRAINT "FoldTemplate_lockVersion_positive" CHECK ("lockVersion" > 0);

ALTER TABLE "FoldRevision"
  ADD CONSTRAINT "FoldRevision_revisionNumber_positive" CHECK ("revisionNumber" > 0),
  ADD CONSTRAINT "FoldRevision_statusChangedByUserId_fkey"
    FOREIGN KEY ("statusChangedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "FoldRevision_deletedByUserId_fkey"
    FOREIGN KEY ("deletedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "FoldRevision_statusChangedByUserId_idx"
  ON "FoldRevision"("statusChangedByUserId");

CREATE INDEX "FoldRevision_deletedByUserId_idx"
  ON "FoldRevision"("deletedByUserId");

CREATE INDEX "FoldTemplate_library_cursor_idx"
  ON "FoldTemplate"("organizationId", "categoryId", "updatedAt" DESC, "id" DESC);

CREATE INDEX "FoldRevision_template_history_idx"
  ON "FoldRevision"("templateId", "revisionNumber" DESC);

CREATE INDEX "FoldRevision_status_cursor_idx"
  ON "FoldRevision"("organizationId", "status", "updatedAt" DESC, "id" DESC);

CREATE UNIQUE INDEX "FoldRevision_one_working_revision_per_template"
  ON "FoldRevision"("templateId")
  WHERE "deletedAt" IS NULL AND "status" IN ('DRAFT', 'REVIEW');

CREATE UNIQUE INDEX "FoldRevision_one_published_revision_per_template"
  ON "FoldRevision"("templateId")
  WHERE "deletedAt" IS NULL AND "status" = 'PUBLISHED';

CREATE UNIQUE INDEX "FoldTemplate_active_category_name_unique"
  ON "FoldTemplate"(
    "organizationId",
    COALESCE("categoryId", '00000000-0000-0000-0000-000000000000'::uuid),
    LOWER("name")
  )
  WHERE "deletedAt" IS NULL;

CREATE INDEX "FoldTemplate_name_trgm_idx"
  ON "FoldTemplate" USING GIN ("name" gin_trgm_ops);

CREATE INDEX "FoldTemplate_code_trgm_idx"
  ON "FoldTemplate" USING GIN ("code" gin_trgm_ops);

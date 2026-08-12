ALTER TABLE "FoldRevision"
ADD COLUMN "lockVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "updatedByUserId" UUID;

UPDATE "FoldRevision"
SET "updatedByUserId" = "createdByUserId"
WHERE "updatedByUserId" IS NULL;

ALTER TABLE "FoldRevision"
ADD CONSTRAINT "FoldRevision_lockVersion_positive_check"
CHECK ("lockVersion" > 0);

CREATE INDEX "FoldRevision_updatedByUserId_idx"
ON "FoldRevision"("updatedByUserId");

ALTER TABLE "FoldRevision"
ADD CONSTRAINT "FoldRevision_updatedByUserId_fkey"
FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

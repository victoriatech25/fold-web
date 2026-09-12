-- 편집기에서 저장한 재단 개정을 구분한다(`P2-B11`).
--
-- `source` 가 `MANUAL_EDIT` 인 개정은 큐를 타지 않고 곧바로 결과를 가진다.
-- `baseRevisionId` 는 편집의 출발점, `annotations` 는 레이저 그룹·가로선·필름 지정,
-- `warnings` 는 저장을 허용한 guillotine·kerf 경고다(`D2-B11-C`·`D2-B11-G`).
CREATE TYPE "CuttingRevisionSource" AS ENUM ('SOLVER', 'MANUAL_EDIT');

ALTER TABLE "CuttingPlanRevision"
  ADD COLUMN "annotations" JSONB,
  ADD COLUMN "baseRevisionId" UUID,
  ADD COLUMN "source" "CuttingRevisionSource" NOT NULL DEFAULT 'SOLVER',
  ADD COLUMN "warnings" JSONB;

CREATE INDEX "CuttingPlanRevision_baseRevisionId_idx" ON "CuttingPlanRevision"("baseRevisionId");

ALTER TABLE "CuttingPlanRevision"
  ADD CONSTRAINT "CuttingPlanRevision_baseRevisionId_fkey"
  FOREIGN KEY ("baseRevisionId") REFERENCES "CuttingPlanRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

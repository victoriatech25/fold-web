-- 재단 개정의 원판 DXF 파일과 파일명 순번(`P2-B11` 4.7).
--
-- 원판 DXF·레이저 그룹 DXF·zip 은 FileAsset 으로 보관하고 어느 재단 개정의 것인지
-- `cuttingPlanRevisionId` 로 묶는다. 파일명의 당일 순번은 MFC 가 PC 레지스트리로 세던
-- 것을 조직·날짜 단위로 서버에서 센다.
ALTER TABLE "FileAsset" ADD COLUMN "cuttingPlanRevisionId" UUID;

CREATE TABLE "CuttingDxfSequence" (
    "organizationId" UUID NOT NULL,
    "dateKey" CHAR(6) NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "CuttingDxfSequence_pkey" PRIMARY KEY ("organizationId","dateKey")
);

CREATE INDEX "FileAsset_cuttingPlanRevisionId_idx" ON "FileAsset"("cuttingPlanRevisionId");

ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_cuttingPlanRevisionId_fkey"
  FOREIGN KEY ("cuttingPlanRevisionId") REFERENCES "CuttingPlanRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CuttingDxfSequence" ADD CONSTRAINT "CuttingDxfSequence_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TYPE "CuttingPlanStatus" AS ENUM ('PENDING', 'CALCULATED', 'APPROVED', 'FAILED');
CREATE TYPE "CuttingPlanRevisionStatus" AS ENUM ('QUEUED', 'SUCCEEDED', 'FAILED');

CREATE TABLE "CuttingPlan" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "salesOrderId" UUID NOT NULL,
  "materialVariantId" UUID NOT NULL,
  "status" "CuttingPlanStatus" NOT NULL DEFAULT 'PENDING',
  "contractVersion" VARCHAR(50) NOT NULL,
  "input" JSONB NOT NULL,
  "inputChecksumSha256" CHAR(64) NOT NULL,
  "nextRevisionNumber" INTEGER NOT NULL DEFAULT 1,
  "currentRevisionId" UUID,
  "approvedRevisionId" UUID,
  "approvedAt" TIMESTAMPTZ(6),
  "approvedByMembershipId" UUID,
  "lockVersion" INTEGER NOT NULL DEFAULT 1,
  "createdByMembershipId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "CuttingPlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CuttingPlan_salesOrderId_materialVariantId_key" UNIQUE ("salesOrderId", "materialVariantId"),
  CONSTRAINT "CuttingPlan_currentRevisionId_key" UNIQUE ("currentRevisionId"),
  CONSTRAINT "CuttingPlan_approvedRevisionId_key" UNIQUE ("approvedRevisionId"),
  CONSTRAINT "CuttingPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CuttingPlan_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CuttingPlan_materialVariantId_fkey" FOREIGN KEY ("materialVariantId") REFERENCES "MaterialVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CuttingPlan_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "OrganizationMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CuttingPlan_approvedByMembershipId_fkey" FOREIGN KEY ("approvedByMembershipId") REFERENCES "OrganizationMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CuttingPlan_revision_counter_check" CHECK ("nextRevisionNumber" >= 1 AND "lockVersion" >= 1),
  -- 승인은 승인 개정·승인자·승인 시각이 함께 있어야 성립한다(`D2-B05-G`).
  CONSTRAINT "CuttingPlan_approval_check" CHECK (
    ("status" = 'APPROVED' AND "approvedRevisionId" IS NOT NULL AND "approvedAt" IS NOT NULL AND "approvedByMembershipId" IS NOT NULL)
    OR
    ("status" <> 'APPROVED' AND "approvedRevisionId" IS NULL AND "approvedAt" IS NULL AND "approvedByMembershipId" IS NULL)
  )
);

CREATE INDEX "CuttingPlan_organization_status_idx" ON "CuttingPlan"("organizationId", "status", "updatedAt");
CREATE INDEX "CuttingPlan_organization_order_idx" ON "CuttingPlan"("organizationId", "salesOrderId");

CREATE TABLE "CuttingPlanRevision" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "cuttingPlanId" UUID NOT NULL,
  "revisionNumber" INTEGER NOT NULL,
  "status" "CuttingPlanRevisionStatus" NOT NULL DEFAULT 'QUEUED',
  "jobId" UUID,
  "pins" JSONB NOT NULL,
  "engineVersion" VARCHAR(50),
  "result" JSONB,
  "sheetCount" INTEGER,
  "usedAreaM2" DECIMAL(18, 8),
  "totalAreaM2" DECIMAL(18, 8),
  "yieldPercent" DECIMAL(6, 2),
  "unplacedQuantity" INTEGER,
  "failureReason" VARCHAR(500),
  "createdByMembershipId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "CuttingPlanRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CuttingPlanRevision_plan_revision_key" UNIQUE ("cuttingPlanId", "revisionNumber"),
  CONSTRAINT "CuttingPlanRevision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CuttingPlanRevision_cuttingPlanId_fkey" FOREIGN KEY ("cuttingPlanId") REFERENCES "CuttingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CuttingPlanRevision_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobQueue"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CuttingPlanRevision_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "OrganizationMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CuttingPlanRevision_number_check" CHECK ("revisionNumber" >= 1),
  -- 성공한 개정은 결과와 요약을 모두 갖는다. 실패한 개정은 사유를 갖는다.
  CONSTRAINT "CuttingPlanRevision_outcome_check" CHECK (
    ("status" = 'SUCCEEDED' AND "result" IS NOT NULL AND "sheetCount" IS NOT NULL AND "yieldPercent" IS NOT NULL AND "unplacedQuantity" IS NOT NULL AND "engineVersion" IS NOT NULL)
    OR
    ("status" = 'FAILED' AND "failureReason" IS NOT NULL)
    OR
    ("status" = 'QUEUED' AND "result" IS NULL AND "failureReason" IS NULL)
  )
);

CREATE INDEX "CuttingPlanRevision_plan_number_idx" ON "CuttingPlanRevision"("organizationId", "cuttingPlanId", "revisionNumber");
CREATE INDEX "CuttingPlanRevision_jobId_idx" ON "CuttingPlanRevision"("jobId");

ALTER TABLE "CuttingPlan"
  ADD CONSTRAINT "CuttingPlan_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "CuttingPlanRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CuttingPlan_approvedRevisionId_fkey" FOREIGN KEY ("approvedRevisionId") REFERENCES "CuttingPlanRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

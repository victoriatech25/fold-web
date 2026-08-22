CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

CREATE TABLE "JobQueue" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "type" VARCHAR(100) NOT NULL,
  "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
  "idempotencyKey" VARCHAR(200) NOT NULL,
  "payload" JSONB NOT NULL,
  "result" JSONB,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "progressPercent" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMPTZ(6),
  "finishedAt" TIMESTAMPTZ(6),
  "leaseExpiresAt" TIMESTAMPTZ(6),
  "lockedBy" VARCHAR(120),
  "cancelRequestedAt" TIMESTAMPTZ(6),
  "lastError" VARCHAR(1000),
  "requestedByMembershipId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "JobQueue_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JobQueue_organizationId_type_idempotencyKey_key" UNIQUE ("organizationId", "type", "idempotencyKey"),
  CONSTRAINT "JobQueue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "JobQueue_requestedByMembershipId_fkey" FOREIGN KEY ("requestedByMembershipId") REFERENCES "OrganizationMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "JobQueue_counter_check" CHECK (
    "attempt" >= 0 AND "maxAttempts" BETWEEN 1 AND 20 AND "attempt" <= "maxAttempts"
    AND "progressPercent" BETWEEN 0 AND 100
    AND "priority" BETWEEN 1 AND 1000
    AND length(btrim("idempotencyKey")) BETWEEN 1 AND 200
    AND length(btrim("type")) BETWEEN 1 AND 100
  ),
  -- 상태와 lease·완료 시각의 정합성을 DB에서 강제한다. worker가 비정상 종료해도
  -- RUNNING인데 lockedBy가 비어 있는 것 같은 중간 상태가 남지 않는다.
  CONSTRAINT "JobQueue_lifecycle_check" CHECK (
    ("status" = 'QUEUED' AND "lockedBy" IS NULL AND "leaseExpiresAt" IS NULL AND "finishedAt" IS NULL)
    OR
    ("status" = 'RUNNING' AND "lockedBy" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL AND "startedAt" IS NOT NULL AND "finishedAt" IS NULL)
    OR
    ("status" IN ('SUCCEEDED', 'FAILED', 'CANCELLED') AND "lockedBy" IS NULL AND "leaseExpiresAt" IS NULL AND "finishedAt" IS NOT NULL)
  )
);

CREATE INDEX "JobQueue_claim_idx" ON "JobQueue"("status", "priority", "availableAt", "id");
CREATE INDEX "JobQueue_lease_reclaim_idx" ON "JobQueue"("status", "leaseExpiresAt");
CREATE INDEX "JobQueue_organization_list_idx" ON "JobQueue"("organizationId", "status", "createdAt", "id");
CREATE INDEX "JobQueue_requestedByMembershipId_idx" ON "JobQueue"("requestedByMembershipId");

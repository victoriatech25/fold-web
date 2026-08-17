ALTER TYPE "SalesOrderStatus" ADD VALUE 'CALCULATED' BEFORE 'CANCELLED';
ALTER TYPE "SalesOrderStatus" ADD VALUE 'APPROVED' BEFORE 'CANCELLED';
ALTER TYPE "SalesOrderStatus" ADD VALUE 'PRODUCTION_REQUESTED' BEFORE 'CANCELLED';
ALTER TYPE "SalesOrderStatus" ADD VALUE 'IN_PRODUCTION' BEFORE 'CANCELLED';
ALTER TYPE "SalesOrderStatus" ADD VALUE 'PRODUCED' BEFORE 'CANCELLED';
ALTER TYPE "SalesOrderStatus" ADD VALUE 'CLOSED' BEFORE 'CANCELLED';

ALTER TABLE "SalesOrder"
ADD COLUMN "approvedCalculationSnapshotId" UUID,
ADD COLUMN "approvedAt" TIMESTAMPTZ(6),
ADD COLUMN "approvedByMembershipId" UUID,
ADD COLUMN "statusChangedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "statusChangedByMembershipId" UUID;

ALTER TABLE "SalesOrder" DROP CONSTRAINT "SalesOrder_cancellation_state_check";

ALTER TABLE "SalesOrder"
ADD CONSTRAINT "SalesOrder_cancellation_state_check"
CHECK (
  ("status" <> 'CANCELLED' AND "cancelledAt" IS NULL AND "cancelledByMembershipId" IS NULL AND "cancellationReason" IS NULL)
  OR
  ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "cancelledByMembershipId" IS NOT NULL AND "cancellationReason" IS NOT NULL AND length(btrim("cancellationReason")) BETWEEN 1 AND 500)
);

ALTER TABLE "SalesOrder"
ADD CONSTRAINT "SalesOrder_approval_state_check"
CHECK (
  ("status" IN ('APPROVED', 'PRODUCTION_REQUESTED', 'IN_PRODUCTION', 'PRODUCED', 'CLOSED') AND "approvedCalculationSnapshotId" IS NOT NULL AND "approvedAt" IS NOT NULL AND "approvedByMembershipId" IS NOT NULL)
  OR
  ("status" NOT IN ('APPROVED', 'PRODUCTION_REQUESTED', 'IN_PRODUCTION', 'PRODUCED', 'CLOSED') AND "approvedCalculationSnapshotId" IS NULL AND "approvedAt" IS NULL AND "approvedByMembershipId" IS NULL)
);

CREATE UNIQUE INDEX "SalesOrder_approvedCalculationSnapshotId_key" ON "SalesOrder"("approvedCalculationSnapshotId");

ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_approvedCalculationSnapshotId_fkey" FOREIGN KEY ("approvedCalculationSnapshotId") REFERENCES "SalesOrderCalculationSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_approvedByMembershipId_fkey" FOREIGN KEY ("approvedByMembershipId") REFERENCES "OrganizationMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_statusChangedByMembershipId_fkey" FOREIGN KEY ("statusChangedByMembershipId") REFERENCES "OrganizationMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

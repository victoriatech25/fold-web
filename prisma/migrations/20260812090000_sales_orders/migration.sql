CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT', 'CANCELLED');

CREATE TABLE "SalesOrderNumberCounter" (
  "organizationId" UUID NOT NULL,
  "sequenceYear" INTEGER NOT NULL,
  "nextValue" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "SalesOrderNumberCounter_pkey" PRIMARY KEY ("organizationId", "sequenceYear"),
  CONSTRAINT "SalesOrderNumberCounter_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SalesOrder" (
  "id" UUID NOT NULL, "organizationId" UUID NOT NULL,
  "orderNumber" VARCHAR(50) NOT NULL, "sequenceYear" INTEGER NOT NULL,
  "status" "SalesOrderStatus" NOT NULL DEFAULT 'DRAFT', "customerId" UUID NOT NULL,
  "customerSiteId" UUID, "customerContactId" UUID, "ownerMembershipId" UUID,
  "orderedAt" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP, "dueDate" DATE,
  "externalReference" VARCHAR(200), "memo" TEXT, "cancelledAt" TIMESTAMPTZ(6),
  "cancelledByMembershipId" UUID, "cancellationReason" VARCHAR(500),
  "lockVersion" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SalesOrder_organizationId_orderNumber_key" UNIQUE ("organizationId", "orderNumber"),
  CONSTRAINT "SalesOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesOrder_customerSiteId_fkey" FOREIGN KEY ("customerSiteId") REFERENCES "CustomerSite"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesOrder_customerContactId_fkey" FOREIGN KEY ("customerContactId") REFERENCES "CustomerContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesOrder_ownerMembershipId_fkey" FOREIGN KEY ("ownerMembershipId") REFERENCES "OrganizationMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesOrder_cancelledByMembershipId_fkey" FOREIGN KEY ("cancelledByMembershipId") REFERENCES "OrganizationMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "SalesOrder_organizationId_status_updatedAt_idx" ON "SalesOrder"("organizationId", "status", "updatedAt");
CREATE INDEX "SalesOrder_organizationId_customerId_updatedAt_idx" ON "SalesOrder"("organizationId", "customerId", "updatedAt");

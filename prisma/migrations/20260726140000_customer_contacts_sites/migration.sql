-- P2-A02 customer, contact, and customer-site contract.
CREATE TYPE "CustomerType" AS ENUM ('SALES', 'PURCHASE', 'TEMPORARY', 'INTERNAL', 'OTHER');

ALTER TABLE "Customer"
  RENAME COLUMN "businessNumber" TO "businessRegistrationNumber";

ALTER TABLE "Customer"
  ADD COLUMN "type" "CustomerType" NOT NULL DEFAULT 'SALES',
  ADD COLUMN "representativeName" VARCHAR(100),
  ADD COLUMN "fax" VARCHAR(30),
  ADD COLUMN "website" VARCHAR(500),
  ADD COLUMN "postalCode" VARCHAR(20),
  ADD COLUMN "addressLine1" VARCHAR(300),
  ADD COLUMN "addressLine2" VARCHAR(300),
  ADD COLUMN "taxInvoiceEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "lockVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "CustomerContact"
  RENAME COLUMN "primary" TO "isPrimary";

ALTER TABLE "CustomerContact"
  ADD COLUMN "customerSiteId" UUID,
  ADD COLUMN "department" VARCHAR(100),
  ADD COLUMN "lockVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "deletedAt" TIMESTAMPTZ(6);

ALTER TABLE "Site" RENAME TO "CustomerSite";
ALTER TABLE "CustomerSite" RENAME CONSTRAINT "Site_pkey" TO "CustomerSite_pkey";
ALTER TABLE "CustomerSite" RENAME CONSTRAINT "Site_organizationId_fkey" TO "CustomerSite_organizationId_fkey";
ALTER TABLE "CustomerSite" RENAME CONSTRAINT "Site_customerId_fkey" TO "CustomerSite_customerId_fkey";
ALTER INDEX "Site_organizationId_customerId_code_key" RENAME TO "CustomerSite_organizationId_customerId_code_key";
ALTER INDEX "Site_organizationId_name_idx" RENAME TO "CustomerSite_organizationId_name_idx";
ALTER INDEX "Site_customerId_active_deletedAt_idx" RENAME TO "CustomerSite_customerId_active_deletedAt_idx";

ALTER TABLE "CustomerSite"
  ADD COLUMN "phone" VARCHAR(30),
  ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lockVersion" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "CustomerCodeCounter" (
  "organizationId" UUID NOT NULL,
  "nextValue" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "CustomerCodeCounter_pkey" PRIMARY KEY ("organizationId")
);

INSERT INTO "CustomerCodeCounter" ("organizationId", "nextValue", "updatedAt")
SELECT
  organization."id",
  COALESCE((
    SELECT MAX(SUBSTRING(customer."code" FROM 2)::INTEGER) + 1
    FROM "Customer" customer
    WHERE customer."organizationId" = organization."id"
      AND customer."code" ~ '^C[0-9]{6}$'
  ), 1),
  CURRENT_TIMESTAMP
FROM "Organization" organization;

DROP INDEX "CustomerContact_organizationId_customerId_active_idx";
CREATE INDEX "CustomerContact_organizationId_customerId_active_deletedAt_idx"
  ON "CustomerContact" ("organizationId", "customerId", "active", "deletedAt");
CREATE INDEX "CustomerContact_customerSiteId_idx"
  ON "CustomerContact" ("customerSiteId");

CREATE INDEX "Customer_organizationId_type_active_deletedAt_idx"
  ON "Customer" ("organizationId", "type", "active", "deletedAt");
CREATE INDEX "Customer_name_trgm_idx"
  ON "Customer" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "Customer_code_trgm_idx"
  ON "Customer" USING GIN ("code" gin_trgm_ops);

CREATE INDEX "CustomerSite_organizationId_customerId_isDefault_idx"
  ON "CustomerSite" ("organizationId", "customerId", "isDefault");

-- Existing records did not have explicit default flags. Preserve deterministic defaults.
WITH ranked_sites AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "organizationId", "customerId"
    ORDER BY "createdAt", "id"
  ) AS row_number
  FROM "CustomerSite"
  WHERE "active" = true AND "deletedAt" IS NULL
)
UPDATE "CustomerSite" site
SET "isDefault" = true
FROM ranked_sites
WHERE site."id" = ranked_sites."id" AND ranked_sites.row_number = 1;

WITH ranked_contacts AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "organizationId", "customerId"
    ORDER BY "isPrimary" DESC, "createdAt", "id"
  ) AS row_number
  FROM "CustomerContact"
  WHERE "active" = true AND "deletedAt" IS NULL
)
UPDATE "CustomerContact" contact
SET "isPrimary" = (ranked_contacts.row_number = 1)
FROM ranked_contacts
WHERE contact."id" = ranked_contacts."id";

CREATE UNIQUE INDEX "CustomerContact_one_active_primary_per_customer_key"
  ON "CustomerContact" ("organizationId", "customerId")
  WHERE "isPrimary" = true AND "active" = true AND "deletedAt" IS NULL;

CREATE UNIQUE INDEX "CustomerSite_one_active_default_per_customer_key"
  ON "CustomerSite" ("organizationId", "customerId")
  WHERE "isDefault" = true AND "active" = true AND "deletedAt" IS NULL;

ALTER TABLE "CustomerCodeCounter"
  ADD CONSTRAINT "CustomerCodeCounter_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerContact"
  ADD CONSTRAINT "CustomerContact_customerSiteId_fkey"
  FOREIGN KEY ("customerSiteId") REFERENCES "CustomerSite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

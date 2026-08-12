-- CreateEnum
CREATE TYPE "BusinessSiteType" AS ENUM ('HEAD_OFFICE', 'FACTORY', 'BRANCH', 'OTHER');

-- AlterTable
ALTER TABLE "CompanyProfile" ADD COLUMN     "lockVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "lockVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "BusinessSite" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "type" "BusinessSiteType" NOT NULL DEFAULT 'OTHER',
    "businessRegistrationNumber" VARCHAR(20),
    "representativeName" VARCHAR(100),
    "phone" VARCHAR(30),
    "email" VARCHAR(320),
    "postalCode" VARCHAR(20),
    "addressLine1" VARCHAR(300),
    "addressLine2" VARCHAR(300),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lockVersion" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "BusinessSite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessSite_organizationId_active_name_idx" ON "BusinessSite"("organizationId", "active", "name");

-- CreateIndex
CREATE INDEX "BusinessSite_organizationId_isDefault_idx" ON "BusinessSite"("organizationId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessSite_organizationId_code_key" ON "BusinessSite"("organizationId", "code");

-- Every existing organization starts with a profile and one active default site.
INSERT INTO "CompanyProfile" ("organizationId", "createdAt", "updatedAt")
SELECT "id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization"
ON CONFLICT ("organizationId") DO NOTHING;

INSERT INTO "BusinessSite" (
    "id",
    "organizationId",
    "code",
    "name",
    "type",
    "isDefault",
    "active",
    "lockVersion",
    "createdAt",
    "updatedAt"
)
SELECT
    md5("id"::text || ':business-site:MAIN')::uuid,
    "id",
    'MAIN',
    '본사',
    'HEAD_OFFICE'::"BusinessSiteType",
    true,
    true,
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Organization";

-- Prisma does not model partial indexes, so the migration owns this invariant.
CREATE UNIQUE INDEX "BusinessSite_one_active_default_per_organization_key"
ON "BusinessSite" ("organizationId")
WHERE "isDefault" = true AND "active" = true AND "deletedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "BusinessSite" ADD CONSTRAINT "BusinessSite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

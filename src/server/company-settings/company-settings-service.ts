import "server-only";

import type {
  BusinessSite,
  CompanyProfile,
  Organization,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import { writeAuditEvent } from "@/server/audit/audit-writer";
import { requirePermission } from "@/server/authorization/authorization";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { CompanySettingsError } from "@/server/company-settings/company-settings-error";
import {
  isValidBusinessSiteCode,
  normalizeBusinessSiteCode,
  normalizeOptionalText,
} from "@/server/company-settings/company-settings-policy";
import type {
  BusinessSiteDto,
  BusinessSiteFields,
  CompanyProfileDto,
  CompanyProfileFields,
  CompanySettingsDto,
} from "@/server/company-settings/company-settings-types";

type Transaction = Prisma.TransactionClient;
type OrganizationWithProfile = Organization & { companyProfile: CompanyProfile | null };

function isPrismaErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function mapCompany(organization: OrganizationWithProfile): CompanyProfileDto {
  const profile = organization.companyProfile;
  return {
    organizationId: organization.id,
    code: organization.code,
    name: organization.name,
    businessRegistrationNumber: profile?.businessRegistrationNumber ?? null,
    representativeName: profile?.representativeName ?? null,
    phone: profile?.phone ?? null,
    email: profile?.email ?? null,
    postalCode: profile?.postalCode ?? null,
    addressLine1: profile?.addressLine1 ?? null,
    addressLine2: profile?.addressLine2 ?? null,
    organizationLockVersion: organization.lockVersion,
    profileLockVersion: profile?.lockVersion ?? 0,
    updatedAt: new Date(
      Math.max(organization.updatedAt.getTime(), profile?.updatedAt.getTime() ?? 0),
    ).toISOString(),
  };
}

function mapBusinessSite(site: BusinessSite): BusinessSiteDto {
  return {
    id: site.id,
    code: site.code,
    name: site.name,
    type: site.type,
    businessRegistrationNumber: site.businessRegistrationNumber,
    representativeName: site.representativeName,
    phone: site.phone,
    email: site.email,
    postalCode: site.postalCode,
    addressLine1: site.addressLine1,
    addressLine2: site.addressLine2,
    isDefault: site.isDefault,
    active: site.active,
    lockVersion: site.lockVersion,
    updatedAt: site.updatedAt.toISOString(),
  };
}

function companyAuditSnapshot(company: CompanyProfileDto) {
  return {
    name: company.name,
    businessRegistrationNumber: company.businessRegistrationNumber,
    representativeName: company.representativeName,
    phone: company.phone,
    email: company.email,
    postalCode: company.postalCode,
    addressLine1: company.addressLine1,
    addressLine2: company.addressLine2,
    organizationLockVersion: company.organizationLockVersion,
    profileLockVersion: company.profileLockVersion,
  };
}

function businessSiteAuditSnapshot(site: BusinessSiteDto) {
  return {
    code: site.code,
    name: site.name,
    type: site.type,
    businessRegistrationNumber: site.businessRegistrationNumber,
    representativeName: site.representativeName,
    phone: site.phone,
    email: site.email,
    postalCode: site.postalCode,
    addressLine1: site.addressLine1,
    addressLine2: site.addressLine2,
    isDefault: site.isDefault,
    active: site.active,
    lockVersion: site.lockVersion,
  };
}

function optionalFields(input: CompanyProfileFields | BusinessSiteFields) {
  return {
    businessRegistrationNumber: normalizeOptionalText(input.businessRegistrationNumber),
    representativeName: normalizeOptionalText(input.representativeName),
    phone: normalizeOptionalText(input.phone),
    email: normalizeOptionalText(input.email)?.toLowerCase() ?? null,
    postalCode: normalizeOptionalText(input.postalCode),
    addressLine1: normalizeOptionalText(input.addressLine1),
    addressLine2: normalizeOptionalText(input.addressLine2),
  };
}

async function lockOrganization(
  transaction: Transaction,
  organizationId: string,
): Promise<void> {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Organization"
    WHERE "id" = ${organizationId}::uuid
    FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new CompanySettingsError("NOT_FOUND", "회사를 찾을 수 없습니다.");
  }
}

async function readOrganizationWithProfile(
  database: PrismaClient | Transaction,
  organizationId: string,
): Promise<OrganizationWithProfile> {
  const organization = await database.organization.findUnique({
    where: { id: organizationId },
    include: { companyProfile: true },
  });
  if (!organization) {
    throw new CompanySettingsError("NOT_FOUND", "회사를 찾을 수 없습니다.");
  }
  return organization;
}

export async function getCompanySettings(
  prisma: PrismaClient,
  context: AuthenticatedContext,
): Promise<CompanySettingsDto> {
  requirePermission(context, "master_data.read");
  const [organization, businessSites] = await Promise.all([
    readOrganizationWithProfile(prisma, context.organizationId),
    prisma.businessSite.findMany({
      where: { organizationId: context.organizationId, deletedAt: null },
      orderBy: [{ isDefault: "desc" }, { active: "desc" }, { name: "asc" }, { id: "asc" }],
    }),
  ]);
  return {
    company: mapCompany(organization),
    businessSites: businessSites.map(mapBusinessSite),
  };
}

export async function getBusinessSite(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  businessSiteId: string,
): Promise<BusinessSiteDto> {
  requirePermission(context, "master_data.read");
  const site = await prisma.businessSite.findFirst({
    where: {
      id: businessSiteId,
      organizationId: context.organizationId,
      deletedAt: null,
    },
  });
  if (!site) throw new CompanySettingsError("NOT_FOUND", "사업장을 찾을 수 없습니다.");
  return mapBusinessSite(site);
}

export async function updateCompanyProfile(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: CompanyProfileFields & {
    expectedOrganizationLockVersion: number;
    expectedProfileLockVersion: number;
    requestId: string;
  },
): Promise<CompanyProfileDto> {
  requirePermission(context, "master_data.manage");
  const name = input.name.trim();
  if (!name) throw new CompanySettingsError("INVALID_REQUEST", "회사명을 입력해 주세요.");

  return prisma.$transaction(async (transaction) => {
    await lockOrganization(transaction, context.organizationId);
    const current = await readOrganizationWithProfile(transaction, context.organizationId);
    if (
      current.lockVersion !== input.expectedOrganizationLockVersion ||
      (current.companyProfile?.lockVersion ?? 0) !== input.expectedProfileLockVersion
    ) {
      throw new CompanySettingsError(
        "CONFLICT",
        "회사 정보가 변경되었습니다. 최신 정보를 불러온 뒤 다시 시도해 주세요.",
      );
    }
    const before = mapCompany(current);
    await transaction.organization.update({
      where: { id: current.id },
      data: { name, lockVersion: { increment: 1 } },
    });
    const fields = optionalFields(input);
    if (current.companyProfile) {
      await transaction.companyProfile.update({
        where: { organizationId: current.id },
        data: { ...fields, lockVersion: { increment: 1 } },
      });
    } else {
      await transaction.companyProfile.create({
        data: { organizationId: current.id, ...fields },
      });
    }
    const updated = mapCompany(await readOrganizationWithProfile(transaction, current.id));
    await writeAuditEvent(transaction, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "master_data.company_profile_updated",
      entityId: context.organizationId,
      requestId: input.requestId,
      before: companyAuditSnapshot(before),
      after: companyAuditSnapshot(updated),
    });
    return updated;
  });
}

export async function createBusinessSite(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: BusinessSiteFields & { code: string; requestId: string },
): Promise<BusinessSiteDto> {
  requirePermission(context, "master_data.manage");
  const code = normalizeBusinessSiteCode(input.code);
  if (!isValidBusinessSiteCode(code)) {
    throw new CompanySettingsError(
      "INVALID_REQUEST",
      "사업장 코드는 영문 대문자·숫자·-·_ 조합 2~50자여야 합니다.",
    );
  }
  const name = input.name.trim();
  if (!name) throw new CompanySettingsError("INVALID_REQUEST", "사업장명을 입력해 주세요.");

  try {
    return await prisma.$transaction(async (transaction) => {
      await lockOrganization(transaction, context.organizationId);
      const activeDefault = await transaction.businessSite.findFirst({
        where: {
          organizationId: context.organizationId,
          isDefault: true,
          active: true,
          deletedAt: null,
        },
        select: { id: true },
      });
      const created = await transaction.businessSite.create({
        data: {
          organizationId: context.organizationId,
          code,
          name,
          type: input.type,
          ...optionalFields(input),
          isDefault: !activeDefault,
        },
      });
      const dto = mapBusinessSite(created);
      await writeAuditEvent(transaction, {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "master_data.business_site_created",
        entityId: created.id,
        requestId: input.requestId,
        after: businessSiteAuditSnapshot(dto),
      });
      return dto;
    });
  } catch (error) {
    if (isPrismaErrorCode(error, "P2002")) {
      throw new CompanySettingsError("CONFLICT", "이미 사용 중인 사업장 코드입니다.");
    }
    throw error;
  }
}

export async function updateBusinessSite(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: BusinessSiteFields & {
    businessSiteId: string;
    active: boolean;
    expectedLockVersion: number;
    requestId: string;
  },
): Promise<BusinessSiteDto> {
  requirePermission(context, "master_data.manage");
  const name = input.name.trim();
  if (!name) throw new CompanySettingsError("INVALID_REQUEST", "사업장명을 입력해 주세요.");

  return prisma.$transaction(async (transaction) => {
    await lockOrganization(transaction, context.organizationId);
    const current = await transaction.businessSite.findFirst({
      where: {
        id: input.businessSiteId,
        organizationId: context.organizationId,
        deletedAt: null,
      },
    });
    if (!current) throw new CompanySettingsError("NOT_FOUND", "사업장을 찾을 수 없습니다.");
    if (current.lockVersion !== input.expectedLockVersion) {
      throw new CompanySettingsError(
        "CONFLICT",
        "사업장 정보가 변경되었습니다. 최신 정보를 불러온 뒤 다시 시도해 주세요.",
      );
    }
    if (current.isDefault && !input.active) {
      throw new CompanySettingsError(
        "CONFLICT",
        "기본 사업장은 비활성화할 수 없습니다. 다른 사업장을 기본으로 지정해 주세요.",
      );
    }
    const updated = await transaction.businessSite.update({
      where: { id: current.id },
      data: {
        name,
        type: input.type,
        ...optionalFields(input),
        active: input.active,
        lockVersion: { increment: 1 },
      },
    });
    const beforeDto = mapBusinessSite(current);
    const updatedDto = mapBusinessSite(updated);
    await writeAuditEvent(transaction, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "master_data.business_site_updated",
      entityId: current.id,
      requestId: input.requestId,
      before: businessSiteAuditSnapshot(beforeDto),
      after: businessSiteAuditSnapshot(updatedDto),
    });
    return updatedDto;
  });
}

export async function setDefaultBusinessSite(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: {
    businessSiteId: string;
    expectedLockVersion: number;
    requestId: string;
  },
): Promise<BusinessSiteDto> {
  requirePermission(context, "master_data.manage");
  return prisma.$transaction(async (transaction) => {
    await lockOrganization(transaction, context.organizationId);
    const target = await transaction.businessSite.findFirst({
      where: {
        id: input.businessSiteId,
        organizationId: context.organizationId,
        deletedAt: null,
      },
    });
    if (!target) throw new CompanySettingsError("NOT_FOUND", "사업장을 찾을 수 없습니다.");
    if (target.lockVersion !== input.expectedLockVersion) {
      throw new CompanySettingsError(
        "CONFLICT",
        "사업장 정보가 변경되었습니다. 최신 정보를 불러온 뒤 다시 시도해 주세요.",
      );
    }
    if (!target.active) {
      throw new CompanySettingsError("CONFLICT", "비활성 사업장은 기본 사업장으로 지정할 수 없습니다.");
    }
    if (target.isDefault) return mapBusinessSite(target);

    const previous = await transaction.businessSite.findFirst({
      where: {
        organizationId: context.organizationId,
        isDefault: true,
        active: true,
        deletedAt: null,
      },
      select: { id: true },
    });
    await transaction.businessSite.updateMany({
      where: {
        organizationId: context.organizationId,
        isDefault: true,
        deletedAt: null,
      },
      data: { isDefault: false, lockVersion: { increment: 1 } },
    });
    const updated = await transaction.businessSite.update({
      where: { id: target.id },
      data: { isDefault: true, lockVersion: { increment: 1 } },
    });
    await writeAuditEvent(transaction, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "master_data.business_site_default_changed",
      entityId: target.id,
      requestId: input.requestId,
      before: { businessSiteId: previous?.id ?? null },
      after: { businessSiteId: target.id },
    });
    return mapBusinessSite(updated);
  });
}

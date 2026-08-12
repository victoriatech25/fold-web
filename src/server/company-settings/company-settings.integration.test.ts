import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { PermissionDeniedError } from "@/server/authorization/authorization";
import { CompanySettingsError } from "@/server/company-settings/company-settings-error";
import {
  createBusinessSite,
  getBusinessSite,
  getCompanySettings,
  setDefaultBusinessSite,
  updateBusinessSite,
  updateCompanyProfile,
} from "@/server/company-settings/company-settings-service";
import { disconnectPrisma, getPrisma } from "@/server/db/prisma";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

let prisma: PrismaClient;
let organizationId: string;
let otherOrganizationId: string;
let userId: string;
let context: AuthenticatedContext;

integration.sequential("company settings integration", () => {
  beforeAll(async () => {
    prisma = getPrisma();
    const organization = await prisma.organization.create({
      data: {
        code: "COMPANY_SETTINGS",
        name: "회사 설정 통합",
        companyProfile: { create: {} },
        businessSites: {
          create: {
            code: "MAIN",
            name: "통합 본사",
            type: "HEAD_OFFICE",
            isDefault: true,
          },
        },
      },
    });
    organizationId = organization.id;
    otherOrganizationId = (await prisma.organization.create({
      data: {
        code: "COMPANY_SETTINGS_OTHER",
        name: "다른 회사",
        companyProfile: { create: {} },
        businessSites: {
          create: {
            code: "MAIN",
            name: "다른 회사 본사",
            type: "HEAD_OFFICE",
            isDefault: true,
          },
        },
      },
    })).id;
    userId = (await prisma.user.create({
      data: {
        email: "company-settings@example.test",
        normalizedEmail: "company-settings@example.test",
        displayName: "기준정보 관리자",
        status: "ACTIVE",
      },
    })).id;
    context = {
      sessionId: crypto.randomUUID(),
      userId,
      displayName: "기준정보 관리자",
      membershipId: crypto.randomUUID(),
      departmentId: null,
      organizationId,
      organizationCode: "COMPANY_SETTINGS",
      organizationName: "회사 설정 통합",
      roleKeys: ["APPROVER"],
      permissions: ["master_data.read", "master_data.manage"],
      expiresAt: new Date("2026-07-27T00:00:00.000Z"),
    };
  });

  afterAll(async () => disconnectPrisma());

  it("updates company profile with optimistic locking and audit history", async () => {
    const initial = await getCompanySettings(prisma, context);
    expect(initial.company.name).toBe("회사 설정 통합");
    expect(initial.businessSites).toHaveLength(1);
    expect(initial.businessSites[0]).toMatchObject({ code: "MAIN", isDefault: true });

    const updated = await updateCompanyProfile(prisma, context, {
      name: "회사 설정 통합 변경",
      businessRegistrationNumber: "123-45-67890",
      representativeName: "홍길동",
      phone: "02-1234-5678",
      email: "COMPANY@EXAMPLE.TEST",
      postalCode: "01234",
      addressLine1: "서울시 테스트구",
      addressLine2: "  ",
      expectedOrganizationLockVersion: initial.company.organizationLockVersion,
      expectedProfileLockVersion: initial.company.profileLockVersion,
      requestId: "company-profile-update",
    });
    expect(updated).toMatchObject({
      name: "회사 설정 통합 변경",
      email: "company@example.test",
      addressLine2: null,
      organizationLockVersion: initial.company.organizationLockVersion + 1,
      profileLockVersion: initial.company.profileLockVersion + 1,
    });
    await expect(updateCompanyProfile(prisma, context, {
      name: "오래된 변경",
      expectedOrganizationLockVersion: initial.company.organizationLockVersion,
      expectedProfileLockVersion: initial.company.profileLockVersion,
      requestId: "company-profile-stale",
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.auditEvent.count({
      where: { organizationId, action: "master_data.company_profile_updated" },
    })).toBe(1);
  });

  it("creates, switches and deactivates business sites while preserving one default", async () => {
    const initial = await getCompanySettings(prisma, context);
    const main = initial.businessSites[0];
    const factory = await createBusinessSite(prisma, context, {
      code: " factory-1 ",
      name: "제1공장",
      type: "FACTORY",
      phone: "031-000-0000",
      requestId: "business-site-create",
    });
    expect(factory).toMatchObject({ code: "FACTORY-1", isDefault: false, active: true });

    await expect(createBusinessSite(prisma, context, {
      code: "FACTORY-1",
      name: "중복 공장",
      type: "FACTORY",
      requestId: "business-site-duplicate",
    })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(updateBusinessSite(prisma, context, {
      businessSiteId: main.id,
      name: main.name,
      type: main.type,
      active: false,
      expectedLockVersion: main.lockVersion,
      requestId: "default-site-deactivate-denied",
    })).rejects.toMatchObject({ code: "CONFLICT" });

    const nextDefault = await setDefaultBusinessSite(prisma, context, {
      businessSiteId: factory.id,
      expectedLockVersion: factory.lockVersion,
      requestId: "business-site-default",
    });
    expect(nextDefault.isDefault).toBe(true);
    const refreshedMain = await getBusinessSite(prisma, context, main.id);
    expect(refreshedMain.isDefault).toBe(false);
    const inactiveMain = await updateBusinessSite(prisma, context, {
      businessSiteId: refreshedMain.id,
      name: refreshedMain.name,
      type: refreshedMain.type,
      active: false,
      expectedLockVersion: refreshedMain.lockVersion,
      requestId: "business-site-deactivate",
    });
    expect(inactiveMain.active).toBe(false);

    const defaults = await prisma.businessSite.count({
      where: { organizationId, active: true, isDefault: true, deletedAt: null },
    });
    expect(defaults).toBe(1);
    expect(await prisma.auditEvent.count({
      where: { organizationId, action: { startsWith: "master_data.business_site" } },
    })).toBe(3);
  });

  it("enforces permission and organization boundaries", async () => {
    await expect(getCompanySettings(prisma, {
      ...context,
      permissions: [],
    })).rejects.toBeInstanceOf(PermissionDeniedError);
    const otherSite = await prisma.businessSite.findFirstOrThrow({
      where: { organizationId: otherOrganizationId },
    });
    await expect(getBusinessSite(prisma, context, otherSite.id)).rejects.toBeInstanceOf(
      CompanySettingsError,
    );
  });

  it("keeps the database-level single default invariant", async () => {
    const settings = await getCompanySettings(prisma, context);
    const inactive = settings.businessSites.find((site) => !site.active)!;
    await expect(prisma.businessSite.update({
      where: { id: inactive.id },
      data: { active: true, isDefault: true },
    })).rejects.toBeTruthy();
  });
});

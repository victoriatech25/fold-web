import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { systemRoleDefinitions } from "@/domain/permission";
import { AdminServiceError } from "@/server/admin/admin-error";
import { readAuthRuntimeConfig } from "@/server/auth/auth-config";
import { getAuthenticatedContext, login } from "@/server/auth/auth-service";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { completePasswordReset } from "@/server/auth/password-reset-service";
import { hashOpaqueToken } from "@/server/auth/token";
import { PlatformAdminRequiredError } from "@/server/authorization/authorization";
import { disconnectPrisma, getPrisma } from "@/server/db/prisma";
import {
  createPlatformOrganization,
  invitePlatformOrganizationAdministrator,
  listPlatformOrganizations,
  updatePlatformOrganization,
} from "@/server/organizations/organization-service";

const origin = "http://localhost:3000";
const secret = "organization-integration-rate-limit-secret-0";

function config() {
  return readAuthRuntimeConfig({ APP_ORIGIN: origin, AUTH_RATE_LIMIT_SECRET: secret });
}

const integration = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

let prisma: PrismaClient;
let context: AuthenticatedContext;

integration.sequential("platform organization integration", () => {
  beforeAll(async () => {
    process.env.APP_ORIGIN = origin;
    process.env.AUTH_RATE_LIMIT_SECRET = secret;
    prisma = getPrisma();
    // 플랫폼 관리자는 seed 된 LOCAL_DEV 조직에 소속돼 있다고 가정한다.
    const home = await prisma.organization.findUniqueOrThrow({
      where: { code: "LOCAL_DEV" },
      select: { id: true, code: true, name: true },
    });
    const user = await prisma.user.create({
      data: {
        email: "platform-admin@example.test",
        normalizedEmail: "platform-admin@example.test",
        displayName: "플랫폼 관리자",
        status: "ACTIVE",
        platformAdmin: true,
      },
    });
    context = {
      sessionId: crypto.randomUUID(),
      userId: user.id,
      displayName: user.displayName,
      membershipId: crypto.randomUUID(),
      departmentId: null,
      organizationId: home.id,
      organizationCode: home.code,
      organizationName: home.name,
      platformAdmin: true,
      roleKeys: ["ADMINISTRATOR"],
      permissions: ["admin.manage"],
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    };
  });

  afterAll(async () => {
    delete process.env.APP_ORIGIN;
    delete process.env.AUTH_RATE_LIMIT_SECRET;
    await disconnectPrisma();
  });

  it("플랫폼 관리자가 아니면 조직 권한이 있어도 거절한다", async () => {
    const orgAdmin = { ...context, platformAdmin: false };
    await expect(listPlatformOrganizations(prisma, orgAdmin)).rejects.toThrow(
      PlatformAdminRequiredError,
    );
    await expect(
      createPlatformOrganization(prisma, orgAdmin, { code: "X1", name: "x", requestId: "t" }),
    ).rejects.toThrow(PlatformAdminRequiredError);
  });

  it("회사를 등록하면 프로필·기본 사업장·시스템 역할이 함께 생긴다", async () => {
    const created = await createPlatformOrganization(prisma, context, {
      code: " platform-new ",
      name: "  새 회사  ",
      requestId: "org-create",
    });
    expect(created).toMatchObject({
      code: "PLATFORM-NEW",
      name: "새 회사",
      status: "ACTIVE",
      memberCount: 0,
      own: false,
    });

    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: created.id },
      include: {
        companyProfile: true,
        businessSites: true,
        roles: { include: { permissions: true } },
      },
    });
    expect(organization.companyProfile).not.toBeNull();
    expect(organization.businessSites).toHaveLength(1);
    expect(organization.businessSites[0]).toMatchObject({
      code: "MAIN",
      type: "HEAD_OFFICE",
      isDefault: true,
    });
    expect(organization.roles.map(({ key }) => key).sort()).toEqual(
      systemRoleDefinitions.map(({ key }) => key).sort(),
    );
    const administrator = organization.roles.find(({ key }) => key === "ADMINISTRATOR")!;
    expect(administrator.system).toBe(true);
    expect(administrator.permissions).toHaveLength(
      systemRoleDefinitions.find(({ key }) => key === "ADMINISTRATOR")!.permissions.length,
    );

    // 감사 이력은 만든 사람의 조직에 남는다.
    const audit = await prisma.auditEvent.findFirst({
      where: { action: "platform.organization_created", entityId: created.id },
    });
    expect(audit?.organizationId).toBe(context.organizationId);

    const listed = await listPlatformOrganizations(prisma, context);
    expect(listed.find(({ id }) => id === created.id)).toBeDefined();
    expect(listed.find(({ id }) => id === context.organizationId)?.own).toBe(true);
  });

  it("코드 형식과 중복을 막는다", async () => {
    await expect(
      createPlatformOrganization(prisma, context, { code: "회사", name: "x", requestId: "t" }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" } satisfies Partial<AdminServiceError>);
    await expect(
      createPlatformOrganization(prisma, context, { code: "platform-new", name: "x", requestId: "t" }),
    ).rejects.toMatchObject({ code: "CONFLICT" } satisfies Partial<AdminServiceError>);
  });

  it("회사 관리자를 발급하면 그 회사의 ADMINISTRATOR 로 로그인해 조직을 관리한다", async () => {
    const target = (await listPlatformOrganizations(prisma, context)).find(
      ({ code }) => code === "PLATFORM-NEW",
    )!;
    expect(target.administrators).toEqual([]);

    const invitation = await invitePlatformOrganizationAdministrator(prisma, context, {
      organizationId: target.id,
      email: "Platform-New-Admin@example.test",
      displayName: " 새 회사 관리자 ",
      requestId: "org-admin",
      config: config(),
    });
    expect(invitation.administrator).toMatchObject({
      displayName: "새 회사 관리자",
      status: "INVITED",
    });
    expect(invitation.organization.administrators.map(({ userId }) => userId)).toEqual([
      invitation.administrator.userId,
    ]);
    expect(invitation.invitationUrl.startsWith(`${origin}/reset-password?token=`)).toBe(true);

    // 감사 이력은 플랫폼(만든 사람의 조직)과 그 회사 양쪽에 남는다.
    const [platformAudit, companyAudit] = await Promise.all([
      prisma.auditEvent.findFirst({
        where: { action: "platform.organization_admin_invited", entityId: invitation.administrator.userId },
      }),
      prisma.auditEvent.findFirst({
        where: { action: "admin.user_invited", entityId: invitation.administrator.userId },
      }),
    ]);
    expect(platformAudit?.organizationId).toBe(context.organizationId);
    expect(companyAudit?.organizationId).toBe(target.id);

    // 일회용 주소로 비밀번호를 정하고 로그인하면 그 회사의 관리자다.
    const token = new URL(invitation.invitationUrl).searchParams.get("token")!;
    const tokenRow = await prisma.passwordResetToken.findUniqueOrThrow({
      where: { tokenHash: hashOpaqueToken(token) },
      select: { id: true },
    });
    expect(tokenRow.id).toBeTruthy();
    const password = "Company admin phrase 2026!";
    const reset = await completePasswordReset(prisma, {
      token,
      password,
      requestId: "org-admin-reset",
    });
    expect(reset.ok).toBe(true);
    const session = await login(prisma, {
      email: "platform-new-admin@example.test",
      password,
      requestId: "org-admin-login",
      source: "integration",
      config: config(),
    });
    if (!session.ok) throw new Error("company administrator login failed");
    const companyAdmin = await getAuthenticatedContext(prisma, {
      token: session.token,
      config: config(),
    });
    expect(companyAdmin).toMatchObject({
      organizationCode: "PLATFORM-NEW",
      platformAdmin: false,
      roleKeys: ["ADMINISTRATOR"],
    });
    expect(companyAdmin?.permissions).toContain("admin.manage");
    // 회사 관리자는 플랫폼 작업을 할 수 없다.
    await expect(listPlatformOrganizations(prisma, companyAdmin!)).rejects.toThrow(
      PlatformAdminRequiredError,
    );

    // 같은 이메일은 다시 못 쓴다.
    await expect(
      invitePlatformOrganizationAdministrator(prisma, context, {
        organizationId: target.id,
        email: "platform-new-admin@example.test",
        displayName: "중복",
        requestId: "org-admin-dup",
        config: config(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" } satisfies Partial<AdminServiceError>);
  });

  it("이름과 상태를 바꾸고 낙관적 잠금으로 겹침을 막는다", async () => {
    const target = (await listPlatformOrganizations(prisma, context)).find(
      ({ code }) => code === "PLATFORM-NEW",
    )!;
    const updated = await updatePlatformOrganization(prisma, context, {
      organizationId: target.id,
      name: "바뀐 회사",
      status: "SUSPENDED",
      expectedUpdatedAt: new Date(target.updatedAt),
      requestId: "org-update",
    });
    expect(updated).toMatchObject({ name: "바뀐 회사", status: "SUSPENDED" });

    await expect(
      invitePlatformOrganizationAdministrator(prisma, context, {
        organizationId: target.id,
        email: "suspended-admin@example.test",
        displayName: "정지 회사 관리자",
        requestId: "org-admin-suspended",
        config: config(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<AdminServiceError>);

    await expect(
      updatePlatformOrganization(prisma, context, {
        organizationId: target.id,
        name: "다시",
        expectedUpdatedAt: new Date(target.updatedAt),
        requestId: "org-stale",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" } satisfies Partial<AdminServiceError>);
  });

  it("자기 조직은 정지할 수 없다", async () => {
    const own = (await listPlatformOrganizations(prisma, context)).find(({ own }) => own)!;
    await expect(
      updatePlatformOrganization(prisma, context, {
        organizationId: own.id,
        status: "SUSPENDED",
        expectedUpdatedAt: new Date(own.updatedAt),
        requestId: "org-self",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<AdminServiceError>);
    const stillActive = await prisma.organization.findUniqueOrThrow({ where: { id: own.id } });
    expect(stillActive.status).toBe("ACTIVE");
  });
});

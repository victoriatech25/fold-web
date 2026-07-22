import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { AdminServiceError } from "@/server/admin/admin-error";
import {
  createOrganizationRole,
  inviteOrganizationUser,
  listAdminUsers,
  updateOrganizationRole,
  updateOrganizationUser,
} from "@/server/admin/admin-service";
import { readAuthRuntimeConfig } from "@/server/auth/auth-config";
import { getAuthenticatedContext, login } from "@/server/auth/auth-service";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import {
  hashPassword,
  passwordHashAlgorithm,
} from "@/server/auth/password";
import { completePasswordReset } from "@/server/auth/password-reset-service";
import { hashOpaqueToken } from "@/server/auth/token";
import { disconnectPrisma, getPrisma } from "@/server/db/prisma";

const runIntegration = process.env.RUN_DB_INTEGRATION === "1";
const integration = runIntegration ? describe : describe.skip;
const origin = "http://localhost:3000";
const secret = "admin-integration-rate-limit-secret-000000";
const administratorPassword = "Admin integration phrase 2026!";
let prisma: PrismaClient;
let organizationId: string;
let administratorRoleId: string;
let viewerRoleId: string;
let designerRoleId: string;
let adminContext: AuthenticatedContext;
let invitedUserId: string;

function config() {
  return readAuthRuntimeConfig({
    APP_ORIGIN: origin,
    AUTH_RATE_LIMIT_SECRET: secret,
  });
}

async function createUserWithRole(input: {
  email: string;
  displayName: string;
  roleId: string;
}) {
  return prisma.user.create({
    data: {
      email: input.email,
      normalizedEmail: input.email,
      displayName: input.displayName,
      status: "ACTIVE",
      passwordCredential: {
        create: {
          algorithm: passwordHashAlgorithm,
          passwordHash: await hashPassword(administratorPassword),
        },
      },
      memberships: {
        create: {
          organizationId,
          roles: { create: { roleId: input.roleId } },
        },
      },
    },
    select: {
      id: true,
      updatedAt: true,
      memberships: { select: { id: true } },
    },
  });
}

integration.sequential("organization user and RBAC integration", () => {
  beforeAll(async () => {
    process.env.APP_ORIGIN = origin;
    process.env.AUTH_RATE_LIMIT_SECRET = secret;
    prisma = getPrisma();
    const templateOrganization = await prisma.organization.findUniqueOrThrow({
      where: { code: "LOCAL_DEV" },
      select: { id: true },
    });
    const templateRoles = await prisma.role.findMany({
      where: {
        organizationId: templateOrganization.id,
        key: { in: ["ADMINISTRATOR", "VIEWER", "DESIGNER"] },
      },
      select: {
        key: true,
        name: true,
        description: true,
        system: true,
        active: true,
        permissions: { select: { permissionId: true } },
      },
    });
    const organization = await prisma.organization.create({
      data: {
        code: "ADMIN_INTEGRATION",
        name: "관리 통합 테스트 조직",
        roles: {
          create: templateRoles.map((role) => ({
            key: role.key,
            name: role.name,
            description: role.description,
            system: role.system,
            active: role.active,
            permissions: {
              create: role.permissions.map(({ permissionId }) => ({
                permissionId,
              })),
            },
          })),
        },
      },
      select: { id: true },
    });
    organizationId = organization.id;
    const roles = await prisma.role.findMany({
      where: { organizationId },
      select: { id: true, key: true },
    });
    administratorRoleId = roles.find(
      ({ key }) => key === "ADMINISTRATOR",
    )!.id;
    viewerRoleId = roles.find(({ key }) => key === "VIEWER")!.id;
    designerRoleId = roles.find(({ key }) => key === "DESIGNER")!.id;

    await createUserWithRole({
      email: "rbac-admin@example.test",
      displayName: "RBAC 관리자",
      roleId: administratorRoleId,
    });
    const authenticated = await login(prisma, {
      email: "rbac-admin@example.test",
      password: administratorPassword,
      source: null,
      requestId: "rbac-admin-login",
      config: config(),
    });
    if (!authenticated.ok) throw new Error("Admin fixture login failed.");
    adminContext = authenticated.context;
  });

  afterAll(async () => {
    delete process.env.APP_ORIGIN;
    delete process.env.AUTH_RATE_LIMIT_SECRET;
    await disconnectPrisma();
  });

  it("denies admin services without the reserved permission", async () => {
    const viewerContext = {
      ...adminContext,
      roleKeys: ["VIEWER"],
      permissions: ["customer.read" as const],
    };
    await expect(
      listAdminUsers(prisma, viewerContext, { limit: 25 }),
    ).rejects.toThrow("Permission is required");
  });

  it("invites a user with a one-time hashed token and completes activation", async () => {
    const result = await inviteOrganizationUser(prisma, adminContext, {
      email: "invited-user@example.test",
      displayName: "초대 사용자",
      departmentId: null,
      roleIds: [viewerRoleId],
      requestId: "invite-integration",
      config: config(),
    });
    invitedUserId = result.user.id;
    expect(result.user.status).toBe("INVITED");
    const token = new URL(result.invitationUrl).searchParams.get("token");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    if (!token) throw new Error("Invitation token is missing.");
    expect(
      await prisma.passwordResetToken.findUnique({
        where: { tokenHash: token },
      }),
    ).toBeNull();
    expect(
      await prisma.passwordResetToken.findUnique({
        where: { tokenHash: hashOpaqueToken(token) },
      }),
    ).not.toBeNull();

    await expect(
      completePasswordReset(prisma, {
        token,
        password: "Invited user phrase 2026!",
        requestId: "invite-complete",
      }),
    ).resolves.toEqual({ ok: true });
    const activated = await prisma.user.findUniqueOrThrow({
      where: { id: invitedUserId },
    });
    expect(activated.status).toBe("ACTIVE");
  });

  it("applies role changes on the next request and revokes a suspended session", async () => {
    const authenticated = await login(prisma, {
      email: "invited-user@example.test",
      password: "Invited user phrase 2026!",
      source: null,
      requestId: "invited-login",
      config: config(),
    });
    expect(authenticated.ok).toBe(true);
    if (!authenticated.ok) return;
    expect(authenticated.context.permissions).toContain("customer.read");
    expect(authenticated.context.permissions).not.toContain("order.edit");

    const before = await prisma.user.findUniqueOrThrow({
      where: { id: invitedUserId },
    });
    const updated = await updateOrganizationUser(
      prisma,
      adminContext,
      {
        userId: invitedUserId,
        roleIds: [designerRoleId],
        expectedUpdatedAt: before.updatedAt,
        requestId: "change-role",
      },
    );
    expect(updated.membership.roles.map(({ key }) => key)).toEqual([
      "DESIGNER",
    ]);
    const afterRoleChange = await getAuthenticatedContext(prisma, {
      token: authenticated.token,
      config: config(),
    });
    expect(afterRoleChange?.permissions).toContain("order.edit");

    await updateOrganizationUser(prisma, adminContext, {
      userId: invitedUserId,
      status: "SUSPENDED",
      expectedUpdatedAt: new Date(updated.updatedAt),
      requestId: "suspend-user",
    });
    await expect(
      getAuthenticatedContext(prisma, {
        token: authenticated.token,
        config: config(),
      }),
    ).resolves.toBeNull();
  });

  it("hides users from another organization", async () => {
    const otherOrganization = await prisma.organization.create({
      data: {
        code: "OTHER_TEST",
        name: "다른 조직",
      },
    });
    const otherUser = await prisma.user.create({
      data: {
        email: "other-org@example.test",
        normalizedEmail: "other-org@example.test",
        displayName: "다른 조직 사용자",
        status: "ACTIVE",
        memberships: {
          create: { organizationId: otherOrganization.id },
        },
      },
    });
    await expect(
      updateOrganizationUser(prisma, adminContext, {
        userId: otherUser.id,
        displayName: "침범",
        expectedUpdatedAt: otherUser.updatedAt,
        requestId: "cross-org",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("protects system roles and the reserved admin permission", async () => {
    const custom = await createOrganizationRole(prisma, adminContext, {
      key: "SHOP_TEAM",
      name: "현장팀",
      description: null,
      permissions: ["customer.read"],
      requestId: "create-custom-role",
    });
    await expect(
      updateOrganizationRole(prisma, adminContext, {
        roleId: administratorRoleId,
        name: "변조",
        expectedUpdatedAt: new Date(
          (
            await prisma.role.findUniqueOrThrow({
              where: { id: administratorRoleId },
            })
          ).updatedAt,
        ),
        requestId: "change-system-role",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      updateOrganizationRole(prisma, adminContext, {
        roleId: custom.id,
        permissions: ["admin.manage"],
        expectedUpdatedAt: new Date(custom.updatedAt),
        requestId: "reserve-admin",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      updateOrganizationRole(prisma, adminContext, {
        roleId: custom.id,
        permissions: ["audit.read"],
        expectedUpdatedAt: new Date(custom.updatedAt),
        requestId: "reserve-audit-read",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows only one of two concurrent last-administrator removals", async () => {
    const originalMembership = await prisma.organizationMembership.findUniqueOrThrow({
      where: { id: adminContext.membershipId },
    });
    await prisma.membershipRole.deleteMany({
      where: {
        membershipId: originalMembership.id,
        roleId: administratorRoleId,
      },
    });
    await prisma.membershipRole.create({
      data: {
        membershipId: originalMembership.id,
        roleId: viewerRoleId,
      },
    });
    const [left, right] = await Promise.all([
      createUserWithRole({
        email: "last-admin-left@example.test",
        displayName: "마지막 관리자 왼쪽",
        roleId: administratorRoleId,
      }),
      createUserWithRole({
        email: "last-admin-right@example.test",
        displayName: "마지막 관리자 오른쪽",
        roleId: administratorRoleId,
      }),
    ]);
    const results = await Promise.allSettled([
      updateOrganizationUser(prisma, adminContext, {
        userId: left.id,
        status: "SUSPENDED",
        expectedUpdatedAt: left.updatedAt,
        requestId: "last-admin-left",
      }),
      updateOrganizationUser(prisma, adminContext, {
        userId: right.id,
        status: "SUSPENDED",
        expectedUpdatedAt: right.updatedAt,
        requestId: "last-admin-right",
      }),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    const rejected = results.find(
      ({ status }) => status === "rejected",
    ) as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(AdminServiceError);
    expect(rejected.reason).toMatchObject({ code: "CONFLICT" });
    await expect(
      prisma.organizationMembership.count({
        where: {
          organizationId,
          user: { status: "ACTIVE" },
          roles: {
            some: {
              role: { key: "ADMINISTRATOR", active: true },
            },
          },
        },
      }),
    ).resolves.toBe(1);
  });
});

import "server-only";

import type {
  OrganizationStatus,
  Prisma,
  PrismaClient,
  UserStatus,
} from "@/generated/prisma/client";
import { permissionCatalog, systemRoleDefinitions } from "@/domain/permission";
import { AdminServiceError } from "@/server/admin/admin-error";
import { writeAuditEvent } from "@/server/audit/audit-writer";
import type { AuthRuntimeConfig } from "@/server/auth/auth-config";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { normalizeEmail } from "@/server/auth/email";
import { createOpaqueToken, hashOpaqueToken } from "@/server/auth/token";
import { requirePlatformAdmin } from "@/server/authorization/authorization";
import {
  canChangeOrganizationStatus,
  isValidOrganizationCode,
  normalizeOrganizationCode,
} from "@/server/organizations/organization-policy";
import type {
  PlatformOrganizationAdministratorDto,
  PlatformOrganizationAdministratorInvitationDto,
  PlatformOrganizationDto,
} from "@/server/organizations/organization-types";

type Transaction = Prisma.TransactionClient;

/** 새 조직에 기본으로 넣는 사업장. seed 의 `MAIN` 본사와 같다. */
const defaultBusinessSite = {
  code: "MAIN",
  name: "본사",
  type: "HEAD_OFFICE",
} as const;

function isPrismaErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function toDto(
  context: AuthenticatedContext,
  organization: {
    id: string;
    code: string;
    name: string;
    status: OrganizationStatus;
    createdAt: Date;
    updatedAt: Date;
    _count: { memberships: number };
    memberships: Array<{
      user: { id: string; email: string; displayName: string; status: UserStatus };
    }>;
  },
): PlatformOrganizationDto {
  return {
    id: organization.id,
    code: organization.code,
    name: organization.name,
    status: organization.status,
    memberCount: organization._count.memberships,
    administrators: organization.memberships.map(({ user }) => ({
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
    })),
    own: organization.id === context.organizationId,
    createdAt: organization.createdAt.toISOString(),
    updatedAt: organization.updatedAt.toISOString(),
  };
}

const organizationSelect = {
  id: true,
  code: true,
  name: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { memberships: { where: { status: "ACTIVE" } } } },
  // 회사를 맡은 관리자. 시스템 역할 `ADMINISTRATOR` 를 가진 활성 소속만 센다.
  memberships: {
    where: { status: "ACTIVE", roles: { some: { role: { key: "ADMINISTRATOR" } } } },
    orderBy: { joinedAt: "asc" },
    select: {
      user: { select: { id: true, email: true, displayName: true, status: true } },
    },
  },
} satisfies Prisma.OrganizationSelect;

export async function listPlatformOrganizations(
  prisma: PrismaClient,
  context: AuthenticatedContext,
): Promise<PlatformOrganizationDto[]> {
  requirePlatformAdmin(context);
  const organizations = await prisma.organization.findMany({
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: organizationSelect,
  });
  return organizations.map((organization) => toDto(context, organization));
}

/**
 * 시스템 역할을 새 조직에 복사한다. seed 와 같은 정의(`systemRoleDefinitions`)를 쓰므로
 * 권한 row 가 seed 되어 있어야 한다. 없으면 조직을 만들다 말고 실패시킨다 — 역할 없는
 * 조직은 관리자를 붙일 수 없어 쓸모가 없다.
 */
async function createSystemRoles(
  transaction: Transaction,
  organizationId: string,
): Promise<void> {
  const permissions = await transaction.permission.findMany({
    where: { key: { in: permissionCatalog.map(({ key }) => key) } },
    select: { id: true, key: true },
  });
  const permissionIdByKey = new Map(permissions.map(({ key, id }) => [key, id]));
  const missing = permissionCatalog
    .map(({ key }) => key)
    .filter((key) => !permissionIdByKey.has(key));
  if (missing.length > 0) {
    throw new Error(`Seed permissions are missing: ${missing.join(", ")}`);
  }
  for (const definition of systemRoleDefinitions) {
    await transaction.role.create({
      data: {
        organizationId,
        key: definition.key,
        name: definition.name,
        description: definition.description,
        system: true,
        permissions: {
          create: definition.permissions.map((key) => ({
            permissionId: permissionIdByKey.get(key)!,
          })),
        },
      },
    });
  }
}

export async function createPlatformOrganization(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: { code: string; name: string; requestId: string },
): Promise<PlatformOrganizationDto> {
  requirePlatformAdmin(context);
  const code = normalizeOrganizationCode(input.code);
  if (!isValidOrganizationCode(code)) {
    throw new AdminServiceError(
      "INVALID_REQUEST",
      "회사 코드는 영문 대문자·숫자·-·_ 조합 2~50자여야 합니다.",
    );
  }
  const name = input.name.trim();
  if (name.length === 0 || name.length > 200) {
    throw new AdminServiceError("INVALID_REQUEST", "회사 이름은 1~200자여야 합니다.");
  }
  try {
    const organization = await prisma.$transaction(async (transaction) => {
      const created = await transaction.organization.create({
        data: {
          code,
          name,
          companyProfile: { create: {} },
          businessSites: { create: { ...defaultBusinessSite, isDefault: true } },
        },
        select: organizationSelect,
      });
      await createSystemRoles(transaction, created.id);
      // 감사 이력은 만든 사람의 조직에 남긴다. 새 조직에는 아직 볼 사람이 없다.
      await writeAuditEvent(transaction, {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "platform.organization_created",
        entityId: created.id,
        requestId: input.requestId,
        after: { code: created.code, name: created.name, status: created.status },
      });
      return created;
    });
    return toDto(context, organization);
  } catch (error) {
    if (isPrismaErrorCode(error, "P2002")) {
      throw new AdminServiceError("CONFLICT", "이미 사용 중인 회사 코드입니다.");
    }
    throw error;
  }
}

export async function updatePlatformOrganization(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: {
    organizationId: string;
    name?: string;
    status?: OrganizationStatus;
    expectedUpdatedAt: Date;
    requestId: string;
    now?: Date;
  },
): Promise<PlatformOrganizationDto> {
  requirePlatformAdmin(context);
  const now = input.now ?? new Date();
  const name = input.name?.trim();
  if (name !== undefined && (name.length === 0 || name.length > 200)) {
    throw new AdminServiceError("INVALID_REQUEST", "회사 이름은 1~200자여야 합니다.");
  }
  return prisma.$transaction(async (transaction) => {
    const organization = await transaction.organization.findUnique({
      where: { id: input.organizationId },
      select: organizationSelect,
    });
    if (!organization) {
      throw new AdminServiceError("NOT_FOUND", "회사를 찾을 수 없습니다.");
    }
    if (organization.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
      throw new AdminServiceError(
        "CONFLICT",
        "회사 정보가 변경되었습니다. 새로고침 후 다시 시도해 주세요.",
      );
    }
    const nextStatus = input.status ?? organization.status;
    if (
      !canChangeOrganizationStatus({
        own: organization.id === context.organizationId,
        current: organization.status,
        next: nextStatus,
      })
    ) {
      throw new AdminServiceError(
        "FORBIDDEN",
        "자신이 속한 회사는 정지할 수 없습니다.",
      );
    }
    const updated = await transaction.organization.update({
      where: { id: organization.id },
      data: {
        name,
        status: input.status,
        lockVersion: { increment: 1 },
        updatedAt: now,
      },
      select: organizationSelect,
    });
    await writeAuditEvent(transaction, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "platform.organization_updated",
      entityId: updated.id,
      requestId: input.requestId,
      before: { name: organization.name, status: organization.status },
      after: { name: updated.name, status: updated.status },
    });
    return toDto(context, updated);
  });
}

function createResetUrl(origin: string, token: string): string {
  const url = new URL("/reset-password", origin);
  url.searchParams.set("token", token);
  return url.toString();
}

/**
 * 회사의 관리자 계정을 발급한다. 조직 관리자의 사용자 초대와 같은 흐름(`INVITED` + 일회용
 * 비밀번호 설정 주소)이되, 역할은 그 회사의 시스템 역할 `ADMINISTRATOR` 로 고정한다.
 * 이 계정으로 들어가면 그 회사의 사용자·부서·역할을 스스로 관리한다.
 */
export async function invitePlatformOrganizationAdministrator(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: {
    organizationId: string;
    email: string;
    displayName: string;
    requestId: string;
    config: AuthRuntimeConfig;
    now?: Date;
  },
): Promise<PlatformOrganizationAdministratorInvitationDto> {
  requirePlatformAdmin(context);
  const now = input.now ?? new Date();
  const displayName = input.displayName.trim();
  if (displayName.length === 0 || displayName.length > 100) {
    throw new AdminServiceError("INVALID_REQUEST", "관리자 이름은 1~100자여야 합니다.");
  }
  const normalizedEmail = normalizeEmail(input.email);
  const token = createOpaqueToken();
  const tokenHash = hashOpaqueToken(token);
  const expiresAt = new Date(now.getTime() + input.config.resetTokenMinutes * 60_000);

  try {
    const { organization, user } = await prisma.$transaction(async (transaction) => {
      const target = await transaction.organization.findUnique({
        where: { id: input.organizationId },
        select: {
          id: true,
          code: true,
          status: true,
          roles: { where: { key: "ADMINISTRATOR", system: true }, select: { id: true } },
        },
      });
      if (!target) throw new AdminServiceError("NOT_FOUND", "회사를 찾을 수 없습니다.");
      if (target.status !== "ACTIVE") {
        throw new AdminServiceError("FORBIDDEN", "정지된 회사에는 관리자를 발급할 수 없습니다.");
      }
      const administratorRole = target.roles[0];
      if (!administratorRole) {
        throw new AdminServiceError("CONFLICT", "이 회사에 관리자 역할이 없습니다.");
      }
      // 로그인은 활성 소속이 정확히 하나일 때만 된다. 다른 회사에 이미 있는 사용자를 붙이면
      // 그 사람의 로그인이 막히므로 새 이메일만 받는다.
      const existing = await transaction.user.findUnique({
        where: { normalizedEmail },
        select: { id: true },
      });
      if (existing) throw new AdminServiceError("CONFLICT", "이미 등록된 이메일입니다.");

      const created = await transaction.user.create({
        data: {
          email: input.email.trim(),
          normalizedEmail,
          displayName,
          status: "INVITED",
          memberships: {
            create: {
              organizationId: target.id,
              roles: { create: { roleId: administratorRole.id } },
            },
          },
          passwordResetTokens: { create: { tokenHash, expiresAt } },
        },
        select: { id: true, email: true, displayName: true, status: true },
      });
      await writeAuditEvent(transaction, {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "platform.organization_admin_invited",
        entityId: created.id,
        requestId: input.requestId,
        after: { organizationCode: target.code, status: created.status, roleKeys: ["ADMINISTRATOR"] },
        metadata: { expiresAt: expiresAt.toISOString() },
      });
      // 그 회사의 감사 로그에도 남긴다. 회사 관리자가 나중에 자기 회사의 시작을 볼 수 있어야 한다.
      await writeAuditEvent(transaction, {
        organizationId: target.id,
        actorUserId: context.userId,
        action: "admin.user_invited",
        entityId: created.id,
        requestId: input.requestId,
        after: { status: created.status, departmentId: null, roleKeys: ["ADMINISTRATOR"] },
        metadata: { expiresAt: expiresAt.toISOString() },
      });
      const reloaded = await transaction.organization.findUniqueOrThrow({
        where: { id: target.id },
        select: organizationSelect,
      });
      return { organization: reloaded, user: created };
    });
    const administrator: PlatformOrganizationAdministratorDto = {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
    };
    return {
      organization: toDto(context, organization),
      administrator,
      invitationUrl: createResetUrl(input.config.appOrigin, token),
    };
  } catch (error) {
    if (isPrismaErrorCode(error, "P2002")) {
      throw new AdminServiceError("CONFLICT", "이미 등록된 이메일입니다.");
    }
    throw error;
  }
}

import "server-only";

import type {
  Prisma,
  PrismaClient,
  UserStatus,
} from "@/generated/prisma/client";
import {
  isPermissionKey,
  isReservedAdministratorPermission,
  isSystemRoleKey,
  permissionCatalog,
  type PermissionKey,
} from "@/domain/permission";
import { AdminServiceError } from "@/server/admin/admin-error";
import { writeAuditEvent } from "@/server/audit/audit-writer";
import {
  countActiveAdministrators,
  findOrganizationUser,
  listOrganizationDepartments,
  listOrganizationRoles,
  listOrganizationUsers,
  resolveActiveDepartment,
  resolveAssignableRoles,
  toAdminUserDto,
} from "@/server/admin/admin-repository";
import {
  canChangeUserStatus,
  isValidCustomRoleKey,
  isValidDepartmentCode,
  normalizeRoleKey,
} from "@/server/admin/admin-policy";
import type {
  AdminDepartmentDto,
  AdminPermissionDto,
  AdminRoleDto,
  AdminUserDto,
  PaginatedAdminUsersDto,
} from "@/server/admin/admin-types";
import type { AuthRuntimeConfig } from "@/server/auth/auth-config";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { normalizeEmail } from "@/server/auth/email";
import { createOpaqueToken, hashOpaqueToken } from "@/server/auth/token";
import { requirePermission } from "@/server/authorization/authorization";

type Transaction = Prisma.TransactionClient;

function ensureAdmin(context: AuthenticatedContext): void {
  requirePermission(context, "admin.manage");
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

function isPrismaErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function isTransactionWriteConflict(error: unknown): boolean {
  if (isPrismaErrorCode(error, "P2034")) return true;
  if (typeof error !== "object" || error === null) return false;

  const mappedError =
    "cause" in error && typeof error.cause === "object" && error.cause !== null
      ? error.cause
      : error;

  return (
    "kind" in mappedError && mappedError.kind === "TransactionWriteConflict"
  );
}

async function runSerializable<T>(
  prisma: PrismaClient,
  operation: (transaction: Transaction) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: "Serializable",
      });
    } catch (error) {
      if (isTransactionWriteConflict(error) && attempt === 0) continue;
      if (isTransactionWriteConflict(error)) {
        throw new AdminServiceError(
          "CONFLICT",
          "다른 관리자가 먼저 변경했습니다. 새로고침 후 다시 시도해 주세요.",
        );
      }
      throw error;
    }
  }
  throw new AdminServiceError("CONFLICT", "동시 변경을 처리하지 못했습니다.");
}

async function lockOrganizationAdminState(
  transaction: Transaction,
  organizationId: string,
): Promise<void> {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "Organization"
    WHERE "id" = ${organizationId}::uuid
    FOR UPDATE
  `;
}

async function runOrganizationAdminMutation<T>(
  prisma: PrismaClient,
  organizationId: string,
  operation: (transaction: Transaction) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (transaction) => {
      await lockOrganizationAdminState(transaction, organizationId);
      return operation(transaction);
    },
    { isolationLevel: "ReadCommitted" },
  );
}

async function validateDepartment(
  database: Transaction,
  organizationId: string,
  departmentId: string | null,
): Promise<void> {
  if (
    departmentId &&
    !(await resolveActiveDepartment(database, organizationId, departmentId))
  ) {
    throw new AdminServiceError("NOT_FOUND", "활성 부서를 찾을 수 없습니다.");
  }
}

async function validateRoles(
  database: Transaction,
  organizationId: string,
  roleIds: string[],
) {
  const uniqueRoleIds = uniqueValues(roleIds);
  if (uniqueRoleIds.length === 0) {
    throw new AdminServiceError(
      "INVALID_REQUEST",
      "사용자에게 역할을 하나 이상 지정해야 합니다.",
    );
  }
  const roles = await resolveAssignableRoles(
    database,
    organizationId,
    uniqueRoleIds,
  );
  if (roles.length !== uniqueRoleIds.length) {
    throw new AdminServiceError(
      "NOT_FOUND",
      "현재 조직의 활성 역할을 찾을 수 없습니다.",
    );
  }
  return roles;
}

function createResetUrl(origin: string, token: string): string {
  const url = new URL("/reset-password", origin);
  url.searchParams.set("token", token);
  return url.toString();
}

export async function listAdminUsers(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: {
    query?: string;
    status?: UserStatus;
    cursor?: string;
    limit: number;
  },
): Promise<PaginatedAdminUsersDto> {
  ensureAdmin(context);
  return listOrganizationUsers(prisma, {
    organizationId: context.organizationId,
    ...input,
  });
}

export async function listAdminDepartments(
  prisma: PrismaClient,
  context: AuthenticatedContext,
): Promise<AdminDepartmentDto[]> {
  ensureAdmin(context);
  return listOrganizationDepartments(prisma, context.organizationId);
}

export async function listAdminRoles(
  prisma: PrismaClient,
  context: AuthenticatedContext,
): Promise<AdminRoleDto[]> {
  ensureAdmin(context);
  return listOrganizationRoles(prisma, context.organizationId);
}

export function listAdminPermissions(
  context: AuthenticatedContext,
): AdminPermissionDto[] {
  ensureAdmin(context);
  return permissionCatalog.map(({ key, description }) => ({
    key,
    description,
  }));
}

export async function inviteOrganizationUser(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: {
    email: string;
    displayName: string;
    departmentId: string | null;
    roleIds: string[];
    requestId: string;
    config: AuthRuntimeConfig;
    now?: Date;
  },
): Promise<{ user: AdminUserDto; invitationUrl: string }> {
  ensureAdmin(context);
  const now = input.now ?? new Date();
  const normalizedEmail = normalizeEmail(input.email);
  const token = createOpaqueToken();
  const tokenHash = hashOpaqueToken(token);
  const expiresAt = new Date(
    now.getTime() + input.config.resetTokenMinutes * 60_000,
  );

  let createdUserId: string;
  try {
    createdUserId = await runSerializable(prisma, async (transaction) => {
      const existingUser = await transaction.user.findUnique({
        where: { normalizedEmail },
        select: { id: true },
      });
      if (existingUser) {
        throw new AdminServiceError(
          "CONFLICT",
          "이미 등록된 이메일입니다.",
        );
      }
      await validateDepartment(
        transaction,
        context.organizationId,
        input.departmentId,
      );
      const roles = await validateRoles(
        transaction,
        context.organizationId,
        input.roleIds,
      );
      const user = await transaction.user.create({
        data: {
          email: input.email.trim(),
          normalizedEmail,
          displayName: input.displayName.trim(),
          status: "INVITED",
          memberships: {
            create: {
              organizationId: context.organizationId,
              departmentId: input.departmentId,
              roles: {
                create: roles.map((role) => ({ roleId: role.id })),
              },
            },
          },
          passwordResetTokens: {
            create: {
              tokenHash,
              expiresAt,
            },
          },
        },
        select: { id: true },
      });
      await writeAuditEvent(transaction, {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "admin.user_invited",
        entityId: user.id,
        requestId: input.requestId,
        after: {
          status: "INVITED",
          departmentId: input.departmentId,
          roleKeys: roles.map(({ key }) => key).sort(),
        },
        metadata: {
          expiresAt: expiresAt.toISOString(),
        },
      });
      return user.id;
    });
  } catch (error) {
    if (isPrismaErrorCode(error, "P2002")) {
      throw new AdminServiceError("CONFLICT", "이미 등록된 이메일입니다.");
    }
    throw error;
  }

  const created = await findOrganizationUser(
    prisma,
    context.organizationId,
    createdUserId,
  );
  if (!created) throw new Error("Created user could not be reloaded.");
  return {
    user: toAdminUserDto(created),
    invitationUrl: createResetUrl(input.config.appOrigin, token),
  };
}

export async function issueOrganizationUserPasswordReset(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: {
    userId: string;
    requestId: string;
    config: AuthRuntimeConfig;
    now?: Date;
  },
): Promise<{ passwordResetUrl: string }> {
  ensureAdmin(context);
  const now = input.now ?? new Date();
  const token = createOpaqueToken();
  const tokenHash = hashOpaqueToken(token);
  const expiresAt = new Date(
    now.getTime() + input.config.resetTokenMinutes * 60_000,
  );

  await runSerializable(prisma, async (transaction) => {
    const target = await findOrganizationUser(
      transaction,
      context.organizationId,
      input.userId,
    );
    if (!target) {
      throw new AdminServiceError("NOT_FOUND", "사용자를 찾을 수 없습니다.");
    }
    if (target.status !== "INVITED" && target.status !== "ACTIVE") {
      throw new AdminServiceError(
        "INVALID_REQUEST",
        "활성 또는 초대 상태 사용자만 비밀번호 링크를 발급할 수 있습니다.",
      );
    }
    await transaction.passwordResetToken.updateMany({
      where: { userId: target.id, usedAt: null },
      data: { usedAt: now },
    });
    await transaction.passwordResetToken.create({
      data: {
        userId: target.id,
        tokenHash,
        expiresAt,
      },
    });
    await writeAuditEvent(transaction, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "admin.password_reset_issued",
      entityId: target.id,
      requestId: input.requestId,
      after: { expiresAt: expiresAt.toISOString() },
    });
  });

  return {
    passwordResetUrl: createResetUrl(input.config.appOrigin, token),
  };
}

export async function updateOrganizationUser(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: {
    userId: string;
    displayName?: string;
    status?: UserStatus;
    departmentId?: string | null;
    roleIds?: string[];
    expectedUpdatedAt: Date;
    requestId: string;
    now?: Date;
  },
): Promise<AdminUserDto> {
  ensureAdmin(context);
  const now = input.now ?? new Date();

  await runOrganizationAdminMutation(
    prisma,
    context.organizationId,
    async (transaction) => {
    const target = await findOrganizationUser(
      transaction,
      context.organizationId,
      input.userId,
    );
    const membership = target?.memberships[0];
    if (!target || !membership) {
      throw new AdminServiceError("NOT_FOUND", "사용자를 찾을 수 없습니다.");
    }
    if (target.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
      throw new AdminServiceError(
        "CONFLICT",
        "사용자 정보가 변경되었습니다. 새로고침 후 다시 시도해 주세요.",
      );
    }

    const nextStatus = input.status ?? target.status;
    if (!canChangeUserStatus(target.status, nextStatus)) {
      throw new AdminServiceError(
        "INVALID_REQUEST",
        "허용되지 않은 사용자 상태 변경입니다.",
      );
    }
    if (target.id === context.userId && nextStatus !== "ACTIVE") {
      throw new AdminServiceError(
        "FORBIDDEN",
        "현재 로그인한 자기 계정은 정지할 수 없습니다.",
      );
    }

    if (input.departmentId !== undefined) {
      await validateDepartment(
        transaction,
        context.organizationId,
        input.departmentId,
      );
    }
    const nextRoles =
      input.roleIds === undefined
        ? null
        : await validateRoles(
            transaction,
            context.organizationId,
            input.roleIds,
          );
    const currentRoleKeys = membership.roles
      .map(({ role }) => role.key)
      .sort();
    const nextRoleKeys =
      nextRoles?.map(({ key }) => key).sort() ?? currentRoleKeys;
    const removesActiveAdministrator =
      target.status === "ACTIVE" &&
      currentRoleKeys.includes("ADMINISTRATOR") &&
      (nextStatus !== "ACTIVE" ||
        !nextRoleKeys.includes("ADMINISTRATOR"));
    const activeAdministratorCount = removesActiveAdministrator
      ? await countActiveAdministrators(transaction, context.organizationId)
      : null;
    if (
      removesActiveAdministrator &&
      activeAdministratorCount !== null &&
      activeAdministratorCount <= 1
    ) {
      throw new AdminServiceError(
        "CONFLICT",
        "마지막 활성 관리자는 정지하거나 관리자 역할을 제거할 수 없습니다.",
      );
    }

    await transaction.user.update({
      where: { id: target.id },
      data: {
        displayName: input.displayName?.trim(),
        status: nextStatus,
        updatedAt: now,
      },
    });
    if (input.departmentId !== undefined) {
      await transaction.organizationMembership.update({
        where: { id: membership.id },
        data: { departmentId: input.departmentId },
      });
    }
    if (nextRoles) {
      await transaction.membershipRole.deleteMany({
        where: { membershipId: membership.id },
      });
      await transaction.membershipRole.createMany({
        data: nextRoles.map((role) => ({
          membershipId: membership.id,
          roleId: role.id,
        })),
      });
    }
    if (target.status !== nextStatus && nextStatus !== "ACTIVE") {
      await transaction.authSession.updateMany({
        where: { userId: target.id, revokedAt: null },
        data: { revokedAt: now },
      });
    }
    if (
      input.departmentId !== undefined ||
      input.displayName !== undefined
    ) {
      await writeAuditEvent(transaction, {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "admin.user_updated",
        entityId: target.id,
        requestId: input.requestId,
        before: {
          displayName: target.displayName,
          departmentId: membership.department?.id ?? null,
        },
        after: {
          displayName: input.displayName?.trim() ?? target.displayName,
          departmentId:
            input.departmentId !== undefined
              ? input.departmentId
              : membership.department?.id ?? null,
        },
      });
    }
    if (target.status !== nextStatus) {
      await writeAuditEvent(transaction, {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "admin.user_status_changed",
        entityId: target.id,
        requestId: input.requestId,
        before: { status: target.status },
        after: { status: nextStatus },
      });
    }
    if (currentRoleKeys.join("\0") !== nextRoleKeys.join("\0")) {
      await writeAuditEvent(transaction, {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "admin.user_roles_changed",
        entityId: membership.id,
        requestId: input.requestId,
        before: { roleKeys: currentRoleKeys },
        after: { roleKeys: nextRoleKeys },
      });
    }
    },
  );

  const updated = await findOrganizationUser(
    prisma,
    context.organizationId,
    input.userId,
  );
  if (!updated) throw new Error("Updated user could not be reloaded.");
  return toAdminUserDto(updated);
}

export async function createOrganizationDepartment(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: {
    code: string;
    name: string;
    requestId: string;
  },
): Promise<AdminDepartmentDto> {
  ensureAdmin(context);
  const code = input.code.trim().toUpperCase();
  if (!isValidDepartmentCode(code)) {
    throw new AdminServiceError(
      "INVALID_REQUEST",
      "부서 코드는 영문 대문자·숫자·-·_ 조합 2~50자여야 합니다.",
    );
  }
  try {
    const department = await prisma.$transaction(async (transaction) => {
      const created = await transaction.department.create({
        data: {
          organizationId: context.organizationId,
          code,
          name: input.name.trim(),
        },
      });
      await writeAuditEvent(transaction, {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "admin.department_created",
        entityId: created.id,
        requestId: input.requestId,
        after: {
          code: created.code,
          name: created.name,
          active: created.active,
        },
      });
      return created;
    });
    return {
      id: department.id,
      code: department.code,
      name: department.name,
      active: department.active,
      updatedAt: department.updatedAt.toISOString(),
    };
  } catch (error) {
    if (isPrismaErrorCode(error, "P2002")) {
      throw new AdminServiceError("CONFLICT", "이미 사용 중인 부서 코드입니다.");
    }
    throw error;
  }
}

export async function updateOrganizationDepartment(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: {
    departmentId: string;
    name?: string;
    active?: boolean;
    expectedUpdatedAt: Date;
    requestId: string;
    now?: Date;
  },
): Promise<AdminDepartmentDto> {
  ensureAdmin(context);
  const now = input.now ?? new Date();
  return runSerializable(prisma, async (transaction) => {
    const department = await transaction.department.findFirst({
      where: {
        id: input.departmentId,
        organizationId: context.organizationId,
      },
    });
    if (!department) {
      throw new AdminServiceError("NOT_FOUND", "부서를 찾을 수 없습니다.");
    }
    if (department.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
      throw new AdminServiceError(
        "CONFLICT",
        "부서 정보가 변경되었습니다. 새로고침 후 다시 시도해 주세요.",
      );
    }
    const updated = await transaction.department.update({
      where: { id: department.id },
      data: {
        name: input.name?.trim(),
        active: input.active,
        updatedAt: now,
      },
    });
    await writeAuditEvent(transaction, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "admin.department_updated",
      entityId: updated.id,
      requestId: input.requestId,
      before: {
        name: department.name,
        active: department.active,
      },
      after: {
        name: updated.name,
        active: updated.active,
      },
    });
    return {
      id: updated.id,
      code: updated.code,
      name: updated.name,
      active: updated.active,
      updatedAt: updated.updatedAt.toISOString(),
    };
  });
}

async function resolveCustomRolePermissions(
  database: Transaction,
  permissionKeys: PermissionKey[],
) {
  const uniqueKeys = uniqueValues(permissionKeys).filter(isPermissionKey);
  if (uniqueKeys.some(isReservedAdministratorPermission)) {
    throw new AdminServiceError(
      "FORBIDDEN",
      "예약된 관리 권한은 관리자 system role에만 부여할 수 있습니다.",
    );
  }
  const permissions = await database.permission.findMany({
    where: { key: { in: uniqueKeys } },
    select: { id: true, key: true },
  });
  if (permissions.length !== uniqueKeys.length) {
    throw new AdminServiceError(
      "INVALID_REQUEST",
      "알 수 없는 permission이 포함되어 있습니다.",
    );
  }
  return permissions;
}

export async function createOrganizationRole(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: {
    key: string;
    name: string;
    description: string | null;
    permissions: PermissionKey[];
    requestId: string;
  },
): Promise<AdminRoleDto> {
  ensureAdmin(context);
  const key = normalizeRoleKey(input.key);
  if (!isValidCustomRoleKey(key) || isSystemRoleKey(key)) {
    throw new AdminServiceError(
      "INVALID_REQUEST",
      "사용할 수 없는 custom role key입니다.",
    );
  }
  try {
    const roleId = await prisma.$transaction(async (transaction) => {
      const permissions = await resolveCustomRolePermissions(
        transaction,
        input.permissions,
      );
      const role = await transaction.role.create({
        data: {
          organizationId: context.organizationId,
          key,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          system: false,
          permissions: {
            create: permissions.map((permission) => ({
              permissionId: permission.id,
            })),
          },
        },
        select: { id: true },
      });
      await writeAuditEvent(transaction, {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "admin.role_created",
        entityId: role.id,
        requestId: input.requestId,
        after: {
          key,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          active: true,
          permissions: permissions.map(({ key: permissionKey }) => permissionKey),
        },
      });
      return role.id;
    });
    const role = (await listOrganizationRoles(
      prisma,
      context.organizationId,
    )).find(({ id }) => id === roleId);
    if (!role) throw new Error("Created role could not be reloaded.");
    return role;
  } catch (error) {
    if (isPrismaErrorCode(error, "P2002")) {
      throw new AdminServiceError("CONFLICT", "이미 사용 중인 role key입니다.");
    }
    throw error;
  }
}

export async function updateOrganizationRole(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: {
    roleId: string;
    name?: string;
    description?: string | null;
    active?: boolean;
    permissions?: PermissionKey[];
    expectedUpdatedAt: Date;
    requestId: string;
    now?: Date;
  },
): Promise<AdminRoleDto> {
  ensureAdmin(context);
  const now = input.now ?? new Date();
  await runSerializable(prisma, async (transaction) => {
    const role = await transaction.role.findFirst({
      where: {
        id: input.roleId,
        organizationId: context.organizationId,
      },
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        active: true,
        system: true,
        updatedAt: true,
        permissions: {
          select: {
            permission: { select: { key: true } },
          },
        },
      },
    });
    if (!role) {
      throw new AdminServiceError("NOT_FOUND", "역할을 찾을 수 없습니다.");
    }
    if (role.system) {
      throw new AdminServiceError(
        "FORBIDDEN",
        "system role은 직접 수정할 수 없습니다.",
      );
    }
    if (role.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
      throw new AdminServiceError(
        "CONFLICT",
        "역할 정보가 변경되었습니다. 새로고침 후 다시 시도해 주세요.",
      );
    }
    const permissions =
      input.permissions === undefined
        ? null
        : await resolveCustomRolePermissions(
            transaction,
            input.permissions,
          );
    await transaction.role.update({
      where: { id: role.id },
      data: {
        name: input.name?.trim(),
        description:
          input.description === undefined
            ? undefined
            : input.description?.trim() || null,
        active: input.active,
        updatedAt: now,
      },
    });
    if (permissions) {
      await transaction.rolePermission.deleteMany({
        where: { roleId: role.id },
      });
      if (permissions.length > 0) {
        await transaction.rolePermission.createMany({
          data: permissions.map((permission) => ({
            roleId: role.id,
            permissionId: permission.id,
          })),
        });
      }
    }
    await writeAuditEvent(transaction, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "admin.role_updated",
      entityId: role.id,
      requestId: input.requestId,
      before: {
        name: role.name,
        description: role.description,
        active: role.active,
        permissions: role.permissions
          .map(({ permission }) => permission.key)
          .sort(),
      },
      after: {
        name: input.name?.trim() ?? role.name,
        description:
          input.description === undefined
            ? role.description
            : input.description?.trim() || null,
        active: input.active ?? role.active,
        permissions:
          permissions?.map(({ key }) => key).sort() ??
          role.permissions.map(({ permission }) => permission.key).sort(),
      },
    });
  });
  const updated = (await listOrganizationRoles(
    prisma,
    context.organizationId,
  )).find(({ id }) => id === input.roleId);
  if (!updated) throw new Error("Updated role could not be reloaded.");
  return updated;
}

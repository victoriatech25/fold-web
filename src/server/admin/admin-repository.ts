import "server-only";

import type {
  Prisma,
  PrismaClient,
  UserStatus,
} from "@/generated/prisma/client";
import {
  isPermissionKey,
  type PermissionKey,
} from "@/domain/permission";
import type {
  AdminDepartmentDto,
  AdminRoleDto,
  AdminUserDto,
  PaginatedAdminUsersDto,
} from "@/server/admin/admin-types";
import type { DatabaseClient } from "@/server/auth/auth-repository";

const userSelect = {
  id: true,
  email: true,
  displayName: true,
  status: true,
  lastLoginAt: true,
  updatedAt: true,
  memberships: {
    select: {
      id: true,
      department: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
      roles: {
        where: { role: { active: true } },
        select: {
          role: {
            select: {
              id: true,
              key: true,
              name: true,
              system: true,
            },
          },
        },
      },
    },
  },
} as const satisfies Prisma.UserSelect;

type SelectedUser = Prisma.UserGetPayload<{ select: typeof userSelect }>;

function toAdminUserDto(user: SelectedUser): AdminUserDto {
  const membership = user.memberships[0];
  if (!membership) {
    throw new Error("Organization-scoped user is missing its membership.");
  }
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    updatedAt: user.updatedAt.toISOString(),
    membership: {
      id: membership.id,
      department: membership.department,
      roles: membership.roles
        .map(({ role }) => role)
        .sort((left, right) => left.key.localeCompare(right.key)),
    },
  };
}

export async function listOrganizationUsers(
  database: PrismaClient,
  input: {
    organizationId: string;
    query?: string;
    status?: UserStatus;
    cursor?: string;
    limit: number;
  },
): Promise<PaginatedAdminUsersDto> {
  const users = await database.user.findMany({
    where: {
      status: input.status,
      memberships: {
        some: {
          organizationId: input.organizationId,
          status: "ACTIVE",
        },
      },
      ...(input.query
        ? {
            OR: [
              {
                displayName: {
                  contains: input.query,
                  mode: "insensitive" as const,
                },
              },
              {
                email: {
                  contains: input.query,
                  mode: "insensitive" as const,
                },
              },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    cursor: input.cursor ? { id: input.cursor } : undefined,
    skip: input.cursor ? 1 : 0,
    take: input.limit + 1,
    select: {
      ...userSelect,
      memberships: {
        where: {
          organizationId: input.organizationId,
          status: "ACTIVE",
        },
        take: 1,
        select: userSelect.memberships.select,
      },
    },
  });
  const hasMore = users.length > input.limit;
  const items = users.slice(0, input.limit);
  return {
    items: items.map(toAdminUserDto),
    nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
  };
}

export async function findOrganizationUser(
  database: DatabaseClient,
  organizationId: string,
  userId: string,
) {
  return database.user.findFirst({
    where: {
      id: userId,
      memberships: {
        some: {
          organizationId,
          status: "ACTIVE",
        },
      },
    },
    select: {
      ...userSelect,
      memberships: {
        where: {
          organizationId,
          status: "ACTIVE",
        },
        take: 1,
        select: userSelect.memberships.select,
      },
    },
  });
}

export async function listOrganizationDepartments(
  database: DatabaseClient,
  organizationId: string,
): Promise<AdminDepartmentDto[]> {
  const departments = await database.department.findMany({
    where: { organizationId },
    orderBy: [{ active: "desc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      active: true,
      updatedAt: true,
    },
  });
  return departments.map((department) => ({
    ...department,
    updatedAt: department.updatedAt.toISOString(),
  }));
}

export async function listOrganizationRoles(
  database: DatabaseClient,
  organizationId: string,
): Promise<AdminRoleDto[]> {
  const roles = await database.role.findMany({
    where: { organizationId },
    orderBy: [{ system: "desc" }, { key: "asc" }],
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      system: true,
      active: true,
      updatedAt: true,
      permissions: {
        select: {
          permission: { select: { key: true } },
        },
      },
    },
  });
  return roles.map((role) => ({
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    system: role.system,
    active: role.active,
    permissions: role.permissions
      .map(({ permission }) => permission.key)
      .filter(isPermissionKey)
      .sort(),
    updatedAt: role.updatedAt.toISOString(),
  }));
}

export async function resolveActiveDepartment(
  database: DatabaseClient,
  organizationId: string,
  departmentId: string | null,
): Promise<{ id: string } | null> {
  if (!departmentId) return null;
  return database.department.findFirst({
    where: {
      id: departmentId,
      organizationId,
      active: true,
    },
    select: { id: true },
  });
}

export async function resolveAssignableRoles(
  database: DatabaseClient,
  organizationId: string,
  roleIds: string[],
) {
  return database.role.findMany({
    where: {
      id: { in: roleIds },
      organizationId,
      active: true,
    },
    select: {
      id: true,
      key: true,
      system: true,
      permissions: {
        select: {
          permission: { select: { key: true } },
        },
      },
    },
  });
}

export function countActiveAdministrators(
  database: DatabaseClient,
  organizationId: string,
): Promise<number> {
  return database.organizationMembership.count({
    where: {
      organizationId,
      status: "ACTIVE",
      user: { status: "ACTIVE" },
      roles: {
        some: {
          role: {
            organizationId,
            key: "ADMINISTRATOR",
            active: true,
          },
        },
      },
    },
  });
}

export function mapPermissionKeys(
  permissions: Array<{ permission: { key: string } }>,
): PermissionKey[] {
  return permissions
    .map(({ permission }) => permission.key)
    .filter(isPermissionKey)
    .sort();
}

export { toAdminUserDto };

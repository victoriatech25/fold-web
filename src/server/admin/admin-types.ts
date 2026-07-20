import type { PermissionKey } from "@/domain/permission";

export type AdminRoleSummaryDto = {
  id: string;
  key: string;
  name: string;
  system: boolean;
};

export type AdminUserDto = {
  id: string;
  email: string;
  displayName: string;
  status: "INVITED" | "ACTIVE" | "SUSPENDED" | "DISABLED";
  lastLoginAt: string | null;
  updatedAt: string;
  membership: {
    id: string;
    department: {
      id: string;
      code: string;
      name: string;
    } | null;
    roles: AdminRoleSummaryDto[];
  };
};

export type AdminDepartmentDto = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  updatedAt: string;
};

export type AdminRoleDto = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  system: boolean;
  active: boolean;
  permissions: PermissionKey[];
  updatedAt: string;
};

export type AdminPermissionDto = {
  key: PermissionKey;
  description: string;
};

export type PaginatedAdminUsersDto = {
  items: AdminUserDto[];
  nextCursor: string | null;
};

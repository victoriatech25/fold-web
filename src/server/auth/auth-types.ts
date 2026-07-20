import type { PermissionKey } from "@/domain/permission";

export type AuthenticatedContext = {
  sessionId: string;
  userId: string;
  displayName: string;
  membershipId: string;
  departmentId: string | null;
  organizationId: string;
  organizationCode: string;
  organizationName: string;
  roleKeys: string[];
  permissions: PermissionKey[];
  expiresAt: Date;
};

export type SessionUserDto = {
  userId: string;
  displayName: string;
  organization: {
    id: string;
    code: string;
    name: string;
  };
  capabilities: PermissionKey[];
  expiresAt: string;
};

export function toSessionUserDto(
  context: AuthenticatedContext,
): SessionUserDto {
  return {
    userId: context.userId,
    displayName: context.displayName,
    organization: {
      id: context.organizationId,
      code: context.organizationCode,
      name: context.organizationName,
    },
    capabilities: [...context.permissions].sort(),
    expiresAt: context.expiresAt.toISOString(),
  };
}

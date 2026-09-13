import type { PermissionKey } from "@/domain/permission";

export type AuthenticatedContext = {
  sessionId: string;
  userId: string;
  displayName: string;
  /** 플랫폼 관리자 여부. 조직 권한(`permissions`)과 별개로 조직을 등록·관리할 수 있다. */
  platformAdmin: boolean;
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
  platformAdmin: boolean;
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
    platformAdmin: context.platformAdmin,
    organization: {
      id: context.organizationId,
      code: context.organizationCode,
      name: context.organizationName,
    },
    capabilities: [...context.permissions].sort(),
    expiresAt: context.expiresAt.toISOString(),
  };
}

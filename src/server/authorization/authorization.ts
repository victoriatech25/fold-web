import "server-only";

import type { PermissionKey } from "@/domain/permission";
import type { AuthenticatedContext } from "@/server/auth/auth-types";

export class PermissionDeniedError extends Error {
  constructor(readonly permission: PermissionKey) {
    super(`Permission is required: ${permission}`);
    this.name = "PermissionDeniedError";
  }
}

export function hasPermission(
  context: AuthenticatedContext,
  permission: PermissionKey,
): boolean {
  return context.permissions.includes(permission);
}

export function requirePermission(
  context: AuthenticatedContext,
  permission: PermissionKey,
): AuthenticatedContext {
  if (!hasPermission(context, permission)) {
    throw new PermissionDeniedError(permission);
  }
  return context;
}

export function requireSameOrganization(
  context: AuthenticatedContext,
  organizationId: string,
): void {
  if (context.organizationId !== organizationId) {
    throw new PermissionDeniedError("admin.manage");
  }
}

export class PlatformAdminRequiredError extends Error {
  constructor() {
    super("Platform administrator is required.");
    this.name = "PlatformAdminRequiredError";
  }
}

/** 조직 경계를 넘는 작업(조직 등록·상태 변경)은 조직 권한이 아니라 플랫폼 관리자 플래그로 연다. */
export function isPlatformAdmin(context: AuthenticatedContext): boolean {
  return context.platformAdmin;
}

export function requirePlatformAdmin(
  context: AuthenticatedContext,
): AuthenticatedContext {
  if (!isPlatformAdmin(context)) throw new PlatformAdminRequiredError();
  return context;
}

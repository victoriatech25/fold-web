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

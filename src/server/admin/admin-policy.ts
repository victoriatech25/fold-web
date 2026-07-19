import type { UserStatus } from "@/generated/prisma/client";

const transitions: Record<UserStatus, readonly UserStatus[]> = {
  INVITED: ["INVITED", "DISABLED"],
  ACTIVE: ["ACTIVE", "SUSPENDED", "DISABLED"],
  SUSPENDED: ["SUSPENDED", "ACTIVE", "DISABLED"],
  DISABLED: ["DISABLED", "ACTIVE"],
};

export function canChangeUserStatus(
  current: UserStatus,
  next: UserStatus,
): boolean {
  return transitions[current].includes(next);
}

export function normalizeRoleKey(value: string): string {
  return value.trim().toUpperCase().replaceAll("-", "_");
}

export function isValidCustomRoleKey(value: string): boolean {
  return /^[A-Z][A-Z0-9_]{2,49}$/.test(value);
}

export function isValidDepartmentCode(value: string): boolean {
  return /^[A-Z0-9][A-Z0-9_-]{1,49}$/.test(value);
}

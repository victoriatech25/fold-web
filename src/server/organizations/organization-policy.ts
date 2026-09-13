import type { OrganizationStatus } from "@/generated/prisma/client";

/** `bootstrap-admin` 과 seed 가 받는 조직 코드 규칙과 같다. 대문자·숫자·`-`·`_` 2~50자. */
export function isValidOrganizationCode(value: string): boolean {
  return /^[A-Z0-9][A-Z0-9_-]{1,49}$/.test(value);
}

export function normalizeOrganizationCode(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * 자기 조직은 정지할 수 없다. 정지하면 그 조직 소속 세션이 모두 끊기므로
 * 플랫폼 관리자 자신도 잠겨 되돌릴 사람이 없어진다.
 */
export function canChangeOrganizationStatus(input: {
  own: boolean;
  current: OrganizationStatus;
  next: OrganizationStatus;
}): boolean {
  if (input.current === input.next) return true;
  if (input.own && input.next === "SUSPENDED") return false;
  return true;
}

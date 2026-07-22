import type {
  AuditCategory,
  AuditOutcome,
  AuditSource,
  Prisma,
} from "@/generated/prisma/client";

export const auditActionCatalog = {
  "auth.admin_bootstrapped": {
    category: "AUTHENTICATION",
    defaultOutcome: "SUCCESS",
    defaultSource: "CLI",
    entityType: "User",
    label: "최초 관리자 생성",
  },
  "auth.login_failed": {
    category: "AUTHENTICATION",
    defaultOutcome: "DENIED",
    defaultSource: "WEB",
    entityType: "User",
    label: "로그인 실패",
  },
  "auth.login_succeeded": {
    category: "AUTHENTICATION",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "User",
    label: "로그인 성공",
  },
  "auth.logout": {
    category: "AUTHENTICATION",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "User",
    label: "로그아웃",
  },
  "auth.password_reset_issued": {
    category: "AUTHENTICATION",
    defaultOutcome: "SUCCESS",
    defaultSource: "CLI",
    entityType: "User",
    label: "CLI 비밀번호 설정 주소 발급",
  },
  "auth.password_reset_completed": {
    category: "AUTHENTICATION",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "User",
    label: "비밀번호 설정 완료",
  },
  "admin.user_invited": {
    category: "ADMINISTRATION",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "User",
    label: "사용자 초대",
  },
  "admin.user_updated": {
    category: "ADMINISTRATION",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "User",
    label: "사용자 정보 변경",
  },
  "admin.user_status_changed": {
    category: "ADMINISTRATION",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "User",
    label: "사용자 상태 변경",
  },
  "admin.user_roles_changed": {
    category: "ADMINISTRATION",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "OrganizationMembership",
    label: "사용자 역할 변경",
  },
  "admin.password_reset_issued": {
    category: "ADMINISTRATION",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "User",
    label: "관리자 비밀번호 설정 주소 발급",
  },
  "admin.department_created": {
    category: "ADMINISTRATION",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "Department",
    label: "부서 생성",
  },
  "admin.department_updated": {
    category: "ADMINISTRATION",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "Department",
    label: "부서 변경",
  },
  "admin.role_created": {
    category: "ADMINISTRATION",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "Role",
    label: "사용자 정의 역할 생성",
  },
  "admin.role_updated": {
    category: "ADMINISTRATION",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "Role",
    label: "사용자 정의 역할 변경",
  },
  "audit.events_viewed": {
    category: "ADMINISTRATION",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "AuditEvent",
    label: "감사 로그 목록 조회",
  },
  "audit.event_viewed": {
    category: "ADMINISTRATION",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "AuditEvent",
    label: "감사 로그 상세 조회",
  },
  "authorization.permission_denied": {
    category: "ADMINISTRATION",
    defaultOutcome: "DENIED",
    defaultSource: "WEB",
    entityType: "Permission",
    label: "권한 없는 접근 거부",
  },
  "platform.database_smoke": {
    category: "SYSTEM",
    defaultOutcome: "SUCCESS",
    defaultSource: "SYSTEM",
    entityType: "Platform",
    label: "데이터베이스 내부 검증",
  },
} as const satisfies Record<
  string,
  {
    category: AuditCategory;
    defaultOutcome: AuditOutcome;
    defaultSource: AuditSource;
    entityType: string;
    label: string;
  }
>;

export type AuditAction = keyof typeof auditActionCatalog;

const forbiddenKeyPattern =
  /(password|token|cookie|authorization|secret|credential)/i;
const fingerprintPattern = /^[0-9a-f]{64}$/;
const maxPayloadBytes = 16_384;
const maxDepth = 8;

export class AuditPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditPayloadError";
  }
}

function inspectAuditValue(
  value: unknown,
  path: string,
  depth: number,
): void {
  if (depth > maxDepth) {
    throw new AuditPayloadError(`${path} exceeds the maximum nesting depth.`);
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new AuditPayloadError(`${path} contains a non-finite number.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      inspectAuditValue(entry, `${path}[${index}]`, depth + 1),
    );
    return;
  }
  if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (forbiddenKeyPattern.test(key)) {
        throw new AuditPayloadError(
          `${path}.${key} uses a forbidden sensitive key.`,
        );
      }
      if (entry === undefined) {
        throw new AuditPayloadError(`${path}.${key} cannot be undefined.`);
      }
      inspectAuditValue(entry, `${path}.${key}`, depth + 1);
    }
    return;
  }
  throw new AuditPayloadError(`${path} contains an unsupported value.`);
}

export type SafeAuditPayload = {
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  metadata?: Prisma.InputJsonValue | null;
};

export function validateAuditPayload(input: {
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}): SafeAuditPayload {
  const payload = {
    before: input.before ?? null,
    after: input.after ?? null,
    metadata: input.metadata ?? null,
  };
  inspectAuditValue(payload, "audit", 0);
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > maxPayloadBytes) {
    throw new AuditPayloadError(
      `Audit payload exceeds ${maxPayloadBytes} bytes.`,
    );
  }
  return payload as SafeAuditPayload;
}

export function assertAuditFingerprint(
  value: string | null | undefined,
  field: string,
): void {
  if (value !== null && value !== undefined && !fingerprintPattern.test(value)) {
    throw new AuditPayloadError(`${field} must be a SHA-256 HMAC fingerprint.`);
  }
}

export function isAuditAction(value: string): value is AuditAction {
  return value in auditActionCatalog;
}

export function auditActionLabel(action: string): string {
  return isAuditAction(action) ? auditActionCatalog[action].label : action;
}

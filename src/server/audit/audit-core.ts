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
  "master_data.company_profile_updated": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "CompanyProfile",
    label: "회사 정보 변경",
  },
  "master_data.business_site_created": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "BusinessSite",
    label: "사업장 생성",
  },
  "master_data.business_site_updated": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "BusinessSite",
    label: "사업장 변경",
  },
  "master_data.business_site_default_changed": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "BusinessSite",
    label: "기본 사업장 변경",
  },
  "customer.created": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "Customer",
    label: "거래처 생성",
  },
  "customer.updated": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "Customer",
    label: "거래처 변경",
  },
  "customer.contact_created": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "CustomerContact",
    label: "거래처 담당자 생성",
  },
  "customer.contact_updated": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "CustomerContact",
    label: "거래처 담당자 변경",
  },
  "customer.contact_default_changed": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "CustomerContact",
    label: "기본 담당자 변경",
  },
  "customer.site_created": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "CustomerSite",
    label: "고객 현장 생성",
  },
  "customer.site_updated": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "CustomerSite",
    label: "고객 현장 변경",
  },
  "customer.site_default_changed": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "CustomerSite",
    label: "기본 고객 현장 변경",
  },
  "order.created": { category: "DATA_CHANGE", defaultOutcome: "SUCCESS", defaultSource: "WEB", entityType: "SalesOrder", label: "수주 생성" },
  "order.updated": { category: "DATA_CHANGE", defaultOutcome: "SUCCESS", defaultSource: "WEB", entityType: "SalesOrder", label: "수주 변경" },
  "order.copied": { category: "DATA_CHANGE", defaultOutcome: "SUCCESS", defaultSource: "WEB", entityType: "SalesOrder", label: "수주 복사" },
  "order.cancelled": { category: "DATA_CHANGE", defaultOutcome: "SUCCESS", defaultSource: "WEB", entityType: "SalesOrder", label: "수주 취소" },
  "order.party_snapshot_captured": { category: "DATA_CHANGE", defaultOutcome: "SUCCESS", defaultSource: "WEB", entityType: "SalesOrder", label: "수주 고객정보 고정" },
  "order.fold_item_added": { category: "DATA_CHANGE", defaultOutcome: "SUCCESS", defaultSource: "WEB", entityType: "SalesOrderFoldItem", label: "수주 절곡 작업 추가" },
  "order.fold_item_updated": { category: "DATA_CHANGE", defaultOutcome: "SUCCESS", defaultSource: "WEB", entityType: "SalesOrderFoldItem", label: "수주 절곡 작업 변경" },
  "order.fold_item_copied": { category: "DATA_CHANGE", defaultOutcome: "SUCCESS", defaultSource: "WEB", entityType: "SalesOrderFoldItem", label: "수주 절곡 작업 복사" },
  "order.fold_item_removed": { category: "DATA_CHANGE", defaultOutcome: "SUCCESS", defaultSource: "WEB", entityType: "SalesOrderFoldItem", label: "수주 절곡 작업 제거" },
  "order.fold_items_reordered": { category: "DATA_CHANGE", defaultOutcome: "SUCCESS", defaultSource: "WEB", entityType: "SalesOrder", label: "수주 절곡 작업 순서 변경" },
  "order.calculation_snapshot_created": { category: "DATA_CHANGE", defaultOutcome: "SUCCESS", defaultSource: "WEB", entityType: "SalesOrderCalculationSnapshot", label: "수주 계산·가격 스냅샷 생성" },
  "order.status_transitioned": { category: "APPROVAL", defaultOutcome: "SUCCESS", defaultSource: "WEB", entityType: "SalesOrder", label: "수주 승인·생산 상태 전이" },
  "job.enqueued": { category: "SYSTEM", defaultOutcome: "SUCCESS", defaultSource: "WEB", entityType: "JobQueue", label: "작업 등록" },
  "job.succeeded": { category: "SYSTEM", defaultOutcome: "SUCCESS", defaultSource: "SYSTEM", entityType: "JobQueue", label: "작업 완료" },
  "job.failed": { category: "SYSTEM", defaultOutcome: "FAILURE", defaultSource: "SYSTEM", entityType: "JobQueue", label: "작업 실패" },
  "job.cancelled": { category: "SYSTEM", defaultOutcome: "SUCCESS", defaultSource: "WEB", entityType: "JobQueue", label: "작업 취소" },
  "job.retried": { category: "SYSTEM", defaultOutcome: "SUCCESS", defaultSource: "WEB", entityType: "JobQueue", label: "작업 다시 실행" },
  "cutting.plan_created": { category: "DATA_CHANGE", defaultOutcome: "SUCCESS", defaultSource: "WEB", entityType: "CuttingPlan", label: "재단 작업 생성" },
  "cutting.revision_created": { category: "DATA_CHANGE", defaultOutcome: "SUCCESS", defaultSource: "WEB", entityType: "CuttingPlan", label: "재단 개정 실행" },
  "cutting.approved": { category: "APPROVAL", defaultOutcome: "SUCCESS", defaultSource: "WEB", entityType: "CuttingPlan", label: "재단 결과 승인" },
  "cutting.approval_cancelled": { category: "APPROVAL", defaultOutcome: "SUCCESS", defaultSource: "WEB", entityType: "CuttingPlan", label: "재단 승인 취소" },
  "file.uploaded": { category: "DATA_CHANGE", defaultOutcome: "SUCCESS", defaultSource: "WEB", entityType: "FileAsset", label: "파일 업로드 완료" },
  "file.upload_rejected": { category: "DATA_CHANGE", defaultOutcome: "FAILURE", defaultSource: "WEB", entityType: "FileAsset", label: "파일 업로드 거부" },
  "file.download_url_issued": { category: "OUTPUT", defaultOutcome: "SUCCESS", defaultSource: "WEB", entityType: "FileAsset", label: "파일 다운로드 주소 발급" },
  "file.deleted": { category: "DATA_CHANGE", defaultOutcome: "SUCCESS", defaultSource: "WEB", entityType: "FileAsset", label: "파일 삭제" },
  "file.purged": { category: "SYSTEM", defaultOutcome: "SUCCESS", defaultSource: "SYSTEM", entityType: "FileAsset", label: "파일 실제 삭제" },
  "material.created": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "Material",
    label: "재질 생성",
  },
  "material.updated": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "Material",
    label: "재질 변경",
  },
  "material.variant_created": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "MaterialVariant",
    label: "재질 두께 생성",
  },
  "material.variant_updated": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "MaterialVariant",
    label: "재질 두께 변경",
  },
  "material.rule_created": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "MaterialRuleRevision",
    label: "재질 계산 규칙 초안 생성",
  },
  "material.rule_updated": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "MaterialRuleRevision",
    label: "재질 계산 규칙 변경",
  },
  "material.rule_review_requested": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "MaterialRuleRevision",
    label: "재질 계산 규칙 검토 요청",
  },
  "material.rule_returned": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "MaterialRuleRevision",
    label: "재질 계산 규칙 수정 반려",
  },
  "material.rule_published": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "MaterialRuleRevision",
    label: "재질 계산 규칙 게시",
  },
  "material.rule_retired": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "MaterialRuleRevision",
    label: "재질 계산 규칙 사용 종료",
  },
  "material.rule_discarded": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "MaterialRuleRevision",
    label: "재질 계산 규칙 초안 폐기",
  },
  "material.sheet_created": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "SheetItem",
    label: "원판 품목 생성",
  },
  "material.sheet_updated": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "SheetItem",
    label: "원판 품목 변경",
  },
  "material.sheet_default_set": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "SheetItem",
    label: "기본 원판 변경",
  },
  "material.sheet_deactivated": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "SheetItem",
    label: "원판 품목 비활성화",
  },
  "material.sheet_reactivated": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "SheetItem",
    label: "원판 품목 재활성화",
  },
  "pricing.tier_changed": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "PriceTier",
    label: "가격등급 변경",
  },
  "pricing.customer_tier_assigned": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "Customer",
    label: "거래처 가격등급 배정",
  },
  "pricing.book_changed": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "PriceBook",
    label: "가격표 변경",
  },
  "pricing.revision_created": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "PriceBookRevision",
    label: "가격표 초안 생성",
  },
  "pricing.revision_updated": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "PriceBookRevision",
    label: "가격표 초안 변경",
  },
  "pricing.revision_review_requested": {
    category: "APPROVAL",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "PriceBookRevision",
    label: "가격표 검토 요청",
  },
  "pricing.revision_returned": {
    category: "APPROVAL",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "PriceBookRevision",
    label: "가격표 수정 반려",
  },
  "pricing.revision_published": {
    category: "APPROVAL",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "PriceBookRevision",
    label: "가격표 게시",
  },
  "pricing.revision_retired": {
    category: "APPROVAL",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "PriceBookRevision",
    label: "가격표 사용 종료",
  },
  "pricing.revision_discarded": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "PriceBookRevision",
    label: "가격표 초안 폐기",
  },
  "fold.draft_created": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "FoldRevision",
    label: "절곡 초안 생성",
  },
  "fold.draft_saved": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "FoldRevision",
    label: "절곡 초안 저장",
  },
  "fold.draft_deleted": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "FoldRevision",
    label: "절곡 초안 삭제",
  },
  "fold.dxf_exported": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "FileAsset",
    label: "절곡 DXF 출력",
  },
  "fold.category_created": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "FoldCategory",
    label: "절곡 분류 생성",
  },
  "fold.category_updated": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "FoldCategory",
    label: "절곡 분류 변경",
  },
  "fold.template_metadata_updated": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "FoldTemplate",
    label: "절곡 템플릿 정보 변경",
  },
  "fold.template_copied": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "FoldTemplate",
    label: "절곡 템플릿 복사",
  },
  "fold.revision_created": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "FoldRevision",
    label: "절곡 새 개정 생성",
  },
  "fold.revision_review_requested": {
    category: "APPROVAL",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "FoldRevision",
    label: "절곡 개정 검토 요청",
  },
  "fold.revision_returned": {
    category: "APPROVAL",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "FoldRevision",
    label: "절곡 개정 수정 요청",
  },
  "fold.revision_published": {
    category: "APPROVAL",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "FoldRevision",
    label: "절곡 개정 게시",
  },
  "fold.revision_retired": {
    category: "APPROVAL",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "FoldRevision",
    label: "절곡 개정 폐기",
  },
  "fold.revision_discarded": {
    category: "DATA_CHANGE",
    defaultOutcome: "SUCCESS",
    defaultSource: "WEB",
    entityType: "FoldRevision",
    label: "절곡 작업 개정 취소",
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

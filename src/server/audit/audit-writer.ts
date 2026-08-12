import {
  Prisma,
  type AuditOutcome,
  type AuditSource,
  type PrismaClient,
} from "@/generated/prisma/client";
import {
  assertAuditFingerprint,
  auditActionCatalog,
  type AuditAction,
  validateAuditPayload,
} from "@/server/audit/audit-core";

export type AuditDatabaseClient = PrismaClient | Prisma.TransactionClient;

export type AuditActorSnapshot = {
  displayName: string;
  email: string;
};

type AuditEventCommonInput = {
  organizationId: string;
  actorUserId?: string | null;
  actorSnapshot?: AuditActorSnapshot | null;
  entityId?: string | null;
  requestId?: string | null;
  outcome?: AuditOutcome;
  source?: AuditSource;
  subjectFingerprint?: string | null;
  sourceFingerprint?: string | null;
};

type AuditPayloadByAction = {
  "auth.admin_bootstrapped": {
    after: { status: string; roleKeys: string[] };
  };
  "auth.login_failed": {
    metadata: {
      reason: "RATE_LIMITED" | "INVALID_CREDENTIALS";
      throttled?: boolean;
    };
  };
  "auth.login_succeeded": Record<never, never>;
  "auth.logout": Record<never, never>;
  "auth.password_reset_issued": { after: { expiresAt: string } };
  "auth.password_reset_completed": {
    before: { status: string };
    after: { status: string; sessionsRevoked: boolean };
  };
  "admin.user_invited": {
    after: {
      status: string;
      departmentId: string | null;
      roleKeys: string[];
    };
    metadata: { expiresAt: string };
  };
  "admin.user_updated": {
    before: { displayName: string; departmentId: string | null };
    after: { displayName: string; departmentId: string | null };
  };
  "admin.user_status_changed": {
    before: { status: string };
    after: { status: string };
  };
  "admin.user_roles_changed": {
    before: { roleKeys: string[] };
    after: { roleKeys: string[] };
  };
  "admin.password_reset_issued": { after: { expiresAt: string } };
  "admin.department_created": {
    after: { code: string; name: string; active: boolean };
  };
  "admin.department_updated": {
    before: { name: string; active: boolean };
    after: { name: string; active: boolean };
  };
  "admin.role_created": {
    after: {
      key: string;
      name: string;
      description: string | null;
      active: boolean;
      permissions: string[];
    };
  };
  "admin.role_updated": {
    before: {
      name: string;
      description: string | null;
      active: boolean;
      permissions: string[];
    };
    after: {
      name: string;
      description: string | null;
      active: boolean;
      permissions: string[];
    };
  };
  "audit.events_viewed": {
    metadata: {
      activeFilters: string[];
      resultCount: number;
      rangeDays: number;
    };
  };
  "audit.event_viewed": Record<never, never>;
  "authorization.permission_denied": {
    metadata: {
      reason: "MISSING_PERMISSION" | "INVALID_MUTATION_ORIGIN";
    };
  };
  "master_data.company_profile_updated": {
    before: CompanyProfileAuditSnapshot;
    after: CompanyProfileAuditSnapshot;
  };
  "master_data.business_site_created": {
    after: BusinessSiteAuditSnapshot;
  };
  "master_data.business_site_updated": {
    before: BusinessSiteAuditSnapshot;
    after: BusinessSiteAuditSnapshot;
  };
  "master_data.business_site_default_changed": {
    before: { businessSiteId: string | null };
    after: { businessSiteId: string };
  };
  "customer.created": { after: CustomerAuditSnapshot };
  "customer.updated": {
    before: CustomerAuditSnapshot;
    after: CustomerAuditSnapshot;
  };
  "customer.contact_created": { after: CustomerContactAuditSnapshot };
  "customer.contact_updated": {
    before: CustomerContactAuditSnapshot;
    after: CustomerContactAuditSnapshot;
  };
  "customer.contact_default_changed": {
    before: { contactId: string | null };
    after: { contactId: string };
  };
  "customer.site_created": { after: CustomerSiteAuditSnapshot };
  "customer.site_updated": {
    before: CustomerSiteAuditSnapshot;
    after: CustomerSiteAuditSnapshot;
  };
  "customer.site_default_changed": {
    before: { siteId: string | null };
    after: { siteId: string };
  };
  "order.created": { after: SalesOrderAuditSnapshot };
  "order.updated": { before: SalesOrderAuditSnapshot; after: SalesOrderAuditSnapshot };
  "order.copied": { after: SalesOrderAuditSnapshot; metadata: { sourceOrderId: string } };
  "order.cancelled": { before: SalesOrderAuditSnapshot; after: SalesOrderAuditSnapshot };
  "material.created": { after: MaterialAuditSnapshot };
  "material.updated": { before: MaterialAuditSnapshot; after: MaterialAuditSnapshot };
  "material.variant_created": { after: MaterialVariantAuditSnapshot };
  "material.variant_updated": { before: MaterialVariantAuditSnapshot; after: MaterialVariantAuditSnapshot };
  "material.rule_created": MaterialRuleCreateAuditPayload;
  "material.rule_updated": MaterialRuleUpdateAuditPayload;
  "material.rule_review_requested": MaterialRuleTransitionAuditPayload;
  "material.rule_returned": MaterialRuleTransitionAuditPayload;
  "material.rule_published": MaterialRuleTransitionAuditPayload;
  "material.rule_retired": MaterialRuleTransitionAuditPayload;
  "material.rule_discarded": MaterialRuleTransitionAuditPayload;
  "material.sheet_created": { after: SheetItemAuditSnapshot };
  "material.sheet_updated": { before: SheetItemAuditSnapshot; after: SheetItemAuditSnapshot };
  "material.sheet_default_set": { before: SheetItemStateAuditSnapshot; after: SheetItemStateAuditSnapshot };
  "material.sheet_deactivated": { before: SheetItemStateAuditSnapshot; after: SheetItemStateAuditSnapshot };
  "material.sheet_reactivated": { before: SheetItemStateAuditSnapshot; after: SheetItemStateAuditSnapshot };
  "pricing.tier_changed": PricingChangeAuditPayload;
  "pricing.customer_tier_assigned": PricingChangeAuditPayload;
  "pricing.book_changed": PricingChangeAuditPayload;
  "pricing.revision_created": PricingRevisionCreateAuditPayload;
  "pricing.revision_updated": PricingRevisionUpdateAuditPayload;
  "pricing.revision_review_requested": PricingRevisionTransitionAuditPayload;
  "pricing.revision_returned": PricingRevisionTransitionAuditPayload;
  "pricing.revision_published": PricingRevisionTransitionAuditPayload;
  "pricing.revision_retired": PricingRevisionTransitionAuditPayload;
  "pricing.revision_discarded": PricingRevisionTransitionAuditPayload;
  "fold.draft_created": {
    after: {
      name: string;
      documentType: string;
      lockVersion: number;
    };
    metadata: { schemaVersion: number; checksumSha256: string };
  };
  "fold.draft_saved": {
    before: {
      name: string;
      documentType: string;
      lockVersion: number;
    };
    after: {
      name: string;
      documentType: string;
      lockVersion: number;
    };
    metadata: { schemaVersion: number; checksumSha256: string };
  };
  "fold.draft_deleted": {
    before: { active: boolean; deleted: boolean };
    after: { active: boolean; deleted: boolean };
    metadata: { lockVersion: number; checksumSha256: string };
  };
  "fold.dxf_exported": {
    metadata: {
      sourceRevisionId: string;
      documentChecksumSha256: string;
      dxfChecksumSha256: string;
      geometryVersion: string;
      writerVersion: string;
      sizeBytes: number;
      entityCount: number;
    };
  };
  "fold.category_created": {
    after: { name: string; sortOrder: number; active: boolean; lockVersion: number };
  };
  "fold.category_updated": {
    before: { name: string; sortOrder: number; active: boolean; lockVersion: number };
    after: { name: string; sortOrder: number; active: boolean; lockVersion: number };
  };
  "fold.template_metadata_updated": {
    before: { name: string; categoryId: string | null; lockVersion: number };
    after: { name: string; categoryId: string | null; lockVersion: number };
  };
  "fold.template_copied": {
    after: { name: string; revisionNumber: number; status: string };
    metadata: { sourceRevisionId: string; checksumSha256: string };
  };
  "fold.revision_created": {
    after: { name: string; revisionNumber: number; status: string; lockVersion: number };
    metadata: { sourceRevisionId: string; checksumSha256: string };
  };
  "fold.revision_review_requested": RevisionTransitionAuditPayload;
  "fold.revision_returned": RevisionTransitionAuditPayload;
  "fold.revision_published": RevisionTransitionAuditPayload;
  "fold.revision_retired": RevisionTransitionAuditPayload;
  "fold.revision_discarded": RevisionTransitionAuditPayload;
  "platform.database_smoke": {
    metadata?: { mode: "commit" | "rollback" };
  };
};

type RevisionTransitionAuditPayload = {
  before: { status: string; lockVersion: number };
  after: { status: string; lockVersion: number };
  metadata: { revisionNumber: number; checksumSha256: string };
};

type PricingChangeAuditPayload = {
  before?: { code?: string; name?: string; active?: boolean; isDefault?: boolean; priceTierId?: string | null; lockVersion?: number };
  after: { code?: string; name?: string; active?: boolean; isDefault?: boolean; priceTierId?: string | null; lockVersion?: number };
  metadata?: { scopeType?: string; reason?: string | null };
};

type PricingRevisionCreateAuditPayload = {
  after: { revisionNumber: number; status: string; lockVersion: number };
  metadata: { checksumSha256: string; sourceRevisionId: string | null; foldRateCount: number; sheetRateCount: number };
};

type PricingRevisionUpdateAuditPayload = {
  before: { status: string; lockVersion: number; checksumSha256: string | null };
  after: { status: string; lockVersion: number; checksumSha256: string };
  metadata: { revisionNumber: number; foldRateCount: number; sheetRateCount: number };
};

type PricingRevisionTransitionAuditPayload = {
  before: { status: string; lockVersion: number };
  after: { status: string; lockVersion: number };
  metadata: { revisionNumber: number; checksumSha256: string; reason: string | null; effectiveFrom: string | null };
};

type MaterialRuleCreateAuditPayload = {
  after: { revisionNumber: number; status: string; lockVersion: number };
  metadata: { checksumSha256: string; sourceRuleRevisionId: string | null };
};

type MaterialRuleUpdateAuditPayload = {
  before: { status: string; lockVersion: number; checksumSha256: string | null };
  after: { status: string; lockVersion: number; checksumSha256: string };
  metadata: { revisionNumber: number };
};

type MaterialRuleTransitionAuditPayload = {
  before: { status: string; lockVersion: number };
  after: { status: string; lockVersion: number };
  metadata: {
    revisionNumber: number;
    checksumSha256: string;
    reason: string | null;
    effectiveFrom: string | null;
  };
};

export type WriteAuditEventInput = {
  [Action in AuditAction]: AuditEventCommonInput &
    { action: Action } &
    AuditPayloadByAction[Action];
}[AuditAction];

type CompanyProfileAuditSnapshot = {
  name: string;
  businessRegistrationNumber: string | null;
  representativeName: string | null;
  phone: string | null;
  email: string | null;
  postalCode: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  organizationLockVersion: number;
  profileLockVersion: number;
};

type BusinessSiteAuditSnapshot = {
  code: string;
  name: string;
  type: string;
  businessRegistrationNumber: string | null;
  representativeName: string | null;
  phone: string | null;
  email: string | null;
  postalCode: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  isDefault: boolean;
  active: boolean;
  lockVersion: number;
};

type CustomerAuditSnapshot = {
  code: string;
  type: string;
  name: string;
  businessRegistrationNumber: string | null;
  active: boolean;
  lockVersion: number;
};

type CustomerContactAuditSnapshot = {
  customerId: string;
  customerSiteId: string | null;
  name: string;
  isPrimary: boolean;
  active: boolean;
  lockVersion: number;
};

type CustomerSiteAuditSnapshot = {
  customerId: string;
  code: string;
  name: string;
  isDefault: boolean;
  active: boolean;
  lockVersion: number;
};
type SalesOrderAuditSnapshot = { orderNumber: string; status: string; customerId: string; customerSiteId: string | null; customerContactId: string | null; ownerMembershipId: string | null; dueDate: string | null; lockVersion: number };

type MaterialAuditSnapshot = {
  code: string;
  name: string;
  densityKgPerM3: string | null;
  active: boolean;
  lockVersion: number;
};

type MaterialVariantAuditSnapshot = {
  materialId: string;
  code: string;
  thicknessMm: string;
  defaultInsideRadiusMm: string;
  active: boolean;
  lockVersion: number;
};

type SheetItemStateAuditSnapshot = {
  active: boolean;
  isDefault: boolean;
  lockVersion: number;
};

type SheetItemAuditSnapshot = SheetItemStateAuditSnapshot & {
  materialVariantId: string;
  code: string;
  name: string;
  widthMm: string;
  lengthMm: string;
  finishName: string | null;
};

async function resolveActorSnapshot(
  database: AuditDatabaseClient,
  actorUserId: string | null | undefined,
  supplied: AuditActorSnapshot | null | undefined,
): Promise<AuditActorSnapshot | null> {
  if (supplied) return supplied;
  if (!actorUserId) return null;
  return database.user.findUnique({
    where: { id: actorUserId },
    select: {
      displayName: true,
      email: true,
    },
  });
}

export async function writeAuditEvent(
  database: AuditDatabaseClient,
  input: WriteAuditEventInput,
): Promise<{ id: string }> {
  const definition = auditActionCatalog[input.action];
  const payload = validateAuditPayload({
    before: "before" in input ? input.before : undefined,
    after: "after" in input ? input.after : undefined,
    metadata: "metadata" in input ? input.metadata : undefined,
  });
  assertAuditFingerprint(input.subjectFingerprint, "subjectFingerprint");
  assertAuditFingerprint(input.sourceFingerprint, "sourceFingerprint");
  const actor = await resolveActorSnapshot(
    database,
    input.actorUserId,
    input.actorSnapshot,
  );

  return database.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      category: definition.category,
      outcome: input.outcome ?? definition.defaultOutcome,
      source: input.source ?? definition.defaultSource,
      schemaVersion: 2,
      actorUserId: input.actorUserId,
      actorDisplayName: actor?.displayName,
      actorEmail: actor?.email,
      subjectFingerprint: input.subjectFingerprint,
      sourceFingerprint: input.sourceFingerprint,
      action: input.action,
      entityType: definition.entityType,
      entityId: input.entityId,
      requestId: input.requestId,
      before: payload.before ?? Prisma.JsonNull,
      after: payload.after ?? Prisma.JsonNull,
      metadata: payload.metadata ?? Prisma.JsonNull,
    },
    select: { id: true },
  });
}

export async function writeDeniedAuditBestEffort(
  database: AuditDatabaseClient,
  input: WriteAuditEventInput,
): Promise<void> {
  try {
    await writeAuditEvent(database, input);
  } catch (error) {
    console.error("Security audit insert failed.", {
      action: input.action,
      requestId: input.requestId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

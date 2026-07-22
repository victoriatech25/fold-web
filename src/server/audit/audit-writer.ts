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
  "platform.database_smoke": {
    metadata?: { mode: "commit" | "rollback" };
  };
};

export type WriteAuditEventInput = {
  [Action in AuditAction]: AuditEventCommonInput &
    { action: Action } &
    AuditPayloadByAction[Action];
}[AuditAction];

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

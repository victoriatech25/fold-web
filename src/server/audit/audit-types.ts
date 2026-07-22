import type {
  AuditCategory,
  AuditOutcome,
  AuditSource,
} from "@/generated/prisma/client";

export type AuditActorDto = {
  userId: string | null;
  displayName: string | null;
  email: string | null;
};

export type AuditEventSummaryDto = {
  id: string;
  category: AuditCategory;
  outcome: AuditOutcome;
  source: AuditSource;
  schemaVersion: number;
  action: string;
  actionLabel: string;
  actor: AuditActorDto;
  entityType: string;
  entityId: string | null;
  requestId: string | null;
  occurredAt: string;
};

export type AuditEventDetailDto = AuditEventSummaryDto & {
  subjectFingerprint: string | null;
  sourceFingerprint: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
};

export type AuditEventListDto = {
  items: AuditEventSummaryDto[];
  nextCursor: string | null;
};

export type AuditEventListInput = {
  from: Date;
  to: Date;
  category?: AuditCategory;
  outcome?: AuditOutcome;
  action?: string;
  actorQuery?: string;
  entityType?: string;
  entityId?: string;
  requestId?: string;
  cursor?: string;
  limit: 25 | 100;
};

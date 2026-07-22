import "server-only";

import type {
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import { auditActionLabel } from "@/server/audit/audit-core";
import type {
  AuditEventDetailDto,
  AuditEventListDto,
  AuditEventListInput,
  AuditEventSummaryDto,
} from "@/server/audit/audit-types";
import type { AuditDatabaseClient } from "@/server/audit/audit-writer";

const auditSummarySelect = {
  id: true,
  category: true,
  outcome: true,
  source: true,
  schemaVersion: true,
  actorUserId: true,
  actorDisplayName: true,
  actorEmail: true,
  action: true,
  entityType: true,
  entityId: true,
  requestId: true,
  occurredAt: true,
} as const satisfies Prisma.AuditEventSelect;

type AuditSummaryRow = Prisma.AuditEventGetPayload<{
  select: typeof auditSummarySelect;
}>;

export type AuditCursor = {
  occurredAt: Date;
  id: string;
};

function toSummaryDto(row: AuditSummaryRow): AuditEventSummaryDto {
  return {
    id: row.id,
    category: row.category,
    outcome: row.outcome,
    source: row.source,
    schemaVersion: row.schemaVersion,
    action: row.action,
    actionLabel: auditActionLabel(row.action),
    actor: {
      userId: row.actorUserId,
      displayName: row.actorDisplayName,
      email: row.actorEmail,
    },
    entityType: row.entityType,
    entityId: row.entityId,
    requestId: row.requestId,
    occurredAt: row.occurredAt.toISOString(),
  };
}

export async function listOrganizationAuditEvents(
  database: PrismaClient | Prisma.TransactionClient,
  organizationId: string,
  input: AuditEventListInput,
  cursor: AuditCursor | null,
): Promise<AuditEventListDto> {
  const where: Prisma.AuditEventWhereInput = {
    organizationId,
    occurredAt: {
      gte: input.from,
      lte: input.to,
    },
    category: input.category,
    outcome: input.outcome,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    requestId: input.requestId,
    ...(input.actorQuery
      ? {
          OR: [
            {
              actorDisplayName: {
                contains: input.actorQuery,
                mode: "insensitive" as const,
              },
            },
            {
              actorEmail: {
                contains: input.actorQuery,
                mode: "insensitive" as const,
              },
            },
          ],
        }
      : {}),
    ...(cursor
      ? {
          AND: [
            {
              OR: [
                { occurredAt: { lt: cursor.occurredAt } },
                {
                  occurredAt: cursor.occurredAt,
                  id: { lt: cursor.id },
                },
              ],
            },
          ],
        }
      : {}),
  };
  const rows = await database.auditEvent.findMany({
    where,
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    select: auditSummarySelect,
  });
  const hasMore = rows.length > input.limit;
  const items = rows.slice(0, input.limit);
  return {
    items: items.map(toSummaryDto),
    nextCursor: hasMore
      ? encodeAuditCursor({
          occurredAt: items.at(-1)!.occurredAt,
          id: items.at(-1)!.id,
        })
      : null,
  };
}

export async function findOrganizationAuditEvent(
  database: AuditDatabaseClient,
  organizationId: string,
  auditEventId: string,
): Promise<AuditEventDetailDto | null> {
  const row = await database.auditEvent.findFirst({
    where: {
      id: auditEventId,
      organizationId,
    },
    select: {
      ...auditSummarySelect,
      subjectFingerprint: true,
      sourceFingerprint: true,
      before: true,
      after: true,
      metadata: true,
    },
  });
  if (!row) return null;
  return {
    ...toSummaryDto(row),
    subjectFingerprint: row.subjectFingerprint,
    sourceFingerprint: row.sourceFingerprint,
    before: row.before,
    after: row.after,
    metadata: row.metadata,
  };
}

export function encodeAuditCursor(cursor: AuditCursor): string {
  return Buffer.from(
    JSON.stringify({
      occurredAt: cursor.occurredAt.toISOString(),
      id: cursor.id,
    }),
    "utf8",
  ).toString("base64url");
}

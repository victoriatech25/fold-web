import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { AuditServiceError } from "@/server/audit/audit-error";
import {
  findOrganizationAuditEvent,
  listOrganizationAuditEvents,
  type AuditCursor,
} from "@/server/audit/audit-repository";
import type {
  AuditEventDetailDto,
  AuditEventListDto,
  AuditEventListInput,
} from "@/server/audit/audit-types";
import { writeAuditEvent } from "@/server/audit/audit-writer";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { requirePermission } from "@/server/authorization/authorization";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maximumRangeMilliseconds = 90 * 24 * 60 * 60 * 1_000;

function decodeAuditCursor(value: string | undefined): AuditCursor | null {
  if (!value) return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as unknown;
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      !("occurredAt" in decoded) ||
      !("id" in decoded) ||
      typeof decoded.occurredAt !== "string" ||
      typeof decoded.id !== "string" ||
      !uuidPattern.test(decoded.id)
    ) {
      throw new Error("Invalid cursor shape.");
    }
    const occurredAt = new Date(decoded.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      throw new Error("Invalid cursor timestamp.");
    }
    return { occurredAt, id: decoded.id };
  } catch {
    throw new AuditServiceError(
      "INVALID_REQUEST",
      "감사 로그 페이지 위치가 올바르지 않습니다.",
    );
  }
}

function validateRange(input: AuditEventListInput): void {
  const duration = input.to.getTime() - input.from.getTime();
  if (
    Number.isNaN(duration) ||
    duration < 0 ||
    duration > maximumRangeMilliseconds
  ) {
    throw new AuditServiceError(
      "INVALID_REQUEST",
      "조회 기간은 시작일 이후 최대 90일이어야 합니다.",
    );
  }
}

export async function listAuditEvents(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: AuditEventListInput,
  requestId: string,
): Promise<AuditEventListDto> {
  requirePermission(context, "audit.read");
  validateRange(input);
  const cursor = decodeAuditCursor(input.cursor);
  return prisma.$transaction(async (transaction) => {
    const result = await listOrganizationAuditEvents(
      transaction,
      context.organizationId,
      input,
      cursor,
    );
    const activeFilters = [
      input.category && "category",
      input.outcome && "outcome",
      input.action && "action",
      input.actorQuery && "actor",
      input.entityType && "entityType",
      input.entityId && "entityId",
      input.requestId && "requestId",
      input.cursor && "cursor",
    ].filter((value): value is string => Boolean(value));
    await writeAuditEvent(transaction, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "audit.events_viewed",
      requestId,
      metadata: {
        activeFilters,
        resultCount: result.items.length,
        rangeDays: Math.ceil(
          (input.to.getTime() - input.from.getTime()) / 86_400_000,
        ),
      },
    });
    return result;
  });
}

export async function getAuditEvent(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  auditEventId: string,
  requestId: string,
): Promise<AuditEventDetailDto> {
  requirePermission(context, "audit.read");
  return prisma.$transaction(async (transaction) => {
    const result = await findOrganizationAuditEvent(
      transaction,
      context.organizationId,
      auditEventId,
    );
    if (!result) {
      throw new AuditServiceError(
        "NOT_FOUND",
        "감사 로그를 찾을 수 없습니다.",
      );
    }
    await writeAuditEvent(transaction, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "audit.event_viewed",
      entityId: auditEventId,
      requestId,
    });
    return result;
  });
}

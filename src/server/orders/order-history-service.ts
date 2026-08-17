import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { auditActionLabel } from "@/server/audit/audit-core";
import { requirePermission } from "@/server/authorization/authorization";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { OrderError } from "./order-error";

type Cursor = { occurredAt: Date; id: string };

function decodeCursor(value: string | undefined): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { occurredAt?: string; id?: string };
    const occurredAt = new Date(parsed.occurredAt ?? "");
    if (!parsed.id || !/^[0-9a-f-]{36}$/i.test(parsed.id) || Number.isNaN(occurredAt.getTime())) throw new Error("invalid");
    return { occurredAt, id: parsed.id };
  } catch { throw new OrderError("INVALID_REQUEST", "수주 이력 페이지 위치가 올바르지 않습니다."); }
}

function encodeCursor(cursor: Cursor) {
  return Buffer.from(JSON.stringify({ occurredAt: cursor.occurredAt.toISOString(), id: cursor.id }), "utf8").toString("base64url");
}

const historySelect = {
  id: true, action: true, category: true, outcome: true, occurredAt: true,
  actorDisplayName: true, entityType: true,
} as const satisfies Prisma.AuditEventSelect;

export type OrderHistoryDto = {
  items: Array<{ id: string; action: string; actionLabel: string; category: string; outcome: string; occurredAt: string; actorName: string | null; entityType: string }>;
  nextCursor: string | null;
};

export async function getOrderHistory(prisma: PrismaClient, context: AuthenticatedContext, orderId: string, input: { cursor?: string; limit?: 25 | 100 } = {}): Promise<OrderHistoryDto> {
  requirePermission(context, "order.read");
  const order = await prisma.salesOrder.findFirst({ where: { id: orderId, organizationId: context.organizationId }, select: { id: true } });
  if (!order) throw new OrderError("NOT_FOUND", "수주를 찾을 수 없습니다.");
  const cursor = decodeCursor(input.cursor);
  const limit = input.limit ?? 25;
  const rows = await prisma.auditEvent.findMany({
    where: {
      organizationId: context.organizationId,
      OR: [
        { entityId: orderId },
        { after: { path: ["salesOrderId"], equals: orderId } },
      ],
      ...(cursor ? { AND: [{ OR: [{ occurredAt: { lt: cursor.occurredAt } }, { occurredAt: cursor.occurredAt, id: { lt: cursor.id } }] }] } : {}),
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: historySelect,
  });
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  return {
    items: items.map((row) => ({ id: row.id, action: row.action, actionLabel: auditActionLabel(row.action), category: row.category, outcome: row.outcome, occurredAt: row.occurredAt.toISOString(), actorName: row.actorDisplayName, entityType: row.entityType })),
    nextCursor: hasMore ? encodeCursor({ occurredAt: items.at(-1)!.occurredAt, id: items.at(-1)!.id }) : null,
  };
}

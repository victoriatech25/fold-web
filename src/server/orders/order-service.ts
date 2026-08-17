import "server-only";

import type { Prisma, PrismaClient, SalesOrderStatus } from "@/generated/prisma/client";
import { requirePermission } from "@/server/authorization/authorization";
import { writeAuditEvent } from "@/server/audit/audit-writer";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { OrderError } from "./order-error";

type Database = PrismaClient | Prisma.TransactionClient;
type Transaction = Prisma.TransactionClient;

export const orderSelect = {
  id: true,
  orderNumber: true,
  status: true,
  customerId: true,
  customerSiteId: true,
  customerContactId: true,
  ownerMembershipId: true,
  orderedAt: true,
  dueDate: true,
  externalReference: true,
  memo: true,
  cancelledAt: true,
  cancellationReason: true,
  approvedCalculationSnapshotId: true,
  approvedAt: true,
  statusChangedAt: true,
  approvedByMembership: { select: { user: { select: { displayName: true } } } },
  statusChangedByMembership: { select: { user: { select: { displayName: true } } } },
  approvedCalculationSnapshot: { select: { snapshotNumber: true, resultChecksumSha256: true, supplyAmountKrw: true, totalAmountKrw: true } },
  partySnapshotCapturedAt: true,
  lockVersion: true,
  updatedAt: true,
  customer: { select: { code: true, name: true, active: true } },
  customerSite: { select: { name: true, active: true } },
  customerContact: { select: { name: true, active: true } },
  ownerMembership: { select: { user: { select: { displayName: true } } } },
} as const satisfies Prisma.SalesOrderSelect;

type OrderRow = Prisma.SalesOrderGetPayload<{ select: typeof orderSelect }>;
export type SalesOrderDto = ReturnType<typeof toDto>;

export type OrderFormOptionsDto = {
  customers: Array<{
    id: string;
    code: string;
    name: string;
    sites: Array<{ id: string; name: string; isDefault: boolean }>;
    contacts: Array<{
      id: string;
      name: string;
      customerSiteId: string | null;
      isPrimary: boolean;
    }>;
  }>;
  owners: Array<{ id: string; name: string }>;
};

type OrderFields = {
  customerId: string;
  customerSiteId?: string | null;
  customerContactId?: string | null;
  ownerMembershipId?: string | null;
  dueDate?: string | null;
  externalReference?: string | null;
  memo?: string | null;
};

export function toDto(row: OrderRow) {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    customerId: row.customerId,
    customerSiteId: row.customerSiteId,
    customerContactId: row.customerContactId,
    ownerMembershipId: row.ownerMembershipId,
    orderedAt: row.orderedAt.toISOString().slice(0, 10),
    dueDate: row.dueDate?.toISOString().slice(0, 10) ?? null,
    externalReference: row.externalReference,
    memo: row.memo,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancellationReason: row.cancellationReason,
    approvedCalculationSnapshotId: row.approvedCalculationSnapshotId,
    approvedCalculationSnapshotNumber: row.approvedCalculationSnapshot?.snapshotNumber ?? null,
    approvedCalculationResultChecksumSha256: row.approvedCalculationSnapshot?.resultChecksumSha256 ?? null,
    approvedSupplyAmountKrw: row.approvedCalculationSnapshot?.supplyAmountKrw.toString() ?? null,
    approvedTotalAmountKrw: row.approvedCalculationSnapshot?.totalAmountKrw.toString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    approvedByName: row.approvedByMembership?.user.displayName ?? null,
    statusChangedAt: row.statusChangedAt.toISOString(),
    statusChangedByName: row.statusChangedByMembership?.user.displayName ?? null,
    partySnapshotCapturedAt: row.partySnapshotCapturedAt?.toISOString() ?? null,
    customerFieldsLocked: row.partySnapshotCapturedAt !== null,
    lockVersion: row.lockVersion,
    updatedAt: row.updatedAt.toISOString(),
    customer: row.customer,
    customerSite: row.customerSite,
    customerContact: row.customerContact,
    ownerName: row.ownerMembership?.user.displayName ?? null,
  };
}

function auditSnapshot(row: OrderRow) {
  return {
    orderNumber: row.orderNumber,
    status: row.status,
    customerId: row.customerId,
    customerSiteId: row.customerSiteId,
    customerContactId: row.customerContactId,
    ownerMembershipId: row.ownerMembershipId,
    dueDate: row.dueDate?.toISOString().slice(0, 10) ?? null,
    externalReference: row.externalReference,
    memo: row.memo,
    cancellationReason: row.cancellationReason,
    lockVersion: row.lockVersion,
  };
}

function databaseDate(value: string | null | undefined) {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function koreanDateParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const year = Number(value("year"));
  return {
    year,
    orderedAt: new Date(`${year}-${value("month")}-${value("day")}T00:00:00.000Z`),
  };
}

async function validateReferences(
  db: Database,
  organizationId: string,
  input: OrderFields,
  validateCustomerReferences = true,
) {
  const customer = validateCustomerReferences ? await db.customer.findFirst({
    where: { id: input.customerId, organizationId, active: true, deletedAt: null },
    select: { id: true },
  }) : { id: input.customerId };
  if (validateCustomerReferences && !customer) throw new OrderError("INVALID_REQUEST", "활성 거래처를 선택해 주세요.");

  if (validateCustomerReferences && input.customerSiteId) {
    const site = await db.customerSite.findFirst({
      where: {
        id: input.customerSiteId,
        organizationId,
        customerId: input.customerId,
        active: true,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!site) {
      throw new OrderError(
        "INVALID_REQUEST",
        "선택한 고객 현장이 거래처와 일치하지 않거나 비활성입니다.",
      );
    }
  }

  if (validateCustomerReferences && input.customerContactId) {
    const contact = await db.customerContact.findFirst({
      where: {
        id: input.customerContactId,
        organizationId,
        customerId: input.customerId,
        active: true,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!contact) {
      throw new OrderError(
        "INVALID_REQUEST",
        "선택한 거래처 담당자가 거래처와 일치하지 않거나 비활성입니다.",
      );
    }
  }

  if (input.ownerMembershipId) {
    const owner = await db.organizationMembership.findFirst({
      where: {
        id: input.ownerMembershipId,
        organizationId,
        status: "ACTIVE",
        user: { status: "ACTIVE" },
      },
      select: { id: true },
    });
    if (!owner) {
      throw new OrderError("INVALID_REQUEST", "선택한 수주 담당자를 사용할 수 없습니다.");
    }
  }
}

async function applyCustomerDefaults(db: Database, organizationId: string, input: OrderFields) {
  const [site, contact] = await Promise.all([
    input.customerSiteId === undefined
      ? db.customerSite.findFirst({
          where: { organizationId, customerId: input.customerId, active: true, deletedAt: null },
          orderBy: [{ isDefault: "desc" }, { name: "asc" }, { id: "asc" }],
          select: { id: true },
        })
      : null,
    input.customerContactId === undefined
      ? db.customerContact.findFirst({
          where: { organizationId, customerId: input.customerId, active: true, deletedAt: null },
          orderBy: [{ isPrimary: "desc" }, { name: "asc" }, { id: "asc" }],
          select: { id: true },
        })
      : null,
  ]);
  return {
    ...input,
    customerSiteId: input.customerSiteId === undefined ? site?.id ?? null : input.customerSiteId,
    customerContactId:
      input.customerContactId === undefined ? contact?.id ?? null : input.customerContactId,
  };
}

async function getOrderRow(db: Database, organizationId: string, id: string) {
  const row = await db.salesOrder.findFirst({
    where: { id, organizationId },
    select: orderSelect,
  });
  if (!row) throw new OrderError("NOT_FOUND", "수주를 찾을 수 없습니다.");
  return row;
}

async function issueOrderNumber(tx: Transaction, organizationId: string, now: Date) {
  const { year, orderedAt } = koreanDateParts(now);
  const counter = await tx.salesOrderNumberCounter.upsert({
    where: { organizationId_sequenceYear: { organizationId, sequenceYear: year } },
    create: { organizationId, sequenceYear: year, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
    select: { nextValue: true },
  });
  const sequence = counter.nextValue - 1;
  if (sequence > 999_999) {
    throw new OrderError("CONFLICT", "연간 수주번호 발급 범위를 초과했습니다.");
  }
  return {
    sequenceYear: year,
    orderNumber: `SO-${year}-${String(sequence).padStart(6, "0")}`,
    orderedAt,
  };
}

export async function listOrders(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: { q?: string; status?: SalesOrderStatus },
) {
  requirePermission(context, "order.read");
  const q = input.q?.trim();
  const rows = await prisma.salesOrder.findMany({
    where: {
      organizationId: context.organizationId,
      ...(input.status ? { status: input.status } : {}),
      ...(q
        ? {
            OR: [
              { orderNumber: { contains: q, mode: "insensitive" } },
              { customer: { name: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 50,
    select: orderSelect,
  });
  return rows.map(toDto);
}

export type OrderListInput = {
  q?: string;
  customerId?: string;
  ownerMembershipId?: string;
  statuses?: SalesOrderStatus[];
  orderedFrom?: Date;
  orderedTo?: Date;
  cursor?: string;
  limit?: 25 | 100;
};

type OrderListCursor = { updatedAt: Date; id: string };

function decodeOrderCursor(value: string | undefined): OrderListCursor | null {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (typeof decoded !== "object" || decoded === null || !("updatedAt" in decoded) || !("id" in decoded) || typeof decoded.updatedAt !== "string" || typeof decoded.id !== "string") throw new Error("invalid cursor");
    const updatedAt = new Date(decoded.updatedAt);
    if (Number.isNaN(updatedAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(decoded.id)) throw new Error("invalid cursor");
    return { updatedAt, id: decoded.id };
  } catch {
    throw new OrderError("INVALID_REQUEST", "수주 목록 페이지 위치가 올바르지 않습니다.");
  }
}

function encodeOrderCursor(cursor: OrderListCursor) {
  return Buffer.from(JSON.stringify({ updatedAt: cursor.updatedAt.toISOString(), id: cursor.id }), "utf8").toString("base64url");
}

export async function listOrdersPage(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: OrderListInput,
) {
  requirePermission(context, "order.read");
  const cursor = decodeOrderCursor(input.cursor);
  const q = input.q?.trim();
  const limit = input.limit ?? 25;
  const rows = await prisma.salesOrder.findMany({
    where: {
      organizationId: context.organizationId,
      ...(input.customerId ? { customerId: input.customerId } : {}),
      ...(input.ownerMembershipId ? { ownerMembershipId: input.ownerMembershipId } : {}),
      ...(input.statuses?.length ? { status: { in: input.statuses } } : {}),
      ...(input.orderedFrom || input.orderedTo ? { orderedAt: { ...(input.orderedFrom ? { gte: input.orderedFrom } : {}), ...(input.orderedTo ? { lte: input.orderedTo } : {}) } } : {}),
      ...(q ? { OR: [{ orderNumber: { contains: q, mode: "insensitive" } }, { customer: { code: { contains: q, mode: "insensitive" } } }, { customer: { name: { contains: q, mode: "insensitive" } } }] } : {}),
      // cursor 조건은 AND로 감싼다. 같은 객체에 OR를 두 번 쓰면 뒤의 spread가 검색어 OR를 덮어써서
      // 2페이지부터 검색 조건이 사라진다.
      ...(cursor ? { AND: [{ OR: [{ updatedAt: { lt: cursor.updatedAt } }, { updatedAt: cursor.updatedAt, id: { lt: cursor.id } }] }] } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: orderSelect,
  });
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  return {
    items: items.map(toDto),
    nextCursor: hasMore ? encodeOrderCursor({ updatedAt: items.at(-1)!.updatedAt, id: items.at(-1)!.id }) : null,
  };
}

export async function getOrder(prisma: PrismaClient, context: AuthenticatedContext, id: string) {
  requirePermission(context, "order.read");
  return toDto(await getOrderRow(prisma, context.organizationId, id));
}

export async function getOrderFormOptions(
  prisma: PrismaClient,
  context: AuthenticatedContext,
): Promise<OrderFormOptionsDto> {
  requirePermission(context, "order.read");
  const [customers, owners] = await Promise.all([
    prisma.customer.findMany({
      where: { organizationId: context.organizationId, active: true, deletedAt: null },
      orderBy: [{ normalizedName: "asc" }, { id: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        sites: {
          where: { active: true, deletedAt: null },
          orderBy: [{ isDefault: "desc" }, { name: "asc" }, { id: "asc" }],
          select: { id: true, name: true, isDefault: true },
        },
        contacts: {
          where: { active: true, deletedAt: null },
          orderBy: [{ isPrimary: "desc" }, { name: "asc" }, { id: "asc" }],
          select: { id: true, name: true, customerSiteId: true, isPrimary: true },
        },
      },
    }),
    prisma.organizationMembership.findMany({
      where: {
        organizationId: context.organizationId,
        status: "ACTIVE",
        user: { status: "ACTIVE" },
      },
      orderBy: [{ user: { displayName: "asc" } }, { id: "asc" }],
      select: { id: true, user: { select: { displayName: true } } },
    }),
  ]);
  return {
    customers,
    owners: owners.map((owner) => ({ id: owner.id, name: owner.user.displayName })),
  };
}

export async function createOrder(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: OrderFields & { requestId: string },
) {
  requirePermission(context, "order.edit");
  return prisma.$transaction(async (tx) => {
    const fields = await applyCustomerDefaults(tx, context.organizationId, input);
    await validateReferences(tx, context.organizationId, fields);
    const number = await issueOrderNumber(tx, context.organizationId, new Date());
    const created = await tx.salesOrder.create({
      data: {
        organizationId: context.organizationId,
        ...number,
        customerId: fields.customerId,
        customerSiteId: fields.customerSiteId || null,
        customerContactId: fields.customerContactId || null,
        ownerMembershipId: fields.ownerMembershipId ?? context.membershipId,
        dueDate: databaseDate(fields.dueDate),
        externalReference: fields.externalReference?.trim() || null,
        memo: fields.memo?.trim() || null,
      },
      select: orderSelect,
    });
    await writeAuditEvent(tx, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "order.created",
      entityId: created.id,
      requestId: input.requestId,
      after: auditSnapshot(created),
    });
    return toDto(created);
  });
}

export async function updateOrder(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: OrderFields & { id: string; expectedLockVersion: number; requestId: string },
) {
  requirePermission(context, "order.edit");
  return prisma.$transaction(async (tx) => {
    const old = await getOrderRow(tx, context.organizationId, input.id);
    if (old.status !== "DRAFT" && old.status !== "CALCULATED") {
      throw new OrderError("CONFLICT", "승인·생산·마감 또는 취소 상태의 수주는 수정할 수 없습니다.", {
        latest: toDto(old),
      });
    }
    const customerReferencesChanged = old.customerId !== input.customerId ||
      old.customerSiteId !== (input.customerSiteId || null) ||
      old.customerContactId !== (input.customerContactId || null);
    if (old.partySnapshotCapturedAt && customerReferencesChanged) {
      throw new OrderError(
        "CONFLICT",
        "절곡 작업이 추가된 수주의 거래처·현장·거래처 담당자는 변경할 수 없습니다. 새 수주를 만들어 주세요.",
        { latest: toDto(old) },
      );
    }
    await validateReferences(tx, context.organizationId, input, !old.partySnapshotCapturedAt);
    const result = await tx.salesOrder.updateMany({
      where: {
        id: input.id,
        organizationId: context.organizationId,
        status: { in: ["DRAFT", "CALCULATED"] },
        lockVersion: input.expectedLockVersion,
      },
      data: {
        customerId: input.customerId,
        customerSiteId: input.customerSiteId || null,
        customerContactId: input.customerContactId || null,
        ownerMembershipId: input.ownerMembershipId || null,
        dueDate: databaseDate(input.dueDate),
        externalReference: input.externalReference?.trim() || null,
        memo: input.memo?.trim() || null,
        lockVersion: { increment: 1 },
      },
    });
    if (result.count !== 1) {
      const latest = await getOrderRow(tx, context.organizationId, input.id);
      throw new OrderError(
        "CONFLICT",
        "수주가 다른 화면에서 변경되었습니다. 최신 내용을 확인해 주세요.",
        { latest: toDto(latest) },
      );
    }
    const updated = await getOrderRow(tx, context.organizationId, input.id);
    await writeAuditEvent(tx, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "order.updated",
      entityId: updated.id,
      requestId: input.requestId,
      before: auditSnapshot(old),
      after: auditSnapshot(updated),
    });
    return toDto(updated);
  });
}

export async function copyOrder(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: { id: string; requestId: string },
) {
  requirePermission(context, "order.edit");
  return prisma.$transaction(async (tx) => {
    const original = await getOrderRow(tx, context.organizationId, input.id);
    if (original.status !== "DRAFT") {
      throw new OrderError("CONFLICT", "작성 중 수주만 복사할 수 있습니다.");
    }
    await validateReferences(tx, context.organizationId, {
      customerId: original.customerId,
      customerSiteId: original.customerSiteId,
      customerContactId: original.customerContactId,
      ownerMembershipId: context.membershipId,
    });
    const number = await issueOrderNumber(tx, context.organizationId, new Date());
    const created = await tx.salesOrder.create({
      data: {
        organizationId: context.organizationId,
        ...number,
        customerId: original.customerId,
        customerSiteId: original.customerSiteId,
        customerContactId: original.customerContactId,
        ownerMembershipId: context.membershipId,
        dueDate: original.dueDate,
        externalReference: original.externalReference,
        memo: original.memo,
      },
      select: orderSelect,
    });
    await writeAuditEvent(tx, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "order.copied",
      entityId: created.id,
      requestId: input.requestId,
      after: auditSnapshot(created),
      metadata: { sourceOrderId: original.id },
    });
    return toDto(created);
  });
}

export async function cancelOrder(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: { id: string; expectedLockVersion: number; reason: string; requestId: string },
) {
  requirePermission(context, "order.edit");
  const reason = input.reason.trim();
  if (!reason || reason.length > 500) {
    throw new OrderError("INVALID_REQUEST", "취소 사유를 1~500자로 입력해 주세요.");
  }
  return prisma.$transaction(async (tx) => {
    const old = await getOrderRow(tx, context.organizationId, input.id);
    if (old.status !== "DRAFT" && old.status !== "CALCULATED") {
      throw new OrderError("CONFLICT", "작성 중 또는 계산 완료 수주만 취소할 수 있습니다.", { latest: toDto(old) });
    }
    const result = await tx.salesOrder.updateMany({
      where: {
        id: input.id,
        organizationId: context.organizationId,
        status: { in: ["DRAFT", "CALCULATED"] },
        lockVersion: input.expectedLockVersion,
      },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledByMembershipId: context.membershipId,
        cancellationReason: reason,
        lockVersion: { increment: 1 },
      },
    });
    if (result.count !== 1) {
      const latest = await getOrderRow(tx, context.organizationId, input.id);
      throw new OrderError(
        "CONFLICT",
        "수주가 다른 화면에서 변경되었습니다. 최신 내용을 확인해 주세요.",
        { latest: toDto(latest) },
      );
    }
    const updated = await getOrderRow(tx, context.organizationId, input.id);
    await writeAuditEvent(tx, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "order.cancelled",
      entityId: updated.id,
      requestId: input.requestId,
      before: auditSnapshot(old),
      after: auditSnapshot(updated),
    });
    return toDto(updated);
  });
}

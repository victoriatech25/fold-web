import "server-only";

import { createHash } from "node:crypto";

import type { PrismaClient, SalesOrderStatus } from "@/generated/prisma/client";
import { projectCanonicalJsonV1 } from "@/domain/fold-document/canonical";
import { requirePermission } from "@/server/authorization/authorization";
import { writeAuditEvent } from "@/server/audit/audit-writer";
import type { AuthenticatedContext } from "@/server/auth/auth-types";

import { OrderError } from "./order-error";
import { orderSelect, toDto } from "./order-service";
import type { OrderTransitionAction } from "./order-transition-schema";

const transitionMap: Record<Exclude<OrderTransitionAction, "APPROVE" | "CANCEL_APPROVAL">, { from: SalesOrderStatus; to: SalesOrderStatus }> = {
  REQUEST_PRODUCTION: { from: "APPROVED", to: "PRODUCTION_REQUESTED" },
  START_PRODUCTION: { from: "PRODUCTION_REQUESTED", to: "IN_PRODUCTION" },
  COMPLETE_PRODUCTION: { from: "IN_PRODUCTION", to: "PRODUCED" },
  CLOSE: { from: "PRODUCED", to: "CLOSED" },
};

function inputChecksum(order: {
  customerId: string;
  partySnapshotChecksumSha256: string | null;
  foldItems: Array<{ id: string; lineNumber: number; documentChecksumSha256: string }>;
}) {
  return createHash("sha256").update(projectCanonicalJsonV1({
    schemaVersion: 1,
    customerId: order.customerId,
    partySnapshotChecksumSha256: order.partySnapshotChecksumSha256,
    items: [...order.foldItems]
      .sort((left, right) => left.lineNumber - right.lineNumber || left.id.localeCompare(right.id))
      .map((item) => ({ id: item.id, lineNumber: item.lineNumber, documentChecksumSha256: item.documentChecksumSha256 })),
  }), "utf8").digest("hex");
}

export async function transitionOrder(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: {
    orderId: string;
    action: OrderTransitionAction;
    expectedLockVersion: number;
    reason?: string;
    requestId: string;
  },
) {
  requirePermission(context, "order.approve");
  return prisma.$transaction(async (tx) => {
    const order = await tx.salesOrder.findFirst({
      where: { id: input.orderId, organizationId: context.organizationId },
      select: {
        id: true,
        status: true,
        lockVersion: true,
        customerId: true,
        partySnapshotChecksumSha256: true,
        foldItems: {
          where: { removedAt: null },
          select: { id: true, lineNumber: true, documentChecksumSha256: true },
        },
      },
    });
    if (!order) throw new OrderError("NOT_FOUND", "수주를 찾을 수 없습니다.");
    if (order.lockVersion !== input.expectedLockVersion) {
      throw new OrderError("CONFLICT", "수주가 다른 화면에서 변경되었습니다.", { latest: { id: order.id, status: order.status, lockVersion: order.lockVersion } });
    }

    let nextStatus: SalesOrderStatus;
    let updateData: {
      status: SalesOrderStatus;
      statusChangedAt: Date;
      statusChangedByMembershipId: string;
      approvedCalculationSnapshotId?: string | null;
      approvedAt?: Date | null;
      approvedByMembershipId?: string | null;
      lockVersion: { increment: number };
    };
    let calculationSnapshotId: string | undefined;
    let calculationSnapshotNumber: number | undefined;

    if (input.action === "APPROVE") {
      if (order.status !== "CALCULATED") throw new OrderError("CONFLICT", "계산 완료 수주만 승인할 수 있습니다.");
      if (order.foldItems.length === 0) throw new OrderError("CONFLICT", "승인할 절곡 작업이 없습니다.");
      const snapshot = await tx.salesOrderCalculationSnapshot.findFirst({
        where: { organizationId: context.organizationId, salesOrderId: order.id },
        orderBy: [{ snapshotNumber: "desc" }, { id: "desc" }],
        select: { id: true, snapshotNumber: true, inputChecksumSha256: true },
      });
      if (!snapshot || snapshot.inputChecksumSha256 !== inputChecksum(order)) {
        throw new OrderError("CONFLICT", "현재 입력과 일치하는 최신 계산을 완료한 뒤 승인해 주세요.");
      }
      nextStatus = "APPROVED";
      calculationSnapshotId = snapshot.id;
      calculationSnapshotNumber = snapshot.snapshotNumber;
      updateData = {
        status: nextStatus,
        approvedCalculationSnapshotId: snapshot.id,
        approvedAt: new Date(),
        approvedByMembershipId: context.membershipId,
        statusChangedAt: new Date(),
        statusChangedByMembershipId: context.membershipId,
        lockVersion: { increment: 1 },
      };
    } else if (input.action === "CANCEL_APPROVAL") {
      if (order.status !== "APPROVED") throw new OrderError("CONFLICT", "생산 요청 전 승인 상태에서만 승인을 취소할 수 있습니다.");
      if (!input.reason?.trim()) throw new OrderError("INVALID_REQUEST", "승인 취소 사유를 입력해 주세요.");
      nextStatus = "CALCULATED";
      updateData = {
        status: nextStatus,
        approvedCalculationSnapshotId: null,
        approvedAt: null,
        approvedByMembershipId: null,
        statusChangedAt: new Date(),
        statusChangedByMembershipId: context.membershipId,
        lockVersion: { increment: 1 },
      };
    } else {
      const transition = transitionMap[input.action];
      if (order.status !== transition.from) throw new OrderError("CONFLICT", `${transition.from} 상태에서만 요청한 전이를 실행할 수 있습니다.`);
      nextStatus = transition.to;
      updateData = {
        status: nextStatus,
        statusChangedAt: new Date(),
        statusChangedByMembershipId: context.membershipId,
        lockVersion: { increment: 1 },
      };
    }

    const changed = await tx.salesOrder.updateMany({
      where: { id: order.id, organizationId: context.organizationId, status: order.status, lockVersion: input.expectedLockVersion },
      data: updateData,
    });
    if (changed.count !== 1) throw new OrderError("CONFLICT", "수주 상태가 다른 화면에서 변경되었습니다.");
    const updated = await tx.salesOrder.findUniqueOrThrow({ where: { id: order.id }, select: orderSelect });
    await writeAuditEvent(tx, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "order.status_transitioned",
      entityId: order.id,
      requestId: input.requestId,
      before: { status: order.status, lockVersion: order.lockVersion },
      after: { status: updated.status, lockVersion: updated.lockVersion },
      metadata: {
        action: input.action,
        ...(input.reason ? { reason: input.reason.trim() } : {}),
        ...(calculationSnapshotId ? { calculationSnapshotId } : {}),
        ...(calculationSnapshotNumber ? { calculationSnapshotNumber } : {}),
      },
    });
    return toDto(updated);
  });
}

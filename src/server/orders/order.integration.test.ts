import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { PermissionDeniedError } from "@/server/authorization/authorization";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { disconnectPrisma, getPrisma } from "@/server/db/prisma";
import { OrderError } from "@/server/orders/order-error";
import {
  cancelOrder,
  copyOrder,
  createOrder,
  getOrder,
  getOrderFormOptions,
  listOrders,
  updateOrder,
} from "@/server/orders/order-service";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

integration.sequential("sales order header integration", () => {
  let prisma: PrismaClient;
  let context: AuthenticatedContext;
  let customerId: string;
  let siteId: string;
  let contactId: string;
  let otherCustomerId: string;

  beforeAll(async () => {
    prisma = getPrisma();
    const organization = await prisma.organization.create({
      data: { code: "ORDER-INTEGRATION", name: "수주 통합 조직" },
    });
    const user = await prisma.user.create({
      data: {
        email: "order-integration@example.test",
        normalizedEmail: "order-integration@example.test",
        displayName: "수주 담당자",
        status: "ACTIVE",
      },
    });
    const membership = await prisma.organizationMembership.create({
      data: { organizationId: organization.id, userId: user.id },
    });
    context = {
      sessionId: crypto.randomUUID(),
      userId: user.id,
      displayName: user.displayName,
      membershipId: membership.id,
      departmentId: null,
      organizationId: organization.id,
      organizationCode: organization.code,
      organizationName: organization.name,
      roleKeys: ["SALES"],
      permissions: ["order.read", "order.edit"],
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    };
    const customer = await prisma.customer.create({
      data: {
        organizationId: organization.id,
        code: "ORDER-CUSTOMER",
        name: "수주 검증 거래처",
        normalizedName: "수주 검증 거래처",
      },
    });
    customerId = customer.id;
    siteId = (
      await prisma.customerSite.create({
        data: {
          organizationId: organization.id,
          customerId,
          code: "MAIN",
          name: "기본 현장",
          isDefault: true,
        },
      })
    ).id;
    contactId = (
      await prisma.customerContact.create({
        data: {
          organizationId: organization.id,
          customerId,
          customerSiteId: siteId,
          name: "기본 담당자",
          isPrimary: true,
        },
      })
    ).id;

    const otherOrganization = await prisma.organization.create({
      data: { code: "ORDER-INTEGRATION-OTHER", name: "다른 수주 조직" },
    });
    otherCustomerId = (
      await prisma.customer.create({
        data: {
          organizationId: otherOrganization.id,
          code: "OTHER-CUSTOMER",
          name: "다른 조직 거래처",
          normalizedName: "다른 조직 거래처",
        },
      })
    ).id;
  });

  afterAll(async () => disconnectPrisma());

  it("issues organization-scoped numbers and applies customer defaults", async () => {
    const created = await createOrder(prisma, context, {
      customerId,
      requestId: "order-create-defaults",
    });
    expect(created.orderNumber).toMatch(/^SO-\d{4}-\d{6}$/);
    expect(created).toMatchObject({
      status: "DRAFT",
      customerSiteId: siteId,
      customerContactId: contactId,
      ownerMembershipId: context.membershipId,
    });

    const parallel = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        createOrder(prisma, context, {
          customerId,
          requestId: `order-create-parallel-${index}`,
        }),
      ),
    );
    expect(new Set(parallel.map((order) => order.orderNumber))).toHaveLength(4);
    expect((await listOrders(prisma, context, { q: "수주 검증" })).length).toBeGreaterThanOrEqual(5);
  });

  it("updates with atomic locking and records typed audit events", async () => {
    const created = await createOrder(prisma, context, {
      customerId,
      requestId: "order-update-create",
    });
    const updated = await updateOrder(prisma, context, {
      id: created.id,
      customerId,
      customerSiteId: siteId,
      customerContactId: contactId,
      ownerMembershipId: context.membershipId,
      dueDate: "2026-08-31",
      externalReference: "PO-2026-0815",
      memo: "통합 테스트",
      expectedLockVersion: created.lockVersion,
      requestId: "order-update",
    });
    expect(updated).toMatchObject({ dueDate: "2026-08-31", lockVersion: 2 });
    await expect(
      updateOrder(prisma, context, {
        id: created.id,
        customerId,
        expectedLockVersion: created.lockVersion,
        requestId: "order-update-stale",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const audit = await prisma.auditEvent.findMany({
      where: { organizationId: context.organizationId, entityId: created.id },
      orderBy: { occurredAt: "asc" },
      select: { action: true, requestId: true },
    });
    expect(audit).toEqual([
      { action: "order.created", requestId: "order-update-create" },
      { action: "order.updated", requestId: "order-update" },
    ]);
  });

  it("copies only draft headers and preserves cancelled orders as read-only", async () => {
    const original = await createOrder(prisma, context, {
      customerId,
      memo: "복사 원본",
      requestId: "order-copy-create",
    });
    const copied = await copyOrder(prisma, context, {
      id: original.id,
      requestId: "order-copy",
    });
    expect(copied).toMatchObject({
      status: "DRAFT",
      memo: "복사 원본",
      ownerMembershipId: context.membershipId,
    });
    expect(copied.orderNumber).not.toBe(original.orderNumber);

    await expect(
      cancelOrder(prisma, context, {
        id: original.id,
        expectedLockVersion: original.lockVersion,
        reason: "   ",
        requestId: "order-cancel-empty",
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    const cancelled = await cancelOrder(prisma, context, {
      id: original.id,
      expectedLockVersion: original.lockVersion,
      reason: "고객 요청 취소",
      requestId: "order-cancel",
    });
    expect(cancelled).toMatchObject({
      status: "CANCELLED",
      cancellationReason: "고객 요청 취소",
      lockVersion: original.lockVersion + 1,
    });
    await expect(
      copyOrder(prisma, context, { id: original.id, requestId: "copy-cancelled" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      updateOrder(prisma, context, {
        id: original.id,
        customerId,
        expectedLockVersion: cancelled.lockVersion,
        requestId: "update-cancelled",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const actions = await prisma.auditEvent.findMany({
      where: { organizationId: context.organizationId, action: { in: ["order.copied", "order.cancelled"] } },
      select: { action: true, requestId: true },
    });
    expect(actions).toEqual(expect.arrayContaining([
      { action: "order.copied", requestId: "order-copy" },
      { action: "order.cancelled", requestId: "order-cancel" },
    ]));
  });

  it("enforces permissions, organization boundaries, and active references", async () => {
    await expect(listOrders(prisma, { ...context, permissions: [] }, {})).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(
      createOrder(prisma, context, {
        customerId: otherCustomerId,
        requestId: "order-other-organization",
      }),
    ).rejects.toBeInstanceOf(OrderError);
    await expect(getOrder(prisma, context, otherCustomerId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const options = await getOrderFormOptions(prisma, context);
    expect(options.customers.find((customer) => customer.id === customerId)).toMatchObject({
      sites: [{ id: siteId }],
      contacts: [{ id: contactId }],
    });
    expect(options.owners).toContainEqual({ id: context.membershipId, name: context.displayName });
  });
});

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { AuditServiceError } from "@/server/audit/audit-error";
import { getAuditEvent, listAuditEvents } from "@/server/audit/audit-service";
import { writeAuditEvent } from "@/server/audit/audit-writer";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { disconnectPrisma, getPrisma } from "@/server/db/prisma";

const runIntegration = process.env.RUN_DB_INTEGRATION === "1";
const integration = runIntegration ? describe : describe.skip;
const migrationUrl =
  process.env.TEST_MIGRATION_DATABASE_URL ??
  "postgresql://fold_web_migrator@127.0.0.1:5432/fold_web_test?schema=public";

let prisma: PrismaClient;
let organizationId: string;
let actorId: string;
let otherOrganizationId: string;
let context: AuthenticatedContext;

integration.sequential("audit event v2 integration", () => {
  beforeAll(async () => {
    prisma = getPrisma();
    const organization = await prisma.organization.create({
      data: {
        code: "AUDIT_INTEGRATION",
        name: "감사 통합 테스트 조직",
      },
      select: { id: true },
    });
    organizationId = organization.id;
    actorId = (
      await prisma.user.create({
        data: {
          email: "audit-actor@example.test",
          normalizedEmail: "audit-actor@example.test",
          displayName: "감사 행위자",
          status: "ACTIVE",
          memberships: {
            create: { organizationId },
          },
        },
        select: { id: true },
      })
    ).id;
    otherOrganizationId = (
      await prisma.organization.create({
        data: {
          code: "AUDIT_OTHER",
          name: "감사 격리 대상 조직",
        },
        select: { id: true },
      })
    ).id;
    context = {
      sessionId: "00000000-0000-4000-8000-000000000001",
      userId: actorId,
      displayName: "감사 행위자",
      membershipId: "00000000-0000-4000-8000-000000000002",
      departmentId: null,
      organizationId,
      organizationCode: "AUDIT_INTEGRATION",
      organizationName: "감사 통합 테스트 조직",
      roleKeys: ["ADMINISTRATOR"],
      permissions: ["audit.read"],
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    };
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("preserves actor snapshots and action-specific change payloads", async () => {
    const created = await writeAuditEvent(prisma, {
      organizationId,
      actorUserId: actorId,
      action: "admin.department_updated",
      entityId: "department-a",
      requestId: "audit-snapshot",
      before: { name: "이전 부서", active: true },
      after: { name: "변경 부서", active: true },
    });
    await prisma.user.update({
      where: { id: actorId },
      data: { displayName: "변경된 행위자" },
    });

    const detail = await getAuditEvent(
      prisma,
      context,
      created.id,
      "audit-detail",
    );
    expect(detail.actor).toMatchObject({
      userId: actorId,
      displayName: "감사 행위자",
      email: "audit-actor@example.test",
    });
    expect(detail.before).toEqual({ name: "이전 부서", active: true });
    expect(detail.after).toEqual({ name: "변경 부서", active: true });
  });

  it("uses a stable cursor and records list access without leaking filters", async () => {
    await prisma.auditEvent.createMany({
      data: Array.from({ length: 27 }, (_, index) => ({
        organizationId,
        category: "SYSTEM" as const,
        outcome: "SUCCESS" as const,
        source: "SYSTEM" as const,
        schemaVersion: 2,
        actorUserId: actorId,
        actorDisplayName: "감사 행위자",
        actorEmail: "audit-actor@example.test",
        action: "platform.database_smoke",
        entityType: "Platform",
        entityId: `cursor-${index.toString().padStart(2, "0")}`,
        requestId: `cursor-request-${index}`,
        occurredAt: new Date(
          Date.UTC(2026, 6, 21, 0, 0, index),
        ),
      })),
    });
    const range = {
      from: new Date("2026-07-20T00:00:00.000Z"),
      to: new Date("2026-07-22T00:00:00.000Z"),
      category: "SYSTEM" as const,
      actorQuery: "audit-actor@example.test",
      limit: 25 as const,
    };
    const first = await listAuditEvents(
      prisma,
      context,
      range,
      "audit-list-first",
    );
    expect(first.items).toHaveLength(25);
    expect(first.nextCursor).not.toBeNull();
    const second = await listAuditEvents(
      prisma,
      context,
      { ...range, cursor: first.nextCursor! },
      "audit-list-second",
    );
    expect(second.items).toHaveLength(2);
    expect(
      new Set([...first.items, ...second.items].map(({ id }) => id)).size,
    ).toBe(27);

    const accessEvent = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId, requestId: "audit-list-first" },
      select: { action: true, metadata: true },
    });
    expect(accessEvent.action).toBe("audit.events_viewed");
    expect(accessEvent.metadata).toEqual({
      activeFilters: ["category", "actor"],
      resultCount: 25,
      rangeDays: 2,
    });
  });

  it("does not reveal audit events from another organization", async () => {
    const foreign = await writeAuditEvent(prisma, {
      organizationId: otherOrganizationId,
      action: "platform.database_smoke",
      requestId: "foreign-audit",
    });
    await expect(
      getAuditEvent(prisma, context, foreign.id, "cross-organization-audit"),
    ).rejects.toBeInstanceOf(AuditServiceError);
    await expect(
      getAuditEvent(prisma, context, foreign.id, "cross-organization-audit"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rolls back the business mutation when audit payload validation fails", async () => {
    await expect(
      prisma.$transaction(async (transaction) => {
        await transaction.department.create({
          data: {
            organizationId,
            code: "ROLLBACK_AUDIT",
            name: "롤백 대상",
          },
        });
        await writeAuditEvent(transaction, {
          organizationId,
          actorUserId: actorId,
          action: "admin.department_created",
          metadata: { password: "must-never-be-stored" },
        } as never);
      }),
    ).rejects.toThrow("forbidden sensitive key");
    await expect(
      prisma.department.count({
        where: { organizationId, code: "ROLLBACK_AUDIT" },
      }),
    ).resolves.toBe(0);
  });

  it("blocks update and delete for both the app role and migration owner", async () => {
    const created = await writeAuditEvent(prisma, {
      organizationId,
      actorUserId: actorId,
      action: "platform.database_smoke",
      requestId: "append-only",
    });
    await expect(
      prisma.auditEvent.update({
        where: { id: created.id },
        data: { requestId: "tampered" },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.auditEvent.delete({ where: { id: created.id } }),
    ).rejects.toThrow();

    const administrativeUrl = new URL(migrationUrl);
    administrativeUrl.searchParams.delete("schema");
    const client = new pg.Client({
      connectionString: administrativeUrl.toString(),
    });
    await client.connect();
    try {
      await expect(
        client.query('UPDATE "AuditEvent" SET "requestId" = $1 WHERE id = $2', [
          "owner-tamper",
          created.id,
        ]),
      ).rejects.toMatchObject({ code: "55000" });
    } finally {
      await client.end();
    }
  });
});

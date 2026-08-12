import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import type { ServerFoldDocumentV1 } from "@/domain/fold-document/schema";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { PermissionDeniedError } from "@/server/authorization/authorization";
import { disconnectPrisma, getPrisma } from "@/server/db/prisma";
import { FoldDraftServiceError } from "@/server/fold-draft/fold-draft-error";
import {
  createFoldDraft,
  deleteFoldDraft,
  getFoldDraft,
  listFoldDrafts,
  listFoldMaterialOptions,
  updateFoldDraft,
} from "@/server/fold-draft/fold-draft-service";

const runIntegration = process.env.RUN_DB_INTEGRATION === "1";
const integration = runIntegration ? describe : describe.skip;

let prisma: PrismaClient;
let organizationId: string;
let otherOrganizationId: string;
let userId: string;
let materialRuleRevisionId: string;
let otherMaterialRuleRevisionId: string;
let context: AuthenticatedContext;

async function createMaterialRule(
  targetOrganizationId: string,
  suffix: string,
) {
  const material = await prisma.material.create({
    data: {
      organizationId: targetOrganizationId,
      code: `FD-${suffix}`,
      name: `절곡 재질 ${suffix}`,
      normalizedName: `절곡 재질 ${suffix}`.toLocaleLowerCase("ko-KR"),
      densityKgPerM3: "2700",
    },
  });
  const variant = await prisma.materialVariant.create({
    data: {
      organizationId: targetOrganizationId,
      materialId: material.id,
      code: `FD-1T-${suffix}`,
      name: `절곡 재질 1T ${suffix}`,
      thicknessMm: "1",
      defaultInsideRadiusMm: "1",
    },
  });
  return prisma.materialRuleRevision.create({
    data: {
      organizationId: targetOrganizationId,
      materialVariantId: variant.id,
      revisionNumber: 1,
      status: "PUBLISHED",
      calculationMode: "FIXED",
      vCutEnabled: true,
      decimalPlaces: 1,
      decimalOperation: "ROUND",
      cutAngleDeg: "135",
      insideBendRadiusMm: "1",
      elongationVCutMm: "0.6",
      elongationACutMm: "0.4",
      elongationNoCutMm: "1",
      cutDepthVCutMm: "0.5",
      cutDepthACutMm: "0.5",
      cutDepthNoCutMm: "0",
      publishedAt: new Date("2026-07-25T00:00:00.000Z"),
    },
  });
}

function document(
  name: string,
  endX: string,
  ruleRevisionId = materialRuleRevisionId,
): ServerFoldDocumentV1 {
  return {
    schemaVersion: 1,
    documentType: "normal",
    name,
    product: { lengthMm: "1000", quantity: 1 },
    material: {
      ruleRevisionId,
      name: "클라이언트가 보낸 비권위 snapshot",
      thicknessMm: "9",
      insideBendRadiusMm: "9",
      cutAngleDeg: "120",
      elongationMm: { vCut: "9", aCut: "9", noCut: "9" },
      cutDepthMm: { vCut: "9", aCut: "9", noCut: "9" },
    },
    calculation: {
      mode: "fixed",
      elongationOption: "standard",
      vCutEnabled: true,
      decimalPlaces: 1,
      decimalOperation: "round",
    },
    variables: [],
    blocks: [
      {
        id: "block-1",
        name: "면 1",
        order: 1,
        segments: [
          {
            id: "segment-1",
            order: 1,
            geometry: {
              kind: "line",
              start: { xMm: "0", yMm: "0" },
              end: { xMm: endX, yMm: "0" },
              direction: "e",
            },
            nominalLengthMm: endX,
          },
        ],
      },
    ],
  };
}

integration.sequential("fold draft persistence integration", () => {
  beforeAll(async () => {
    prisma = getPrisma();
    organizationId = (
      await prisma.organization.create({
        data: { code: "FOLD_DRAFT", name: "절곡 초안 통합 테스트" },
        select: { id: true },
      })
    ).id;
    otherOrganizationId = (
      await prisma.organization.create({
        data: { code: "FOLD_DRAFT_OTHER", name: "절곡 초안 타 조직" },
        select: { id: true },
      })
    ).id;
    userId = (
      await prisma.user.create({
        data: {
          email: "fold-draft@example.test",
          normalizedEmail: "fold-draft@example.test",
          displayName: "절곡 초안 작성자",
          status: "ACTIVE",
        },
        select: { id: true },
      })
    ).id;
    materialRuleRevisionId = (
      await createMaterialRule(organizationId, "OWN")
    ).id;
    otherMaterialRuleRevisionId = (
      await createMaterialRule(otherOrganizationId, "OTHER")
    ).id;
    context = {
      sessionId: crypto.randomUUID(),
      userId,
      displayName: "절곡 초안 작성자",
      membershipId: crypto.randomUUID(),
      departmentId: null,
      organizationId,
      organizationCode: "FOLD_DRAFT",
      organizationName: "절곡 초안 통합 테스트",
      roleKeys: ["DESIGNER"],
      permissions: ["template.fold.read", "template.fold.edit", "material.read"],
      expiresAt: new Date("2026-07-26T00:00:00.000Z"),
    };
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("creates, lists and reads a canonical organization draft", async () => {
    const draftId = crypto.randomUUID();
    const created = await createFoldDraft(prisma, context, {
      draftId,
      document: document("첫 초안", "100"),
      requestId: "draft-create",
    });
    expect(created).toMatchObject({
      draftId,
      name: "첫 초안",
      lockVersion: 1,
      document: {
        material: {
          ruleRevisionId: materialRuleRevisionId,
          name: "절곡 재질 1T OWN",
          thicknessMm: "1",
        },
      },
    });
    const retried = await createFoldDraft(prisma, context, {
      draftId,
      document: document("첫 초안", "100"),
      requestId: "draft-create-retry",
    });
    expect(retried.lockVersion).toBe(1);

    const listed = await listFoldDrafts(prisma, context, { limit: 25 });
    expect(listed.items.some((item) => item.draftId === draftId)).toBe(true);
    expect((await getFoldDraft(prisma, context, draftId)).document).toEqual(
      created.document,
    );
    expect(
      await prisma.auditEvent.count({
        where: { entityId: draftId, action: "fold.draft_created" },
      }),
    ).toBe(1);
  });

  it("increments lock versions, treats lost responses idempotently and rejects stale changes", async () => {
    const draftId = crypto.randomUUID();
    const created = await createFoldDraft(prisma, context, {
      draftId,
      document: document("동시성 초안", "100"),
      requestId: "concurrency-create",
    });
    const saved = await updateFoldDraft(prisma, context, {
      draftId,
      expectedLockVersion: created.lockVersion,
      document: document("동시성 초안", "110"),
      requestId: "concurrency-save",
    });
    expect(saved.lockVersion).toBe(2);

    const responseLostRetry = await updateFoldDraft(prisma, context, {
      draftId,
      expectedLockVersion: 1,
      document: document("동시성 초안", "110"),
      requestId: "concurrency-save-retry",
    });
    expect(responseLostRetry.lockVersion).toBe(2);
    expect(
      await prisma.auditEvent.count({
        where: { entityId: draftId, action: "fold.draft_saved" },
      }),
    ).toBe(1);

    await expect(
      updateFoldDraft(prisma, context, {
        draftId,
        expectedLockVersion: 1,
        document: document("충돌한 로컬 초안", "120"),
        requestId: "concurrency-stale",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { conflict: { lockVersion: 2 } },
    });
  });

  it("serializes concurrent saves so exactly one stale writer wins", async () => {
    const draftId = crypto.randomUUID();
    await createFoldDraft(prisma, context, {
      draftId,
      document: document("경합 초안", "100"),
      requestId: "race-create",
    });
    const results = await Promise.allSettled([
      updateFoldDraft(prisma, context, {
        draftId,
        expectedLockVersion: 1,
        document: document("경합 A", "130"),
        requestId: "race-a",
      }),
      updateFoldDraft(prisma, context, {
        draftId,
        expectedLockVersion: 1,
        document: document("경합 B", "140"),
        requestId: "race-b",
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: "CONFLICT" }),
    });
    expect((await getFoldDraft(prisma, context, draftId)).lockVersion).toBe(2);
  });

  it("hides cross-organization drafts and material rules", async () => {
    const draftId = crypto.randomUUID();
    await createFoldDraft(prisma, context, {
      draftId,
      document: document("조직 경계", "100"),
      requestId: "boundary-create",
    });
    const otherContext = { ...context, organizationId: otherOrganizationId };
    await expect(getFoldDraft(prisma, otherContext, draftId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      createFoldDraft(prisma, context, {
        draftId: crypto.randomUUID(),
        document: document("잘못된 재질", "100", otherMaterialRuleRevisionId),
        requestId: "boundary-material",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const options = await listFoldMaterialOptions(prisma, context);
    expect(options.map((option) => option.ruleRevisionId)).toContain(
      materialRuleRevisionId,
    );
    expect(options.map((option) => option.ruleRevisionId)).not.toContain(
      otherMaterialRuleRevisionId,
    );
  });

  it("soft deletes with a lock version and denies read-only mutation", async () => {
    const draftId = crypto.randomUUID();
    const created = await createFoldDraft(prisma, context, {
      draftId,
      document: document("삭제 초안", "100"),
      requestId: "delete-create",
    });
    await expect(
      deleteFoldDraft(prisma, context, {
        draftId,
        expectedLockVersion: created.lockVersion + 1,
        requestId: "delete-stale",
      }),
    ).rejects.toBeInstanceOf(FoldDraftServiceError);
    await deleteFoldDraft(prisma, context, {
      draftId,
      expectedLockVersion: created.lockVersion,
      requestId: "delete-success",
    });
    await expect(getFoldDraft(prisma, context, draftId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      createFoldDraft(
        prisma,
        { ...context, permissions: ["template.fold.read"] },
        {
          draftId: crypto.randomUUID(),
          document: document("읽기 전용", "100"),
          requestId: "read-only",
        },
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

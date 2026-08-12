import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import type { ServerFoldDocumentV1 } from "@/domain/fold-document/schema";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { PermissionDeniedError } from "@/server/authorization/authorization";
import { disconnectPrisma, getPrisma } from "@/server/db/prisma";
import { createFoldDraft } from "@/server/fold-draft/fold-draft-service";
import {
  copyFoldTemplate,
  createFoldCategory,
  createNextFoldRevision,
  getFoldTemplate,
  getFoldRevision,
  listFoldTemplates,
  transitionFoldRevision,
  updateFoldTemplateMetadata,
} from "@/server/fold-library/fold-library-service";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

let prisma: PrismaClient;
let organizationId: string;
let otherOrganizationId: string;
let userId: string;
let materialRuleRevisionId: string;
let context: AuthenticatedContext;

function document(name: string): ServerFoldDocumentV1 {
  return {
    schemaVersion: 1,
    documentType: "normal",
    name,
    product: { lengthMm: "1000", quantity: 1 },
    material: {
      ruleRevisionId: materialRuleRevisionId,
      name: "서버 대체값",
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
    blocks: [{
      id: "block-1",
      name: "면 1",
      order: 1,
      segments: [{
        id: "segment-1",
        order: 1,
        geometry: {
          kind: "line",
          start: { xMm: "0", yMm: "0" },
          end: { xMm: "100", yMm: "0" },
          direction: "e",
        },
        nominalLengthMm: "100",
      }],
    }],
  };
}

integration.sequential("fold template library integration", () => {
  beforeAll(async () => {
    prisma = getPrisma();
    organizationId = (await prisma.organization.create({ data: { code: "FOLD_LIBRARY", name: "템플릿 라이브러리 통합" } })).id;
    otherOrganizationId = (await prisma.organization.create({ data: { code: "FOLD_LIBRARY_OTHER", name: "다른 라이브러리 조직" } })).id;
    userId = (await prisma.user.create({ data: {
      email: "fold-library@example.test",
      normalizedEmail: "fold-library@example.test",
      displayName: "템플릿 승인자",
      status: "ACTIVE",
    } })).id;
    const material = await prisma.material.create({ data: {
      organizationId,
      code: "FL-MAT",
      name: "라이브러리 재질",
      normalizedName: "라이브러리 재질",
      densityKgPerM3: "2700",
    } });
    const variant = await prisma.materialVariant.create({ data: {
      organizationId,
      materialId: material.id,
      code: "FL-MAT-1T",
      name: "라이브러리 재질 1T",
      thicknessMm: "1",
      defaultInsideRadiusMm: "1",
    } });
    materialRuleRevisionId = (await prisma.materialRuleRevision.create({ data: {
      organizationId,
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
    } })).id;
    context = {
      sessionId: crypto.randomUUID(),
      userId,
      displayName: "템플릿 승인자",
      membershipId: crypto.randomUUID(),
      departmentId: null,
      organizationId,
      organizationCode: "FOLD_LIBRARY",
      organizationName: "템플릿 라이브러리 통합",
      roleKeys: ["APPROVER"],
      permissions: ["template.fold.read", "template.fold.edit", "template.fold.publish", "material.read"],
      expiresAt: new Date("2026-07-26T00:00:00.000Z"),
    };
  });

  afterAll(async () => disconnectPrisma());

  it("moves a draft through review, publish and a replacement publication atomically", async () => {
    const category = await createFoldCategory(prisma, context, { name: "통합 분류", sortOrder: 10, requestId: "category-create" });
    const draft = await createFoldDraft(prisma, context, {
      draftId: crypto.randomUUID(),
      document: document("상태 전이 템플릿"),
      requestId: "library-draft-create",
    });
    let template = await updateFoldTemplateMetadata(prisma, context, {
      templateId: draft.templateId,
      name: draft.name,
      categoryId: category.id,
      expectedLockVersion: 1,
      requestId: "metadata-update",
    });
    expect(template.category?.id).toBe(category.id);
    expect(template.currentRevision?.lockVersion).toBe(2);

    const reviewExpectedLockVersion = template.currentRevision!.lockVersion;
    template = await transitionFoldRevision(prisma, context, {
      revisionId: draft.draftId,
      action: "review",
      expectedLockVersion: reviewExpectedLockVersion,
      requestId: "review-request",
    });
    expect(template.currentRevision?.status).toBe("REVIEW");
    const retriedReview = await transitionFoldRevision(prisma, context, {
      revisionId: draft.draftId,
      action: "review",
      expectedLockVersion: reviewExpectedLockVersion,
      requestId: "review-request-retry",
    });
    expect(retriedReview.currentRevision?.status).toBe("REVIEW");
    expect(await prisma.auditEvent.count({ where: {
      entityId: draft.draftId,
      action: "fold.revision_review_requested",
    } })).toBe(1);
    template = await transitionFoldRevision(prisma, context, {
      revisionId: draft.draftId,
      action: "publish",
      expectedLockVersion: template.currentRevision!.lockVersion,
      requestId: "publish-r1",
    });
    expect(template.currentRevision).toMatchObject({ status: "PUBLISHED", revisionNumber: 1 });

    template = await createNextFoldRevision(prisma, context, {
      templateId: template.templateId,
      sourceRevisionId: draft.draftId,
      draftId: crypto.randomUUID(),
      requestId: "revision-r2",
    });
    expect(template.currentRevision).toMatchObject({ status: "DRAFT", revisionNumber: 2 });
    template = await transitionFoldRevision(prisma, context, {
      revisionId: template.currentRevision!.revisionId,
      action: "review",
      expectedLockVersion: template.currentRevision!.lockVersion,
      requestId: "review-r2",
    });
    template = await transitionFoldRevision(prisma, context, {
      revisionId: template.currentRevision!.revisionId,
      action: "publish",
      expectedLockVersion: template.currentRevision!.lockVersion,
      requestId: "publish-r2",
    });
    expect(template.revisions.map(({ revisionNumber, status }) => ({ revisionNumber, status }))).toEqual([
      { revisionNumber: 2, status: "PUBLISHED" },
      { revisionNumber: 1, status: "RETIRED" },
    ]);
    expect(await prisma.foldRevision.count({ where: { templateId: template.templateId, status: "PUBLISHED", deletedAt: null } })).toBe(1);
  });

  it("copies a historical revision and finds it with combined search filters", async () => {
    const source = await listFoldTemplates(prisma, context, { q: "상태 전이", status: "PUBLISHED", limit: 25 });
    expect(source.items).toHaveLength(1);
    const sourceDetail = await getFoldTemplate(prisma, context, source.items[0].templateId);
    const copied = await copyFoldTemplate(prisma, context, {
      sourceRevisionId: sourceDetail.revisions.at(-1)!.revisionId,
      draftId: crypto.randomUUID(),
      name: "검색 가능한 복사본",
      categoryId: sourceDetail.category!.id,
      requestId: "copy-template",
    });
    expect(copied.currentRevision).toMatchObject({ status: "DRAFT", revisionNumber: 1 });
    const retriedCopy = await copyFoldTemplate(prisma, context, {
      sourceRevisionId: sourceDetail.revisions.at(-1)!.revisionId,
      draftId: copied.currentRevision!.revisionId,
      name: "검색 가능한 복사본",
      categoryId: sourceDetail.category!.id,
      requestId: "copy-template-retry",
    });
    expect(retriedCopy.templateId).toBe(copied.templateId);
    const listed = await listFoldTemplates(prisma, context, {
      q: "검색 가능한",
      categoryId: copied.category!.id,
      status: "DRAFT",
      documentType: "NORMAL",
      limit: 25,
    });
    expect(listed.items.map((item) => item.templateId)).toEqual([copied.templateId]);

    const panelCopy = await copyFoldTemplate(prisma, context, {
      sourceRevisionId: sourceDetail.revisions.at(-1)!.revisionId,
      draftId: crypto.randomUUID(),
      name: "재사용 패널 템플릿",
      categoryId: sourceDetail.category!.id,
      targetDocumentType: "panel",
      requestId: "copy-panel-template",
    });
    expect(panelCopy.documentType).toBe("panel");
    const panelRevision = await getFoldRevision(prisma, context, panelCopy.currentRevision!.revisionId);
    expect(panelRevision.document).toMatchObject({ documentType: "panel", panelAttachments: [] });
    expect(panelRevision.document.blocks).toHaveLength(1);
  });

  it("enforces organization and permission boundaries", async () => {
    const visible = await listFoldTemplates(prisma, context, { limit: 25 });
    const templateId = visible.items[0].templateId;
    await expect(getFoldTemplate(prisma, { ...context, organizationId: otherOrganizationId }, templateId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createFoldCategory(prisma, { ...context, permissions: ["template.fold.read"] }, {
      name: "권한 없는 분류",
      sortOrder: 20,
      requestId: "denied-category",
    })).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

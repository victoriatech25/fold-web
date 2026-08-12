import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { PermissionDeniedError } from "@/server/authorization/authorization";
import { disconnectPrisma, getPrisma } from "@/server/db/prisma";
import { listOrganizationFoldMaterialOptions } from "@/server/fold-draft/fold-draft-repository";
import { createMaterial, createMaterialVariant } from "@/server/materials/material-service";

import { createMaterialRule, getMaterialRuleWorkspace, previewMaterialRule, transitionMaterialRule, updateMaterialRule } from "./material-rule-service";
import type { MaterialRuleFields } from "./material-rule-types";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const fields: MaterialRuleFields = {
  calculationMode: "RATIO",
  elongationOption: "TWO_LINE",
  vCutEnabled: true,
  decimalPlaces: 1,
  decimalOperation: "ROUND",
  cutAngleDeg: "135",
  insideBendRadiusMm: "1.2",
  elongationVCutMm: "0.6",
  elongationACutMm: "0.4",
  elongationNoCutMm: "1",
  cutDepthVCutMm: "0.5",
  cutDepthACutMm: "0.4",
  cutDepthNoCutMm: "0",
  changeSummary: "RATIO 계산 규칙 검증",
};

integration.sequential("material calculation rule integration", () => {
  let prisma: PrismaClient;
  let context: AuthenticatedContext;
  let materialId: string;
  let variantId: string;

  beforeAll(async () => {
    prisma = getPrisma();
    const organization = await prisma.organization.create({ data: { code: "RULES", name: "계산 규칙 통합 조직" } });
    const user = await prisma.user.create({ data: { email: "rules@example.test", normalizedEmail: "rules@example.test", displayName: "규칙 관리자", status: "ACTIVE" } });
    context = { sessionId: crypto.randomUUID(), userId: user.id, displayName: user.displayName, membershipId: crypto.randomUUID(), departmentId: null, organizationId: organization.id, organizationCode: organization.code, organizationName: organization.name, roleKeys: ["APPROVER"], permissions: ["material.read", "material.write", "material.approve"], expiresAt: new Date("2027-01-01T00:00:00Z") };
    const material = await createMaterial(prisma, context, { code: "RULE", name: "규칙 재질", densityKgPerM3: "2700", sortOrder: 0, memo: null, requestId: "rule-material" });
    const variant = await createMaterialVariant(prisma, context, { materialId: material.id, code: "RULE-12", name: "규칙 1.2T", thicknessMm: "1.2", defaultInsideRadiusMm: "1.2", sortOrder: 0, requestId: "rule-variant" });
    materialId = material.id;
    variantId = variant.id;
  });

  afterAll(async () => disconnectPrisma());

  it("creates one mutable draft, enforces locking and produces boundary previews", async () => {
    const created = await createMaterialRule(prisma, context, { ...fields, materialId, variantId, requestId: "rule-create" });
    expect(created).toMatchObject({ revisionNumber: 1, status: "DRAFT", effectiveStatus: "DRAFT", elongationOption: "TWO_LINE", cutAngleDeg: "135" });
    expect(created.contentChecksumSha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(createMaterialRule(prisma, context, { ...fields, materialId, variantId, requestId: "rule-duplicate" })).rejects.toMatchObject({ code: "CONFLICT" });
    const updated = await updateMaterialRule(prisma, context, { ...fields, elongationVCutMm: "0.7", materialId, variantId, ruleId: created.id, expectedLockVersion: created.lockVersion, requestId: "rule-update" });
    await expect(updateMaterialRule(prisma, context, { ...fields, materialId, variantId, ruleId: created.id, expectedLockVersion: created.lockVersion, requestId: "rule-stale" })).rejects.toMatchObject({ code: "CONFLICT" });
    const preview = await previewMaterialRule(prisma, context, { materialId, variantId, ruleId: updated.id });
    const below = preview.cases.find((item) => item.key === "front-v-134")!;
    const equal = preview.cases.find((item) => item.key === "front-v-135")!;
    expect(below.candidateCorrectionMm).not.toBe("0");
    expect(equal.candidateCorrectionMm).toBe("0");
  });

  it("reviews and publishes immediately while exposing the complete setting to design", async () => {
    const draft = (await getMaterialRuleWorkspace(prisma, context, materialId, variantId)).revisions[0];
    const reviewed = await transitionMaterialRule(prisma, context, { materialId, variantId, ruleId: draft.id, action: "review", expectedLockVersion: draft.lockVersion, effectiveFrom: new Date(Date.now() - 1000).toISOString(), requestId: "rule-review" });
    expect(reviewed?.status).toBe("REVIEW");
    const published = await transitionMaterialRule(prisma, context, { materialId, variantId, ruleId: draft.id, action: "publish", expectedLockVersion: reviewed!.lockVersion, requestId: "rule-publish" });
    expect(published).toMatchObject({ status: "PUBLISHED", effectiveStatus: "ACTIVE" });
    const option = (await listOrganizationFoldMaterialOptions(prisma, context.organizationId)).find((item) => item.materialVariantId === variantId)!;
    expect(option.calculation).toMatchObject({ mode: "ratio", elongationOption: "two-line", decimalPlaces: 1 });
  });

  it("schedules a replacement, restores the predecessor when cancelled, and records history", async () => {
    const first = (await getMaterialRuleWorkspace(prisma, context, materialId, variantId)).revisions[0];
    const second = await createMaterialRule(prisma, context, { ...fields, calculationMode: "FIXED", changeSummary: "미래 예약 규칙", materialId, variantId, sourceRuleRevisionId: first.id, requestId: "rule-create-2" });
    const start = new Date(Date.now() + 86_400_000);
    const reviewed = await transitionMaterialRule(prisma, context, { materialId, variantId, ruleId: second.id, action: "review", expectedLockVersion: second.lockVersion, effectiveFrom: start.toISOString(), requestId: "rule-review-2" });
    const scheduled = await transitionMaterialRule(prisma, context, { materialId, variantId, ruleId: second.id, action: "publish", expectedLockVersion: reviewed!.lockVersion, requestId: "rule-publish-2" });
    expect(scheduled?.effectiveStatus).toBe("SCHEDULED");
    let workspace = await getMaterialRuleWorkspace(prisma, context, materialId, variantId);
    expect(workspace.currentRuleId).toBe(first.id);
    expect(workspace.scheduledRuleId).toBe(second.id);
    expect(workspace.revisions.find((item) => item.id === first.id)?.effectiveTo).toBe(start.toISOString());
    await transitionMaterialRule(prisma, context, { materialId, variantId, ruleId: second.id, action: "retire", expectedLockVersion: scheduled!.lockVersion, reason: "예약 취소 검증", requestId: "rule-retire-2" });
    workspace = await getMaterialRuleWorkspace(prisma, context, materialId, variantId);
    expect(workspace.revisions.find((item) => item.id === first.id)?.effectiveTo).toBeNull();
    expect(workspace.history.some((item) => item.action === "material.rule_retired" && item.reason === "예약 취소 검증")).toBe(true);
    await expect(getMaterialRuleWorkspace(prisma, { ...context, permissions: [] }, materialId, variantId)).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

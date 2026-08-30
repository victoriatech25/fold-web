import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ServerFoldDocumentV1 } from "@/domain/fold-document/schema";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { disconnectPrisma, getPrisma } from "@/server/db/prisma";
import { prepareFoldRevisionDocument } from "@/server/fold-document/revision-contract";
import type { PrismaClient } from "@/generated/prisma/client";
import { processNextJob } from "@/server/jobs/job-worker";
import { addOrderFoldItem } from "@/server/orders/order-fold-service";
import { createOrder } from "@/server/orders/order-service";
import { createOrderCalculationSnapshot } from "@/server/orders/order-calculation-service";
import { transitionOrder } from "@/server/orders/order-transition-service";
import { CuttingError } from "./cutting-error";
import {
  approveCuttingPlan,
  cancelCuttingApproval,
  createCuttingPlansForOrder,
  getCuttingPlan,
  rerunCuttingPlan,
} from "./cutting-plan-service";
import { buildCuttingInputs } from "./cutting-input-builder";
import {
  listSheetRemnants,
  listSheetUsageForOrder,
  summarizeSheetUsageByPeriod,
} from "./sheet-usage-service";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

const grantedPermissions = [
  "order.read",
  "order.edit",
  "order.calculate",
  "order.approve",
  "cutting.optimize",
  "cutting.approve",
] as const;

integration.sequential("cutting plan integration", () => {
  let prisma: PrismaClient;
  let context: AuthenticatedContext;
  let customerId: string;
  let sourceRevisionId: string;
  let planId: string;
  let planOrderId: string;

  /**
   * 큐는 조직을 가리지 않으므로 앞선 파일이 남긴 작업이 먼저 잡힐 수 있다.
   * 우리 작업이 처리될 때까지 돌린다.
   */
  async function processUntil(jobId: string) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const processed = await processNextJob(prisma, "worker-cutting");
      if (!processed) break;
      if (processed.jobId === jobId) return processed;
    }
    throw new Error("재단 작업이 처리되지 않았습니다.");
  }

  /** 승인까지 끝난 수주를 하나 만든다. 재단은 여기서부터 시작한다(`D2-B05-A`). */
  async function approvedOrder() {
    const order = await createOrder(prisma, context, { customerId, requestId: "cutting-order" });
    const first = await addOrderFoldItem(prisma, context, {
      orderId: order.id,
      sourceFoldRevisionId: sourceRevisionId,
      expectedOrderLockVersion: order.lockVersion,
      requestId: "cutting-order-item-1",
    });
    // 부품이 하나뿐이면 고정으로 원판을 나눌 수 없다. 두 항목으로 만든다.
    const second = await addOrderFoldItem(prisma, context, {
      orderId: order.id,
      sourceFoldRevisionId: sourceRevisionId,
      expectedOrderLockVersion: first.orderLockVersion,
      requestId: "cutting-order-item-2",
    });
    const calculated = await createOrderCalculationSnapshot(prisma, context, {
      orderId: order.id,
      expectedOrderLockVersion: second.orderLockVersion,
      requestId: "cutting-order-calc",
    });
    await transitionOrder(prisma, context, {
      orderId: order.id,
      action: "APPROVE",
      expectedLockVersion: calculated.orderLockVersion,
      requestId: "cutting-order-approve",
    });
    return order;
  }

  beforeAll(async () => {
    prisma = getPrisma();
    const organization = await prisma.organization.create({
      data: { code: "CUTTING-INTEGRATION", name: "재단 통합 조직" },
    });
    const user = await prisma.user.create({
      data: {
        email: "cutting-plan@example.test",
        normalizedEmail: "cutting-plan@example.test",
        displayName: "재단 담당자",
        status: "ACTIVE",
      },
    });
    const membership = await prisma.organizationMembership.create({
      data: { organizationId: organization.id, userId: user.id },
    });

    // worker 는 session 없이 membership 의 실제 권한을 다시 읽는다.
    const role = await prisma.role.create({
      data: { organizationId: organization.id, key: "CUT-OPERATOR", name: "재단 운영자", system: false },
    });
    for (const key of grantedPermissions) {
      const permission = await prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key, description: key },
      });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    await prisma.membershipRole.create({ data: { membershipId: membership.id, roleId: role.id } });

    context = {
      sessionId: crypto.randomUUID(),
      userId: user.id,
      displayName: user.displayName,
      membershipId: membership.id,
      departmentId: null,
      organizationId: organization.id,
      organizationCode: organization.code,
      organizationName: organization.name,
      roleKeys: ["CUT-OPERATOR"],
      permissions: [...grantedPermissions],
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    };

    customerId = (await prisma.customer.create({
      data: {
        organizationId: organization.id,
        code: "CUT-CUSTOMER",
        name: "재단 거래처",
        normalizedName: "재단거래처",
        phone: "02-1000-3000",
        addressLine1: "서울시 재단로 1",
      },
    })).id;

    const material = await prisma.material.create({
      data: { organizationId: organization.id, code: "CUT-MAT", name: "재단 재질", normalizedName: "재단재질", densityKgPerM3: "2700" },
    });
    const variant = await prisma.materialVariant.create({
      data: { organizationId: organization.id, materialId: material.id, code: "CUT-MAT-1", name: "재단 1T", thicknessMm: "1", defaultInsideRadiusMm: "1" },
    });
    const rule = await prisma.materialRuleRevision.create({
      data: {
        organizationId: organization.id, materialVariantId: variant.id, revisionNumber: 1, status: "PUBLISHED",
        calculationMode: "FIXED", elongationOption: "STANDARD", vCutEnabled: true, decimalPlaces: 1, decimalOperation: "ROUND",
        cutAngleDeg: "135", insideBendRadiusMm: "1", elongationVCutMm: "0.6", elongationACutMm: "0.4", elongationNoCutMm: "1",
        cutDepthVCutMm: "0.5", cutDepthACutMm: "0.5", cutDepthNoCutMm: "0", publishedAt: new Date(),
      },
    });
    await prisma.sheetItem.create({
      data: {
        organizationId: organization.id, materialVariantId: variant.id, code: "CUT-SHEET",
        name: "1220×2440", widthMm: "1220", lengthMm: "2440", isDefault: true,
        standardPurchaseCostKrw: "50000",
      },
    });

    const document: ServerFoldDocumentV1 = {
      schemaVersion: 1, documentType: "normal", name: "재단 표본",
      // 전개 폭 400 × 길이 1000 짜리 부품 3개. 한 장에 다 들어간다.
      product: { lengthMm: "1000", quantity: 3 },
      material: {
        ruleRevisionId: rule.id, name: "재단 1T", thicknessMm: "1", insideBendRadiusMm: "1", cutAngleDeg: "135",
        elongationMm: { vCut: "0.6", aCut: "0.4", noCut: "1" }, cutDepthMm: { vCut: "0.5", aCut: "0.5", noCut: "0" },
      },
      calculation: { mode: "fixed", elongationOption: "standard", vCutEnabled: true, decimalPlaces: 1, decimalOperation: "round" },
      variables: [],
      blocks: [{
        id: "block-1", name: "단면", order: 1,
        segments: [{ id: "segment-1", order: 1, geometry: { kind: "line", start: { xMm: "0", yMm: "0" }, end: { xMm: "400", yMm: "0" }, direction: "e" }, nominalLengthMm: "400" }],
      }],
    };
    const prepared = prepareFoldRevisionDocument(document);
    const template = await prisma.foldTemplate.create({
      data: { organizationId: organization.id, code: "CUT-TPL", name: "재단 템플릿", documentType: "NORMAL" },
    });
    sourceRevisionId = (await prisma.foldRevision.create({
      data: {
        organizationId: organization.id, templateId: template.id, revisionNumber: 1, status: "PUBLISHED",
        name: document.name, publishedAt: new Date(), ...prepared,
      },
    })).id;

    const priceBook = await prisma.priceBook.create({
      data: { organizationId: organization.id, scopeType: "STANDARD", code: "CUT-STANDARD", name: "재단 표준 가격" },
    });
    const priceRevision = await prisma.priceBookRevision.create({
      data: {
        organizationId: organization.id, priceBookId: priceBook.id, revisionNumber: 1, status: "PUBLISHED",
        contentChecksumSha256: "b".repeat(64), effectiveFrom: new Date(Date.now() - 60_000), publishedAt: new Date(),
      },
    });
    await prisma.foldPriceRate.create({
      data: {
        organizationId: organization.id, priceBookRevisionId: priceRevision.id, materialVariantId: variant.id,
        materialRatePerM2Krw: "1000", bendRatePerOperationKrw: "100", vCutRatePerMeterKrw: "50",
      },
    });
  });

  afterAll(async () => disconnectPrisma());

  it("승인 전 수주는 재단할 수 없다", async () => {
    const order = await createOrder(prisma, context, { customerId, requestId: "cutting-draft-order" });
    await expect(
      createCuttingPlansForOrder(prisma, context, { salesOrderId: order.id, requestId: "cutting-draft" }),
    ).rejects.toBeInstanceOf(CuttingError);
  });

  it("승인된 수주에서 재질별 재단 작업을 만들고 worker 가 결과를 남긴다", async () => {
    await prisma.jobQueue.deleteMany({ where: { organizationId: context.organizationId } });
    const order = await approvedOrder();

    const plans = await createCuttingPlansForOrder(prisma, context, {
      salesOrderId: order.id,
      requestId: "cutting-create",
    });
    expect(plans).toHaveLength(1);
    planId = plans[0].id;
    planOrderId = order.id;
    expect(plans[0].status).toBe("PENDING");

    const queued = await getCuttingPlan(prisma, context, planId);
    const processed = await processUntil(queued.currentRevision!.jobId!);
    expect(processed.outcome).toBe("SUCCEEDED");

    const plan = await getCuttingPlan(prisma, context, planId);
    expect(plan.status).toBe("CALCULATED");
    expect(plan.currentRevision).toMatchObject({ revisionNumber: 1, status: "SUCCEEDED", unplacedQuantity: 0 });
    expect(plan.result?.summary.sheetCount).toBe(1);
    expect(plan.input.parts).toHaveLength(2);
    expect(plan.input.parts[0]).toMatchObject({ quantity: 3, lengthMm: "1000" });
  });

  it("고정하고 다시 돌리면 개정이 쌓이고 지정한 원판에 놓인다", async () => {
    const before = await getCuttingPlan(prisma, context, planId);
    const partId = before.input.parts[1].id;

    const rerun = await rerunCuttingPlan(prisma, context, {
      planId,
      pins: [{ partId, sheetIndex: 1 }],
      expectedLockVersion: before.lockVersion,
      requestId: "cutting-rerun",
    });
    const processed = await processUntil(rerun.currentRevision!.jobId!);
    expect(processed.outcome).toBe("SUCCEEDED");

    const after = await getCuttingPlan(prisma, context, planId);
    expect(after.revisions).toHaveLength(2);
    expect(after.currentRevision?.revisionNumber).toBe(2);
    // 고정한 부품은 둘째 원판으로 옮겨 가고 첫째 원판은 비지 않는다.
    expect(after.result?.summary.sheetCount).toBe(2);
    expect(after.result?.sheets[1].placements.every((placement) => placement.partId === partId)).toBe(true);
    // 이전 개정은 그대로 남는다(`D2-B05-H`).
    expect(after.revisions.map((item) => item.revisionNumber)).toEqual([2, 1]);
  });

  it("승인하면 잠기고 다시 돌릴 수 없다", async () => {
    const before = await getCuttingPlan(prisma, context, planId);
    const approved = await approveCuttingPlan(prisma, context, {
      planId,
      revisionId: before.currentRevision!.id,
      expectedLockVersion: before.lockVersion,
      requestId: "cutting-approve",
    });
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedRevisionId).toBe(before.currentRevision!.id);

    await expect(
      rerunCuttingPlan(prisma, context, {
        planId,
        pins: [],
        expectedLockVersion: approved.lockVersion,
        requestId: "cutting-rerun-blocked",
      }),
    ).rejects.toBeInstanceOf(CuttingError);

    const events = await prisma.auditEvent.findMany({
      where: { organizationId: context.organizationId, action: "cutting.approved" },
      select: { entityId: true },
    });
    expect(events.map((event) => event.entityId)).toContain(planId);
  });

  it("권한이 없으면 승인할 수 없다", async () => {
    const viewer: AuthenticatedContext = { ...context, permissions: ["cutting.optimize"] };
    const plan = await getCuttingPlan(prisma, viewer, planId);
    await expect(
      approveCuttingPlan(prisma, viewer, {
        planId,
        revisionId: plan.currentRevision!.id,
        expectedLockVersion: plan.lockVersion,
        requestId: "cutting-approve-denied",
      }),
    ).rejects.toThrow();
  });

  it("승인하면 원판 사용 실적과 잔재가 남는다", async () => {
    const usage = await listSheetUsageForOrder(prisma, context, planOrderId);
    expect(usage.items).toHaveLength(1);
    const [record] = usage.items;
    expect(record.status).toBe("ACTIVE");
    expect(record.fromRemnant).toBe(false);
    // 개정 2 는 원판 두 장을 썼다. 장수와 원가가 그대로 붙는다(`D2-B06-I`).
    expect(record.sheetCount).toBe(2);
    expect(record.unitCostKrw).toBe("50000");
    expect(record.totalCostKrw).toBe("100000");
    // 밀도 2700, 두께 1mm, 1220×2440 이면 한 장이 약 8.04kg 이다.
    expect(Number(record.unitWeightKg)).toBeCloseTo(8.04, 1);
    expect(usage.totals.sheetCount).toBe(2);
    expect(Number(usage.totals.placedAreaM2)).toBeGreaterThan(0);

    // 기간 집계에서도 같은 실적이 보인다.
    const period = await summarizeSheetUsageByPeriod(prisma, context, {});
    expect(period.items.some((item) => item.code === "CUT-SHEET")).toBe(true);

    const remnants = await listSheetRemnants(prisma, context, { status: "AVAILABLE" });
    expect(remnants.items.length).toBeGreaterThan(0);
    expect(remnants.items[0].code.startsWith("R-")).toBe(true);
    expect(remnants.items[0].originCuttingPlanId).toBe(planId);
  });

  it("남아 있는 잔재는 다음 재단의 원판 후보로 실린다", async () => {
    const builds = await buildCuttingInputs(prisma, {
      organizationId: context.organizationId,
      salesOrderId: planOrderId,
    });
    const [build] = builds;
    const remnantSheets = build.input.sheets.filter((sheet) =>
      sheet.sheetItemId.startsWith("remnant:"),
    );
    expect(remnantSheets.length).toBeGreaterThan(0);
    // 조각은 하나뿐이라 장수가 1 이고, 이미 잘린 것이라 trim 을 다시 빼지 않는다.
    expect(remnantSheets[0].availableCount).toBe(1);
    expect(remnantSheets[0].trimLeftMm).toBe("0");
  });

  it("승인을 취소하면 실적은 무효가 되고 잔재는 폐기된다", async () => {
    const before = await getCuttingPlan(prisma, context, planId);
    const cancelled = await cancelCuttingApproval(prisma, context, {
      planId,
      reason: "현장에서 원판을 바꿔 달라고 했다",
      expectedLockVersion: before.lockVersion,
      requestId: "cutting-approval-cancel",
    });
    expect(cancelled.status).toBe("CALCULATED");
    expect(cancelled.approvedRevisionId).toBeNull();

    const usage = await listSheetUsageForOrder(prisma, context, planOrderId);
    // 지우지 않는다. 무효로 남는다(`D2-B06-F`).
    expect(usage.items).toHaveLength(1);
    expect(usage.items[0].status).toBe("VOID");
    expect(usage.items[0].voidReason).toBe("현장에서 원판을 바꿔 달라고 했다");
    expect(usage.totals.sheetCount).toBe(0);

    const available = await listSheetRemnants(prisma, context, { status: "AVAILABLE" });
    expect(available.items).toHaveLength(0);
    const discarded = await listSheetRemnants(prisma, context, { status: "DISCARDED" });
    expect(discarded.items.length).toBeGreaterThan(0);

    // 무효가 된 실적은 기간 집계에서도 빠진다.
    const period = await summarizeSheetUsageByPeriod(prisma, context, {});
    expect(period.totals.sheetCount).toBe(0);

    const events = await prisma.auditEvent.findMany({
      where: { organizationId: context.organizationId, action: "cutting.approval_cancelled" },
      select: { entityId: true },
    });
    expect(events.map((event) => event.entityId)).toContain(planId);
  });

  it("승인되지 않은 재단은 취소할 수 없다", async () => {
    const plan = await getCuttingPlan(prisma, context, planId);
    await expect(
      cancelCuttingApproval(prisma, context, {
        planId,
        reason: "이미 풀린 것을 또 푼다",
        expectedLockVersion: plan.lockVersion,
        requestId: "cutting-approval-cancel-twice",
      }),
    ).rejects.toBeInstanceOf(CuttingError);
  });
});

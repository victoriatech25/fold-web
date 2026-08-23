import { afterAll, beforeAll, describe, expect, it } from "vitest";

import legacySamples from "@/domain/cutting/fixtures/legacy-input-samples.json";
import { cuttingSampleSchema } from "@/domain/cutting/sample";
import { optimizeCutting } from "@/domain/cutting/solver/optimize";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ServerFoldDocumentV1 } from "@/domain/fold-document/schema";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { disconnectPrisma, getPrisma } from "@/server/db/prisma";
import { prepareFoldRevisionDocument } from "@/server/fold-document/revision-contract";
import { JobError } from "@/server/jobs/job-error";
import { cancelJob, enqueueJob, getJob, listJobs, retryJob } from "@/server/jobs/job-service";
import { claimNextJob, reclaimExpiredLeases, renewLease } from "@/server/jobs/job-runtime";
import { processNextJob } from "@/server/jobs/job-worker";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
// 저장소가 함께 떠 있을 때만 DXF 바이트 보관까지 확인한다.
const storageAvailable = process.env.RUN_STORAGE_INTEGRATION === "1";

integration.sequential("job queue integration", () => {
  let prisma: PrismaClient;
  let context: AuthenticatedContext;
  let revisionId: string;
  let membershipId: string;

  async function enqueueDxf(idempotencyKey: string, payloadRevisionId = revisionId) {
    return enqueueJob(prisma, context, {
      type: "dxf.export",
      payload: { revisionId: payloadRevisionId },
      idempotencyKey,
      requestId: `job-${idempotencyKey}`,
    });
  }

  beforeAll(async () => {
    prisma = getPrisma();
    const organization = await prisma.organization.create({ data: { code: "JOB-INTEGRATION", name: "작업 큐 조직" } });
    const user = await prisma.user.create({
      data: { email: "job-integration@example.test", normalizedEmail: "job-integration@example.test", displayName: "작업 담당자", status: "ACTIVE" },
    });
    const membership = await prisma.organizationMembership.create({ data: { organizationId: organization.id, userId: user.id } });
    membershipId = membership.id;

    // worker는 session이 없어 membership의 실제 role·permission을 다시 읽는다.
    // 그래서 통합 테스트에서도 진짜 role 행이 있어야 한다.
    const permissions = await Promise.all(
      [
        { key: "output.print", description: "출력 실행" },
        { key: "cutting.optimize", description: "절단 최적화 실행" },
      ].map((entry) =>
        prisma.permission.upsert({ where: { key: entry.key }, update: {}, create: entry }),
      ),
    );
    const role = await prisma.role.create({
      data: { organizationId: organization.id, key: "JOB-OPERATOR", name: "작업 운영자", system: false },
    });
    await prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
    });
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
      roleKeys: ["JOB-OPERATOR"],
      permissions: ["output.print", "cutting.optimize"],
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    };

    const material = await prisma.material.create({
      data: { organizationId: organization.id, code: "JOB-MAT", name: "작업 재질", normalizedName: "작업재질", densityKgPerM3: "2700" },
    });
    const variant = await prisma.materialVariant.create({
      data: { organizationId: organization.id, materialId: material.id, code: "JOB-MAT-1", name: "작업 1T", thicknessMm: "1", defaultInsideRadiusMm: "1" },
    });
    const rule = await prisma.materialRuleRevision.create({
      data: {
        organizationId: organization.id, materialVariantId: variant.id, revisionNumber: 1, status: "PUBLISHED",
        calculationMode: "FIXED", elongationOption: "STANDARD", vCutEnabled: true, decimalPlaces: 1, decimalOperation: "ROUND",
        cutAngleDeg: "135", insideBendRadiusMm: "1", elongationVCutMm: "0.6", elongationACutMm: "0.4", elongationNoCutMm: "1",
        cutDepthVCutMm: "0.5", cutDepthACutMm: "0.5", cutDepthNoCutMm: "0", publishedAt: new Date(),
      },
    });
    const document: ServerFoldDocumentV1 = {
      schemaVersion: 1, documentType: "normal", name: "작업 큐 DXF 표본",
      product: { lengthMm: "1000", quantity: 1 },
      material: {
        ruleRevisionId: rule.id, name: "작업 1T", thicknessMm: "1", insideBendRadiusMm: "1", cutAngleDeg: "135",
        elongationMm: { vCut: "0.6", aCut: "0.4", noCut: "1" }, cutDepthMm: { vCut: "0.5", aCut: "0.5", noCut: "0" },
      },
      calculation: { mode: "fixed", elongationOption: "standard", vCutEnabled: true, decimalPlaces: 1, decimalOperation: "round" },
      variables: [],
      blocks: [{ id: "block-1", name: "단면", order: 1, segments: [{ id: "segment-1", order: 1, geometry: { kind: "line", start: { xMm: "0", yMm: "0" }, end: { xMm: "100", yMm: "0" }, direction: "e" }, nominalLengthMm: "100" }] }],
    };
    const prepared = prepareFoldRevisionDocument(document);
    const template = await prisma.foldTemplate.create({
      data: { organizationId: organization.id, code: "JOB-TPL", name: "작업 템플릿", documentType: "NORMAL" },
    });
    revisionId = (await prisma.foldRevision.create({
      data: {
        organizationId: organization.id, templateId: template.id, revisionNumber: 1, status: "PUBLISHED",
        name: "작업 개정", publishedAt: new Date(), ...prepared,
      },
    })).id;
  });

  afterAll(async () => disconnectPrisma());

  it("returns the same job for a repeated idempotency key", async () => {
    const first = await enqueueDxf("dup-key");
    expect(first.reused).toBe(false);
    const second = await enqueueDxf("dup-key");
    expect(second.reused).toBe(true);
    expect(second.job.id).toBe(first.job.id);
    expect(await prisma.jobQueue.count({ where: { organizationId: context.organizationId, idempotencyKey: "dup-key" } })).toBe(1);
  });

  it("creates only one job when the same key is enqueued concurrently", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => enqueueDxf("race-key")),
    );
    const ids = new Set(results.map((result) => result.job.id));
    expect(ids.size).toBe(1);
    expect(results.filter((result) => !result.reused)).toHaveLength(1);
  });

  it("never hands the same job to two workers", async () => {
    await enqueueDxf("single-claim");
    const target = await prisma.jobQueue.findFirstOrThrow({ where: { idempotencyKey: "single-claim" }, select: { id: true } });
    // 다른 대기 작업이 끼어들지 않도록 이 작업만 남기고 뒤로 미뤄 둔다.
    await prisma.jobQueue.updateMany({
      where: { organizationId: context.organizationId, status: "QUEUED", id: { not: target.id } },
      data: { availableAt: new Date(Date.now() + 3_600_000) },
    });
    const claims = await Promise.all([
      claimNextJob(prisma, "worker-a"),
      claimNextJob(prisma, "worker-b"),
      claimNextJob(prisma, "worker-c"),
    ]);
    const claimed = claims.filter((job) => job !== null);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.id).toBe(target.id);
    expect(claimed[0]!.attempt).toBe(1);
  });

  it("reclaims a job whose lease expired and lets another worker finish it", async () => {
    await prisma.jobQueue.deleteMany({ where: { organizationId: context.organizationId } });
    await enqueueDxf("lease-recovery");
    const claimed = await claimNextJob(prisma, "worker-dead");
    expect(claimed).not.toBeNull();

    // worker가 죽어 lease 갱신이 끊긴 상황을 만든다.
    await prisma.jobQueue.update({
      where: { id: claimed!.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });
    expect(await reclaimExpiredLeases(prisma)).toBe(1);
    const reclaimed = await prisma.jobQueue.findUniqueOrThrow({ where: { id: claimed!.id }, select: { status: true, lockedBy: true, attempt: true } });
    expect(reclaimed).toMatchObject({ status: "QUEUED", lockedBy: null, attempt: 1 });

    // 죽은 worker는 더 이상 lease를 갱신하지 못한다.
    expect(await renewLease(prisma, { jobId: claimed!.id, workerId: "worker-dead", leaseSeconds: 60 })).toBe(false);

    const processed = await processNextJob(prisma, "worker-alive");
    expect(processed).toMatchObject({ jobId: claimed!.id, outcome: "SUCCEEDED", attempt: 2 });
    const finished = await getJob(prisma, context, claimed!.id);
    expect(finished.status).toBe("SUCCEEDED");
    expect(finished.progressPercent).toBe(100);
  });

  it("fails a job with an unusable payload without retrying it", async () => {
    await prisma.jobQueue.deleteMany({ where: { organizationId: context.organizationId } });
    await enqueueDxf("missing-revision", crypto.randomUUID());
    const processed = await processNextJob(prisma, "worker-a");
    expect(processed?.outcome).toBe("FAILED");
    const row = await prisma.jobQueue.findFirstOrThrow({ where: { idempotencyKey: "missing-revision" } });
    expect(row.status).toBe("FAILED");
    expect(row.attempt).toBe(1);
    expect(row.lastError).toContain("찾을 수 없습니다");
  });

  it("produces the same checksum as the synchronous dxf export", async () => {
    await prisma.jobQueue.deleteMany({ where: { organizationId: context.organizationId } });
    const { exportFoldRevisionDxf } = await import("@/server/dxf/dxf-export-service");
    const direct = await exportFoldRevisionDxf(prisma, context, { revisionId, requestId: "job-direct-dxf" });

    await enqueueDxf("checksum-compare");
    const processed = await processNextJob(prisma, "worker-a");
    expect(processed?.outcome).toBe("SUCCEEDED");
    const job = await getJob(prisma, context, processed!.jobId);
    expect(job.result).toMatchObject({
      checksumSha256: direct.checksumSha256,
      sizeBytes: direct.sizeBytes,
      entityCount: direct.entityCount,
      // 저장소가 함께 떠 있으면 바이트까지 보관한다(`P2-B02`).
      contentRetained: storageAvailable,
    });
  });

  it("보관한 DXF를 다운로드 URL로 그대로 받는다", async () => {
    if (!storageAvailable) return;
    const { exportFoldRevisionDxf } = await import("@/server/dxf/dxf-export-service");
    const { issueDownloadUrl } = await import("@/server/files/file-service");
    const exported = await exportFoldRevisionDxf(prisma, context, {
      revisionId,
      requestId: "job-download-dxf",
    });
    expect(exported.contentRetained).toBe(true);

    const ticket = await issueDownloadUrl(prisma, context, exported.assetId, "job-download-url");
    const response = await fetch(ticket.download.url);
    expect(response.status).toBe(200);
    const received = await response.text();
    expect(received).toBe(exported.content);
  });

  it("cancels a queued job and refuses to cancel a finished one", async () => {
    await prisma.jobQueue.deleteMany({ where: { organizationId: context.organizationId } });
    const { job } = await enqueueDxf("cancel-queued");
    const cancelled = await cancelJob(prisma, context, { jobId: job.id, requestId: "job-cancel" });
    expect(cancelled.status).toBe("CANCELLED");
    // 취소된 작업은 worker가 가져가지 않는다.
    expect(await claimNextJob(prisma, "worker-a")).toBeNull();
    await expect(cancelJob(prisma, context, { jobId: job.id, requestId: "job-cancel-again" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("re-queues a failed job on retry and rejects retrying a successful one", async () => {
    await prisma.jobQueue.deleteMany({ where: { organizationId: context.organizationId } });
    await enqueueDxf("retry-failed", crypto.randomUUID());
    const failed = await processNextJob(prisma, "worker-a");
    expect(failed?.outcome).toBe("FAILED");

    const retried = await retryJob(prisma, context, { jobId: failed!.jobId, requestId: "job-retry" });
    expect(retried).toMatchObject({ status: "QUEUED", attempt: 0, lastError: null });

    await prisma.jobQueue.deleteMany({ where: { organizationId: context.organizationId } });
    await enqueueDxf("retry-succeeded");
    const succeeded = await processNextJob(prisma, "worker-a");
    expect(succeeded?.outcome).toBe("SUCCEEDED");
    await expect(retryJob(prisma, context, { jobId: succeeded!.jobId, requestId: "job-retry-ok" }))
      .rejects.toBeInstanceOf(JobError);
  });

  it("keeps jobs inside the organization and hides other members' jobs", async () => {
    await prisma.jobQueue.deleteMany({ where: { organizationId: context.organizationId } });
    const { job } = await enqueueDxf("visibility");

    const otherOrganization = await prisma.organization.create({ data: { code: "JOB-OTHER", name: "다른 조직" } });
    const otherUser = await prisma.user.create({
      data: { email: "job-other@example.test", normalizedEmail: "job-other@example.test", displayName: "다른 담당자", status: "ACTIVE" },
    });
    const otherMembership = await prisma.organizationMembership.create({
      data: { organizationId: otherOrganization.id, userId: otherUser.id },
    });
    const otherContext: AuthenticatedContext = {
      ...context,
      userId: otherUser.id,
      membershipId: otherMembership.id,
      organizationId: otherOrganization.id,
      organizationCode: otherOrganization.code,
      organizationName: otherOrganization.name,
    };
    await expect(getJob(prisma, otherContext, job.id)).rejects.toBeInstanceOf(JobError);

    // 같은 조직이라도 admin.manage가 없으면 남의 작업은 보이지 않는다.
    const sameOrgOther: AuthenticatedContext = { ...context, membershipId: otherMembership.id };
    expect((await listJobs(prisma, sameOrgOther, {})).items).toHaveLength(0);
    expect((await listJobs(prisma, context, {})).items.map((item) => item.id)).toContain(job.id);
  });

  it("재단 최적화를 작업으로 돌리면 직접 호출한 결과와 같은 결과가 남는다", async () => {
    await prisma.jobQueue.deleteMany({ where: { organizationId: context.organizationId } });
    const sample = cuttingSampleSchema.parse(legacySamples[0]);
    const direct = optimizeCutting(sample.input);

    const { job } = await enqueueJob(prisma, context, {
      type: "cutting.optimize",
      payload: { input: sample.input },
      idempotencyKey: "cutting-sample-1",
      requestId: "job-cutting-sample-1",
    });
    expect(job.summary).toContain(`부품 ${sample.input.parts.length}종`);

    const processed = await processNextJob(prisma, "worker-cutting");
    expect(processed).toMatchObject({ jobId: job.id, outcome: "SUCCEEDED" });

    const finished = await getJob(prisma, context, job.id);
    expect(finished.progressPercent).toBe(100);
    expect(finished.result).toMatchObject({
      engineVersion: direct.engineVersion,
      summary: {
        sheetCount: direct.summary.sheetCount,
        yieldPercent: direct.summary.yieldPercent,
        unplacedParts: [],
      },
    });
  });

  it("계약을 어긴 재단 입력은 큐에 들어가지 못한다", async () => {
    await prisma.jobQueue.deleteMany({ where: { organizationId: context.organizationId } });
    const sample = cuttingSampleSchema.parse(legacySamples[0]);
    await expect(
      enqueueJob(prisma, context, {
        type: "cutting.optimize",
        // 원판이 없으면 배치할 자리가 없다. 계약 검사에서 걸러진다.
        payload: { input: { ...sample.input, sheets: [] } },
        idempotencyKey: "cutting-invalid",
        requestId: "job-cutting-invalid",
      }),
    ).rejects.toBeInstanceOf(JobError);
  });

  it("does not expose raw payload through the API dto", async () => {
    await prisma.jobQueue.deleteMany({ where: { organizationId: context.organizationId } });
    const { job } = await enqueueDxf("payload-hidden");
    expect(job).not.toHaveProperty("payload");
    expect(job.summary).toContain(revisionId.slice(0, 8));
    const events = await prisma.auditEvent.findMany({
      where: { organizationId: context.organizationId, action: "job.enqueued" },
      select: { metadata: true },
    });
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(JSON.stringify(event.metadata)).not.toContain(revisionId);
    }
    expect(membershipId).toBeTruthy();
  });
});

import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { calculateProfile } from "@/domain/fold-calculation";
import type { CalculationSettings, CutType, FoldSegment, MaterialRule } from "@/domain/fold-profile";
import { requirePermission } from "@/server/authorization/authorization";
import { auditActionLabel } from "@/server/audit/audit-core";
import { writeAuditEvent } from "@/server/audit/audit-writer";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { MaterialError } from "@/server/materials/material-error";

import {
  calculateMaterialRuleChecksum,
  normalizeMaterialRuleFields,
  normalizeTransitionReason,
  parseEffectiveFrom,
} from "./material-rule-policy";
import type {
  MaterialRuleEffectiveStatus,
  MaterialRuleFields,
  MaterialRulePreviewDto,
  MaterialRuleRevisionDto,
  MaterialRuleTransitionAction,
  MaterialRuleWorkspaceDto,
} from "./material-rule-types";

type Database = PrismaClient | Prisma.TransactionClient;
type Transaction = Prisma.TransactionClient;

const actorSelect = { id: true, displayName: true } as const;
const ruleSelect = {
  id: true,
  materialVariantId: true,
  revisionNumber: true,
  status: true,
  calculationMode: true,
  elongationOption: true,
  vCutEnabled: true,
  decimalPlaces: true,
  decimalOperation: true,
  cutAngleDeg: true,
  insideBendRadiusMm: true,
  elongationVCutMm: true,
  elongationACutMm: true,
  elongationNoCutMm: true,
  cutDepthVCutMm: true,
  cutDepthACutMm: true,
  cutDepthNoCutMm: true,
  changeSummary: true,
  contentChecksumSha256: true,
  effectiveFrom: true,
  effectiveTo: true,
  lockVersion: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
  createdBy: { select: actorSelect },
  updatedBy: { select: actorSelect },
  publishedBy: { select: actorSelect },
} as const satisfies Prisma.MaterialRuleRevisionSelect;

type RuleRow = Prisma.MaterialRuleRevisionGetPayload<{ select: typeof ruleSelect }>;

const auditActions = [
  "material.rule_created",
  "material.rule_updated",
  "material.rule_review_requested",
  "material.rule_returned",
  "material.rule_published",
  "material.rule_retired",
  "material.rule_discarded",
] as const;

function rowFields(row: RuleRow): MaterialRuleFields {
  return {
    calculationMode: row.calculationMode,
    elongationOption: row.elongationOption,
    vCutEnabled: row.vCutEnabled,
    decimalPlaces: row.decimalPlaces,
    decimalOperation: row.decimalOperation,
    cutAngleDeg: row.cutAngleDeg.toString(),
    insideBendRadiusMm: row.insideBendRadiusMm.toString(),
    elongationVCutMm: row.elongationVCutMm.toString(),
    elongationACutMm: row.elongationACutMm.toString(),
    elongationNoCutMm: row.elongationNoCutMm.toString(),
    cutDepthVCutMm: row.cutDepthVCutMm.toString(),
    cutDepthACutMm: row.cutDepthACutMm.toString(),
    cutDepthNoCutMm: row.cutDepthNoCutMm.toString(),
    changeSummary: row.changeSummary,
  };
}

function effectiveStatus(row: RuleRow, now: Date): MaterialRuleEffectiveStatus {
  if (row.status === "DRAFT" || row.status === "REVIEW" || row.status === "RETIRED") return row.status;
  if (row.effectiveFrom && row.effectiveFrom > now) return "SCHEDULED";
  if (row.effectiveTo && row.effectiveTo <= now) return "EXPIRED";
  return "ACTIVE";
}

function toDto(row: RuleRow, now = new Date()): MaterialRuleRevisionDto {
  return {
    id: row.id,
    revisionNumber: row.revisionNumber,
    status: row.status,
    effectiveStatus: effectiveStatus(row, now),
    ...rowFields(row),
    effectiveFrom: row.effectiveFrom?.toISOString() ?? null,
    effectiveTo: row.effectiveTo?.toISOString() ?? null,
    contentChecksumSha256: row.contentChecksumSha256,
    lockVersion: row.lockVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    publishedBy: row.publishedBy,
  };
}

async function findVariant(database: Database, organizationId: string, materialId: string, variantId: string) {
  const variant = await database.materialVariant.findFirst({
    where: { id: variantId, materialId, organizationId, deletedAt: null, material: { organizationId, deletedAt: null } },
    select: {
      id: true,
      code: true,
      name: true,
      thicknessMm: true,
      defaultInsideRadiusMm: true,
      active: true,
      material: { select: { id: true, code: true, name: true, active: true } },
    },
  });
  if (!variant) throw new MaterialError("NOT_FOUND", "재질 두께 항목을 찾을 수 없습니다.");
  return variant;
}

async function findRule(database: Database, organizationId: string, variantId: string, ruleId: string) {
  const row = await database.materialRuleRevision.findFirst({
    where: { id: ruleId, organizationId, materialVariantId: variantId, deletedAt: null },
    select: ruleSelect,
  });
  if (!row) throw new MaterialError("NOT_FOUND", "계산 규칙 개정을 찾을 수 없습니다.");
  return row;
}

async function lockVariant(tx: Transaction, organizationId: string, variantId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "MaterialVariant" WHERE "id"=${variantId}::uuid AND "organizationId"=${organizationId}::uuid AND "deletedAt" IS NULL FOR UPDATE`;
  if (!rows.length) throw new MaterialError("NOT_FOUND", "재질 두께 항목을 찾을 수 없습니다.");
}

async function lockRule(tx: Transaction, organizationId: string, ruleId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "MaterialRuleRevision" WHERE "id"=${ruleId}::uuid AND "organizationId"=${organizationId}::uuid AND "deletedAt" IS NULL FOR UPDATE`;
  if (!rows.length) throw new MaterialError("NOT_FOUND", "계산 규칙 개정을 찾을 수 없습니다.");
}

function dataFromFields(fields: MaterialRuleFields) {
  return {
    calculationMode: fields.calculationMode,
    elongationOption: fields.elongationOption,
    vCutEnabled: fields.vCutEnabled,
    decimalPlaces: fields.decimalPlaces,
    decimalOperation: fields.decimalOperation,
    cutAngleDeg: fields.cutAngleDeg,
    insideBendRadiusMm: fields.insideBendRadiusMm,
    elongationVCutMm: fields.elongationVCutMm,
    elongationACutMm: fields.elongationACutMm,
    elongationNoCutMm: fields.elongationNoCutMm,
    cutDepthVCutMm: fields.cutDepthVCutMm,
    cutDepthACutMm: fields.cutDepthACutMm,
    cutDepthNoCutMm: fields.cutDepthNoCutMm,
    changeSummary: fields.changeSummary,
  };
}

export async function getMaterialRuleWorkspace(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  materialId: string,
  variantId: string,
  now = new Date(),
): Promise<MaterialRuleWorkspaceDto> {
  requirePermission(context, "material.read");
  const variant = await findVariant(prisma, context.organizationId, materialId, variantId);
  const revisions = await prisma.materialRuleRevision.findMany({
    where: { organizationId: context.organizationId, materialVariantId: variantId, deletedAt: null },
    orderBy: [{ revisionNumber: "desc" }],
    select: ruleSelect,
  });
  const history = await prisma.auditEvent.findMany({
    where: { organizationId: context.organizationId, entityType: "MaterialRuleRevision", entityId: { in: revisions.map((row) => row.id) }, action: { in: [...auditActions] } },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: 100,
    select: { id: true, action: true, actorDisplayName: true, occurredAt: true, metadata: true },
  });
  const current = revisions.find((row) => effectiveStatus(row, now) === "ACTIVE");
  const scheduled = revisions.find((row) => effectiveStatus(row, now) === "SCHEDULED");
  const open = revisions.find((row) => row.status === "DRAFT" || row.status === "REVIEW");
  return {
    material: variant.material,
    variant: {
      id: variant.id,
      code: variant.code,
      name: variant.name,
      thicknessMm: variant.thicknessMm.toString(),
      defaultInsideRadiusMm: variant.defaultInsideRadiusMm.toString(),
      active: variant.active,
    },
    revisions: revisions.map((row) => toDto(row, now)),
    currentRuleId: current?.id ?? null,
    scheduledRuleId: scheduled?.id ?? null,
    openRuleId: open?.id ?? null,
    history: history.map((event) => ({
      id: event.id,
      action: event.action,
      label: auditActionLabel(event.action),
      actorDisplayName: event.actorDisplayName,
      occurredAt: event.occurredAt.toISOString(),
      reason: typeof event.metadata === "object" && event.metadata !== null && !Array.isArray(event.metadata) && "reason" in event.metadata && typeof event.metadata.reason === "string" ? event.metadata.reason : null,
    })),
  };
}

export async function createMaterialRule(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: MaterialRuleFields & { materialId: string; variantId: string; sourceRuleRevisionId?: string | null; requestId: string },
) {
  requirePermission(context, "material.write");
  const fields = normalizeMaterialRuleFields(input);
  const checksum = calculateMaterialRuleChecksum(fields);
  try {
    return await prisma.$transaction(async (tx) => {
      await lockVariant(tx, context.organizationId, input.variantId);
      const variant = await findVariant(tx, context.organizationId, input.materialId, input.variantId);
      if (!variant.active || !variant.material.active) throw new MaterialError("CONFLICT", "비활성 재질이나 두께에는 계산 규칙을 만들 수 없습니다.");
      const open = await tx.materialRuleRevision.findFirst({ where: { organizationId: context.organizationId, materialVariantId: input.variantId, status: { in: ["DRAFT", "REVIEW"] }, deletedAt: null }, select: { id: true } });
      if (open) throw new MaterialError("CONFLICT", "이미 작성 또는 검토 중인 계산 규칙이 있습니다.");
      if (input.sourceRuleRevisionId) await findRule(tx, context.organizationId, input.variantId, input.sourceRuleRevisionId);
      const latest = await tx.materialRuleRevision.aggregate({ where: { materialVariantId: input.variantId }, _max: { revisionNumber: true } });
      const created = await tx.materialRuleRevision.create({
        data: {
          organizationId: context.organizationId,
          materialVariantId: input.variantId,
          revisionNumber: (latest._max.revisionNumber ?? 0) + 1,
          ...dataFromFields(fields),
          contentChecksumSha256: checksum,
          createdByUserId: context.userId,
          updatedByUserId: context.userId,
          statusChangedByUserId: context.userId,
        },
        select: ruleSelect,
      });
      await writeAuditEvent(tx, {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "material.rule_created",
        entityId: created.id,
        requestId: input.requestId,
        after: { revisionNumber: created.revisionNumber, status: created.status, lockVersion: created.lockVersion },
        metadata: { checksumSha256: checksum, sourceRuleRevisionId: input.sourceRuleRevisionId ?? null },
      });
      return toDto(created);
    });
  } catch (error) {
    if (error instanceof MaterialError) throw error;
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") throw new MaterialError("CONFLICT", "이미 작성 또는 검토 중인 계산 규칙이 있습니다.");
    throw error;
  }
}

export async function updateMaterialRule(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: MaterialRuleFields & { materialId: string; variantId: string; ruleId: string; expectedLockVersion: number; requestId: string },
) {
  requirePermission(context, "material.write");
  const fields = normalizeMaterialRuleFields(input);
  const checksum = calculateMaterialRuleChecksum(fields);
  return prisma.$transaction(async (tx) => {
    await lockVariant(tx, context.organizationId, input.variantId);
    await findVariant(tx, context.organizationId, input.materialId, input.variantId);
    await lockRule(tx, context.organizationId, input.ruleId);
    const current = await findRule(tx, context.organizationId, input.variantId, input.ruleId);
    if (current.status !== "DRAFT") throw new MaterialError("CONFLICT", "초안 상태의 계산 규칙만 수정할 수 있습니다.");
    if (current.lockVersion !== input.expectedLockVersion) throw new MaterialError("CONFLICT", "계산 규칙이 다른 화면에서 변경되었습니다.");
    const updated = await tx.materialRuleRevision.update({
      where: { id: current.id },
      data: { ...dataFromFields(fields), contentChecksumSha256: checksum, lockVersion: { increment: 1 }, updatedByUserId: context.userId },
      select: ruleSelect,
    });
    await writeAuditEvent(tx, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "material.rule_updated",
      entityId: current.id,
      requestId: input.requestId,
      before: { status: current.status, lockVersion: current.lockVersion, checksumSha256: current.contentChecksumSha256 },
      after: { status: updated.status, lockVersion: updated.lockVersion, checksumSha256: checksum },
      metadata: { revisionNumber: current.revisionNumber },
    });
    return toDto(updated);
  });
}

function engineRule(thicknessMm: string, fields: MaterialRuleFields): MaterialRule {
  return {
    thickness: Number(thicknessMm),
    insideBendRadius: Number(fields.insideBendRadiusMm),
    cutAngle: Number(fields.cutAngleDeg),
    elongation: { "v-cut": Number(fields.elongationVCutMm), "a-cut": Number(fields.elongationACutMm), "no-cut": Number(fields.elongationNoCutMm) },
    cutDepth: { "v-cut": Number(fields.cutDepthVCutMm), "a-cut": Number(fields.cutDepthACutMm), "no-cut": Number(fields.cutDepthNoCutMm) },
  };
}

function engineSettings(fields: MaterialRuleFields, vCutEnabled = fields.vCutEnabled): CalculationSettings {
  const option = { STANDARD: "standard", TWO_LINE: "two-line", DIAGONAL: "diagonal", EXT1: "ext1" }[fields.elongationOption] as CalculationSettings["elongationOption"];
  return { mode: fields.calculationMode.toLowerCase() as CalculationSettings["mode"], elongationOption: option, vCutEnabled, decimalPlaces: fields.decimalPlaces, decimalOperation: fields.decimalOperation.toLowerCase() as CalculationSettings["decimalOperation"] };
}

const previewCases: Array<{ key: string; label: string; direction: "front" | "back"; cutType: CutType; angle: number; vCutEnabled?: boolean; secondDirection?: "front" | "back" }> = [
  { key: "front-v-90", label: "90° 앞각 · V-CUT", direction: "front", cutType: "v-cut", angle: 90 },
  { key: "back-v-90", label: "90° 뒷각 · V-CUT", direction: "back", cutType: "v-cut", angle: 90 },
  { key: "front-a-90", label: "90° 앞각 · A-CUT", direction: "front", cutType: "a-cut", angle: 90 },
  { key: "front-no-90", label: "90° 앞각 · NO-CUT", direction: "front", cutType: "v-cut", angle: 90, vCutEnabled: false },
  { key: "double-front-90", label: "90° 양쪽 앞각 · V-CUT", direction: "front", secondDirection: "front", cutType: "v-cut", angle: 90 },
  { key: "front-v-134", label: "134° 제한각 미만", direction: "front", cutType: "v-cut", angle: 134 },
  { key: "front-v-135", label: "135° 제한각 동일", direction: "front", cutType: "v-cut", angle: 135 },
  { key: "front-v-136", label: "136° 제한각 초과", direction: "front", cutType: "v-cut", angle: 136 },
];

function calculatePreview(thicknessMm: string, fields: MaterialRuleFields, sample: typeof previewCases[number]) {
  const segments: FoldSegment[] = [
    { id: "preview-1", start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, inputLength: 100, bendAfter: { direction: sample.direction, form: "standard", cutType: sample.cutType, angle: sample.angle } },
    { id: "preview-2", start: { x: 100, y: 0 }, end: { x: 100, y: 50 }, inputLength: 50, ...(sample.secondDirection ? { bendAfter: { direction: sample.secondDirection, form: "standard" as const, cutType: sample.cutType, angle: sample.angle } } : {}) },
    ...(sample.secondDirection ? [{ id: "preview-3", start: { x: 100, y: 50 }, end: { x: 150, y: 50 }, inputLength: 50 }] satisfies FoldSegment[] : []),
  ];
  return calculateProfile(segments, engineRule(thicknessMm, fields), engineSettings(fields, sample.vCutEnabled));
}

export async function previewMaterialRule(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: { materialId: string; variantId: string; ruleId: string },
): Promise<MaterialRulePreviewDto> {
  requirePermission(context, "material.read");
  const variant = await findVariant(prisma, context.organizationId, input.materialId, input.variantId);
  const candidate = await findRule(prisma, context.organizationId, input.variantId, input.ruleId);
  const current = await prisma.materialRuleRevision.findFirst({
    where: { organizationId: context.organizationId, materialVariantId: input.variantId, status: "PUBLISHED", deletedAt: null, OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: new Date() } }], AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }] }] },
    orderBy: [{ revisionNumber: "desc" }],
    select: ruleSelect,
  });
  const candidateFields = rowFields(candidate);
  const currentFields = current ? rowFields(current) : null;
  return {
    candidateChecksumSha256: calculateMaterialRuleChecksum(candidateFields),
    currentRuleId: current?.id ?? null,
    cases: previewCases.map((sample) => {
      const next = calculatePreview(variant.thicknessMm.toString(), candidateFields, sample);
      const previous = currentFields ? calculatePreview(variant.thicknessMm.toString(), currentFields, sample) : null;
      return {
        key: sample.key,
        label: sample.label,
        candidateWidthMm: next.calculatedWidthDecimal,
        candidateCorrectionMm: next.appliedCorrectionTotalDecimal,
        currentWidthMm: previous?.calculatedWidthDecimal ?? null,
        currentCorrectionMm: previous?.appliedCorrectionTotalDecimal ?? null,
      };
    }),
  };
}

const transitionAudit = {
  review: "material.rule_review_requested",
  return: "material.rule_returned",
  publish: "material.rule_published",
  retire: "material.rule_retired",
  discard: "material.rule_discarded",
} as const;

export async function transitionMaterialRule(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: {
    materialId: string;
    variantId: string;
    ruleId: string;
    action: MaterialRuleTransitionAction;
    expectedLockVersion: number;
    effectiveFrom?: string | null;
    reason?: string | null;
    requestId: string;
  },
) {
  requirePermission(context, input.action === "review" || input.action === "discard" ? "material.write" : "material.approve");
  const reason = normalizeTransitionReason(input.reason, input.action === "return" || input.action === "retire");
  return prisma.$transaction(async (tx) => {
    await lockVariant(tx, context.organizationId, input.variantId);
    const variant = await findVariant(tx, context.organizationId, input.materialId, input.variantId);
    if (input.action === "discard") {
      const discarded = await tx.materialRuleRevision.findFirst({
        where: { id: input.ruleId, organizationId: context.organizationId, materialVariantId: input.variantId, deletedAt: { not: null } },
        select: ruleSelect,
      });
      if (discarded && discarded.lockVersion === input.expectedLockVersion + 1) return null;
    }
    await lockRule(tx, context.organizationId, input.ruleId);
    const current = await findRule(tx, context.organizationId, input.variantId, input.ruleId);
    const retryStatus = { review: "REVIEW", return: "DRAFT", publish: "PUBLISHED", retire: "RETIRED", discard: "DRAFT" }[input.action];
    if (input.action !== "discard" && current.status === retryStatus && current.lockVersion === input.expectedLockVersion + 1) return toDto(current);
    if (current.lockVersion !== input.expectedLockVersion) throw new MaterialError("CONFLICT", "계산 규칙 상태가 다른 화면에서 변경되었습니다.");
    const now = new Date();
    let nextStatus: RuleRow["status"] = current.status;
    let effectiveFrom = current.effectiveFrom;
    let effectiveTo = current.effectiveTo;

    if (input.action === "review") {
      if (current.status !== "DRAFT") throw new MaterialError("CONFLICT", "초안만 검토 요청할 수 있습니다.");
      if (!current.changeSummary) throw new MaterialError("INVALID_REQUEST", "검토 요청 전에 변경 요약을 입력해 주세요.");
      effectiveFrom = parseEffectiveFrom(input.effectiveFrom);
      nextStatus = "REVIEW";
    } else if (input.action === "return") {
      if (current.status !== "REVIEW") throw new MaterialError("CONFLICT", "검토 중인 규칙만 수정 반려할 수 있습니다.");
      nextStatus = "DRAFT";
    } else if (input.action === "publish") {
      if (current.status !== "REVIEW" || !current.effectiveFrom) throw new MaterialError("CONFLICT", "검토 중이며 효력 시작이 정해진 규칙만 게시할 수 있습니다.");
      if (!variant.active || !variant.material.active) throw new MaterialError("CONFLICT", "비활성 재질이나 두께의 계산 규칙은 게시할 수 없습니다.");
      const checksum = calculateMaterialRuleChecksum(rowFields(current));
      if (current.contentChecksumSha256 !== checksum) throw new MaterialError("CONFLICT", "검토 중 계산 규칙 내용이 변경되었습니다.");
      const overlaps = await tx.materialRuleRevision.findMany({
        where: {
          organizationId: context.organizationId,
          materialVariantId: input.variantId,
          id: { not: current.id },
          status: "PUBLISHED",
          deletedAt: null,
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: current.effectiveFrom } }],
        },
        orderBy: [{ revisionNumber: "desc" }],
        select: { id: true, effectiveFrom: true, effectiveTo: true, lockVersion: true },
      });
      const future = overlaps.filter((row) => row.effectiveFrom && row.effectiveFrom >= current.effectiveFrom!);
      const predecessors = overlaps.filter((row) => !row.effectiveFrom || row.effectiveFrom < current.effectiveFrom!);
      if (future.length || predecessors.length > 1) throw new MaterialError("CONFLICT", "게시 유효기간이 기존 또는 예약 규칙과 겹칩니다.");
      const predecessor = predecessors[0];
      if (predecessor) {
        await tx.materialRuleRevision.update({ where: { id: predecessor.id }, data: { effectiveTo: current.effectiveFrom, lockVersion: { increment: 1 }, updatedByUserId: context.userId } });
      }
      nextStatus = "PUBLISHED";
      effectiveFrom = current.effectiveFrom;
      effectiveTo = null;
    } else if (input.action === "retire") {
      if (current.status !== "PUBLISHED") throw new MaterialError("CONFLICT", "게시된 규칙만 사용 종료할 수 있습니다.");
      if (current.effectiveFrom && current.effectiveFrom > now) {
        const predecessor = await tx.materialRuleRevision.findFirst({ where: { organizationId: context.organizationId, materialVariantId: input.variantId, id: { not: current.id }, status: "PUBLISHED", effectiveTo: current.effectiveFrom, deletedAt: null }, orderBy: [{ revisionNumber: "desc" }], select: { id: true } });
        if (predecessor) await tx.materialRuleRevision.update({ where: { id: predecessor.id }, data: { effectiveTo: null, lockVersion: { increment: 1 }, updatedByUserId: context.userId } });
      } else if (!effectiveTo || effectiveTo > now) {
        effectiveTo = now;
      }
      nextStatus = "RETIRED";
    } else {
      if (current.status !== "DRAFT") throw new MaterialError("CONFLICT", "초안만 폐기할 수 있습니다.");
    }

    const checksum = current.contentChecksumSha256 ?? calculateMaterialRuleChecksum(rowFields(current));
    const updated = await tx.materialRuleRevision.update({
      where: { id: current.id },
      data: input.action === "discard"
        ? { deletedAt: now, deletedByUserId: context.userId, lockVersion: { increment: 1 }, updatedByUserId: context.userId, statusChangedAt: now, statusChangedByUserId: context.userId }
        : {
            status: nextStatus,
            effectiveFrom,
            effectiveTo,
            contentChecksumSha256: checksum,
            lockVersion: { increment: 1 },
            updatedByUserId: context.userId,
            statusChangedAt: now,
            statusChangedByUserId: context.userId,
            ...(input.action === "publish" ? { publishedAt: now, publishedByUserId: context.userId } : {}),
          },
      select: ruleSelect,
    });
    await writeAuditEvent(tx, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: transitionAudit[input.action],
      entityId: current.id,
      requestId: input.requestId,
      before: { status: current.status, lockVersion: current.lockVersion },
      after: { status: input.action === "discard" ? "DISCARDED" : nextStatus, lockVersion: updated.lockVersion },
      metadata: { revisionNumber: current.revisionNumber, checksumSha256: checksum, reason, effectiveFrom: effectiveFrom?.toISOString() ?? null },
    });
    return input.action === "discard" ? null : toDto(updated, now);
  });
}

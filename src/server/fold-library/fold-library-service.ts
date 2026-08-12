import "server-only";

import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient, RevisionStatus } from "@/generated/prisma/client";
import { parseServerFoldDocument } from "@/domain/fold-document/schema";
import { writeAuditEvent } from "@/server/audit/audit-writer";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { requirePermission } from "@/server/authorization/authorization";
import { FoldDraftServiceError } from "@/server/fold-draft/fold-draft-error";
import { resolvePublishedMaterialRuleSnapshot } from "@/server/fold-document/material-snapshot";
import {
  prepareFoldRevisionDocument,
  readFoldRevisionDocument,
} from "@/server/fold-document/revision-contract";
import type {
  FoldCategoryDto,
  FoldRevisionDetailDto,
  FoldRevisionSummaryDto,
  FoldTemplateDetailDto,
  FoldTemplateListDto,
  FoldTemplateSummaryDto,
} from "@/server/fold-library/fold-library-types";

type Database = PrismaClient | Prisma.TransactionClient;
type Transaction = Prisma.TransactionClient;

const userSelect = { id: true, displayName: true } as const;
const revisionSummarySelect = {
  id: true,
  templateId: true,
  revisionNumber: true,
  status: true,
  name: true,
  lockVersion: true,
  documentChecksumSha256: true,
  updatedAt: true,
  statusChangedAt: true,
  publishedAt: true,
  updatedBy: { select: userSelect },
} as const satisfies Prisma.FoldRevisionSelect;

const templateSummarySelect = {
  id: true,
  code: true,
  name: true,
  documentType: true,
  lockVersion: true,
  updatedAt: true,
  category: {
    select: {
      id: true,
      code: true,
      name: true,
      active: true,
      sortOrder: true,
      lockVersion: true,
    },
  },
  revisions: {
    where: { deletedAt: null },
    orderBy: { revisionNumber: "desc" },
    select: revisionSummarySelect,
  },
} as const satisfies Prisma.FoldTemplateSelect;

type RevisionSummaryRow = Prisma.FoldRevisionGetPayload<{
  select: typeof revisionSummarySelect;
}>;
type TemplateSummaryRow = Prisma.FoldTemplateGetPayload<{
  select: typeof templateSummarySelect;
}>;

function toCategoryDto(row: FoldCategoryDto): FoldCategoryDto {
  return row;
}

function toRevisionSummary(row: RevisionSummaryRow): FoldRevisionSummaryDto {
  return {
    revisionId: row.id,
    revisionNumber: row.revisionNumber,
    status: row.status,
    name: row.name,
    lockVersion: row.lockVersion,
    checksumSha256: row.documentChecksumSha256,
    updatedAt: row.updatedAt.toISOString(),
    statusChangedAt: row.statusChangedAt.toISOString(),
    updatedBy: row.updatedBy,
    publishedAt: row.publishedAt?.toISOString() ?? null,
  };
}

function chooseCurrentRevision(rows: RevisionSummaryRow[]): RevisionSummaryRow | null {
  return (
    rows.find((row) => row.status === "DRAFT" || row.status === "REVIEW") ??
    rows.find((row) => row.status === "PUBLISHED") ??
    rows[0] ??
    null
  );
}

function toTemplateSummary(row: TemplateSummaryRow): FoldTemplateSummaryDto {
  const current = chooseCurrentRevision(row.revisions);
  return {
    templateId: row.id,
    code: row.code,
    name: row.name,
    documentType: row.documentType.toLowerCase() as "normal" | "box" | "panel",
    category: row.category ? toCategoryDto(row.category) : null,
    lockVersion: row.lockVersion,
    updatedAt: row.updatedAt.toISOString(),
    currentRevision: current ? toRevisionSummary(current) : null,
    revisionCount: row.revisions.length,
  };
}

function encodeCursor(updatedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ updatedAt: updatedAt.toISOString(), id })).toString("base64url");
}

function decodeCursor(value?: string): { updatedAt: Date; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      updatedAt?: unknown;
      id?: unknown;
    };
    if (typeof parsed.updatedAt !== "string" || typeof parsed.id !== "string") throw new Error();
    const updatedAt = new Date(parsed.updatedAt);
    if (Number.isNaN(updatedAt.getTime())) throw new Error();
    return { updatedAt, id: parsed.id };
  } catch {
    throw new FoldDraftServiceError("INVALID_REQUEST", "템플릿 목록 페이지 위치가 올바르지 않습니다.");
  }
}

async function requireCategory(
  database: Database,
  organizationId: string,
  categoryId: string | null,
): Promise<void> {
  if (!categoryId) return;
  const category = await database.foldCategory.findFirst({
    where: { id: categoryId, organizationId, active: true, deletedAt: null },
    select: { id: true },
  });
  if (!category) throw new FoldDraftServiceError("NOT_FOUND", "절곡 분류를 찾을 수 없습니다.");
}

async function lockTemplate(transaction: Transaction, organizationId: string, templateId: string) {
  await transaction.$queryRaw`
    SELECT "id" FROM "FoldTemplate"
    WHERE "id" = ${templateId}::uuid AND "organizationId" = ${organizationId}::uuid
    FOR UPDATE
  `;
}

async function lockRevision(transaction: Transaction, organizationId: string, revisionId: string) {
  await transaction.$queryRaw`
    SELECT "id" FROM "FoldRevision"
    WHERE "id" = ${revisionId}::uuid AND "organizationId" = ${organizationId}::uuid
    FOR UPDATE
  `;
}

async function prepareCopiedDocument(
  database: Database,
  organizationId: string,
  source: unknown,
  name: string,
) {
  const parsed = parseServerFoldDocument(source);
  const material = await resolvePublishedMaterialRuleSnapshot(
    database,
    organizationId,
    parsed.material.ruleRevisionId,
  );
  const document = parseServerFoldDocument({ ...parsed, name, material });
  return { document, prepared: prepareFoldRevisionDocument(document) };
}

async function findTemplateDetail(
  database: Database,
  organizationId: string,
  templateId: string,
): Promise<TemplateSummaryRow | null> {
  return database.foldTemplate.findFirst({
    where: { id: templateId, organizationId, active: true, deletedAt: null },
    select: templateSummarySelect,
  });
}

export async function listFoldCategories(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  includeInactive = false,
): Promise<FoldCategoryDto[]> {
  requirePermission(context, "template.fold.read");
  const rows = await prisma.foldCategory.findMany({
    where: {
      organizationId: context.organizationId,
      deletedAt: null,
      ...(includeInactive ? {} : { active: true }),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, code: true, name: true, active: true, sortOrder: true, lockVersion: true },
  });
  return rows.map(toCategoryDto);
}

export async function createFoldCategory(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: { name: string; sortOrder: number; requestId: string },
): Promise<FoldCategoryDto> {
  requirePermission(context, "template.fold.edit");
  return prisma.$transaction(async (transaction) => {
    const id = randomUUID();
    const created = await transaction.foldCategory.create({
      data: {
        id,
        organizationId: context.organizationId,
        code: `CAT-${id}`,
        name: input.name.trim(),
        sortOrder: input.sortOrder,
      },
      select: { id: true, code: true, name: true, active: true, sortOrder: true, lockVersion: true },
    });
    await writeAuditEvent(transaction, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "fold.category_created",
      entityId: id,
      requestId: input.requestId,
      after: { name: created.name, sortOrder: created.sortOrder, active: true, lockVersion: 1 },
    });
    return toCategoryDto(created);
  });
}

export async function updateFoldCategory(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: {
    categoryId: string;
    name: string;
    sortOrder: number;
    active: boolean;
    expectedLockVersion: number;
    requestId: string;
  },
): Promise<FoldCategoryDto> {
  requirePermission(context, "template.fold.edit");
  return prisma.$transaction(async (transaction) => {
    const current = await transaction.foldCategory.findFirst({
      where: { id: input.categoryId, organizationId: context.organizationId, deletedAt: null },
      select: { id: true, code: true, name: true, active: true, sortOrder: true, lockVersion: true },
    });
    if (!current) throw new FoldDraftServiceError("NOT_FOUND", "절곡 분류를 찾을 수 없습니다.");
    if (current.lockVersion !== input.expectedLockVersion) {
      throw new FoldDraftServiceError("CONFLICT", "다른 화면에서 이 분류를 먼저 변경했습니다.");
    }
    const next = current.lockVersion + 1;
    const result = await transaction.foldCategory.updateMany({
      where: {
        id: current.id,
        organizationId: context.organizationId,
        deletedAt: null,
        lockVersion: input.expectedLockVersion,
      },
      data: { name: input.name.trim(), sortOrder: input.sortOrder, active: input.active, lockVersion: next },
    });
    if (result.count !== 1) {
      throw new FoldDraftServiceError("CONFLICT", "다른 화면에서 이 분류를 먼저 변경했습니다.");
    }
    const updated = await transaction.foldCategory.findUniqueOrThrow({
      where: { id: current.id },
      select: { id: true, code: true, name: true, active: true, sortOrder: true, lockVersion: true },
    });
    await writeAuditEvent(transaction, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "fold.category_updated",
      entityId: current.id,
      requestId: input.requestId,
      before: { name: current.name, sortOrder: current.sortOrder, active: current.active, lockVersion: current.lockVersion },
      after: { name: updated.name, sortOrder: updated.sortOrder, active: updated.active, lockVersion: next },
    });
    return toCategoryDto(updated);
  });
}

export async function listFoldTemplates(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: {
    q?: string;
    categoryId?: string;
    status?: RevisionStatus;
    documentType?: "NORMAL" | "BOX" | "PANEL";
    cursor?: string;
    limit: number;
  },
): Promise<FoldTemplateListDto> {
  requirePermission(context, "template.fold.read");
  const cursor = decodeCursor(input.cursor);
  const filters: Prisma.FoldTemplateWhereInput[] = [];
  if (input.q?.trim()) {
    filters.push({
      OR: [
        { name: { contains: input.q.trim(), mode: "insensitive" } },
        { code: { contains: input.q.trim(), mode: "insensitive" } },
      ],
    });
  }
  if (cursor) {
    filters.push({
      OR: [
        { updatedAt: { lt: cursor.updatedAt } },
        { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
      ],
    });
  }
  const rows = await prisma.foldTemplate.findMany({
    where: {
      organizationId: context.organizationId,
      active: true,
      deletedAt: null,
      ...(filters.length > 0 ? { AND: filters } : {}),
      ...(input.categoryId === "uncategorized"
        ? { categoryId: null }
        : input.categoryId
          ? { categoryId: input.categoryId }
          : {}),
      ...(input.status ? { revisions: { some: { status: input.status, deletedAt: null } } } : {}),
      ...(input.documentType ? { documentType: input.documentType } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    select: templateSummarySelect,
  });
  const hasMore = rows.length > input.limit;
  const visible = rows.slice(0, input.limit);
  return {
    items: visible.map(toTemplateSummary),
    nextCursor: hasMore && visible.length > 0
      ? encodeCursor(visible.at(-1)!.updatedAt, visible.at(-1)!.id)
      : null,
  };
}

export async function getFoldTemplate(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  templateId: string,
): Promise<FoldTemplateDetailDto> {
  requirePermission(context, "template.fold.read");
  const row = await findTemplateDetail(prisma, context.organizationId, templateId);
  if (!row) throw new FoldDraftServiceError("NOT_FOUND", "절곡 템플릿을 찾을 수 없습니다.");
  return { ...toTemplateSummary(row), revisions: row.revisions.map(toRevisionSummary) };
}

export async function updateFoldTemplateMetadata(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: {
    templateId: string;
    name: string;
    categoryId: string | null;
    expectedLockVersion: number;
    requestId: string;
  },
): Promise<FoldTemplateDetailDto> {
  requirePermission(context, "template.fold.edit");
  return prisma.$transaction(async (transaction) => {
    await lockTemplate(transaction, context.organizationId, input.templateId);
    await requireCategory(transaction, context.organizationId, input.categoryId);
    const current = await findTemplateDetail(transaction, context.organizationId, input.templateId);
    if (!current) throw new FoldDraftServiceError("NOT_FOUND", "절곡 템플릿을 찾을 수 없습니다.");
    if (current.lockVersion !== input.expectedLockVersion) {
      throw new FoldDraftServiceError("CONFLICT", "다른 화면에서 템플릿 정보를 먼저 변경했습니다.");
    }
    const working = current.revisions.find((item) => item.status === "DRAFT");
    if (!working && current.name !== input.name.trim()) {
      throw new FoldDraftServiceError("CONFLICT", "이름 변경은 편집 가능한 초안이 있을 때만 가능합니다.");
    }
    const next = current.lockVersion + 1;
    await transaction.foldTemplate.update({
      where: { id: current.id },
      data: { name: input.name.trim(), categoryId: input.categoryId, lockVersion: next },
    });
    if (working) {
      await lockRevision(transaction, context.organizationId, working.id);
      const source = await transaction.foldRevision.findUniqueOrThrow({ where: { id: working.id } });
      const document = readFoldRevisionDocument(source);
      const prepared = prepareFoldRevisionDocument({ ...document, name: input.name.trim() });
      await transaction.foldRevision.update({
        where: { id: working.id },
        data: {
          name: input.name.trim(),
          lockVersion: source.lockVersion + 1,
          updatedByUserId: context.userId,
          ...prepared,
        },
      });
    }
    await writeAuditEvent(transaction, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "fold.template_metadata_updated",
      entityId: current.id,
      requestId: input.requestId,
      before: { name: current.name, categoryId: current.category?.id ?? null, lockVersion: current.lockVersion },
      after: { name: input.name.trim(), categoryId: input.categoryId, lockVersion: next },
    });
    const updated = await findTemplateDetail(transaction, context.organizationId, current.id);
    if (!updated) throw new Error("Updated template could not be read.");
    return { ...toTemplateSummary(updated), revisions: updated.revisions.map(toRevisionSummary) };
  });
}

async function readSourceRevision(database: Database, organizationId: string, revisionId: string) {
  const source = await database.foldRevision.findFirst({
    where: { id: revisionId, organizationId, deletedAt: null, template: { organizationId, deletedAt: null } },
    include: { template: true },
  });
  if (!source) throw new FoldDraftServiceError("NOT_FOUND", "절곡 개정을 찾을 수 없습니다.");
  return source;
}

export async function copyFoldTemplate(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: {
    sourceRevisionId: string;
    draftId: string;
    name: string;
    categoryId: string | null;
    targetDocumentType?: "panel";
    requestId: string;
  },
): Promise<FoldTemplateDetailDto> {
  requirePermission(context, "template.fold.edit");
  return prisma.$transaction(async (transaction) => {
    await requireCategory(transaction, context.organizationId, input.categoryId);
    const retriedRevision = await transaction.foldRevision.findFirst({
      where: { id: input.draftId, organizationId: context.organizationId, deletedAt: null },
      select: { templateId: true },
    });
    if (retriedRevision) {
      const retried = await findTemplateDetail(transaction, context.organizationId, retriedRevision.templateId);
      if (!retried) throw new FoldDraftServiceError("CONFLICT", "이미 처리된 복사 요청의 템플릿을 찾을 수 없습니다.");
      return { ...toTemplateSummary(retried), revisions: retried.revisions.map(toRevisionSummary) };
    }
    const source = await readSourceRevision(transaction, context.organizationId, input.sourceRevisionId);
    const rawSourceDocument = readFoldRevisionDocument(source);
    if (input.targetDocumentType === "panel" && rawSourceDocument.documentType !== "normal") {
      throw new FoldDraftServiceError("INVALID_REQUEST", "패널 템플릿은 단일 일반 단면에서만 만들 수 있습니다.");
    }
    const { boxDefinition: _boxDefinition, panelAttachments: _panelAttachments, ...sourceBase } = rawSourceDocument;
    void _boxDefinition;
    void _panelAttachments;
    const sourceDocument = input.targetDocumentType === "panel"
      ? parseServerFoldDocument({
          ...sourceBase,
          documentType: "panel",
          blocks: [rawSourceDocument.blocks[0]],
          panelAttachments: [],
        })
      : rawSourceDocument;
    const { prepared } = await prepareCopiedDocument(transaction, context.organizationId, sourceDocument, input.name.trim());
    const templateId = randomUUID();
    await transaction.foldTemplate.create({
      data: {
        id: templateId,
        organizationId: context.organizationId,
        categoryId: input.categoryId,
        code: `FOLD-${templateId}`,
        name: input.name.trim(),
        documentType: input.targetDocumentType === "panel" ? "PANEL" : source.template.documentType,
      },
    });
    await transaction.foldRevision.create({
      data: {
        id: input.draftId,
        organizationId: context.organizationId,
        templateId,
        revisionNumber: 1,
        status: "DRAFT",
        name: input.name.trim(),
        createdByUserId: context.userId,
        updatedByUserId: context.userId,
        statusChangedByUserId: context.userId,
        ...prepared,
      },
    });
    await writeAuditEvent(transaction, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "fold.template_copied",
      entityId: templateId,
      requestId: input.requestId,
      after: { name: input.name.trim(), revisionNumber: 1, status: "DRAFT" },
      metadata: { sourceRevisionId: source.id, checksumSha256: prepared.documentChecksumSha256 },
    });
    const created = await findTemplateDetail(transaction, context.organizationId, templateId);
    if (!created) throw new Error("Copied template could not be read.");
    return { ...toTemplateSummary(created), revisions: created.revisions.map(toRevisionSummary) };
  });
}

export async function createNextFoldRevision(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: { templateId: string; sourceRevisionId: string; draftId: string; requestId: string },
): Promise<FoldTemplateDetailDto> {
  requirePermission(context, "template.fold.edit");
  return prisma.$transaction(async (transaction) => {
    await lockTemplate(transaction, context.organizationId, input.templateId);
    const template = await findTemplateDetail(transaction, context.organizationId, input.templateId);
    if (!template) throw new FoldDraftServiceError("NOT_FOUND", "절곡 템플릿을 찾을 수 없습니다.");
    const retriedRevision = await transaction.foldRevision.findFirst({
      where: { id: input.draftId, organizationId: context.organizationId, deletedAt: null },
      select: { templateId: true },
    });
    if (retriedRevision) {
      if (retriedRevision.templateId !== template.id) {
        throw new FoldDraftServiceError("CONFLICT", "같은 초안 ID가 다른 템플릿에서 사용 중입니다.");
      }
      return { ...toTemplateSummary(template), revisions: template.revisions.map(toRevisionSummary) };
    }
    if (template.revisions.some((item) => item.status === "DRAFT" || item.status === "REVIEW")) {
      throw new FoldDraftServiceError("CONFLICT", "이미 작업 중인 개정이 있습니다.");
    }
    const source = await readSourceRevision(transaction, context.organizationId, input.sourceRevisionId);
    if (source.templateId !== template.id) {
      throw new FoldDraftServiceError("NOT_FOUND", "같은 템플릿의 원본 개정을 찾을 수 없습니다.");
    }
    const sourceDocument = readFoldRevisionDocument(source);
    const { prepared } = await prepareCopiedDocument(transaction, context.organizationId, sourceDocument, template.name);
    const revisionNumber = Math.max(0, ...template.revisions.map((item) => item.revisionNumber)) + 1;
    await transaction.foldRevision.create({
      data: {
        id: input.draftId,
        organizationId: context.organizationId,
        templateId: template.id,
        revisionNumber,
        status: "DRAFT",
        name: template.name,
        createdByUserId: context.userId,
        updatedByUserId: context.userId,
        statusChangedByUserId: context.userId,
        ...prepared,
      },
    });
    await writeAuditEvent(transaction, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "fold.revision_created",
      entityId: input.draftId,
      requestId: input.requestId,
      after: { name: template.name, revisionNumber, status: "DRAFT", lockVersion: 1 },
      metadata: { sourceRevisionId: source.id, checksumSha256: prepared.documentChecksumSha256 },
    });
    const updated = await findTemplateDetail(transaction, context.organizationId, template.id);
    if (!updated) throw new Error("New revision template could not be read.");
    return { ...toTemplateSummary(updated), revisions: updated.revisions.map(toRevisionSummary) };
  });
}

export async function getFoldRevision(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  revisionId: string,
): Promise<FoldRevisionDetailDto> {
  requirePermission(context, "template.fold.read");
  const row = await prisma.foldRevision.findFirst({
    where: { id: revisionId, organizationId: context.organizationId, deletedAt: null, template: { organizationId: context.organizationId, deletedAt: null } },
    include: { template: true, updatedBy: { select: userSelect } },
  });
  if (!row) throw new FoldDraftServiceError("NOT_FOUND", "절곡 개정을 찾을 수 없습니다.");
  return {
    ...toRevisionSummary(row),
    templateId: row.templateId,
    templateName: row.template.name,
    document: readFoldRevisionDocument(row),
  };
}

type TransitionAction = "review" | "return" | "publish" | "retire" | "discard";

const transitionRules: Record<TransitionAction, { from: RevisionStatus; to: RevisionStatus }> = {
  review: { from: "DRAFT", to: "REVIEW" },
  return: { from: "REVIEW", to: "DRAFT" },
  publish: { from: "REVIEW", to: "PUBLISHED" },
  retire: { from: "PUBLISHED", to: "RETIRED" },
  discard: { from: "DRAFT", to: "DRAFT" },
};

const transitionAuditAction = {
  review: "fold.revision_review_requested",
  return: "fold.revision_returned",
  publish: "fold.revision_published",
  retire: "fold.revision_retired",
  discard: "fold.revision_discarded",
} as const;

export async function transitionFoldRevision(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: { revisionId: string; action: TransitionAction; expectedLockVersion: number; requestId: string },
): Promise<FoldTemplateDetailDto> {
  requirePermission(context, input.action === "review" || input.action === "discard" ? "template.fold.edit" : "template.fold.publish");
  return prisma.$transaction(async (transaction) => {
    const candidate = await transaction.foldRevision.findFirst({
      where: {
        id: input.revisionId,
        organizationId: context.organizationId,
        deletedAt: null,
        template: { organizationId: context.organizationId, deletedAt: null },
      },
      select: { templateId: true },
    });
    if (!candidate) throw new FoldDraftServiceError("NOT_FOUND", "절곡 개정을 찾을 수 없습니다.");
    await lockTemplate(transaction, context.organizationId, candidate.templateId);
    await lockRevision(transaction, context.organizationId, input.revisionId);
    const current = await readSourceRevision(transaction, context.organizationId, input.revisionId);
    const rule = transitionRules[input.action];
    if (
      input.action !== "discard" &&
      current.status === rule.to &&
      current.lockVersion === input.expectedLockVersion + 1
    ) {
      const retried = await findTemplateDetail(transaction, context.organizationId, current.templateId);
      if (!retried) throw new FoldDraftServiceError("NOT_FOUND", "절곡 템플릿을 찾을 수 없습니다.");
      return { ...toTemplateSummary(retried), revisions: retried.revisions.map(toRevisionSummary) };
    }
    if (current.status !== rule.from) {
      throw new FoldDraftServiceError("CONFLICT", `현재 ${current.status} 상태에서는 이 작업을 수행할 수 없습니다.`);
    }
    if (current.lockVersion !== input.expectedLockVersion) {
      throw new FoldDraftServiceError("CONFLICT", "다른 화면에서 이 개정을 먼저 변경했습니다.");
    }
    const next = current.lockVersion + 1;
    const now = new Date();

    if (input.action === "publish") {
      const document = readFoldRevisionDocument(current);
      const { prepared } = await prepareCopiedDocument(transaction, context.organizationId, document, current.name);
      if (prepared.documentChecksumSha256 !== current.documentChecksumSha256) {
        throw new FoldDraftServiceError("CONFLICT", "검토 중 재질 기준이 변경되었습니다. 수정 요청 후 다시 저장해 주세요.");
      }
      const previous = await transaction.foldRevision.findFirst({
        where: { templateId: current.templateId, status: "PUBLISHED", deletedAt: null },
      });
      if (previous) {
        await transaction.foldRevision.update({
          where: { id: previous.id },
          data: {
            status: "RETIRED",
            lockVersion: previous.lockVersion + 1,
            statusChangedAt: now,
            statusChangedByUserId: context.userId,
            updatedByUserId: context.userId,
          },
        });
        await writeAuditEvent(transaction, {
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: "fold.revision_retired",
          entityId: previous.id,
          requestId: input.requestId,
          before: { status: "PUBLISHED", lockVersion: previous.lockVersion },
          after: { status: "RETIRED", lockVersion: previous.lockVersion + 1 },
          metadata: { revisionNumber: previous.revisionNumber, checksumSha256: previous.documentChecksumSha256 },
        });
      }
    }

    if (input.action === "discard") {
      await transaction.foldRevision.update({
        where: { id: current.id },
        data: {
          deletedAt: now,
          deletedByUserId: context.userId,
          lockVersion: next,
          updatedByUserId: context.userId,
          statusChangedAt: now,
          statusChangedByUserId: context.userId,
        },
      });
      const historicalCount = await transaction.foldRevision.count({
        where: { templateId: current.templateId, deletedAt: null },
      });
      if (historicalCount === 0) {
        await transaction.foldTemplate.update({
          where: { id: current.templateId },
          data: { active: false, deletedAt: now, lockVersion: { increment: 1 } },
        });
      }
    } else {
      await transaction.foldRevision.update({
        where: { id: current.id },
        data: {
          status: rule.to,
          lockVersion: next,
          updatedByUserId: context.userId,
          statusChangedAt: now,
          statusChangedByUserId: context.userId,
          ...(input.action === "publish"
            ? { publishedAt: now, publishedByUserId: context.userId }
            : {}),
        },
      });
    }

    await writeAuditEvent(transaction, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: transitionAuditAction[input.action],
      entityId: current.id,
      requestId: input.requestId,
      before: { status: current.status, lockVersion: current.lockVersion },
      after: { status: input.action === "discard" ? "DISCARDED" : rule.to, lockVersion: next },
      metadata: { revisionNumber: current.revisionNumber, checksumSha256: current.documentChecksumSha256 },
    });
    const updated = await findTemplateDetail(transaction, context.organizationId, current.templateId);
    if (!updated) {
      if (input.action === "discard") {
        return {
          templateId: current.templateId,
          code: current.template.code,
          name: current.template.name,
          documentType: current.template.documentType.toLowerCase() as "normal" | "box" | "panel",
          category: null,
          lockVersion: current.template.lockVersion + 1,
          updatedAt: now.toISOString(),
          currentRevision: null,
          revisionCount: 0,
          revisions: [],
        };
      }
      throw new Error("Transitioned template could not be read.");
    }
    return { ...toTemplateSummary(updated), revisions: updated.revisions.map(toRevisionSummary) };
  });
}

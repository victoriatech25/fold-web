import "server-only";

import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  FoldDocumentValidationError,
} from "@/domain/fold-document/errors";
import {
  parseServerFoldDocument,
  type ServerFoldDocument,
} from "@/domain/fold-document/schema";
import { writeAuditEvent } from "@/server/audit/audit-writer";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { requirePermission } from "@/server/authorization/authorization";
import { FoldDraftServiceError } from "@/server/fold-draft/fold-draft-error";
import {
  findOrganizationFoldDraft,
  listOrganizationFoldDrafts,
  listOrganizationFoldMaterialOptions,
  toFoldDraftDetail,
  type FoldDraftCursor,
} from "@/server/fold-draft/fold-draft-repository";
import type {
  FoldDraftConflictDto,
  FoldDraftDetailDto,
  FoldDraftListDto,
  FoldMaterialOptionDto,
} from "@/server/fold-draft/fold-draft-types";
import {
  FoldMaterialRuleNotFoundError,
  resolvePublishedMaterialRuleSnapshot,
} from "@/server/fold-document/material-snapshot";
import { prepareFoldRevisionDocument } from "@/server/fold-document/revision-contract";
import {
  FoldSheetItemNotFoundError,
  resolveSheetItemSnapshot,
} from "@/server/fold-document/sheet-item-snapshot";

type Transaction = Prisma.TransactionClient;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function mapDocumentType(value: ServerFoldDocument["documentType"]) {
  return value.toUpperCase() as "NORMAL" | "BOX" | "PANEL";
}

function asConflict(detail: FoldDraftDetailDto): FoldDraftConflictDto {
  return {
    draftId: detail.draftId,
    lockVersion: detail.lockVersion,
    checksumSha256: detail.checksumSha256,
    updatedAt: detail.updatedAt,
    updatedBy: detail.updatedBy,
  };
}

function isPrismaUniqueError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function mapDocumentError(error: unknown): never {
  if (error instanceof FoldDocumentValidationError) {
    throw new FoldDraftServiceError(
      "INVALID_REQUEST",
      "절곡 문서 내용을 확인해 주세요.",
      { issues: error.issues },
    );
  }
  if (error instanceof FoldMaterialRuleNotFoundError) {
    throw new FoldDraftServiceError(
      "NOT_FOUND",
      "사용할 수 있는 재질 계산 기준을 찾을 수 없습니다.",
    );
  }
  if (error instanceof FoldSheetItemNotFoundError) {
    throw new FoldDraftServiceError(
      "NOT_FOUND",
      "선택한 재질에 사용할 수 있는 원판 품목을 찾을 수 없습니다.",
    );
  }
  throw error;
}

async function prepareCanonicalDraftDocument(
  database: Transaction | PrismaClient,
  organizationId: string,
  input: unknown,
  previous?: ServerFoldDocument,
) {
  try {
    const supplied = parseServerFoldDocument(input);
    const material = await resolvePublishedMaterialRuleSnapshot(
      database,
      organizationId,
      supplied.material.ruleRevisionId,
    );
    let sheetItemSnapshot = supplied.sheetItemSnapshot;
    if (sheetItemSnapshot) {
      const previousSnapshot = previous && previous.material.ruleRevisionId === supplied.material.ruleRevisionId && "sheetItemSnapshot" in previous
        ? previous.sheetItemSnapshot
        : undefined;
      sheetItemSnapshot = previousSnapshot?.sheetItemId === sheetItemSnapshot.sheetItemId
        ? previousSnapshot
        : await resolveSheetItemSnapshot(
            database,
            organizationId,
            sheetItemSnapshot.sheetItemId,
            supplied.material.ruleRevisionId,
          );
    }
    const document = parseServerFoldDocument({
      ...supplied,
      material,
      ...(sheetItemSnapshot ? { sheetItemSnapshot } : {}),
    });
    return { document, prepared: prepareFoldRevisionDocument(document) };
  } catch (error) {
    mapDocumentError(error);
  }
}

function decodeFoldDraftCursor(value: string | undefined): FoldDraftCursor | null {
  if (!value) return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as unknown;
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      !("updatedAt" in decoded) ||
      !("id" in decoded) ||
      typeof decoded.updatedAt !== "string" ||
      typeof decoded.id !== "string" ||
      !uuidPattern.test(decoded.id)
    ) {
      throw new Error("Invalid cursor shape.");
    }
    const updatedAt = new Date(decoded.updatedAt);
    if (Number.isNaN(updatedAt.getTime())) {
      throw new Error("Invalid cursor timestamp.");
    }
    return { updatedAt, id: decoded.id };
  } catch {
    throw new FoldDraftServiceError(
      "INVALID_REQUEST",
      "초안 목록 페이지 위치가 올바르지 않습니다.",
    );
  }
}

async function lockFoldRevision(
  transaction: Transaction,
  organizationId: string,
  draftId: string,
): Promise<void> {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "FoldRevision"
    WHERE "id" = ${draftId}::uuid
      AND "organizationId" = ${organizationId}::uuid
    FOR UPDATE
  `;
}

async function lockFoldTemplate(
  transaction: Transaction,
  organizationId: string,
  templateId: string,
): Promise<void> {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "FoldTemplate"
    WHERE "id" = ${templateId}::uuid
      AND "organizationId" = ${organizationId}::uuid
    FOR UPDATE
  `;
}

async function lockDraftAggregate(
  transaction: Transaction,
  organizationId: string,
  draftId: string,
): Promise<void> {
  const candidate = await transaction.foldRevision.findFirst({
    where: {
      id: draftId,
      organizationId,
      status: "DRAFT",
      deletedAt: null,
      template: { organizationId, active: true, deletedAt: null },
    },
    select: { templateId: true },
  });
  if (!candidate) return;
  await lockFoldTemplate(transaction, organizationId, candidate.templateId);
  await lockFoldRevision(transaction, organizationId, draftId);
}

export async function listFoldDrafts(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: { cursor?: string; limit: number },
): Promise<FoldDraftListDto> {
  requirePermission(context, "template.fold.read");
  return listOrganizationFoldDrafts(prisma, context.organizationId, {
    cursor: decodeFoldDraftCursor(input.cursor),
    limit: input.limit,
  });
}

export async function getFoldDraft(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  draftId: string,
): Promise<FoldDraftDetailDto> {
  requirePermission(context, "template.fold.read");
  const row = await findOrganizationFoldDraft(
    prisma,
    context.organizationId,
    draftId,
  );
  if (!row) {
    throw new FoldDraftServiceError(
      "NOT_FOUND",
      "절곡 초안을 찾을 수 없습니다.",
    );
  }
  return toFoldDraftDetail(row);
}

export async function listFoldMaterialOptions(
  prisma: PrismaClient,
  context: AuthenticatedContext,
): Promise<FoldMaterialOptionDto[]> {
  requirePermission(context, "material.read");
  return listOrganizationFoldMaterialOptions(prisma, context.organizationId);
}

export async function createFoldDraft(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: { draftId: string; document: unknown; requestId: string },
): Promise<FoldDraftDetailDto> {
  requirePermission(context, "template.fold.edit");
  try {
    return await prisma.$transaction(async (transaction) => {
      const { document, prepared } = await prepareCanonicalDraftDocument(
        transaction,
        context.organizationId,
        input.document,
      );
      const existing = await findOrganizationFoldDraft(
        transaction,
        context.organizationId,
        input.draftId,
      );
      if (existing) {
        const detail = toFoldDraftDetail(existing);
        if (detail.checksumSha256 === prepared.documentChecksumSha256) {
          return detail;
        }
        throw new FoldDraftServiceError(
          "CONFLICT",
          "같은 초안 ID에 다른 내용이 이미 저장되어 있습니다.",
          { conflict: asConflict(detail) },
        );
      }

      const templateId = randomUUID();
      await transaction.foldTemplate.create({
        data: {
          id: templateId,
          organizationId: context.organizationId,
          code: `FOLD-${templateId}`,
          name: document.name,
          documentType: mapDocumentType(document.documentType),
        },
      });
      await transaction.foldRevision.create({
        data: {
          id: input.draftId,
          organizationId: context.organizationId,
          templateId,
          revisionNumber: 1,
          status: "DRAFT",
          name: document.name,
          lockVersion: 1,
          createdByUserId: context.userId,
          updatedByUserId: context.userId,
          statusChangedByUserId: context.userId,
          ...prepared,
        },
      });
      await writeAuditEvent(transaction, {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "fold.draft_created",
        entityId: input.draftId,
        requestId: input.requestId,
        after: {
          name: document.name,
          documentType: document.documentType,
          lockVersion: 1,
        },
        metadata: {
          schemaVersion: document.schemaVersion,
          checksumSha256: prepared.documentChecksumSha256,
        },
      });
      const created = await findOrganizationFoldDraft(
        transaction,
        context.organizationId,
        input.draftId,
      );
      if (!created) throw new Error("Created fold draft could not be read.");
      return toFoldDraftDetail(created);
    });
  } catch (error) {
    if (error instanceof FoldDraftServiceError) throw error;
    if (isPrismaUniqueError(error)) {
      const { prepared } = await prepareCanonicalDraftDocument(
        prisma,
        context.organizationId,
        input.document,
      );
      const existing = await findOrganizationFoldDraft(
        prisma,
        context.organizationId,
        input.draftId,
      );
      if (existing) {
        const detail = toFoldDraftDetail(existing);
        if (detail.checksumSha256 === prepared.documentChecksumSha256) {
          return detail;
        }
      }
      throw new FoldDraftServiceError(
        "CONFLICT",
        "같은 초안 생성 요청이 이미 처리되었습니다. 목록을 다시 확인해 주세요.",
      );
    }
    throw error;
  }
}

export async function updateFoldDraft(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: {
    draftId: string;
    expectedLockVersion: number;
    document: unknown;
    requestId: string;
  },
): Promise<FoldDraftDetailDto> {
  requirePermission(context, "template.fold.edit");
  return prisma.$transaction(async (transaction) => {
    await lockDraftAggregate(transaction, context.organizationId, input.draftId);
    const currentRow = await findOrganizationFoldDraft(
      transaction,
      context.organizationId,
      input.draftId,
    );
    if (!currentRow) {
      throw new FoldDraftServiceError(
        "NOT_FOUND",
        "절곡 초안을 찾을 수 없습니다.",
      );
    }
    const current = toFoldDraftDetail(currentRow);
    const { document, prepared } = await prepareCanonicalDraftDocument(
      transaction,
      context.organizationId,
      input.document,
      current.document,
    );

    if (current.checksumSha256 === prepared.documentChecksumSha256) {
      return current;
    }
    if (current.lockVersion !== input.expectedLockVersion) {
      throw new FoldDraftServiceError(
        "CONFLICT",
        "다른 화면에서 이 초안을 먼저 저장했습니다.",
        { conflict: asConflict(current) },
      );
    }

    const nextLockVersion = current.lockVersion + 1;
    await transaction.foldRevision.update({
      where: { id: input.draftId },
      data: {
        name: document.name,
        lockVersion: nextLockVersion,
        updatedByUserId: context.userId,
        ...prepared,
      },
    });
    await transaction.foldTemplate.update({
      where: { id: current.templateId },
      data: {
        name: document.name,
        documentType: mapDocumentType(document.documentType),
      },
    });
    await writeAuditEvent(transaction, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "fold.draft_saved",
      entityId: input.draftId,
      requestId: input.requestId,
      before: {
        name: current.name,
        documentType: current.documentType,
        lockVersion: current.lockVersion,
      },
      after: {
        name: document.name,
        documentType: document.documentType,
        lockVersion: nextLockVersion,
      },
      metadata: {
        schemaVersion: document.schemaVersion,
        checksumSha256: prepared.documentChecksumSha256,
      },
    });
    const updated = await findOrganizationFoldDraft(
      transaction,
      context.organizationId,
      input.draftId,
    );
    if (!updated) throw new Error("Updated fold draft could not be read.");
    return toFoldDraftDetail(updated);
  });
}

export async function deleteFoldDraft(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: {
    draftId: string;
    expectedLockVersion: number;
    requestId: string;
  },
): Promise<{ draftId: string }> {
  requirePermission(context, "template.fold.edit");
  return prisma.$transaction(async (transaction) => {
    await lockDraftAggregate(transaction, context.organizationId, input.draftId);
    const currentRow = await findOrganizationFoldDraft(
      transaction,
      context.organizationId,
      input.draftId,
    );
    if (!currentRow) {
      throw new FoldDraftServiceError(
        "NOT_FOUND",
        "절곡 초안을 찾을 수 없습니다.",
      );
    }
    const current = toFoldDraftDetail(currentRow);
    if (current.lockVersion !== input.expectedLockVersion) {
      throw new FoldDraftServiceError(
        "CONFLICT",
        "다른 화면에서 이 초안을 먼저 저장했습니다.",
        { conflict: asConflict(current) },
      );
    }
    const nextLockVersion = current.lockVersion + 1;
    await transaction.foldRevision.update({
      where: { id: input.draftId },
      data: {
        lockVersion: nextLockVersion,
        updatedByUserId: context.userId,
        statusChangedByUserId: context.userId,
        statusChangedAt: new Date(),
        deletedByUserId: context.userId,
        deletedAt: new Date(),
      },
    });
    const remainingRevisionCount = await transaction.foldRevision.count({
      where: { templateId: current.templateId, deletedAt: null },
    });
    if (remainingRevisionCount === 0) {
      await transaction.foldTemplate.update({
        where: { id: current.templateId },
        data: {
          active: false,
          deletedAt: new Date(),
          lockVersion: { increment: 1 },
        },
      });
    }
    await writeAuditEvent(transaction, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "fold.draft_deleted",
      entityId: input.draftId,
      requestId: input.requestId,
      before: { active: true, deleted: false },
      after: { active: false, deleted: true },
      metadata: {
        lockVersion: nextLockVersion,
        checksumSha256: current.checksumSha256,
      },
    });
    return { draftId: input.draftId };
  });
}

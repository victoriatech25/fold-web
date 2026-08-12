import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { readFoldRevisionDocument } from "@/server/fold-document/revision-contract";
import type {
  FoldDraftDetailDto,
  FoldDraftListDto,
  FoldDraftSummaryDto,
  FoldMaterialOptionDto,
} from "@/server/fold-draft/fold-draft-types";
import { calculateSheetItem } from "@/server/sheet-items/sheet-item-policy";

export type FoldDraftDatabase = PrismaClient | Prisma.TransactionClient;

const draftSummarySelect = {
  id: true,
  templateId: true,
  name: true,
  documentSchemaVersion: true,
  documentChecksumSha256: true,
  materialRuleRevisionId: true,
  lockVersion: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, displayName: true } },
  updatedBy: { select: { id: true, displayName: true } },
  template: {
    select: {
      organizationId: true,
      name: true,
      documentType: true,
      active: true,
      deletedAt: true,
    },
  },
} as const satisfies Prisma.FoldRevisionSelect;

const draftDetailSelect = {
  ...draftSummarySelect,
  document: true,
} as const satisfies Prisma.FoldRevisionSelect;

type DraftSummaryRow = Prisma.FoldRevisionGetPayload<{
  select: typeof draftSummarySelect;
}>;

type DraftDetailRow = Prisma.FoldRevisionGetPayload<{
  select: typeof draftDetailSelect;
}>;

export type FoldDraftCursor = { updatedAt: Date; id: string };

function toDocumentType(value: "NORMAL" | "BOX" | "PANEL") {
  return value.toLowerCase() as "normal" | "box" | "panel";
}

function ensureMetadataIntegrity(row: DraftSummaryRow): void {
  if (row.name !== row.template.name) {
    throw new Error("Fold draft name metadata does not match its template.");
  }
}

export function toFoldDraftSummary(row: DraftSummaryRow): FoldDraftSummaryDto {
  ensureMetadataIntegrity(row);
  return {
    draftId: row.id,
    templateId: row.templateId,
    name: row.name,
    documentType: toDocumentType(row.template.documentType),
    lockVersion: row.lockVersion,
    checksumSha256: row.documentChecksumSha256,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
  };
}

export function toFoldDraftDetail(row: DraftDetailRow): FoldDraftDetailDto {
  const summary = toFoldDraftSummary(row);
  const document = readFoldRevisionDocument(row);
  if (
    document.name !== summary.name ||
    document.documentType !== summary.documentType
  ) {
    throw new Error("Fold draft document metadata does not match its rows.");
  }
  return { ...summary, document };
}

export async function findOrganizationFoldDraft(
  database: FoldDraftDatabase,
  organizationId: string,
  draftId: string,
): Promise<DraftDetailRow | null> {
  return database.foldRevision.findFirst({
    where: {
      id: draftId,
      organizationId,
      status: "DRAFT",
      deletedAt: null,
      template: {
        organizationId,
        active: true,
        deletedAt: null,
      },
    },
    select: draftDetailSelect,
  });
}

export async function listOrganizationFoldDrafts(
  database: FoldDraftDatabase,
  organizationId: string,
  input: { cursor: FoldDraftCursor | null; limit: number },
): Promise<FoldDraftListDto> {
  const rows = await database.foldRevision.findMany({
    where: {
      organizationId,
      status: "DRAFT",
      deletedAt: null,
      template: { organizationId, active: true, deletedAt: null },
      ...(input.cursor
        ? {
            OR: [
              { updatedAt: { lt: input.cursor.updatedAt } },
              { updatedAt: input.cursor.updatedAt, id: { lt: input.cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    select: draftSummarySelect,
  });
  const hasMore = rows.length > input.limit;
  const items = rows.slice(0, input.limit);
  return {
    items: items.map(toFoldDraftSummary),
    nextCursor: hasMore
      ? encodeFoldDraftCursor({
          updatedAt: items.at(-1)!.updatedAt,
          id: items.at(-1)!.id,
        })
      : null,
  };
}

export function encodeFoldDraftCursor(cursor: FoldDraftCursor): string {
  return Buffer.from(
    JSON.stringify({ updatedAt: cursor.updatedAt.toISOString(), id: cursor.id }),
    "utf8",
  ).toString("base64url");
}

export async function listOrganizationFoldMaterialOptions(
  database: FoldDraftDatabase,
  organizationId: string,
  now = new Date(),
): Promise<FoldMaterialOptionDto[]> {
  const rows = await database.materialRuleRevision.findMany({
    where: {
      organizationId,
      status: "PUBLISHED",
      OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }],
      AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }],
      materialVariant: {
        organizationId,
        active: true,
        deletedAt: null,
        material: { organizationId, active: true, deletedAt: null },
      },
    },
    include: {
      materialVariant: {
        include: {
          material: true,
          sheetItems: {
            where: { active: true, deletedAt: null },
            orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
          },
        },
      },
    },
    orderBy: [
      { materialVariant: { name: "asc" } },
      { revisionNumber: "desc" },
    ],
  });

  const seenVariants = new Set<string>();
  const options: FoldMaterialOptionDto[] = [];
  for (const row of rows) {
    if (seenVariants.has(row.materialVariantId)) continue;
    seenVariants.add(row.materialVariantId);
    options.push({
      ruleRevisionId: row.id,
      materialVariantId: row.materialVariantId,
      code: row.materialVariant.code,
      name: row.materialVariant.name,
      revisionNumber: row.revisionNumber,
      material: {
        ruleRevisionId: row.id,
        name: row.materialVariant.name,
        thicknessMm: row.materialVariant.thicknessMm.toString(),
        insideBendRadiusMm: row.insideBendRadiusMm.toString(),
        cutAngleDeg: row.cutAngleDeg.toString(),
        elongationMm: {
          vCut: row.elongationVCutMm.toString(),
          aCut: row.elongationACutMm.toString(),
          noCut: row.elongationNoCutMm.toString(),
        },
        cutDepthMm: {
          vCut: row.cutDepthVCutMm.toString(),
          aCut: row.cutDepthACutMm.toString(),
          noCut: row.cutDepthNoCutMm.toString(),
        },
      },
      calculation: {
        mode: row.calculationMode.toLowerCase() as "fixed" | "ratio",
        elongationOption: ({
          STANDARD: "standard",
          TWO_LINE: "two-line",
          DIAGONAL: "diagonal",
          EXT1: "ext1",
        } as const)[row.elongationOption],
        vCutEnabled: row.vCutEnabled,
        decimalPlaces: row.decimalPlaces,
        decimalOperation: row.decimalOperation.toLowerCase() as
          | "none"
          | "round"
          | "floor"
          | "ceil",
      },
      sheetItems: row.materialVariant.sheetItems.map((sheet) => {
        const calculation = calculateSheetItem(
          {
            widthMm: sheet.widthMm.toString(),
            lengthMm: sheet.lengthMm.toString(),
            trimTopMm: sheet.trimTopMm.toString(),
            trimRightMm: sheet.trimRightMm.toString(),
            trimBottomMm: sheet.trimBottomMm.toString(),
            trimLeftMm: sheet.trimLeftMm.toString(),
            weightOverrideKg: sheet.weightOverrideKg?.toString() ?? null,
          },
          row.materialVariant.material.densityKgPerM3?.toString() ?? null,
          row.materialVariant.thicknessMm.toString(),
        );
        return {
          sheetItemId: sheet.id,
          materialVariantId: row.materialVariantId,
          code: sheet.code,
          name: sheet.name,
          finishName: sheet.finishName,
          widthMm: sheet.widthMm.toString(),
          lengthMm: sheet.lengthMm.toString(),
          rotationPolicy: sheet.rotationPolicy,
          grainAxis: sheet.grainAxis,
          trimTopMm: sheet.trimTopMm.toString(),
          trimRightMm: sheet.trimRightMm.toString(),
          trimBottomMm: sheet.trimBottomMm.toString(),
          trimLeftMm: sheet.trimLeftMm.toString(),
          nominalAreaM2: calculation.nominalAreaM2,
          usableWidthMm: calculation.usableWidthMm,
          usableLengthMm: calculation.usableLengthMm,
          usableAreaM2: calculation.usableAreaM2,
          effectiveWeightKg: calculation.effectiveWeightKg,
          weightSource: calculation.weightSource,
        };
      }),
      defaultSheetItemId: row.materialVariant.sheetItems.find((sheet) => sheet.isDefault)?.id ?? null,
    });
  }
  return options;
}

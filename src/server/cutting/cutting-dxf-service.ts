import "server-only";

import { createHash } from "node:crypto";

import { cuttingAnnotationsSchema, type CuttingAnnotations } from "@/domain/cutting/annotations";
import { cuttingInputSchema, cuttingResultSchema, type CuttingInput, type CuttingResult } from "@/domain/cutting/schema";
import {
  buildSheetDxf,
  dateKeyOf,
  laserGroupDxfFileName,
  sheetDxfFileName,
  type PartGeometry,
} from "@/domain/cutting/sheet-dxf";
import { serverDocumentToBrowserFoldProfileV4 } from "@/domain/fold-document/adapter";
import { createManufacturingGeometry } from "@/domain/manufacturing-geometry";
import { writeAuditEvent } from "@/server/audit/audit-writer";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { requirePermission } from "@/server/authorization/authorization";
import { createDxfDocument, createDxfDocumentFromEntities, type DxfDocument } from "@/server/dxf/dxf-writer";
import { createZip } from "@/server/dxf/zip-writer";
import { readFoldRevisionDocument } from "@/server/fold-document/revision-contract";
import { generatedObjectKey, type FileStorage } from "@/server/storage/file-storage";
import { getFileStorage } from "@/server/storage/s3-file-storage";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { CuttingError } from "./cutting-error";

type Database = PrismaClient | Prisma.TransactionClient;

/**
 * 재단 개정의 원판별 장비용 DXF(`P2-B11` 4.7). 원판마다 파일 하나, 레이저 그룹마다
 * 첫 부품 전개도 하나, 전체 zip 하나를 만들어 `FileAsset` 으로 보관한다.
 * 큐 작업 `cutting.dxf` 가 부른다. 같은 개정은 지정까지 잠겨 있으므로 두 번 만들면
 * 같은 내용이 나온다 — 파일이 이미 있으면 다시 만들지 않는다.
 */

export type CuttingDxfFileDto = {
  assetId: string;
  fileName: string;
  kind: "SHEET" | "LASER_GROUP" | "ZIP";
  sheetIndex: number | null;
  status: "READY" | "PENDING";
  sizeBytes: number;
};

export type CuttingDxfResult = {
  revisionId: string;
  dateKey: string;
  sequence: number;
  files: CuttingDxfFileDto[];
  reused: boolean;
};

type FileMetadata = {
  cuttingKind: CuttingDxfFileDto["kind"];
  sheetIndex: number | null;
  dateKey: string;
  sequence: number;
  writerVersion: string;
  layers: string[];
  entityCount: number;
  contentRetained: boolean;
  storageFailure: string | null;
};

const fileSelect = {
  id: true,
  fileName: true,
  status: true,
  sizeBytes: true,
  metadata: true,
} as const satisfies Prisma.FileAssetSelect;

function toFileDto(row: Prisma.FileAssetGetPayload<{ select: typeof fileSelect }>): CuttingDxfFileDto {
  const metadata = (row.metadata ?? {}) as Partial<FileMetadata>;
  return {
    assetId: row.id,
    fileName: row.fileName,
    kind: metadata.cuttingKind ?? "SHEET",
    sheetIndex: metadata.sheetIndex ?? null,
    status: row.status === "READY" ? "READY" : "PENDING",
    sizeBytes: Number(row.sizeBytes),
  };
}

/** 이미 만든 파일 목록. 없으면 빈 배열. */
export async function listCuttingRevisionDxf(
  database: Database,
  context: AuthenticatedContext,
  input: { planId: string; revisionId: string },
): Promise<CuttingDxfFileDto[]> {
  requirePermission(context, "cutting.optimize");
  const rows = await database.fileAsset.findMany({
    where: {
      organizationId: context.organizationId,
      cuttingPlanRevisionId: input.revisionId,
      cuttingPlanRevision: { cuttingPlanId: input.planId },
      deletedAt: null,
    },
    select: fileSelect,
    orderBy: [{ createdAt: "asc" }, { fileName: "asc" }],
  });
  return rows.map(toFileDto);
}

/** 부품(수주 항목)마다 제작 geometry 와 V/A 컷 깊이를 읽는다. */
async function loadPartGeometries(database: Database, partIds: string[]): Promise<Map<string, PartGeometry>> {
  const items = await database.salesOrderFoldItem.findMany({
    where: { id: { in: partIds } },
    select: {
      id: true,
      documentSchemaVersion: true,
      document: true,
      documentChecksumSha256: true,
      materialRuleRevisionId: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  const geometries = new Map<string, PartGeometry>();
  for (const item of items) {
    const document = readFoldRevisionDocument(item);
    const profile = serverDocumentToBrowserFoldProfileV4(JSON.parse(JSON.stringify(document)), {
      id: item.id,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    });
    const manufacturing = createManufacturingGeometry(profile);
    if (!manufacturing.valid || !manufacturing.geometry) {
      throw new CuttingError("CONFLICT", `부품 ${item.id}의 제작 형상을 만들 수 없어 DXF 를 낼 수 없습니다.`);
    }
    geometries.set(item.id, {
      geometry: manufacturing.geometry,
      vCutDepthMm: profile.material.cutDepth["v-cut"] ?? 0,
      aCutDepthMm: profile.material.cutDepth["a-cut"] ?? 0,
    });
  }
  return geometries;
}

/** 조직·날짜 단위 순번을 하나 뽑는다. 같은 트랜잭션 안에서 행 잠금으로 겹치지 않는다. */
async function nextSequence(database: Database, organizationId: string, dateKey: string): Promise<number> {
  const rows = await database.$queryRaw<Array<{ next: number }>>`
    INSERT INTO "CuttingDxfSequence" ("organizationId", "dateKey", "next")
    VALUES (${organizationId}::uuid, ${dateKey}, 2)
    ON CONFLICT ("organizationId", "dateKey")
    DO UPDATE SET "next" = "CuttingDxfSequence"."next" + 1
    RETURNING "next" - 1 AS "next"
  `;
  return rows[0].next;
}

async function storeFile(
  database: Database,
  storage: FileStorage,
  context: AuthenticatedContext,
  input: {
    revisionId: string;
    fileName: string;
    bytes: Uint8Array;
    mediaType: string;
    extension: string;
    metadata: Omit<FileMetadata, "contentRetained" | "storageFailure">;
  },
) {
  const checksumSha256 = createHash("sha256").update(input.bytes).digest("hex");
  // 키는 개정·파일명까지 섞어 만든다. 내용이 같은 파일(같은 부품의 그룹 도면 등)이 다른
  // 개정·다른 원판에서 나와도 서로의 자리를 빼앗지 않게 한다. 내용 checksum 은 따로 남긴다.
  const storageKey = generatedObjectKey({
    organizationId: context.organizationId,
    kind: "cutting-dxf",
    checksumSha256: createHash("sha256").update(`${input.revisionId}/${input.fileName}\n`).update(input.bytes).digest("hex"),
    extension: input.extension,
  });
  let contentRetained = true;
  let storageFailure: string | null = null;
  try {
    await storage.put({
      key: storageKey,
      body: input.bytes,
      mediaType: input.mediaType,
      checksumSha256,
      fileName: input.fileName,
    });
  } catch (error) {
    contentRetained = false;
    storageFailure = error instanceof Error ? error.message : "저장소 오류";
    console.error("Cutting DXF storage write failed", { revisionId: input.revisionId, fileName: input.fileName, error });
  }
  const metadata: FileMetadata = { ...input.metadata, contentRetained, storageFailure };
  return database.fileAsset.upsert({
    where: { storageKey },
    create: {
      organizationId: context.organizationId,
      kind: "DXF",
      status: contentRetained ? "READY" : "PENDING",
      storageKey,
      fileName: input.fileName,
      mediaType: input.mediaType,
      sizeBytes: BigInt(input.bytes.byteLength),
      checksumSha256,
      uploadedById: context.userId,
      cuttingPlanRevisionId: input.revisionId,
      metadata,
    },
    update: {
      status: contentRetained ? "READY" : "PENDING",
      fileName: input.fileName,
      sizeBytes: BigInt(input.bytes.byteLength),
      uploadedById: context.userId,
      cuttingPlanRevisionId: input.revisionId,
      deletedAt: null,
      metadata,
    },
    select: fileSelect,
  });
}

export async function generateCuttingRevisionDxf(
  database: PrismaClient,
  context: AuthenticatedContext,
  input: { planId: string; revisionId: string; requestId: string },
  storage: FileStorage = getFileStorage(),
): Promise<CuttingDxfResult> {
  requirePermission(context, "cutting.optimize");
  const revision = await database.cuttingPlanRevision.findFirst({
    where: { id: input.revisionId, cuttingPlanId: input.planId, organizationId: context.organizationId },
    select: {
      id: true,
      status: true,
      revisionNumber: true,
      result: true,
      annotations: true,
      cuttingPlan: {
        select: {
          id: true,
          input: true,
          materialVariant: { select: { code: true, thicknessMm: true } },
        },
      },
    },
  });
  if (!revision) throw new CuttingError("NOT_FOUND", "재단 개정을 찾을 수 없습니다.");
  if (revision.status !== "SUCCEEDED") {
    throw new CuttingError("CONFLICT", "성공한 재단 결과만 DXF 로 낼 수 있습니다.");
  }

  const existing = await listCuttingRevisionDxf(database, context, input);
  if (existing.length > 0 && existing.every((file) => file.status === "READY")) {
    const first = existing[0];
    const stored = await database.fileAsset.findUniqueOrThrow({ where: { id: first.assetId }, select: { metadata: true } });
    const metadata = (stored.metadata ?? {}) as Partial<FileMetadata>;
    return {
      revisionId: revision.id,
      dateKey: metadata.dateKey ?? "",
      sequence: metadata.sequence ?? 0,
      files: existing,
      reused: true,
    };
  }

  const parsedInput = cuttingInputSchema.safeParse(revision.cuttingPlan.input);
  const parsedResult = cuttingResultSchema.safeParse(revision.result);
  if (!parsedInput.success || !parsedResult.success) {
    throw new CuttingError("CONFLICT", "재단 입력이나 결과를 읽을 수 없습니다.");
  }
  const cuttingInput: CuttingInput = parsedInput.data;
  const result: CuttingResult = parsedResult.data;
  const parsedAnnotations = cuttingAnnotationsSchema.safeParse(revision.annotations);
  const annotations: CuttingAnnotations | null = parsedAnnotations.success ? parsedAnnotations.data : null;

  const partIds = [...new Set(result.sheets.flatMap((sheet) => sheet.placements.map((p) => p.partId)))];
  const partGeometries = await loadPartGeometries(database, partIds);
  const thicknessMm = revision.cuttingPlan.materialVariant.thicknessMm.toString();
  const colorCode = revision.cuttingPlan.materialVariant.code;

  // 파일 이름의 순번은 만드는 시점에 한 번만 뽑는다.
  const dateKey = dateKeyOf(new Date());
  const sequence = await nextSequence(database, context.organizationId, dateKey);

  const encoder = new TextEncoder();
  const documents: Array<{ fileName: string; kind: CuttingDxfFileDto["kind"]; sheetIndex: number | null; dxf: DxfDocument }> = [];
  for (const sheet of result.sheets) {
    const film = annotations?.sheets.some((item) => item.sheetIndex === sheet.sheetIndex && item.film) ?? false;
    const built = buildSheetDxf({
      input: cuttingInput,
      sheet,
      sheetIndex: sheet.sheetIndex,
      annotations,
      partGeometries,
      thicknessMm,
      colorCode,
    });
    documents.push({
      fileName: sheetDxfFileName({ dateKey, sequence, sheetIndex: sheet.sheetIndex, film }),
      kind: "SHEET",
      sheetIndex: sheet.sheetIndex,
      dxf: createDxfDocumentFromEntities({
        entities: built.entities,
        layers: built.layers,
        comment: `cutting sheet ${sheet.sheetIndex + 1}; revision=${revision.revisionNumber}; unit=mm`,
      }),
    });

    // 레이저 그룹마다 첫 부품의 전개도. 그룹 안은 레이저가 이 도면대로 딴다.
    const groups = (annotations?.laserGroups ?? []).filter((group) => group.sheetIndex === sheet.sheetIndex);
    groups.forEach((group, ordinal) => {
      const partId = group.placementKeys[0]?.split("#")[0];
      const geometry = partId ? partGeometries.get(partId) : undefined;
      if (!geometry) return;
      documents.push({
        fileName: laserGroupDxfFileName({ dateKey, sequence, sheetIndex: sheet.sheetIndex, groupOrdinal: ordinal, film }),
        kind: "LASER_GROUP",
        sheetIndex: sheet.sheetIndex,
        dxf: createDxfDocument(geometry.geometry),
      });
    });
  }

  const files: CuttingDxfFileDto[] = [];
  for (const document of documents) {
    const row = await storeFile(database, storage, context, {
      revisionId: revision.id,
      fileName: document.fileName,
      bytes: encoder.encode(document.dxf.content),
      mediaType: "application/dxf",
      extension: "dxf",
      metadata: {
        cuttingKind: document.kind,
        sheetIndex: document.sheetIndex,
        dateKey,
        sequence,
        writerVersion: document.dxf.version,
        layers: document.dxf.layers,
        entityCount: document.dxf.entityCount,
      },
    });
    files.push(toFileDto(row));
  }

  const zipBytes = createZip(
    documents.map((document) => ({ name: document.fileName, data: encoder.encode(document.dxf.content) })),
  );
  const zipRow = await storeFile(database, storage, context, {
    revisionId: revision.id,
    fileName: `${dateKey}-${String(sequence).padStart(2, "0")}-r${revision.revisionNumber}.zip`,
    bytes: zipBytes,
    mediaType: "application/zip",
    extension: "zip",
    metadata: {
      cuttingKind: "ZIP",
      sheetIndex: null,
      dateKey,
      sequence,
      writerVersion: documents[0]?.dxf.version ?? "",
      layers: [],
      entityCount: documents.length,
    },
  });
  files.push(toFileDto(zipRow));

  await writeAuditEvent(database, {
    organizationId: context.organizationId,
    actorUserId: context.userId,
    action: "cutting.dxf_exported",
    entityId: revision.cuttingPlan.id,
    requestId: input.requestId,
    metadata: {
      revisionNumber: revision.revisionNumber,
      dateKey,
      sequence,
      sheetFileCount: documents.filter((d) => d.kind === "SHEET").length,
      laserGroupFileCount: documents.filter((d) => d.kind === "LASER_GROUP").length,
      zipAssetId: zipRow.id,
      contentRetained: files.every((file) => file.status === "READY"),
    },
  });

  return { revisionId: revision.id, dateKey, sequence, files, reused: false };
}

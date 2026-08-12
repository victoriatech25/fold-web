import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { serverDocumentToBrowserFoldProfileV4 } from "@/domain/fold-document/adapter";
import { validateFoldDocumentCapability } from "@/domain/fold-document/capabilities";
import { createManufacturingGeometry } from "@/domain/manufacturing-geometry";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { writeAuditEvent } from "@/server/audit/audit-writer";
import { requirePermission } from "@/server/authorization/authorization";
import { createDxfDocument } from "@/server/dxf/dxf-writer";
import { FoldDraftServiceError } from "@/server/fold-draft/fold-draft-error";
import { readFoldRevisionDocument } from "@/server/fold-document/revision-contract";

export type DxfExportResult = {
  assetId: string;
  fileName: string;
  content: string;
  checksumSha256: string;
  sizeBytes: number;
  entityCount: number;
};

function safeFileStem(name: string) {
  const normalized = name.normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim();
  return (normalized || "fold-drawing").slice(0, 180);
}

export async function exportFoldRevisionDxf(
  database: PrismaClient,
  context: AuthenticatedContext,
  input: { revisionId: string; requestId?: string },
): Promise<DxfExportResult> {
  requirePermission(context, "output.print");
  const revision = await database.foldRevision.findFirst({
    where: {
      id: input.revisionId,
      organizationId: context.organizationId,
      deletedAt: null,
      template: { deletedAt: null, active: true },
    },
    select: {
      id: true,
      name: true,
      createdAt: true,
      updatedAt: true,
      documentSchemaVersion: true,
      document: true,
      documentChecksumSha256: true,
      materialRuleRevisionId: true,
    },
  });
  if (!revision) {
    throw new FoldDraftServiceError("NOT_FOUND", "DXF로 출력할 절곡 초안을 찾을 수 없습니다.");
  }

  const document = readFoldRevisionDocument(revision);
  const capability = validateFoldDocumentCapability(document, "dxf");
  if (!capability.supported) {
    throw new FoldDraftServiceError("INVALID_REQUEST", "현재 문서에는 DXF로 출력할 수 없는 제작 주석이 있습니다.", {
      issues: capability.issues,
    });
  }
  const profile = serverDocumentToBrowserFoldProfileV4(document, {
    id: revision.id,
    createdAt: revision.createdAt.toISOString(),
    updatedAt: revision.updatedAt.toISOString(),
  });
  const manufacturing = createManufacturingGeometry(profile);
  if (!manufacturing.valid || !manufacturing.geometry) {
    throw new FoldDraftServiceError("INVALID_REQUEST", "DXF 제조 형상을 생성할 수 없습니다.");
  }
  const dxf = createDxfDocument(manufacturing.geometry);
  const fileName = `${safeFileStem(revision.name)}.dxf`;
  const storageKey = [
    "generated",
    context.organizationId,
    "dxf",
    `${dxf.checksumSha256}.dxf`,
  ].join("/");
  const assetMetadata = {
    delivery: "DIRECT_RESPONSE",
    sourceRevisionId: revision.id,
    documentChecksumSha256: revision.documentChecksumSha256,
    geometryVersion: manufacturing.geometry.version,
    writerVersion: dxf.version,
    acadVersion: dxf.acadVersion,
    unit: dxf.unit,
    layers: dxf.layers,
    entityCount: dxf.entityCount,
  };
  const asset = await database.fileAsset.upsert({
    where: { storageKey },
    create: {
      organizationId: context.organizationId,
      kind: "DXF",
      status: "READY",
      storageKey,
      fileName,
      mediaType: "application/dxf",
      sizeBytes: BigInt(dxf.sizeBytes),
      checksumSha256: dxf.checksumSha256,
      uploadedById: context.userId,
      metadata: assetMetadata,
    },
    update: {
      status: "READY",
      fileName,
      sizeBytes: BigInt(dxf.sizeBytes),
      uploadedById: context.userId,
      deletedAt: null,
      metadata: assetMetadata,
    },
    select: { id: true },
  });
  await writeAuditEvent(database, {
    organizationId: context.organizationId,
    actorUserId: context.userId,
    action: "fold.dxf_exported",
    entityId: asset.id,
    requestId: input.requestId,
    metadata: {
      sourceRevisionId: revision.id,
      documentChecksumSha256: revision.documentChecksumSha256,
      dxfChecksumSha256: dxf.checksumSha256,
      geometryVersion: manufacturing.geometry.version,
      writerVersion: dxf.version,
      sizeBytes: dxf.sizeBytes,
      entityCount: dxf.entityCount,
    },
  });
  return {
    assetId: asset.id,
    fileName,
    content: dxf.content,
    checksumSha256: dxf.checksumSha256,
    sizeBytes: dxf.sizeBytes,
    entityCount: dxf.entityCount,
  };
}

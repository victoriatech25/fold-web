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
import type { FileStorage } from "@/server/storage/file-storage";
import { getFileStorage } from "@/server/storage/s3-file-storage";

export type DxfExportResult = {
  assetId: string;
  fileName: string;
  content: string;
  checksumSha256: string;
  sizeBytes: number;
  entityCount: number;
  /** 바이트를 저장소에 보관했는지. 저장에 실패해도 출력 자체는 막지 않는다. */
  contentRetained: boolean;
};

function safeFileStem(name: string) {
  const normalized = name.normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim();
  return (normalized || "fold-drawing").slice(0, 180);
}

export async function exportFoldRevisionDxf(
  database: PrismaClient,
  context: AuthenticatedContext,
  input: { revisionId: string; requestId?: string },
  storage?: FileStorage,
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
  // 저장소가 죽어도 DXF 출력 자체는 멈추지 않는다. 응답으로 바이트를 내보내고
  // 보관 실패만 남긴다. 다음 출력에서 같은 키로 다시 시도한다.
  let contentRetained = true;
  let storageFailure: string | null = null;
  try {
    // 저장소 설정이 없거나 연결이 안 되는 환경에서도 출력 자체는 계속되어야 하므로
    // client 생성까지 이 try 안에서 한다.
    await (storage ?? getFileStorage()).put({
      key: storageKey,
      body: new TextEncoder().encode(dxf.content),
      mediaType: "application/dxf",
      checksumSha256: dxf.checksumSha256,
      fileName,
    });
  } catch (error) {
    contentRetained = false;
    storageFailure = error instanceof Error ? error.message : "저장소 오류";
    console.error("DXF storage write failed", { revisionId: revision.id, error });
  }

  const assetMetadata = {
    delivery: contentRetained ? "STORED" : "DIRECT_RESPONSE",
    contentRetained,
    storageFailure,
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
      // 바이트가 저장되지 않았으면 아직 내려받을 수 없다.
      status: contentRetained ? "READY" : "PENDING",
      storageKey,
      fileName,
      mediaType: "application/dxf",
      sizeBytes: BigInt(dxf.sizeBytes),
      checksumSha256: dxf.checksumSha256,
      uploadedById: context.userId,
      metadata: assetMetadata,
    },
    update: {
      status: contentRetained ? "READY" : "PENDING",
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
      contentRetained,
    },
  });
  return {
    assetId: asset.id,
    fileName,
    content: dxf.content,
    checksumSha256: dxf.checksumSha256,
    sizeBytes: dxf.sizeBytes,
    entityCount: dxf.entityCount,
    contentRetained,
  };
}

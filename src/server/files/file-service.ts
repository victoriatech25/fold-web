import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import type { FileAssetKind, PrismaClient } from "@/generated/prisma/client";
import { writeAuditEvent } from "@/server/audit/audit-writer";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { requirePermission } from "@/server/authorization/authorization";
import { readStorageRuntimeConfig } from "@/server/config/storage-env";
import { extensionOf, fileKindPolicy } from "@/server/files/file-kind";
import { FileError } from "@/server/files/file-error";
import { keyBelongsToOrganization, uploadObjectKey } from "@/server/storage/file-storage";
import type { FileStorage } from "@/server/storage/file-storage";
import { getFileStorage } from "@/server/storage/s3-file-storage";
import { StorageError } from "@/server/storage/storage-error";

const fileSelect = {
  id: true,
  kind: true,
  status: true,
  storageKey: true,
  fileName: true,
  mediaType: true,
  sizeBytes: true,
  checksumSha256: true,
  metadata: true,
  uploadedById: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.FileAssetSelect;

type FileRow = Prisma.FileAssetGetPayload<{ select: typeof fileSelect }>;

export type FileAssetDto = ReturnType<typeof toFileDto>;

function toFileDto(row: FileRow) {
  return {
    id: row.id,
    kind: row.kind,
    kindLabel: fileKindPolicy(row.kind).label,
    status: row.status,
    fileName: row.fileName,
    mediaType: row.mediaType,
    sizeBytes: Number(row.sizeBytes),
    checksumSha256: row.checksumSha256,
    uploadedById: row.uploadedById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const checksumPattern = /^[0-9a-f]{64}$/;

export type StartUploadInput = {
  kind: FileAssetKind;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
  checksumSha256: string;
  requestId: string;
};

export type StartUploadResult = {
  file: FileAssetDto;
  upload: { url: string; expiresAt: string };
};

/**
 * 업로드를 시작한다(`D2-B02-F`).
 * `PENDING` 행과 presigned PUT URL만 내주고, 실제 바이트 검증은 완료 단계에서 한다.
 */
export async function startUpload(
  database: PrismaClient,
  context: AuthenticatedContext,
  input: StartUploadInput,
  storage: FileStorage = getFileStorage(),
): Promise<StartUploadResult> {
  const policy = fileKindPolicy(input.kind);
  if (!policy.userUploadable) {
    throw new FileError("INVALID_REQUEST", `${policy.label}은 서버가 만드는 파일이라 직접 올릴 수 없습니다.`);
  }
  requirePermission(context, policy.uploadPermission);

  const fileName = input.fileName.trim();
  if (!fileName || fileName.length > 255) {
    throw new FileError("INVALID_REQUEST", "파일 이름을 확인해 주세요.");
  }
  const extension = extensionOf(fileName);
  if (!extension || !policy.extensions.includes(extension)) {
    throw new FileError(
      "INVALID_REQUEST",
      `${policy.label}은 ${policy.extensions.join(", ")} 형식만 올릴 수 있습니다.`,
    );
  }
  if (!policy.mediaTypes.includes(input.mediaType)) {
    throw new FileError("INVALID_REQUEST", "허용하지 않는 파일 형식입니다.");
  }
  if (!checksumPattern.test(input.checksumSha256)) {
    throw new FileError("INVALID_REQUEST", "파일 checksum 형식이 올바르지 않습니다.");
  }
  const limit = Math.min(policy.maxBytes, readStorageRuntimeConfig().maxFileBytes);
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > limit) {
    throw new FileError(
      "INVALID_REQUEST",
      `${policy.label}은 ${Math.floor(limit / (1024 * 1024))}MB까지 올릴 수 있습니다.`,
    );
  }

  const fileId = randomUUID();
  const storageKey = uploadObjectKey({
    organizationId: context.organizationId,
    fileId,
    extension,
  });
  const created = await database.fileAsset.create({
    data: {
      id: fileId,
      organizationId: context.organizationId,
      kind: input.kind,
      status: "PENDING",
      storageKey,
      fileName,
      mediaType: input.mediaType,
      sizeBytes: BigInt(input.sizeBytes),
      checksumSha256: input.checksumSha256,
      uploadedById: context.userId,
    },
    select: fileSelect,
  });

  const signed = await storage.signUploadUrl({
    key: storageKey,
    mediaType: input.mediaType,
    maxBytes: input.sizeBytes,
  });

  return {
    file: toFileDto(created),
    upload: { url: signed.url, expiresAt: signed.expiresAt.toISOString() },
  };
}

/**
 * 업로드 완료를 확인한다(`D2-B02-F`, `D2-B02-H`).
 * 크기와 checksum을 서버가 직접 확인하고, 어긋나면 `READY`로 올리지 않는다.
 */
export async function completeUpload(
  database: PrismaClient,
  context: AuthenticatedContext,
  fileId: string,
  requestId: string,
  storage: FileStorage = getFileStorage(),
): Promise<FileAssetDto> {
  const row = await database.fileAsset.findFirst({
    where: { id: fileId, organizationId: context.organizationId, deletedAt: null },
    select: fileSelect,
  });
  if (!row) throw new FileError("NOT_FOUND", "파일을 찾을 수 없습니다.");
  const policy = fileKindPolicy(row.kind);
  requirePermission(context, policy.uploadPermission);
  if (row.status === "READY") return toFileDto(row);
  if (row.status !== "PENDING") {
    throw new FileError("CONFLICT", "이미 처리가 끝난 파일입니다.");
  }

  const head = await storage.head(row.storageKey);
  if (!head) {
    throw new FileError("CONFLICT", "업로드가 아직 끝나지 않았습니다.");
  }

  // presigned PUT 으로 올라온 바이트에는 서버가 넣은 checksum이 없다.
  // 내용을 직접 읽어 대조한다. 크기 상한이 있으므로 메모리에 담아도 된다.
  const actualChecksum =
    head.checksumSha256 ?? createHash("sha256").update(await storage.get(row.storageKey)).digest("hex");
  const expectedSize = Number(row.sizeBytes);
  const matches = head.sizeBytes === expectedSize && actualChecksum === row.checksumSha256;

  if (!matches) {
    // 깨진 바이트를 남겨두지 않는다. 다시 올리면 새 파일로 시작한다.
    await storage.delete(row.storageKey).catch(() => undefined);
    await database.fileAsset.update({
      where: { id: row.id },
      data: {
        status: "FAILED",
        metadata: {
          failure: "CHECKSUM_OR_SIZE_MISMATCH",
          expectedSizeBytes: expectedSize,
          actualSizeBytes: head.sizeBytes,
        },
      },
    });
    await writeAuditEvent(database, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "file.upload_rejected",
      entityId: row.id,
      requestId,
      metadata: {
        kind: row.kind,
        expectedSizeBytes: expectedSize,
        actualSizeBytes: head.sizeBytes,
        checksumMatched: actualChecksum === row.checksumSha256,
      },
    });
    throw new FileError("CONFLICT", "업로드한 내용이 checksum·크기와 일치하지 않습니다. 다시 올려 주세요.");
  }

  const ready = await database.fileAsset.update({
    where: { id: row.id },
    data: { status: "READY" },
    select: fileSelect,
  });
  await writeAuditEvent(database, {
    organizationId: context.organizationId,
    actorUserId: context.userId,
    action: "file.uploaded",
    entityId: row.id,
    requestId,
    metadata: {
      kind: row.kind,
      sizeBytes: expectedSize,
      checksumSha256: row.checksumSha256,
    },
  });
  return toFileDto(ready);
}

/** 파일 metadata 조회. 조직 경계를 서버에서 다시 본다(`D2-B02-D`). */
export async function getFile(
  database: PrismaClient,
  context: AuthenticatedContext,
  fileId: string,
): Promise<FileAssetDto> {
  const row = await database.fileAsset.findFirst({
    where: { id: fileId, organizationId: context.organizationId, deletedAt: null },
    select: fileSelect,
  });
  if (!row) throw new FileError("NOT_FOUND", "파일을 찾을 수 없습니다.");
  requirePermission(context, fileKindPolicy(row.kind).downloadPermission);
  return toFileDto(row);
}

export function isStorageUnavailable(error: unknown): boolean {
  return error instanceof StorageError && error.code === "UNAVAILABLE";
}

export type DownloadTicket = {
  file: FileAssetDto;
  download: { url: string; expiresAt: string };
};

/**
 * 다운로드 URL 을 발급한다(`D2-B02-E`).
 * 권한과 조직 경계를 발급 시점에 검사하고, 누가 언제 받아 갔는지 감사에 남긴다(`D2-B02-L`).
 */
export async function issueDownloadUrl(
  database: PrismaClient,
  context: AuthenticatedContext,
  fileId: string,
  requestId: string,
  storage: FileStorage = getFileStorage(),
): Promise<DownloadTicket> {
  const row = await database.fileAsset.findFirst({
    where: { id: fileId, organizationId: context.organizationId, deletedAt: null },
    select: fileSelect,
  });
  if (!row) throw new FileError("NOT_FOUND", "파일을 찾을 수 없습니다.");
  requirePermission(context, fileKindPolicy(row.kind).downloadPermission);
  if (row.status !== "READY") {
    throw new FileError("CONFLICT", "아직 받을 수 있는 상태가 아닙니다.");
  }
  // 키에 실린 조직이 다르면 DB 가 어떻든 발급하지 않는다.
  if (!keyBelongsToOrganization(row.storageKey, context.organizationId)) {
    throw new FileError("NOT_FOUND", "파일을 찾을 수 없습니다.");
  }

  const signed = await storage.signDownloadUrl({
    key: row.storageKey,
    fileName: row.fileName,
    mediaType: row.mediaType,
  });
  await writeAuditEvent(database, {
    organizationId: context.organizationId,
    actorUserId: context.userId,
    action: "file.download_url_issued",
    entityId: row.id,
    requestId,
    metadata: { kind: row.kind, expiresAt: signed.expiresAt.toISOString() },
  });
  return {
    file: toFileDto(row),
    download: { url: signed.url, expiresAt: signed.expiresAt.toISOString() },
  };
}

/** soft delete 유예 일수와 재생성 가능한 산출물의 보존 일수(`D2-B02-I`, `D2-B02-J`). */
export const deleteGraceDays = 30;
export const regenerableRetentionDays = 90;

/**
 * 화면에서 지우면 `deletedAt`만 찍는다(`D2-B02-I`).
 * 객체는 유예 기간 동안 남아 있어 실수로 지운 도면을 되돌릴 시간이 있다.
 */
export async function deleteFile(
  database: PrismaClient,
  context: AuthenticatedContext,
  fileId: string,
  requestId: string,
): Promise<FileAssetDto> {
  const row = await database.fileAsset.findFirst({
    where: { id: fileId, organizationId: context.organizationId, deletedAt: null },
    select: fileSelect,
  });
  if (!row) throw new FileError("NOT_FOUND", "파일을 찾을 수 없습니다.");
  // 지우는 것은 올릴 수 있는 사람만 한다. 조회 권한만으로는 지울 수 없다.
  requirePermission(context, fileKindPolicy(row.kind).uploadPermission);

  const now = new Date();
  const purgeAfter = new Date(now.getTime() + deleteGraceDays * 24 * 60 * 60 * 1_000);
  const deleted = await database.fileAsset.update({
    where: { id: row.id },
    data: { status: "DELETED", deletedAt: now },
    select: fileSelect,
  });
  await writeAuditEvent(database, {
    organizationId: context.organizationId,
    actorUserId: context.userId,
    action: "file.deleted",
    entityId: row.id,
    requestId,
    metadata: { kind: row.kind, purgeAfter: purgeAfter.toISOString() },
  });
  return toFileDto(deleted);
}

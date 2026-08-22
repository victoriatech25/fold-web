import "server-only";

import { StorageError } from "@/server/storage/storage-error";

export type StoredObjectHead = {
  sizeBytes: number;
  checksumSha256: string | null;
  mediaType: string | null;
};

export type PutObjectInput = {
  key: string;
  body: Uint8Array;
  mediaType: string;
  /** 저장 후 대조할 기대 checksum. 다르면 저장을 실패로 본다(`D2-B02-H`). */
  checksumSha256: string;
  fileName?: string;
};

/**
 * 업무 코드가 보는 유일한 저장소 계약이다(`D2-B02-B`).
 * 제품이 바뀌어도 이 인터페이스는 그대로 두고 구현만 바꾼다.
 */
export type FileStorage = {
  put: (input: PutObjectInput) => Promise<void>;
  get: (key: string) => Promise<Uint8Array>;
  head: (key: string) => Promise<StoredObjectHead | null>;
  delete: (key: string) => Promise<void>;
  /** 다운로드용 presigned URL. 만료는 저장소 설정을 따른다. */
  signDownloadUrl: (input: {
    key: string;
    fileName: string;
    mediaType: string;
  }) => Promise<{ url: string; expiresAt: Date }>;
  /** 업로드용 presigned PUT URL(`D2-B02-F`). */
  signUploadUrl: (input: {
    key: string;
    mediaType: string;
    maxBytes: number;
  }) => Promise<{ url: string; expiresAt: Date }>;
};

const keySegment = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const checksumPattern = /^[0-9a-f]{64}$/;

function requireExtension(extension: string): string {
  const normalized = extension.replace(/^\./, "").toLowerCase();
  if (!/^[a-z0-9]{1,10}$/.test(normalized)) {
    throw new StorageError("INVALID_REQUEST", "저장할 파일 확장자를 확인해 주세요.");
  }
  return normalized;
}

function requireOrganizationId(organizationId: string): string {
  if (!uuid.test(organizationId)) {
    throw new StorageError("INVALID_REQUEST", "조직 정보를 확인할 수 없습니다.");
  }
  return organizationId;
}

/**
 * 서버가 만든 산출물의 키다(`D2-B02-C`).
 * 내용이 같으면 checksum 도 같으므로 같은 객체를 다시 쓴다.
 */
export function generatedObjectKey(input: {
  organizationId: string;
  kind: string;
  checksumSha256: string;
  extension: string;
}): string {
  const kind = input.kind.toLowerCase();
  if (!keySegment.test(kind)) {
    throw new StorageError("INVALID_REQUEST", "저장할 파일 종류를 확인해 주세요.");
  }
  if (!checksumPattern.test(input.checksumSha256)) {
    throw new StorageError("INVALID_REQUEST", "파일 checksum 형식이 올바르지 않습니다.");
  }
  return [
    "generated",
    requireOrganizationId(input.organizationId),
    kind,
    `${input.checksumSha256}.${requireExtension(input.extension)}`,
  ].join("/");
}

/**
 * 사용자가 올린 파일의 키다(`D2-B02-C`).
 * 내용이 같아도 서로 다른 문서일 수 있으므로 파일 ID 로 구분한다.
 */
export function uploadObjectKey(input: {
  organizationId: string;
  fileId: string;
  extension: string;
  now?: Date;
}): string {
  if (!uuid.test(input.fileId)) {
    throw new StorageError("INVALID_REQUEST", "파일 정보를 확인할 수 없습니다.");
  }
  const now = input.now ?? new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return [
    "uploads",
    requireOrganizationId(input.organizationId),
    year,
    month,
    `${input.fileId}.${requireExtension(input.extension)}`,
  ].join("/");
}

/** 키에 실린 조직과 요청자의 조직이 같은지 본다(`D2-B02-D`). */
export function keyBelongsToOrganization(key: string, organizationId: string): boolean {
  const segments = key.split("/");
  if (segments.length < 3) return false;
  if (segments[0] !== "generated" && segments[0] !== "uploads") return false;
  return segments[1] === organizationId;
}

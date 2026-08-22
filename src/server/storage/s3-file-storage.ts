import "server-only";

import { createHash } from "node:crypto";

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { readStorageRuntimeConfig, type StorageRuntimeConfig } from "@/server/config/storage-env";
import type { FileStorage, PutObjectInput, StoredObjectHead } from "@/server/storage/file-storage";
import { StorageError } from "@/server/storage/storage-error";

type StorageGlobal = typeof globalThis & {
  foldWebStorage?: FileStorage;
};

const storageGlobal = globalThis as StorageGlobal;

function isNotFound(error: unknown): boolean {
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  const name = (error as { name?: string })?.name;
  return status === 404 || name === "NotFound" || name === "NoSuchKey";
}

function contentDisposition(fileName: string): string {
  // 한글 파일명이 헤더에서 깨지지 않도록 RFC 5987 형식을 함께 보낸다.
  const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function createS3FileStorage(config: StorageRuntimeConfig): FileStorage {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  function wrap(error: unknown, message: string): StorageError {
    if (error instanceof StorageError) return error;
    if (isNotFound(error)) return new StorageError("NOT_FOUND", "파일을 찾을 수 없습니다.", { cause: error });
    return new StorageError("UNAVAILABLE", message, { cause: error });
  }

  return {
    async put(input: PutObjectInput) {
      if (input.body.byteLength > config.maxFileBytes) {
        throw new StorageError("TOO_LARGE", "파일 크기가 허용 범위를 넘었습니다.");
      }
      const actual = createHash("sha256").update(input.body).digest("hex");
      if (actual !== input.checksumSha256) {
        // 저장 전에 막는다. 깨진 바이트를 장비로 보내지 않는다(`D2-B02-H`).
        throw new StorageError("CHECKSUM_MISMATCH", "파일 내용이 checksum과 일치하지 않습니다.");
      }
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: input.key,
            Body: input.body,
            ContentType: input.mediaType,
            ContentLength: input.body.byteLength,
            ChecksumSHA256: Buffer.from(actual, "hex").toString("base64"),
            Metadata: input.fileName ? { "original-name": encodeURIComponent(input.fileName) } : undefined,
          }),
        );
      } catch (error) {
        throw wrap(error, "파일을 저장하지 못했습니다.");
      }
    },

    async get(key: string) {
      try {
        const result = await client.send(
          new GetObjectCommand({ Bucket: config.bucket, Key: key }),
        );
        if (!result.Body) throw new StorageError("NOT_FOUND", "파일을 찾을 수 없습니다.");
        return new Uint8Array(await result.Body.transformToByteArray());
      } catch (error) {
        throw wrap(error, "파일을 읽지 못했습니다.");
      }
    },

    async head(key: string): Promise<StoredObjectHead | null> {
      try {
        const result = await client.send(
          // ChecksumMode 를 켜야 저장 때 넣은 SHA-256 이 응답에 실린다.
          new HeadObjectCommand({ Bucket: config.bucket, Key: key, ChecksumMode: "ENABLED" }),
        );
        return {
          sizeBytes: Number(result.ContentLength ?? 0),
          checksumSha256: result.ChecksumSHA256
            ? Buffer.from(result.ChecksumSHA256, "base64").toString("hex")
            : null,
          mediaType: result.ContentType ?? null,
        };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw wrap(error, "파일 정보를 읽지 못했습니다.");
      }
    },

    async delete(key: string) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
      } catch (error) {
        throw wrap(error, "파일을 삭제하지 못했습니다.");
      }
    },

    async signDownloadUrl({ key, fileName, mediaType }) {
      try {
        const url = await getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: config.bucket,
            Key: key,
            ResponseContentType: mediaType,
            ResponseContentDisposition: contentDisposition(fileName),
          }),
          { expiresIn: config.downloadUrlTtlSeconds },
        );
        return {
          url,
          expiresAt: new Date(Date.now() + config.downloadUrlTtlSeconds * 1_000),
        };
      } catch (error) {
        throw wrap(error, "다운로드 주소를 만들지 못했습니다.");
      }
    },

    async signUploadUrl({ key, mediaType, maxBytes }) {
      if (maxBytes > config.maxFileBytes) {
        throw new StorageError("TOO_LARGE", "파일 크기가 허용 범위를 넘었습니다.");
      }
      try {
        const url = await getSignedUrl(
          client,
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            ContentType: mediaType,
            ContentLength: maxBytes,
          }),
          { expiresIn: config.uploadUrlTtlSeconds },
        );
        return {
          url,
          expiresAt: new Date(Date.now() + config.uploadUrlTtlSeconds * 1_000),
        };
      } catch (error) {
        throw wrap(error, "업로드 주소를 만들지 못했습니다.");
      }
    },
  };
}

/**
 * bucket 이 없으면 만든다. 로컬과 테스트에서 사람이 콘솔을 열어 만들지 않아도
 * 되게 하려는 것이며, 운영에서는 이미 있는 bucket 을 확인하는 것으로 끝난다.
 */
export async function ensureBucket(config: StorageRuntimeConfig): Promise<void> {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
  } catch (error) {
    if (!isNotFound(error)) {
      throw new StorageError("UNAVAILABLE", "파일 저장소에 연결하지 못했습니다.", { cause: error });
    }
    await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
  }
}

export function getFileStorage(): FileStorage {
  storageGlobal.foldWebStorage ??= createS3FileStorage(readStorageRuntimeConfig());
  return storageGlobal.foldWebStorage;
}

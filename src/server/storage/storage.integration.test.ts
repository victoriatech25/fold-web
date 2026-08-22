import { createHash } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { readStorageRuntimeConfig } from "@/server/config/storage-env";
import { createS3FileStorage, ensureBucket } from "@/server/storage/s3-file-storage";
import { generatedObjectKey, uploadObjectKey } from "@/server/storage/file-storage";
import { StorageError } from "@/server/storage/storage-error";
import type { FileStorage } from "@/server/storage/file-storage";

// 실제 S3 호환 저장소가 떠 있을 때만 돈다. compose 의 `storage` 서비스를 쓴다.
const integration = process.env.RUN_STORAGE_INTEGRATION === "1" ? describe : describe.skip;

const organizationId = "8f1a0f6e-1c8a-4c1e-9a3e-2b7f7c9d4e11";
const otherOrganizationId = "11111111-1111-4111-8111-111111111111";

function sha256(body: Uint8Array) {
  return createHash("sha256").update(body).digest("hex");
}

integration.sequential("s3 file storage integration", () => {
  let storage: FileStorage;

  beforeAll(async () => {
    const config = readStorageRuntimeConfig();
    await ensureBucket(config);
    storage = createS3FileStorage(config);
  });

  it("저장한 바이트를 그대로 다시 읽는다", async () => {
    const body = new TextEncoder().encode("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n");
    const checksumSha256 = sha256(body);
    const key = generatedObjectKey({ organizationId, kind: "dxf", checksumSha256, extension: "dxf" });

    await storage.put({ key, body, mediaType: "application/dxf", checksumSha256, fileName: "제작 도면.dxf" });

    const read = await storage.get(key);
    expect(sha256(read)).toBe(checksumSha256);

    const head = await storage.head(key);
    expect(head?.sizeBytes).toBe(body.byteLength);
    expect(head?.checksumSha256).toBe(checksumSha256);
  });

  it("checksum이 다르면 저장하지 않는다", async () => {
    const body = new TextEncoder().encode("깨진 내용");
    const key = uploadObjectKey({
      organizationId,
      fileId: "0f2a1b3c-4d5e-4f60-8a71-9b2c3d4e5f60",
      extension: "txt",
    });
    await expect(
      storage.put({ key, body, mediaType: "text/plain", checksumSha256: "b".repeat(64) }),
    ).rejects.toMatchObject({ code: "CHECKSUM_MISMATCH" });
    expect(await storage.head(key)).toBeNull();
  });

  it("없는 객체는 head가 null이고 get은 NOT_FOUND다", async () => {
    const key = generatedObjectKey({
      organizationId,
      kind: "dxf",
      checksumSha256: "c".repeat(64),
      extension: "dxf",
    });
    expect(await storage.head(key)).toBeNull();
    await expect(storage.get(key)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("presigned URL로 내려받고 만료 시각을 함께 돌려준다", async () => {
    const body = new TextEncoder().encode("presigned download");
    const checksumSha256 = sha256(body);
    const key = generatedObjectKey({ organizationId, kind: "dxf", checksumSha256, extension: "dxf" });
    await storage.put({ key, body, mediaType: "application/dxf", checksumSha256 });

    const signed = await storage.signDownloadUrl({
      key,
      fileName: "제작 도면.dxf",
      mediaType: "application/dxf",
    });
    expect(signed.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const response = await fetch(signed.url);
    expect(response.status).toBe(200);
    expect(sha256(new Uint8Array(await response.arrayBuffer()))).toBe(checksumSha256);
  });

  it("presigned PUT URL로 올린 파일을 서버가 다시 확인한다", async () => {
    const body = new TextEncoder().encode("uploaded by client");
    const checksumSha256 = sha256(body);
    const key = uploadObjectKey({
      organizationId,
      fileId: "2b7f7c9d-4e11-4a2b-8c3d-4e5f60718293",
      extension: "txt",
    });

    const signed = await storage.signUploadUrl({
      key,
      mediaType: "text/plain",
      maxBytes: body.byteLength,
    });
    const upload = await fetch(signed.url, {
      method: "PUT",
      headers: { "content-type": "text/plain", "content-length": String(body.byteLength) },
      body,
    });
    expect(upload.status).toBe(200);

    const head = await storage.head(key);
    expect(head?.sizeBytes).toBe(body.byteLength);
    expect(sha256(await storage.get(key))).toBe(checksumSha256);
  });

  it("만료된 URL로는 받을 수 없다", async () => {
    const body = new TextEncoder().encode("만료 확인");
    const checksumSha256 = sha256(body);
    const key = generatedObjectKey({ organizationId, kind: "dxf", checksumSha256, extension: "dxf" });
    await storage.put({ key, body, mediaType: "application/dxf", checksumSha256 });

    // 만료를 1초로 잡은 별도 storage 로 서명한다.
    const shortLived = createS3FileStorage({
      ...readStorageRuntimeConfig(),
      downloadUrlTtlSeconds: 1,
    });
    const signed = await shortLived.signDownloadUrl({
      key,
      fileName: "만료.dxf",
      mediaType: "application/dxf",
    });
    expect((await fetch(signed.url)).status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const expired = await fetch(signed.url);
    expect(expired.status).toBeGreaterThanOrEqual(400);
  });

  it("삭제한 객체는 사라진다", async () => {
    const body = new TextEncoder().encode("to be deleted");
    const checksumSha256 = sha256(body);
    const key = generatedObjectKey({ organizationId, kind: "dxf", checksumSha256, extension: "dxf" });
    await storage.put({ key, body, mediaType: "application/dxf", checksumSha256 });
    await storage.delete(key);
    expect(await storage.head(key)).toBeNull();
  });

  it("다른 조직의 키는 애초에 만들어지지 않는다", () => {
    const key = generatedObjectKey({
      organizationId: otherOrganizationId,
      kind: "dxf",
      checksumSha256: "d".repeat(64),
      extension: "dxf",
    });
    expect(key.startsWith(`generated/${otherOrganizationId}/`)).toBe(true);
    expect(() =>
      generatedObjectKey({ organizationId: "", kind: "dxf", checksumSha256: "d".repeat(64), extension: "dxf" }),
    ).toThrow(StorageError);
  });
});

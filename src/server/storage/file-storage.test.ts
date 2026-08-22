import { describe, expect, it } from "vitest";

import { readStorageRuntimeConfig, StorageEnvironmentError } from "@/server/config/storage-env";
import {
  generatedObjectKey,
  keyBelongsToOrganization,
  uploadObjectKey,
} from "@/server/storage/file-storage";
import { StorageError } from "@/server/storage/storage-error";

const organizationId = "8f1a0f6e-1c8a-4c1e-9a3e-2b7f7c9d4e11";
const checksum = "a".repeat(64);

const baseEnvironment = {
  STORAGE_ENDPOINT: "http://127.0.0.1:9000",
  STORAGE_BUCKET: "fold-web-local",
  STORAGE_ACCESS_KEY_ID: "key",
  STORAGE_SECRET_ACCESS_KEY: "secret",
};

describe("storage object key", () => {
  it("생성물 키는 조직과 checksum으로 만든다", () => {
    expect(
      generatedObjectKey({ organizationId, kind: "DXF", checksumSha256: checksum, extension: "dxf" }),
    ).toBe(`generated/${organizationId}/dxf/${checksum}.dxf`);
  });

  it("같은 내용이면 같은 키가 나와 중복 저장을 막는다", () => {
    const first = generatedObjectKey({ organizationId, kind: "dxf", checksumSha256: checksum, extension: ".DXF" });
    const second = generatedObjectKey({ organizationId, kind: "DXF", checksumSha256: checksum, extension: "dxf" });
    expect(first).toBe(second);
  });

  it("업로드 키는 연·월과 파일 ID로 만든다", () => {
    const fileId = "0f2a1b3c-4d5e-4f60-8a71-9b2c3d4e5f60";
    expect(
      uploadObjectKey({
        organizationId,
        fileId,
        extension: "pdf",
        now: new Date("2026-03-09T00:00:00.000Z"),
      }),
    ).toBe(`uploads/${organizationId}/2026/03/${fileId}.pdf`);
  });

  it("조직 ID나 확장자가 올바르지 않으면 키를 만들지 않는다", () => {
    expect(() =>
      generatedObjectKey({ organizationId: "not-a-uuid", kind: "dxf", checksumSha256: checksum, extension: "dxf" }),
    ).toThrow(StorageError);
    expect(() =>
      generatedObjectKey({ organizationId, kind: "dxf", checksumSha256: checksum, extension: "../../etc" }),
    ).toThrow(StorageError);
    expect(() =>
      generatedObjectKey({ organizationId, kind: "dxf", checksumSha256: "짧은값", extension: "dxf" }),
    ).toThrow(StorageError);
  });

  it("키의 조직 구간으로 다른 조직 파일을 걸러낸다", () => {
    const key = generatedObjectKey({ organizationId, kind: "dxf", checksumSha256: checksum, extension: "dxf" });
    expect(keyBelongsToOrganization(key, organizationId)).toBe(true);
    expect(keyBelongsToOrganization(key, "11111111-1111-4111-8111-111111111111")).toBe(false);
    expect(keyBelongsToOrganization(`other/${organizationId}/x`, organizationId)).toBe(false);
  });
});

describe("storage runtime config", () => {
  it("기본값을 채운다", () => {
    const config = readStorageRuntimeConfig(baseEnvironment);
    expect(config.region).toBe("us-east-1");
    expect(config.forcePathStyle).toBe(true);
    expect(config.downloadUrlTtlSeconds).toBe(300);
    expect(config.maxFileBytes).toBe(100 * 1024 * 1024);
  });

  it("필수 값이 없으면 기동 시점에 막는다", () => {
    expect(() => readStorageRuntimeConfig({ ...baseEnvironment, STORAGE_ENDPOINT: undefined })).toThrow(
      StorageEnvironmentError,
    );
    expect(() => readStorageRuntimeConfig({ ...baseEnvironment, STORAGE_SECRET_ACCESS_KEY: undefined })).toThrow(
      StorageEnvironmentError,
    );
  });

  it("주소와 bucket 이름 형식을 검사한다", () => {
    expect(() => readStorageRuntimeConfig({ ...baseEnvironment, STORAGE_ENDPOINT: "ftp://x" })).toThrow(
      StorageEnvironmentError,
    );
    expect(() => readStorageRuntimeConfig({ ...baseEnvironment, STORAGE_BUCKET: "Fold_Web" })).toThrow(
      StorageEnvironmentError,
    );
  });

  it("만료와 크기 상한은 양의 정수만 받는다", () => {
    expect(() =>
      readStorageRuntimeConfig({ ...baseEnvironment, STORAGE_DOWNLOAD_URL_TTL_SECONDS: "0" }),
    ).toThrow(StorageEnvironmentError);
    expect(() => readStorageRuntimeConfig({ ...baseEnvironment, STORAGE_MAX_FILE_BYTES: "-1" })).toThrow(
      StorageEnvironmentError,
    );
  });
});

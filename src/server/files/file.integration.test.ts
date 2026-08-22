import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { readStorageRuntimeConfig } from "@/server/config/storage-env";
import { disconnectPrisma, getPrisma } from "@/server/db/prisma";
import { FileError } from "@/server/files/file-error";
import {
  completeUpload,
  deleteFile,
  getFile,
  issueDownloadUrl,
  startUpload,
} from "@/server/files/file-service";
import { runStorageCleanup } from "@/server/files/file-cleanup";
import { createS3FileStorage, ensureBucket } from "@/server/storage/s3-file-storage";
import type { FileStorage } from "@/server/storage/file-storage";

// DB와 실제 저장소가 모두 필요하다.
const integration =
  process.env.RUN_DB_INTEGRATION === "1" && process.env.RUN_STORAGE_INTEGRATION === "1"
    ? describe
    : describe.skip;

function sha256(body: Uint8Array) {
  return createHash("sha256").update(body).digest("hex");
}

integration.sequential("file upload integration", () => {
  let prisma: PrismaClient;
  let storage: FileStorage;
  let context: AuthenticatedContext;
  let otherContext: AuthenticatedContext;

  async function grant(organizationCode: string, email: string, permissions: string[]) {
    const organization = await prisma.organization.create({
      data: { code: organizationCode, name: `${organizationCode} 조직` },
    });
    const user = await prisma.user.create({
      data: { email, normalizedEmail: email, displayName: "파일 담당자", status: "ACTIVE" },
    });
    const membership = await prisma.organizationMembership.create({
      data: { organizationId: organization.id, userId: user.id },
    });
    const role = await prisma.role.create({
      data: { organizationId: organization.id, key: `${organizationCode}-ROLE`, name: "파일 담당", system: false },
    });
    for (const key of permissions) {
      const permission = await prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key, description: key },
      });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    await prisma.membershipRole.create({ data: { membershipId: membership.id, roleId: role.id } });
    return {
      sessionId: randomUUID(),
      userId: user.id,
      displayName: user.displayName,
      membershipId: membership.id,
      departmentId: null,
      organizationId: organization.id,
      organizationCode: organization.code,
      organizationName: organization.name,
      roleKeys: [role.key],
      permissions: permissions as AuthenticatedContext["permissions"],
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    } satisfies AuthenticatedContext;
  }

  async function putSigned(url: string, body: Uint8Array, mediaType: string) {
    return fetch(url, {
      method: "PUT",
      headers: { "content-type": mediaType, "content-length": String(body.byteLength) },
      body: body.slice().buffer as ArrayBuffer,
    });
  }

  beforeAll(async () => {
    prisma = getPrisma();
    const config = readStorageRuntimeConfig();
    await ensureBucket(config);
    storage = createS3FileStorage(config);
    context = await grant("FILE-INTEGRATION", "file-integration@example.test", ["order.edit", "order.read"]);
    otherContext = await grant("FILE-OTHER", "file-other@example.test", ["order.edit", "order.read"]);
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("업로드를 시작하고 완료하면 READY가 된다", async () => {
    const body = new TextEncoder().encode("첨부 파일 내용");
    const started = await startUpload(
      prisma,
      context,
      {
        kind: "OTHER",
        fileName: "현장 사진.txt",
        mediaType: "text/plain",
        sizeBytes: body.byteLength,
        checksumSha256: sha256(body),
        requestId: "file-1",
      },
      storage,
    );
    expect(started.file.status).toBe("PENDING");
    expect(started.upload.url).toContain("uploads/");

    const uploaded = await putSigned(started.upload.url, body, "text/plain");
    expect(uploaded.status).toBe(200);

    const completed = await completeUpload(prisma, context, started.file.id, "file-1-complete", storage);
    expect(completed.status).toBe("READY");
    expect(completed.sizeBytes).toBe(body.byteLength);

    const audit = await prisma.auditEvent.findFirst({
      where: { organizationId: context.organizationId, action: "file.uploaded", entityId: started.file.id },
    });
    expect(audit).not.toBeNull();
  });

  it("올리지 않은 채 완료를 요청하면 PENDING으로 남는다", async () => {
    const body = new TextEncoder().encode("올리지 않은 파일");
    const started = await startUpload(
      prisma,
      context,
      {
        kind: "OTHER",
        fileName: "미완료.txt",
        mediaType: "text/plain",
        sizeBytes: body.byteLength,
        checksumSha256: sha256(body),
        requestId: "file-2",
      },
      storage,
    );
    await expect(
      completeUpload(prisma, context, started.file.id, "file-2-complete", storage),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const row = await prisma.fileAsset.findUniqueOrThrow({ where: { id: started.file.id } });
    expect(row.status).toBe("PENDING");
  });

  it("길이는 같고 내용이 다르면 READY가 되지 않고 객체도 지운다", async () => {
    // presigned URL 에 선언한 크기가 서명에 들어가므로 크기가 다르면 저장소가 먼저 거절한다.
    // 여기서는 크기가 같고 내용만 다른 경우, 즉 서버 checksum 검증이 유일한 방어선인 경우를 본다.
    const declared = new TextEncoder().encode("AAAAAAAAAA");
    const actual = new TextEncoder().encode("BBBBBBBBBB");
    const started = await startUpload(
      prisma,
      context,
      {
        kind: "OTHER",
        fileName: "불일치.txt",
        mediaType: "text/plain",
        sizeBytes: declared.byteLength,
        checksumSha256: sha256(declared),
        requestId: "file-3",
      },
      storage,
    );
    await putSigned(started.upload.url, actual, "text/plain");

    await expect(
      completeUpload(prisma, context, started.file.id, "file-3-complete", storage),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const row = await prisma.fileAsset.findUniqueOrThrow({ where: { id: started.file.id } });
    expect(row.status).toBe("FAILED");
    expect(await storage.head(row.storageKey)).toBeNull();

    const audit = await prisma.auditEvent.findFirst({
      where: { organizationId: context.organizationId, action: "file.upload_rejected", entityId: started.file.id },
    });
    expect(audit).not.toBeNull();
  });

  it("다른 조직의 파일은 조회도 완료도 할 수 없다", async () => {
    const body = new TextEncoder().encode("남의 조직 파일");
    const started = await startUpload(
      prisma,
      context,
      {
        kind: "OTHER",
        fileName: "경계.txt",
        mediaType: "text/plain",
        sizeBytes: body.byteLength,
        checksumSha256: sha256(body),
        requestId: "file-4",
      },
      storage,
    );
    await expect(getFile(prisma, otherContext, started.file.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      completeUpload(prisma, otherContext, started.file.id, "file-4-complete", storage),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("서버가 만드는 종류와 허용하지 않는 형식은 업로드를 막는다", async () => {
    const body = new TextEncoder().encode("x");
    await expect(
      startUpload(
        prisma,
        context,
        {
          kind: "DXF",
          fileName: "제작.dxf",
          mediaType: "application/dxf",
          sizeBytes: body.byteLength,
          checksumSha256: sha256(body),
          requestId: "file-5",
        },
        storage,
      ),
    ).rejects.toBeInstanceOf(FileError);

    await expect(
      startUpload(
        prisma,
        context,
        {
          kind: "OTHER",
          fileName: "실행파일.exe",
          mediaType: "application/octet-stream",
          sizeBytes: body.byteLength,
          checksumSha256: sha256(body),
          requestId: "file-6",
        },
        storage,
      ),
    ).rejects.toBeInstanceOf(FileError);
  });

  it("READY 파일은 다운로드 URL 로 그대로 받아진다", async () => {
    const body = new TextEncoder().encode("내려받을 첨부");
    const checksumSha256 = sha256(body);
    const started = await startUpload(
      prisma,
      context,
      {
        kind: "OTHER",
        fileName: "받을 파일.txt",
        mediaType: "text/plain",
        sizeBytes: body.byteLength,
        checksumSha256,
        requestId: "file-download-1",
      },
      storage,
    );
    await putSigned(started.upload.url, body, "text/plain");
    await completeUpload(prisma, context, started.file.id, "file-download-1-complete", storage);

    const ticket = await issueDownloadUrl(prisma, context, started.file.id, "file-download-1-url", storage);
    expect(ticket.download.expiresAt).toBeTruthy();

    const response = await fetch(ticket.download.url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("filename");
    expect(sha256(new Uint8Array(await response.arrayBuffer()))).toBe(checksumSha256);

    const audit = await prisma.auditEvent.findFirst({
      where: {
        organizationId: context.organizationId,
        action: "file.download_url_issued",
        entityId: started.file.id,
      },
    });
    expect(audit).not.toBeNull();
  });

  it("완료되지 않은 파일과 다른 조직 요청에는 URL 을 주지 않는다", async () => {
    const body = new TextEncoder().encode("아직 준비 안 됨");
    const started = await startUpload(
      prisma,
      context,
      {
        kind: "OTHER",
        fileName: "대기.txt",
        mediaType: "text/plain",
        sizeBytes: body.byteLength,
        checksumSha256: sha256(body),
        requestId: "file-download-2",
      },
      storage,
    );
    await expect(
      issueDownloadUrl(prisma, context, started.file.id, "file-download-2-url", storage),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      issueDownloadUrl(prisma, otherContext, started.file.id, "file-download-2-other", storage),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("다운로드 권한이 없으면 URL 을 주지 않는다", async () => {
    const body = new TextEncoder().encode("권한 확인용");
    const started = await startUpload(
      prisma,
      context,
      {
        kind: "OTHER",
        fileName: "권한확인.txt",
        mediaType: "text/plain",
        sizeBytes: body.byteLength,
        checksumSha256: sha256(body),
        requestId: "file-download-3",
      },
      storage,
    );
    await putSigned(started.upload.url, body, "text/plain");
    await completeUpload(prisma, context, started.file.id, "file-download-3-complete", storage);

    const stranger = { ...context, permissions: [] as AuthenticatedContext["permissions"] };
    await expect(
      issueDownloadUrl(prisma, stranger, started.file.id, "file-download-3-url", storage),
    ).rejects.toThrow();
  });

  async function uploadReady(fileName: string, contents: string) {
    const body = new TextEncoder().encode(contents);
    const started = await startUpload(
      prisma,
      context,
      {
        kind: "OTHER",
        fileName,
        mediaType: "text/plain",
        sizeBytes: body.byteLength,
        checksumSha256: sha256(body),
        requestId: `upload-${fileName}`,
      },
      storage,
    );
    await putSigned(started.upload.url, body, "text/plain");
    await completeUpload(prisma, context, started.file.id, `complete-${fileName}`, storage);
    return started.file.id;
  }

  it("삭제는 표시만 하고 객체는 유예 기간 동안 남는다", async () => {
    const fileId = await uploadReady("삭제대상.txt", "지울 파일");
    const deleted = await deleteFile(prisma, context, fileId, "delete-1");
    expect(deleted.status).toBe("DELETED");

    const row = await prisma.fileAsset.findUniqueOrThrow({ where: { id: fileId } });
    expect(row.deletedAt).not.toBeNull();
    // 객체는 아직 남아 있어야 되돌릴 수 있다.
    expect(await storage.head(row.storageKey)).not.toBeNull();

    // 목록·조회에서는 보이지 않는다.
    await expect(getFile(prisma, context, fileId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("유예가 끝나면 정리 작업이 객체를 실제로 지운다", async () => {
    const fileId = await uploadReady("유예만료.txt", "유예 지난 파일");
    await deleteFile(prisma, context, fileId, "delete-2");
    const row = await prisma.fileAsset.findUniqueOrThrow({ where: { id: fileId } });

    // 유예 안에는 건드리지 않는다.
    const early = await runStorageCleanup(
      prisma,
      { organizationId: context.organizationId, requestId: "cleanup-early" },
      storage,
    );
    expect(early.purgedDeleted).toBe(0);
    expect(await storage.head(row.storageKey)).not.toBeNull();

    // 31일 뒤 시점으로 보면 지운다.
    const later = new Date(Date.now() + 31 * 24 * 60 * 60 * 1_000);
    const result = await runStorageCleanup(
      prisma,
      { organizationId: context.organizationId, requestId: "cleanup-late", now: later },
      storage,
    );
    expect(result.purgedDeleted).toBeGreaterThanOrEqual(1);
    expect(await storage.head(row.storageKey)).toBeNull();

    const purged = await prisma.fileAsset.findUniqueOrThrow({ where: { id: fileId } });
    // 행은 남겨 무엇이 있었는지 추적할 수 있게 한다.
    expect((purged.metadata as Record<string, unknown>).purgeReason).toBe("DELETED_GRACE_EXPIRED");

    const audit = await prisma.auditEvent.findFirst({
      where: { organizationId: context.organizationId, action: "file.purged", entityId: fileId },
    });
    expect(audit).not.toBeNull();
  });

  it("보존 기간이 지나도 업로드본은 자동으로 지우지 않는다", async () => {
    const fileId = await uploadReady("오래된업로드.txt", "원본밖에 없는 파일");
    const row = await prisma.fileAsset.findUniqueOrThrow({ where: { id: fileId } });

    const farFuture = new Date(Date.now() + 400 * 24 * 60 * 60 * 1_000);
    await runStorageCleanup(
      prisma,
      { organizationId: context.organizationId, requestId: "cleanup-retention", now: farFuture },
      storage,
    );

    // OTHER 는 재생성할 수 없는 종류라 보존 기간 정리 대상이 아니다.
    expect(await storage.head(row.storageKey)).not.toBeNull();
    const kept = await prisma.fileAsset.findUniqueOrThrow({ where: { id: fileId } });
    expect(kept.deletedAt).toBeNull();
  });

  it("권한이 없으면 업로드를 시작할 수 없다", async () => {
    const viewer = await grant("FILE-VIEWER", "file-viewer@example.test", ["order.read"]);
    const body = new TextEncoder().encode("권한 없음");
    await expect(
      startUpload(
        prisma,
        viewer,
        {
          kind: "OTHER",
          fileName: "권한.txt",
          mediaType: "text/plain",
          sizeBytes: body.byteLength,
          checksumSha256: sha256(body),
          requestId: "file-7",
        },
        storage,
      ),
    ).rejects.toThrow();
  });
});

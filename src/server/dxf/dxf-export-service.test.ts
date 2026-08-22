import { describe, expect, it, vi } from "vitest";

import { browserFoldProfileV4ToServerDocumentV2 } from "@/domain/fold-document/adapter";
import { createFoldProfile, createFoldSegment } from "@/domain/fold-profile";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { prepareFoldRevisionDocument } from "@/server/fold-document/revision-contract";

import { exportFoldRevisionDxf } from "./dxf-export-service";

const context: AuthenticatedContext = {
  sessionId: "session-1",
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "테스트 관리자",
  membershipId: "22222222-2222-4222-8222-222222222222",
  departmentId: null,
  organizationId: "33333333-3333-4333-8333-333333333333",
  organizationCode: "TEST",
  organizationName: "테스트 조직",
  roleKeys: ["ADMIN"],
  permissions: ["output.print"],
  expiresAt: new Date("2026-07-27T00:00:00.000Z"),
};

describe("DXF export service", () => {
  it("creates a tenant-scoped metadata asset and audit event", async () => {
    const profile = createFoldProfile({
      id: "44444444-4444-4444-8444-444444444444",
      name: "테스트/도면",
      product: { length: 2400, quantity: 1 },
      material: { id: "55555555-5555-4555-8555-555555555555" },
    });
    profile.blocks[0].segments = [
      createFoldSegment({ x: 0, y: 0 }, { x: 100, y: 0 }),
    ];
    const prepared = prepareFoldRevisionDocument(
      browserFoldProfileV4ToServerDocumentV2(profile, profile.material.id),
    );
    const findFirst = vi.fn().mockResolvedValue({
      id: profile.id,
      name: profile.name,
      createdAt: new Date("2026-07-26T00:00:00.000Z"),
      updatedAt: new Date("2026-07-26T01:00:00.000Z"),
      ...prepared,
    });
    const upsert = vi.fn().mockResolvedValue({ id: "66666666-6666-4666-8666-666666666666" });
    const auditCreate = vi.fn().mockResolvedValue({ id: "audit-1" });
    const database = {
      foldRevision: { findFirst },
      fileAsset: { upsert },
      user: { findUnique: vi.fn().mockResolvedValue({ displayName: context.displayName, email: "test@example.test" }) },
      auditEvent: { create: auditCreate },
    };

    const put = vi.fn().mockResolvedValue(undefined);
    const storage = { put } as never;

    const result = await exportFoldRevisionDxf(
      database as never,
      context,
      { revisionId: profile.id, requestId: "request-1" },
      storage,
    );

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: context.organizationId }),
    }));
    expect(result.fileName).toBe("테스트-도면.dxf");
    expect(result.content).toContain("AC1015");
    expect(result.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ kind: "DXF", status: "READY" }),
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "fold.dxf_exported" }),
    }));
    // 바이트를 저장소에 보관한다(`P2-B02`).
    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({ mediaType: "application/dxf", checksumSha256: result.checksumSha256 }),
    );
    expect(result.contentRetained).toBe(true);
  });

  it("저장소가 실패해도 DXF 출력 자체는 막지 않는다", async () => {
    const profile = createFoldProfile({
      id: "44444444-4444-4444-8444-444444444444",
      name: "테스트/도면",
      product: { length: 2400, quantity: 1 },
      material: { id: "55555555-5555-4555-8555-555555555555" },
    });
    profile.blocks[0].segments = [createFoldSegment({ x: 0, y: 0 }, { x: 100, y: 0 })];
    const prepared = prepareFoldRevisionDocument(
      browserFoldProfileV4ToServerDocumentV2(profile, profile.material.id),
    );
    const findFirst = vi.fn().mockResolvedValue({
      id: profile.id,
      name: profile.name,
      createdAt: new Date("2026-07-26T00:00:00.000Z"),
      updatedAt: new Date("2026-07-26T01:00:00.000Z"),
      ...prepared,
    });
    const upsert = vi.fn().mockResolvedValue({ id: "66666666-6666-4666-8666-666666666666" });
    const database = {
      foldRevision: { findFirst },
      fileAsset: { upsert },
      user: { findUnique: vi.fn().mockResolvedValue({ displayName: context.displayName, email: "test@example.test" }) },
      auditEvent: { create: vi.fn().mockResolvedValue({ id: "audit-2" }) },
    };
    const storage = { put: vi.fn().mockRejectedValue(new Error("저장소 연결 실패")) } as never;

    const result = await exportFoldRevisionDxf(
      database as never,
      context,
      { revisionId: profile.id, requestId: "request-2" },
      storage,
    );

    // 사용자는 여전히 DXF를 받는다. 다만 아직 내려받을 수 있는 상태는 아니다.
    expect(result.content).toContain("AC1015");
    expect(result.contentRetained).toBe(false);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ status: "PENDING" }),
    }));
  });
});

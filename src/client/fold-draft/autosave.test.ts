import { afterEach, describe, expect, it, vi } from "vitest";

import { FoldDraftAutosaveController } from "./autosave";
import type { ServerFoldDocument, ServerFoldDocumentV1 } from "@/domain/fold-document/schema";
import type { FoldDraftDetailDto } from "@/server/fold-draft/fold-draft-types";

function document(name: string, length = "100"): ServerFoldDocumentV1 {
  return {
    schemaVersion: 1,
    documentType: "normal",
    name,
    product: { lengthMm: "1000", quantity: 1 },
    material: {
      ruleRevisionId: "00000000-0000-4000-8000-000000000001",
      name: "재질",
      thicknessMm: "1",
      insideBendRadiusMm: "1",
      cutAngleDeg: "135",
      elongationMm: { vCut: "0.6", aCut: "0.4", noCut: "1" },
      cutDepthMm: { vCut: "0.5", aCut: "0.5", noCut: "0" },
    },
    calculation: {
      mode: "fixed",
      elongationOption: "standard",
      vCutEnabled: true,
      decimalPlaces: 1,
      decimalOperation: "round",
    },
    variables: [],
    blocks: [{
      id: "block-1",
      name: "면 1",
      order: 1,
      segments: [{
        id: "segment-1",
        order: 1,
        geometry: {
          kind: "line",
          start: { xMm: "0", yMm: "0" },
          end: { xMm: length, yMm: "0" },
          direction: "e",
        },
        nominalLengthMm: length,
      }],
    }],
  };
}

function detail(
  source: ServerFoldDocument,
  lockVersion = 1,
): FoldDraftDetailDto {
  return {
    draftId: "00000000-0000-4000-8000-000000000010",
    templateId: "00000000-0000-4000-8000-000000000011",
    name: source.name,
    documentType: source.documentType,
    lockVersion,
    checksumSha256: `${lockVersion}`.repeat(64),
    createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
    createdBy: null,
    updatedBy: null,
    document: source,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("FoldDraftAutosaveController", () => {
  it("debounces changes and saves the latest document", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async ({ document: source }: { document: ServerFoldDocument }) =>
      detail(source, 2));
    const statuses: string[] = [];
    const controller = new FoldDraftAutosaveController({
      initial: detail(document("초기")),
      delayMs: 1_000,
      save,
      writeRecovery: vi.fn(async () => undefined),
      deleteRecovery: vi.fn(async () => undefined),
      onStatus: (status) => statuses.push(status.kind),
    });

    controller.update(document("변경 1", "110"));
    controller.update(document("변경 2", "120"));
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(999);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({
      expectedLockVersion: 1,
      document: { name: "변경 2" },
    });
    expect(controller.currentStatus.kind).toBe("clean");
    expect(statuses).toContain("saving");
  });

  it("queues a change made while a save is in flight", async () => {
    vi.useFakeTimers();
    let releaseFirst!: (value: FoldDraftDetailDto) => void;
    const first = new Promise<FoldDraftDetailDto>((resolve) => {
      releaseFirst = resolve;
    });
    const save = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(({ document: source }) =>
        Promise.resolve(detail(source, 3)));
    const controller = new FoldDraftAutosaveController({
      initial: detail(document("초기")),
      delayMs: 10,
      save,
      writeRecovery: vi.fn(async () => undefined),
      deleteRecovery: vi.fn(async () => undefined),
      onStatus: vi.fn(),
    });

    const firstDocument = document("첫 저장", "110");
    controller.update(firstDocument);
    await vi.advanceTimersByTimeAsync(10);
    controller.update(document("두 번째 저장", "120"));
    releaseFirst(detail(firstDocument, 2));
    await Promise.resolve();
    await vi.runAllTimersAsync();

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toMatchObject({ expectedLockVersion: 2 });
    expect(controller.currentDocument.name).toBe("두 번째 저장");
  });

  it("stops automatic saving on a conflict", async () => {
    vi.useFakeTimers();
    const conflict = Object.assign(new Error("다른 화면에서 저장했습니다."), {
      status: 409,
      requestId: "conflict-request",
      conflict: {
        draftId: "00000000-0000-4000-8000-000000000010",
        lockVersion: 2,
        checksumSha256: "a".repeat(64),
        updatedAt: "2026-07-25T00:01:00.000Z",
        updatedBy: null,
      },
    });
    const save = vi.fn(async () => {
      throw conflict;
    });
    const controller = new FoldDraftAutosaveController({
      initial: detail(document("초기")),
      delayMs: 10,
      save,
      writeRecovery: vi.fn(async () => undefined),
      deleteRecovery: vi.fn(async () => undefined),
      onStatus: vi.fn(),
    });

    controller.update(document("충돌", "110"));
    await vi.advanceTimersByTimeAsync(10);
    expect(controller.currentStatus).toMatchObject({
      kind: "conflict",
      requestId: "conflict-request",
    });
    controller.update(document("충돌 후", "120"));
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("retries retryable server errors with backoff", async () => {
    vi.useFakeTimers();
    const retryable = Object.assign(new Error("일시 오류"), {
      status: 500,
      retryable: true,
    });
    const source = document("재시도", "110");
    const save = vi
      .fn()
      .mockRejectedValueOnce(retryable)
      .mockResolvedValueOnce(detail(source, 2));
    const controller = new FoldDraftAutosaveController({
      initial: detail(document("초기")),
      delayMs: 10,
      save,
      writeRecovery: vi.fn(async () => undefined),
      deleteRecovery: vi.fn(async () => undefined),
      onStatus: vi.fn(),
    });

    controller.update(source);
    await vi.advanceTimersByTimeAsync(10);
    expect(controller.currentStatus.kind).toBe("retrying");
    await vi.advanceTimersByTimeAsync(999);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect(controller.currentStatus.kind).toBe("clean");
  });
});

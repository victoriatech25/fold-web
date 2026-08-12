import { projectCanonicalJsonV1 } from "@/domain/fold-document/canonical";
import type { ServerFoldDocument } from "@/domain/fold-document/schema";
import type {
  FoldDraftConflictDto,
  FoldDraftDetailDto,
} from "@/server/fold-draft/fold-draft-types";

export type FoldDraftSaveStatus =
  | { kind: "clean"; message: string }
  | { kind: "dirty"; message: string }
  | { kind: "saving"; message: string }
  | { kind: "retrying"; message: string }
  | { kind: "offline"; message: string }
  | { kind: "invalid"; message: string; requestId?: string }
  | {
      kind: "conflict";
      message: string;
      conflict?: FoldDraftConflictDto;
      requestId?: string;
    };

export type AutosaveFailure = Error & {
  status?: number;
  retryable?: boolean;
  requestId?: string;
  conflict?: FoldDraftConflictDto;
};

type AutosaveOptions = {
  initial: FoldDraftDetailDto;
  delayMs?: number;
  save: (input: {
    expectedLockVersion: number;
    document: ServerFoldDocument;
  }) => Promise<FoldDraftDetailDto>;
  writeRecovery: (input: {
    document: ServerFoldDocument;
    baseLockVersion: number;
    baseChecksum: string;
  }) => Promise<void>;
  deleteRecovery: () => Promise<void>;
  onStatus: (status: FoldDraftSaveStatus) => void;
  onServerDocument?: (detail: FoldDraftDetailDto) => void;
};

export class FoldDraftAutosaveController {
  private readonly delayMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private saving = false;
  private retryAttempt = 0;
  private latestDocument: ServerFoldDocument;
  private latestCanonical: string;
  private serverCanonical: string;
  private lockVersion: number;
  private checksum: string;
  private status: FoldDraftSaveStatus = {
    kind: "clean",
    message: "저장됨",
  };

  constructor(private readonly options: AutosaveOptions) {
    this.delayMs = options.delayMs ?? 1_000;
    this.latestDocument = options.initial.document;
    this.latestCanonical = projectCanonicalJsonV1(options.initial.document);
    this.serverCanonical = this.latestCanonical;
    this.lockVersion = options.initial.lockVersion;
    this.checksum = options.initial.checksumSha256;
    options.onStatus(this.status);
  }

  get currentStatus(): FoldDraftSaveStatus {
    return this.status;
  }

  get currentDocument(): ServerFoldDocument {
    return this.latestDocument;
  }

  get currentLockVersion(): number {
    return this.lockVersion;
  }

  update(document: ServerFoldDocument): void {
    if (this.stopped || this.status.kind === "conflict") return;
    const canonical = projectCanonicalJsonV1(document);
    this.latestDocument = document;
    this.latestCanonical = canonical;
    if (canonical === this.serverCanonical) {
      this.clearTimer();
      this.setStatus({ kind: "clean", message: "저장됨" });
      void this.options.deleteRecovery();
      return;
    }
    this.setStatus({ kind: "dirty", message: "저장 대기" });
    void this.options.writeRecovery({
      document,
      baseLockVersion: this.lockVersion,
      baseChecksum: this.checksum,
    });
    this.schedule(this.delayMs);
  }

  async flush(): Promise<void> {
    if (
      this.stopped ||
      this.saving ||
      this.status.kind === "conflict" ||
      this.latestCanonical === this.serverCanonical
    ) {
      return;
    }
    this.clearTimer();
    const sentDocument = this.latestDocument;
    const sentCanonical = this.latestCanonical;
    const expectedLockVersion = this.lockVersion;
    this.saving = true;
    this.setStatus({ kind: "saving", message: "저장 중" });
    try {
      const saved = await this.options.save({
        expectedLockVersion,
        document: sentDocument,
      });
      this.retryAttempt = 0;
      this.lockVersion = saved.lockVersion;
      this.checksum = saved.checksumSha256;
      this.serverCanonical = projectCanonicalJsonV1(saved.document);
      this.options.onServerDocument?.(saved);
      if (this.latestCanonical === sentCanonical) {
        this.latestDocument = saved.document;
        this.latestCanonical = this.serverCanonical;
        this.setStatus({ kind: "clean", message: "저장됨" });
        await this.options.deleteRecovery();
      } else {
        this.setStatus({ kind: "dirty", message: "추가 변경 저장 대기" });
        void this.options.writeRecovery({
          document: this.latestDocument,
          baseLockVersion: this.lockVersion,
          baseChecksum: this.checksum,
        });
        this.schedule(0);
      }
    } catch (error) {
      const failure = error as AutosaveFailure;
      if (failure.status === 409) {
        this.setStatus({
          kind: "conflict",
          message: failure.message,
          conflict: failure.conflict,
          requestId: failure.requestId,
        });
      } else if (
        failure.status === 0 ||
        (typeof navigator !== "undefined" && navigator.onLine === false)
      ) {
        this.retryAttempt += 1;
        this.setStatus({ kind: "offline", message: "오프라인 · 로컬 보관 중" });
        this.scheduleRetry();
      } else if (failure.retryable) {
        this.retryAttempt += 1;
        this.setStatus({ kind: "retrying", message: "저장 재시도 대기" });
        this.scheduleRetry();
      } else {
        this.setStatus({
          kind: "invalid",
          message: failure.message,
          requestId: failure.requestId,
        });
      }
    } finally {
      this.saving = false;
    }
  }

  reset(detail: FoldDraftDetailDto): void {
    this.clearTimer();
    this.retryAttempt = 0;
    this.latestDocument = detail.document;
    this.latestCanonical = projectCanonicalJsonV1(detail.document);
    this.serverCanonical = this.latestCanonical;
    this.lockVersion = detail.lockVersion;
    this.checksum = detail.checksumSha256;
    this.setStatus({ kind: "clean", message: "저장됨" });
  }

  restore(
    document: ServerFoldDocument,
    baseLockVersion: number,
    baseChecksum: string,
  ): void {
    this.lockVersion = baseLockVersion;
    this.checksum = baseChecksum;
    this.latestDocument = document;
    this.latestCanonical = projectCanonicalJsonV1(document);
    this.setStatus({ kind: "dirty", message: "복구본 저장 대기" });
    this.schedule(0);
  }

  resume(): void {
    if (
      !this.stopped &&
      this.status.kind !== "conflict" &&
      this.latestCanonical !== this.serverCanonical
    ) {
      this.schedule(0);
    }
  }

  invalidate(message: string): void {
    this.clearTimer();
    this.setStatus({ kind: "invalid", message });
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer();
  }

  private scheduleRetry(): void {
    const seconds = Math.min(30, 2 ** Math.max(0, this.retryAttempt - 1));
    this.schedule(seconds * 1_000);
  }

  private schedule(delayMs: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private setStatus(status: FoldDraftSaveStatus): void {
    this.status = status;
    this.options.onStatus(status);
  }
}

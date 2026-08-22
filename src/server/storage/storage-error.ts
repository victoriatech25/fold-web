import "server-only";

export type StorageErrorCode =
  | "NOT_FOUND"
  | "INVALID_REQUEST"
  | "CHECKSUM_MISMATCH"
  | "TOO_LARGE"
  | "UNAVAILABLE";

/**
 * 저장 계층이 밖으로 내보내는 유일한 오류 타입이다.
 * SDK 오류를 그대로 흘리면 업무 코드가 제품에 묶인다(`D2-B02-B`).
 */
export class StorageError extends Error {
  readonly code: StorageErrorCode;

  constructor(code: StorageErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StorageError";
    this.code = code;
  }
}

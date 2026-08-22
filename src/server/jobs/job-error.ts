export class JobError extends Error {
  constructor(
    readonly code: "INVALID_REQUEST" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT",
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "JobError";
  }
}

/**
 * worker가 작업을 처리하다 던지는 오류. `retryable`이 false면 재시도해도 결과가
 * 같으므로 backoff 없이 바로 FAILED로 확정한다.
 */
export class JobExecutionError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "JobExecutionError";
  }
}

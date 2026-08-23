export class CuttingError extends Error {
  constructor(
    readonly code: "INVALID_REQUEST" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT",
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "CuttingError";
  }
}

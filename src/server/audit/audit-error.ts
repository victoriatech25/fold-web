export class AuditServiceError extends Error {
  constructor(
    readonly code: "INVALID_REQUEST" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "AuditServiceError";
  }
}

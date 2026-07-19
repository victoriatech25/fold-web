import "server-only";

export type AdminErrorCode =
  | "INVALID_REQUEST"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT";

export class AdminServiceError extends Error {
  constructor(
    readonly code: AdminErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AdminServiceError";
  }
}

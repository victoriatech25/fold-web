export type CustomerErrorCode =
  | "INVALID_REQUEST"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT";

export class CustomerError extends Error {
  constructor(
    readonly code: CustomerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CustomerError";
  }
}

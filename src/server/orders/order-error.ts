export class OrderError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT", message: string) {
    super(message);
    this.name = "OrderError";
  }
}

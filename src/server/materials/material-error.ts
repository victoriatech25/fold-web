export type MaterialErrorCode = "INVALID_REQUEST" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT";

export class MaterialError extends Error {
  constructor(readonly code: MaterialErrorCode, message: string) {
    super(message);
    this.name = "MaterialError";
  }
}

export type CompanySettingsErrorCode =
  | "INVALID_REQUEST"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT";

export class CompanySettingsError extends Error {
  constructor(
    readonly code: CompanySettingsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CompanySettingsError";
  }
}

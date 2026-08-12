export type PricingErrorCode =
  | "INVALID_REQUEST"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PRICE_NOT_CONFIGURED"
  | "PRICE_REVISION_NOT_EFFECTIVE"
  | "PRICE_SCOPE_CONFLICT"
  | "PRICE_INPUT_INVALID"
  | "PRICE_REVISION_LOCKED";

export class PricingError extends Error {
  constructor(readonly code: PricingErrorCode, message: string) {
    super(message);
    this.name = "PricingError";
  }
}

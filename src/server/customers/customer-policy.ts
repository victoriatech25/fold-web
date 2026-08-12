const CUSTOMER_SITE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,49}$/;

export function normalizeOptionalText(value?: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

export function normalizeCustomerName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}

export function normalizeBusinessRegistrationNumber(
  value?: string | null,
): string | null {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits || null;
}

export function normalizeCustomerSiteCode(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidCustomerSiteCode(value: string): boolean {
  return CUSTOMER_SITE_CODE_PATTERN.test(value);
}

export function formatCustomerCode(value: number): string {
  if (!Number.isSafeInteger(value) || value < 1 || value > 999_999) {
    throw new Error("Customer code counter is outside the supported range.");
  }
  return `C${value.toString().padStart(6, "0")}`;
}

export function encodeCustomerCursor(normalizedName: string, id: string): string {
  return Buffer.from(JSON.stringify({ normalizedName, id })).toString("base64url");
}

export function decodeCustomerCursor(
  value?: string,
): { normalizedName: string; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      normalizedName?: unknown;
      id?: unknown;
    };
    if (
      typeof parsed.normalizedName !== "string" ||
      typeof parsed.id !== "string" ||
      !parsed.normalizedName ||
      !parsed.id
    ) {
      throw new Error();
    }
    return { normalizedName: parsed.normalizedName, id: parsed.id };
  } catch {
    throw new Error("INVALID_CUSTOMER_CURSOR");
  }
}

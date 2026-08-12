const BUSINESS_SITE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,49}$/;

export function normalizeBusinessSiteCode(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidBusinessSiteCode(value: string): boolean {
  return BUSINESS_SITE_CODE_PATTERN.test(value);
}

export function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

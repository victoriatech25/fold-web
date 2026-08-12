import { normalizeDecimalString } from "@/domain/fold-document/decimal";

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,49}$/;
export const MATERIAL_DECIMAL_POLICY = { precision: 18, scale: 6 } as const;
export const POSITIVE_MATERIAL_DECIMAL_POLICY = { ...MATERIAL_DECIMAL_POLICY, min: "0.000001" } as const;
export const NON_NEGATIVE_MATERIAL_DECIMAL_POLICY = { ...MATERIAL_DECIMAL_POLICY, min: "0" } as const;

export function normalizeMaterialCode(value: string) { return value.trim().toUpperCase(); }
export function isValidMaterialCode(value: string) { return CODE_PATTERN.test(value); }
export function normalizeMaterialName(value: string) { return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR"); }
export function normalizeOptionalText(value?: string | null) { const result = value?.trim() ?? ""; return result || null; }
export function normalizePositiveDecimal(value: string) { return normalizeDecimalString(value.trim(), POSITIVE_MATERIAL_DECIMAL_POLICY); }
export function normalizeNonNegativeDecimal(value: string) { return normalizeDecimalString(value.trim(), NON_NEGATIVE_MATERIAL_DECIMAL_POLICY); }
export function encodeMaterialCursor(sortOrder: number, normalizedName: string, id: string) { return Buffer.from(JSON.stringify({ sortOrder, normalizedName, id })).toString("base64url"); }
export function decodeMaterialCursor(value?: string): { sortOrder: number; normalizedName: string; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Number.isInteger(parsed.sortOrder) || typeof parsed.normalizedName !== "string" || typeof parsed.id !== "string") throw new Error();
    return parsed;
  } catch { throw new Error("INVALID_MATERIAL_CURSOR"); }
}

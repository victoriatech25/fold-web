import { z } from "zod";

import type { FoldDocumentIssueCode } from "./errors";

export type DecimalPolicy = {
  precision: number;
  scale: number;
  min?: string;
  max?: string;
};

export class DecimalContractError extends Error {
  readonly code: Extract<
    FoldDocumentIssueCode,
    | "INVALID_DECIMAL"
    | "DECIMAL_SCALE_EXCEEDED"
    | "DECIMAL_PRECISION_EXCEEDED"
    | "DECIMAL_OUT_OF_RANGE"
    | "LOSSY_NUMBER_CONVERSION"
  >;

  constructor(code: DecimalContractError["code"], message: string) {
    super(message);
    this.name = "DecimalContractError";
    this.code = code;
  }
}

const DECIMAL_INPUT_PATTERN = /^-?\d+(?:\.\d+)?$/;

function parts(value: string) {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [integer, fraction = ""] = unsigned.split(".");
  return { negative, integer, fraction };
}

export function normalizeDecimalString(input: string, policy: DecimalPolicy): string {
  if (!DECIMAL_INPUT_PATTERN.test(input)) {
    throw new DecimalContractError(
      "INVALID_DECIMAL",
      "Decimal 값은 부호, 숫자와 선택적 소수점만 사용할 수 있습니다.",
    );
  }

  const parsed = parts(input);
  const integer = parsed.integer.replace(/^0+(?=\d)/, "");
  const fraction = parsed.fraction.replace(/0+$/, "");
  const zero = integer === "0" && fraction.length === 0;
  const canonical = `${parsed.negative && !zero ? "-" : ""}${integer}${
    fraction ? `.${fraction}` : ""
  }`;
  const canonicalParts = parts(canonical);
  const integerDigits = canonicalParts.integer === "0" ? 0 : canonicalParts.integer.length;

  if (canonicalParts.fraction.length > policy.scale) {
    throw new DecimalContractError(
      "DECIMAL_SCALE_EXCEEDED",
      `Decimal 소수 자리는 최대 ${policy.scale}자리입니다.`,
    );
  }
  if (integerDigits > policy.precision - policy.scale) {
    throw new DecimalContractError(
      "DECIMAL_PRECISION_EXCEEDED",
      `Decimal 정수 자리는 최대 ${policy.precision - policy.scale}자리입니다.`,
    );
  }
  if (policy.min !== undefined && compareCanonicalDecimals(canonical, policy.min) < 0) {
    throw new DecimalContractError(
      "DECIMAL_OUT_OF_RANGE",
      `Decimal 값은 ${policy.min} 이상이어야 합니다.`,
    );
  }
  if (policy.max !== undefined && compareCanonicalDecimals(canonical, policy.max) > 0) {
    throw new DecimalContractError(
      "DECIMAL_OUT_OF_RANGE",
      `Decimal 값은 ${policy.max} 이하여야 합니다.`,
    );
  }

  return canonical;
}

export function compareCanonicalDecimals(left: string, right: string): number {
  const leftParts = parts(left);
  const rightParts = parts(right);
  const scale = Math.max(leftParts.fraction.length, rightParts.fraction.length);
  const toScaledBigInt = (value: ReturnType<typeof parts>) => {
    const digits = `${value.integer}${value.fraction.padEnd(scale, "0")}`;
    const integer = BigInt(digits || "0");
    return value.negative ? -integer : integer;
  };
  const leftInteger = toScaledBigInt(leftParts);
  const rightInteger = toScaledBigInt(rightParts);
  return leftInteger < rightInteger ? -1 : leftInteger > rightInteger ? 1 : 0;
}

export function decimalStringSchema(policy: DecimalPolicy) {
  return z.string().transform((value, context) => {
    try {
      return normalizeDecimalString(value, policy);
    } catch (error) {
      const contractError = error as DecimalContractError;
      context.addIssue({
        code: "custom",
        message: contractError.message,
        params: { foldCode: contractError.code },
      });
      return z.NEVER;
    }
  });
}

export function numberToCanonicalDecimal(value: number, policy: DecimalPolicy): string {
  if (!Number.isFinite(value)) {
    throw new DecimalContractError(
      "LOSSY_NUMBER_CONVERSION",
      "유한한 number만 Decimal 문자열로 변환할 수 있습니다.",
    );
  }

  try {
    return normalizeDecimalString(String(value), policy);
  } catch (error) {
    const contractError = error as DecimalContractError;
    throw new DecimalContractError(
      contractError.code === "INVALID_DECIMAL" ? "LOSSY_NUMBER_CONVERSION" : contractError.code,
      contractError.message,
    );
  }
}

export function canonicalDecimalToLosslessNumber(value: string, policy: DecimalPolicy): number {
  const canonical = normalizeDecimalString(value, policy);
  const converted = Number(canonical);
  if (!Number.isFinite(converted)) {
    throw new DecimalContractError(
      "LOSSY_NUMBER_CONVERSION",
      "현재 편집기가 표현할 수 없는 Decimal 값입니다.",
    );
  }

  let roundTrip: string;
  try {
    roundTrip = normalizeDecimalString(String(converted), policy);
  } catch {
    throw new DecimalContractError(
      "LOSSY_NUMBER_CONVERSION",
      "현재 편집기로 변환하면 Decimal 정밀도가 손실됩니다.",
    );
  }
  if (roundTrip !== canonical) {
    throw new DecimalContractError(
      "LOSSY_NUMBER_CONVERSION",
      "현재 편집기로 변환하면 Decimal 정밀도가 손실됩니다.",
    );
  }
  return converted;
}

export const LENGTH_DECIMAL_POLICY = { precision: 18, scale: 6 } as const;
export const NON_NEGATIVE_LENGTH_DECIMAL_POLICY = {
  ...LENGTH_DECIMAL_POLICY,
  min: "0",
} as const;
export const POSITIVE_LENGTH_DECIMAL_POLICY = {
  ...LENGTH_DECIMAL_POLICY,
  min: "0.000001",
} as const;
export const ANGLE_DECIMAL_POLICY = {
  precision: 9,
  scale: 4,
  min: "0",
  max: "180",
} as const;

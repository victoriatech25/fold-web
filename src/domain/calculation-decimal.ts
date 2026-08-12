import type { DecimalOperation } from "./fold-profile";
import {
  LENGTH_DECIMAL_POLICY,
  numberToCanonicalDecimal,
} from "./fold-document/decimal";

export const FOLD_CALCULATION_ENGINE_VERSION = "decimal-v1" as const;
export const AREA_DECIMAL_PLACES = 8;

type FixedDecimal = {
  coefficient: bigint;
  scale: number;
};

const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const TEN = BigInt(10);
const pow10 = (power: number) => TEN ** BigInt(power);

function normalize(value: FixedDecimal): FixedDecimal {
  let { coefficient, scale } = value;
  while (scale > 0 && coefficient % TEN === ZERO) {
    coefficient /= TEN;
    scale -= 1;
  }
  return { coefficient: coefficient === ZERO ? ZERO : coefficient, scale };
}

function parseCanonical(value: string): FixedDecimal {
  const match = DECIMAL_PATTERN.exec(value);
  if (!match) throw new Error(`유효하지 않은 Decimal 값입니다: ${value}`);
  const fraction = match[3] ?? "";
  const coefficient = BigInt(`${match[1]}${match[2]}${fraction}`);
  return normalize({ coefficient, scale: fraction.length });
}

function align(left: FixedDecimal, right: FixedDecimal) {
  const scale = Math.max(left.scale, right.scale);
  return {
    left: left.coefficient * pow10(scale - left.scale),
    right: right.coefficient * pow10(scale - right.scale),
    scale,
  };
}

function add(left: FixedDecimal, right: FixedDecimal): FixedDecimal {
  const aligned = align(left, right);
  return normalize({
    coefficient: aligned.left + aligned.right,
    scale: aligned.scale,
  });
}

function subtract(left: FixedDecimal, right: FixedDecimal): FixedDecimal {
  const aligned = align(left, right);
  return normalize({
    coefficient: aligned.left - aligned.right,
    scale: aligned.scale,
  });
}

function multiply(left: FixedDecimal, right: FixedDecimal): FixedDecimal {
  return normalize({
    coefficient: left.coefficient * right.coefficient,
    scale: left.scale + right.scale,
  });
}

function multiplyInteger(value: FixedDecimal, multiplier: number): FixedDecimal {
  if (!Number.isSafeInteger(multiplier)) {
    throw new Error("Decimal 정수 곱은 안전한 정수만 사용할 수 있습니다.");
  }
  return normalize({
    coefficient: value.coefficient * BigInt(multiplier),
    scale: value.scale,
  });
}

function divideByPowerOfTen(value: FixedDecimal, power: number): FixedDecimal {
  return normalize({ coefficient: value.coefficient, scale: value.scale + power });
}

function quantize(
  value: FixedDecimal,
  places: number,
  operation: DecimalOperation,
): FixedDecimal {
  if (operation === "none" || value.scale <= places) return normalize(value);

  const divisor = pow10(value.scale - places);
  let coefficient = value.coefficient / divisor;
  const remainder = value.coefficient % divisor;
  if (remainder === ZERO) return normalize({ coefficient, scale: places });

  const direction = value.coefficient < ZERO ? -ONE : ONE;
  if (operation === "round") {
    const absoluteRemainder = remainder < ZERO ? -remainder : remainder;
    if (absoluteRemainder * TWO >= divisor) coefficient += direction;
  } else if (operation === "ceil") {
    // 레거시 wire 값 `ceil`은 수학적 ceil이 아니라 0에서 먼 방향의 올림이다.
    coefficient += direction;
  }
  // 레거시 wire 값 `floor`는 수학적 floor가 아니라 0 방향 버림이다.
  return normalize({ coefficient, scale: places });
}

function toCanonical(value: FixedDecimal): string {
  const normalized = normalize(value);
  const negative = normalized.coefficient < ZERO;
  const digits = (negative ? -normalized.coefficient : normalized.coefficient).toString();
  if (normalized.scale === 0) return `${negative ? "-" : ""}${digits}`;
  const padded = digits.padStart(normalized.scale + 1, "0");
  const integer = padded.slice(0, -normalized.scale);
  const fraction = padded.slice(-normalized.scale);
  return `${negative ? "-" : ""}${integer}.${fraction}`;
}

export function lengthNumberToCanonical(value: number): string {
  return numberToCanonicalDecimal(value, LENGTH_DECIMAL_POLICY);
}

export function addCanonicalDecimals(left: string, right: string): string {
  return toCanonical(add(parseCanonical(left), parseCanonical(right)));
}

export function subtractCanonicalDecimals(left: string, right: string): string {
  return toCanonical(subtract(parseCanonical(left), parseCanonical(right)));
}

export function quantizeCanonicalDecimal(
  value: string,
  places: number,
  operation: DecimalOperation,
): string {
  if (!Number.isInteger(places) || places < 0 || places > 8) {
    throw new Error("Decimal 소수 자리는 0~8 사이의 정수여야 합니다.");
  }
  return toCanonical(quantize(parseCanonical(value), places, operation));
}

export function multiplyCanonicalDecimals(left: string, right: string): string {
  return toCanonical(multiply(parseCanonical(left), parseCanonical(right)));
}

export function multiplyCanonicalDecimalByInteger(value: string, multiplier: number): string {
  return toCanonical(multiplyInteger(parseCanonical(value), multiplier));
}

export function squareMillimetresToSquareMetres(value: string): string {
  return toCanonical(divideByPowerOfTen(parseCanonical(value), 6));
}

export function divideCanonicalDecimalByPowerOfTen(
  value: string,
  power: number,
): string {
  if (!Number.isInteger(power) || power < 0) {
    throw new Error("Decimal 10의 거듭제곱 나눗셈 지수는 0 이상의 정수여야 합니다.");
  }
  return toCanonical(divideByPowerOfTen(parseCanonical(value), power));
}

export function divideCanonicalDecimals(
  dividend: string,
  divisor: string,
  places = 6,
): string {
  if (!Number.isInteger(places) || places < 0 || places > 8) {
    throw new Error("Decimal 나눗셈 소수 자리는 0~8 사이의 정수여야 합니다.");
  }
  const left = parseCanonical(dividend);
  const right = parseCanonical(divisor);
  if (right.coefficient === ZERO) throw new Error("Decimal 값을 0으로 나눌 수 없습니다.");
  const numerator = left.coefficient * pow10(places + right.scale);
  const denominator = right.coefficient * pow10(left.scale);
  let coefficient = numerator / denominator;
  const remainder = numerator % denominator;
  const absoluteRemainder = remainder < ZERO ? -remainder : remainder;
  const absoluteDenominator = denominator < ZERO ? -denominator : denominator;
  if (absoluteRemainder * TWO >= absoluteDenominator) {
    coefficient += (numerator < ZERO) !== (denominator < ZERO) ? -ONE : ONE;
  }
  return toCanonical({ coefficient, scale: places });
}

export function canonicalDecimalToNumber(value: string): number {
  const converted = Number(value);
  if (!Number.isFinite(converted)) throw new Error("Decimal 결과를 화면 숫자로 변환할 수 없습니다.");
  return Object.is(converted, -0) ? 0 : converted;
}

export function formatCanonicalDecimal(value: string, fractionDigits?: number): string {
  const canonical = toCanonical(parseCanonical(value));
  if (fractionDigits === undefined) return canonical;
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0) {
    throw new Error("표시 소수 자리는 0 이상의 정수여야 합니다.");
  }
  const [integer, fraction = ""] = canonical.split(".");
  if (fractionDigits === 0) return integer;
  return `${integer}.${fraction.padEnd(fractionDigits, "0").slice(0, fractionDigits)}`;
}

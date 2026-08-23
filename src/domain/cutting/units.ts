/**
 * 재단 기하 계산의 내부 단위(`D2-B03-B`).
 *
 * 길이는 mm 의 1/10^6 정수로 다룬다. Decimal 정책의 소수 6자리가 그대로 담기고,
 * 부동소수 오차로 경계 판정이 흔들리지 않는다. 검증 함수와 solver 가 같은 변환을
 * 써야 면적 문자열이 정확히 일치한다(`AREA_MISMATCH`).
 */

export const LENGTH_UNITS_PER_MM = BigInt(1_000_000);

const AREA_SCALE = BigInt(100_000_000);
// 1㎡ = 10^6 ㎟ = 10^6 × (10^6)^2 내부 단위² = 10^18.
const SQUARE_UNITS_PER_SQUARE_METRE = BigInt(10) ** BigInt(18);

/** 길이 문자열을 내부 정수 단위로 바꾼다. */
export function toUnits(value: string): bigint {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [integer, fraction = ""] = unsigned.split(".");
  const scaled = BigInt(`${integer}${fraction.padEnd(6, "0").slice(0, 6)}`);
  return negative ? -scaled : scaled;
}

/** 내부 정수 단위를 mm 문자열로 되돌린다. 소수 6자리까지 남긴다. */
export function unitsToMm(value: bigint): string {
  const negative = value < BigInt(0);
  const magnitude = negative ? -value : value;
  const integer = magnitude / LENGTH_UNITS_PER_MM;
  const fraction = (magnitude % LENGTH_UNITS_PER_MM)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  const body = fraction ? `${integer}.${fraction}` : `${integer}`;
  return negative && magnitude !== BigInt(0) ? `-${body}` : body;
}

/** 내부 단위 넓이를 ㎡ 문자열로 바꾼다. 소수 8자리까지 남긴다. */
export function squareUnitsToM2(value: bigint): string {
  const scaled = (value * AREA_SCALE) / SQUARE_UNITS_PER_SQUARE_METRE;
  const integer = scaled / AREA_SCALE;
  const fraction = (scaled % AREA_SCALE).toString().padStart(8, "0").replace(/0+$/, "");
  return fraction ? `${integer}.${fraction}` : `${integer}`;
}

/**
 * 사용 면적을 전체 면적으로 나눠 백분율 문자열로 만든다. 소수 2자리로 버림한다.
 * 전체가 0이면 나눌 수 없으므로 `0` 으로 본다.
 */
export function yieldPercent(used: bigint, total: bigint): string {
  if (total <= BigInt(0)) return "0";
  const scaled = (used * BigInt(10_000)) / total;
  const integer = scaled / BigInt(100);
  const fraction = (scaled % BigInt(100)).toString().padStart(2, "0").replace(/0+$/, "");
  return fraction ? `${integer}.${fraction}` : `${integer}`;
}

import { describe, expect, it } from "vitest";

import {
  addCanonicalDecimals,
  divideCanonicalDecimals,
  formatCanonicalDecimal,
  multiplyCanonicalDecimals,
  quantizeCanonicalDecimal,
  squareMillimetresToSquareMetres,
} from "./calculation-decimal";

describe("decimal-v1 고정 소수점 연산", () => {
  it("부동소수점 오차 없이 덧셈과 곱셈을 수행한다", () => {
    expect(addCanonicalDecimals("0.1", "0.2")).toBe("0.3");
    expect(multiplyCanonicalDecimals("0.1", "0.2")).toBe("0.02");
    expect(squareMillimetresToSquareMetres("573600")).toBe("0.5736");
  });

  it("면적 환산 비율을 지정 자리에서 Decimal 반올림한다", () => {
    expect(divideCanonicalDecimals("1", "3", 3)).toBe("0.333");
    expect(divideCanonicalDecimals("2.9768", "1.98", 3)).toBe("1.503");
  });

  it("절반값을 양수와 음수 모두 0에서 먼 방향으로 반올림한다", () => {
    expect(quantizeCanonicalDecimal("1.005", 2, "round")).toBe("1.01");
    expect(quantizeCanonicalDecimal("-1.005", 2, "round")).toBe("-1.01");
  });

  it("wire floor는 0 방향 버림, wire ceil은 0에서 먼 방향 올림이다", () => {
    expect(quantizeCanonicalDecimal("1.239", 2, "floor")).toBe("1.23");
    expect(quantizeCanonicalDecimal("-1.239", 2, "floor")).toBe("-1.23");
    expect(quantizeCanonicalDecimal("1.231", 2, "ceil")).toBe("1.24");
    expect(quantizeCanonicalDecimal("-1.231", 2, "ceil")).toBe("-1.24");
  });

  it("처리 안 함은 원래 Decimal을 유지하고 표시 자리만 안전하게 채운다", () => {
    expect(quantizeCanonicalDecimal("12.3456", 2, "none")).toBe("12.3456");
    expect(formatCanonicalDecimal("12.3", 4)).toBe("12.3000");
  });
});

import { describe, expect, it } from "vitest";

import { BACKOFF_CAP_MS, backoffDelayMs } from "@/server/jobs/job-runtime";

describe("job backoff", () => {
  it("doubles the delay from the first retry and caps it", () => {
    // attempt는 claim에서 1부터 시작하므로 첫 실패의 대기는 기본값 그대로다.
    expect(backoffDelayMs(1)).toBe(10_000);
    expect(backoffDelayMs(2)).toBe(20_000);
    expect(backoffDelayMs(3)).toBe(40_000);
    expect(backoffDelayMs(4)).toBe(80_000);
    expect(backoffDelayMs(7)).toBe(640_000 > BACKOFF_CAP_MS ? BACKOFF_CAP_MS : 640_000);
  });

  it("never returns more than the cap or less than the base", () => {
    for (let attempt = 0; attempt <= 40; attempt += 1) {
      const delay = backoffDelayMs(attempt);
      expect(delay).toBeGreaterThanOrEqual(10_000);
      expect(delay).toBeLessThanOrEqual(BACKOFF_CAP_MS);
    }
  });

  it("caps very large attempt counts without overflowing", () => {
    expect(backoffDelayMs(1_000)).toBe(BACKOFF_CAP_MS);
    expect(Number.isFinite(backoffDelayMs(Number.MAX_SAFE_INTEGER))).toBe(true);
  });
});

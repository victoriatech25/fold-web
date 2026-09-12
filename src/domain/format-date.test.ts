import { describe, expect, it } from "vitest";

import {
  formatDate,
  formatDateTime,
  formatDateTimeSeconds,
  formatMonthDayTime,
  fromDateTimeLocalInput,
  toDateTimeLocalInput,
} from "@/domain/format-date";

describe("format-date", () => {
  // UTC 16:30 = KST 다음날 01:30. 서버가 UTC 여도 KST 로 찍혀야 한다.
  const value = "2026-09-12T16:30:05Z";

  it("Asia/Seoul 로 고정하고 로케일 문자열 없이 숫자 틀로 찍는다", () => {
    expect(formatDate(value)).toBe("2026-09-13");
    expect(formatDateTime(value)).toBe("2026-09-13 01:30");
    expect(formatDateTimeSeconds(value)).toBe("2026-09-13 01:30:05");
    expect(formatMonthDayTime(value)).toBe("09-13 01:30");
  });

  it("자정과 정오도 24시간제다", () => {
    expect(formatDateTime("2026-09-12T15:00:00Z")).toBe("2026-09-13 00:00");
    expect(formatDateTime("2026-09-12T03:00:00Z")).toBe("2026-09-12 12:00");
  });

  it("datetime-local 입력과 왕복한다", () => {
    expect(toDateTimeLocalInput(value)).toBe("2026-09-13T01:30");
    expect(fromDateTimeLocalInput("2026-09-13T01:30")).toBe("2026-09-12T16:30:00.000Z");
  });

  it("잘못된 값은 빈 문자열이다", () => {
    expect(formatDateTime("not a date")).toBe("");
  });
});

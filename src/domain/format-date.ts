/**
 * 화면에 보이는 날짜·시각은 전부 이 함수로 만든다(2026-09-08 점검 H2).
 *
 * 서버(컨테이너)와 브라우저의 시간대·ICU 가 달라 같은 값이 다르게 찍히던 것을 막는다.
 * 시간대는 Asia/Seoul 로 고정하고, 로케일 문자열(`오전`/`AM`, 구분자)에 기대지 않고
 * 숫자 조각을 정해진 틀에 끼운다. 그래서 Node 와 Chrome 이 같은 문자열을 내고
 * hydration 이 어긋나지 않는다.
 */
export const DISPLAY_TIME_ZONE = "Asia/Seoul";

type Parts = Record<string, string>;

function parts(value: Date, options: Intl.DateTimeFormatOptions): Parts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TIME_ZONE,
    hourCycle: "h23",
    ...options,
  });
  return Object.fromEntries(formatter.formatToParts(value).map((part) => [part.type, part.value]));
}

function toDate(value: string | number | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `2026-09-12` */
export function formatDate(value: string | number | Date): string {
  const date = toDate(value);
  if (!date) return "";
  const p = parts(date, { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${p.year}-${p.month}-${p.day}`;
}

/** `2026-09-12 13:08` */
export function formatDateTime(value: string | number | Date): string {
  const date = toDate(value);
  if (!date) return "";
  const p = parts(date, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** `2026-09-12 13:08:45` */
export function formatDateTimeSeconds(value: string | number | Date): string {
  const date = toDate(value);
  if (!date) return "";
  const p = parts(date, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** `09-12 13:08` — 업무 홈처럼 연도가 뻔한 자리. */
export function formatMonthDayTime(value: string | number | Date): string {
  const date = toDate(value);
  if (!date) return "";
  const p = parts(date, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  return `${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** `<input type="datetime-local">` 값(`2026-09-12T13:08`). KST 기준이다. */
export function toDateTimeLocalInput(value: string | number | Date): string {
  const date = toDate(value);
  if (!date) return "";
  return formatDateTime(date).replace(" ", "T");
}

/** `<input type="datetime-local">` 값을 KST 로 해석해 ISO 문자열로 돌린다. */
export function fromDateTimeLocalInput(value: string): string {
  return new Date(`${value}:00+09:00`).toISOString();
}

import { SheetUsagePanel } from "@/components/cutting/sheet-usage-panel";
import { requirePermissionPage } from "@/server/auth/auth-dal";
import { getPrisma } from "@/server/db/prisma";
import { summarizeSheetUsageByPeriod } from "@/server/cutting/sheet-usage-service";

export const dynamic = "force-dynamic";

/**
 * 오늘이 며칠인지는 KST 로 센다. `toISOString()` 을 쓰면 한국 새벽에 어제 날짜가 잡힌다.
 * 실적 조회 API 도 같은 기준으로 경계를 자른다.
 */
function seoulDateInput(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

/** 하루의 시작·끝을 KST 로 만든다. */
function seoulDayBoundary(dateInput: string, endOfDay: boolean): Date {
  return new Date(`${dateInput}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+09:00`);
}

/** 처음 열면 최근 한 달을 본다. 기간을 비워 두면 화면이 통째로 무거워진다. */
function defaultRange(): { fromInput: string; toInput: string } {
  const now = new Date();
  const monthAgo = new Date(now);
  monthAgo.setMonth(monthAgo.getMonth() - 1);
  return { fromInput: seoulDateInput(monthAgo), toInput: seoulDateInput(now) };
}

export default async function SheetUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ sheetItemId?: string }>;
}) {
  const auth = await requirePermissionPage("cutting.optimize");
  const { fromInput, toInput } = defaultRange();
  // 기준정보에서 원판 하나를 짚어 들어오면 그 원판만 본다.
  const { sheetItemId } = await searchParams;
  const initial = await summarizeSheetUsageByPeriod(getPrisma(), auth, {
    from: seoulDayBoundary(fromInput, false),
    to: seoulDayBoundary(toInput, true),
    sheetItemId,
  });
  return (
    <SheetUsagePanel
      initial={initial}
      initialFrom={fromInput}
      initialSheetItemId={sheetItemId ?? ""}
      initialTo={toInput}
    />
  );
}

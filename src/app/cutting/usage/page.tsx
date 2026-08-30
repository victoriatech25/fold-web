import { SheetUsagePanel } from "@/components/cutting/sheet-usage-panel";
import { requirePermissionPage } from "@/server/auth/auth-dal";
import { getPrisma } from "@/server/db/prisma";
import { summarizeSheetUsageByPeriod } from "@/server/cutting/sheet-usage-service";

export const dynamic = "force-dynamic";

/** 처음 열면 최근 한 달을 본다. 기간을 비워 두면 화면이 통째로 무거워진다. */
function defaultRange(): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - 1);
  return { from, to };
}

function toDateInput(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export default async function SheetUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ sheetItemId?: string }>;
}) {
  const auth = await requirePermissionPage("cutting.optimize");
  const { from, to } = defaultRange();
  // 기준정보에서 원판 하나를 짚어 들어오면 그 원판만 본다.
  const { sheetItemId } = await searchParams;
  const initial = await summarizeSheetUsageByPeriod(getPrisma(), auth, { from, to, sheetItemId });
  return (
    <SheetUsagePanel
      initial={initial}
      initialFrom={toDateInput(from)}
      initialSheetItemId={sheetItemId ?? ""}
      initialTo={toDateInput(to)}
    />
  );
}

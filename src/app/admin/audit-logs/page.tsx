import { randomUUID } from "node:crypto";

import { AuditLogPanel } from "@/components/admin/audit-log-panel";
import { listAuditEvents } from "@/server/audit/audit-service";
import { requirePermissionPage } from "@/server/auth/auth-dal";
import { getPrisma } from "@/server/db/prisma";

export default async function AdminAuditLogsPage() {
  const context = await requirePermissionPage("audit.read");
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 86_400_000);
  const data = await listAuditEvents(
    getPrisma(),
    context,
    { from, to, limit: 25 },
    randomUUID(),
  );

  return (
    <>
      <div className="mb-5">
        <h1 className="text-xl font-black">감사 로그</h1>
        <p className="mt-1 text-sm text-slate-600">
          인증, 관리자 변경과 접근 거부 이력을 조직 범위에서 확인합니다.
        </p>
      </div>
      <AuditLogPanel
        initialData={data}
        initialFrom={from.toISOString()}
        initialTo={to.toISOString()}
      />
    </>
  );
}

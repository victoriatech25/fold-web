import { getPrisma } from "@/server/db/prisma";
import { runHealthCheck } from "@/server/platform/health-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Docker HEALTHCHECK 와 deploy.sh 가 이 응답 코드로 배포 성공을 판정한다.
// DB 접속과 마이그레이션 적용 상태가 모두 맞아야 200 이고, 아니면 503 이다.
export async function GET() {
  const result = await runHealthCheck(getPrisma());
  return Response.json(result, {
    status: result.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}

import { handleFoldRevisionTransition, type FoldRevisionRouteContext } from "@/server/fold-library/fold-library-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: FoldRevisionRouteContext): Promise<Response> {
  return handleFoldRevisionTransition(request, context, "publish");
}

import { proxySession } from "@/lib/trading/session-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path: string[] }> };

async function handle(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { path } = await context.params;
    return await proxySession(request, path);
  } catch {
    return Response.json(
      { error: "Visitor session gateway is unavailable." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const GET = handle;
export const POST = handle;

import { bootstrapSession, closeSession } from "@/lib/trading/session-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    return await bootstrapSession(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Visitor session gateway is unavailable.";
    return Response.json({ error: message }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    return await closeSession(request);
  } catch {
    return Response.json(
      { error: "Could not close the visitor session." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

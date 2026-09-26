import { writeFile } from "node:fs/promises";
import path from "node:path";
import { validateSiteConfig } from "@/lib/site-config";

export const dynamic = "force-dynamic";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Writes web/src/site.config.json. Only `next dev` on this machine may use it; production has no write path. */
export async function POST(request: Request): Promise<Response> {
  if (process.env.NODE_ENV !== "development") return Response.json({ error: "Not found" }, { status: 404 });
  const host = new URL(request.url).hostname;
  const origin = request.headers.get("origin");
  if (!LOCAL_HOSTS.has(host) || (origin && !LOCAL_HOSTS.has(new URL(origin).hostname))) {
    return Response.json({ error: "Site config can only be written from this machine" }, { status: 403 });
  }
  try {
    const config = validateSiteConfig(await request.json());
    const file = path.join(process.cwd(), "src", "site.config.json");
    await writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
    return Response.json({ ok: true, config });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid site config" }, { status: 400 });
  }
}

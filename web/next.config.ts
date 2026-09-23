import type { NextConfig } from "next";
import os from "node:os";
import path from "node:path";

const lanHosts = Object.values(os.networkInterfaces())
  .flat()
  .filter((a) => a && a.family === "IPv4" && !a.internal)
  .map((a) => a!.address);

const nextConfig: NextConfig = {
  // The repo root also has a bun.lock; pin the workspace root to this app.
  turbopack: { root: path.resolve(__dirname) },
  // Agent rules live in the repo-root CLAUDE.md. Do not emit web/AGENTS.md.
  agentRules: false,
  allowedDevOrigins: ["127.0.0.1", "localhost", ...lanHosts],
};

export default nextConfig;

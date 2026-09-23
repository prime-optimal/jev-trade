export type Env = Record<string, string | undefined>;

declare global {
  var __JEV_RUNTIME_ENV__: Env | undefined;
}

/** Process environment by default; isolated workers inject an allowlisted object before this module loads. */
export const runtimeEnv: Env = globalThis.__JEV_RUNTIME_ENV__ ?? process.env;
const env = (key: string, fallback?: string) => runtimeEnv[key] ?? fallback;

export type JevProvider = "openrouter" | "typesafe" | "gateway";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api";

export function resolveJevProvider(e: Env): JevProvider {
  const explicit = e.JEV_PROVIDER?.trim().toLowerCase();
  if (explicit === "openrouter" || explicit === "typesafe" || explicit === "gateway") return explicit;
  if (explicit) throw new Error("JEV_PROVIDER must be openrouter, typesafe, or gateway");
  if (e.OPENROUTER_API_KEY?.trim()) return "openrouter";
  if (e.TYPESAFE_API_KEY?.trim()) return "typesafe";
  if (e.AI_GATEWAY_API_KEY?.trim()) return "gateway";
  return "openrouter";
}

export function resolveJevModelId(e: Env, provider: JevProvider): string {
  const set = e.JEV_MODEL_ID?.trim();
  if (set) return set;
  return provider === "gateway" ? "typesafe-ai/jev" : "jev-latest";
}

export function assertJevCredentials(
  model: string,
  provider: JevProvider,
  e: Env,
): void {
  if (model !== "jev") return;
  if (provider === "openrouter" && !e.OPENROUTER_API_KEY?.trim()) {
    throw new Error("MODEL=jev with JEV_PROVIDER=openrouter needs OPENROUTER_API_KEY. Get a key at https://openrouter.ai/settings/keys.");
  }
  if (provider === "typesafe" && !e.TYPESAFE_API_KEY?.trim()) {
    throw new Error("MODEL=jev with JEV_PROVIDER=typesafe needs TYPESAFE_API_KEY. Get a key at https://docs.typesafe.ai/ or set JEV_PROVIDER=gateway with AI_GATEWAY_API_KEY.");
  }
  if (provider === "gateway" && !e.AI_GATEWAY_API_KEY?.trim()) {
    throw new Error("MODEL=jev with JEV_PROVIDER=gateway needs AI_GATEWAY_API_KEY. Or set JEV_PROVIDER=openrouter with OPENROUTER_API_KEY.");
  }
}

const jevProvider = resolveJevProvider(runtimeEnv);
const production = env("NODE_ENV") === "production";

function integerSetting(key: string, fallback: number, min: number, max: number): number {
  const value = env(key);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!value.trim() || !Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${key} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

function webOrigins(): string[] {
  const configured = env("WEB_ORIGINS", production ? "" : "http://localhost:3001");
  return [...new Set(configured!.split(",").map((value) => value.trim()).filter(Boolean).map((value) => {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== value) {
      throw new Error("WEB_ORIGINS must contain exact http or https origins");
    }
    return value;
  }))];
}

const model = env("MODEL", "jev");
if (model !== "jev" && model !== "mock") throw new Error("MODEL must be jev or mock");
if (production && model !== "jev") throw new Error("Production requires MODEL=jev");

export const config = {
  model,
  production,
  jevProvider,
  jevModelId: resolveJevModelId(runtimeEnv, jevProvider),
  port: integerSetting("PORT", 3000, 1, 65535),
  webOrigins: webOrigins(),
  inferenceRatePerMinute: integerSetting("INFERENCE_RATE_PER_MINUTE", 300, 1, 6000),
  inferenceBurst: integerSetting("INFERENCE_BURST", 20, 1, 1000),
  inferenceConcurrency: integerSetting("INFERENCE_CONCURRENCY", 32, 1, 256),
  inferenceDeadlineMs: integerSetting("INFERENCE_DEADLINE_MS", 4000, 100, 30000),
};

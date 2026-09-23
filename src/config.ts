import { effectiveEndpoints, type TradingSettings } from "./settings";

const env = (key: string, fallback?: string) => process.env[key] ?? fallback;

export type JevProvider = "openrouter" | "typesafe" | "gateway";

export type Env = Record<string, string | undefined>;

export type HyperliquidEnv = {
  isTestnet: boolean;
  apiUrl: string;
  infoUrl: string;
  wsUrl: string;
  rpcUrl: string;
  headers: Record<string, string>;
  fallbackMs: number;
};

const HL_MAINNET_API = "https://api.hyperliquid.xyz";
const HL_TESTNET_API = "https://api.hyperliquid-testnet.xyz";
const HL_MAINNET_RPC = "https://rpc.hyperliquid.xyz";
const HL_TESTNET_RPC = "https://rpc.hyperliquid-testnet.xyz";

function endpoint(value: string | undefined, fallback: string): string {
  return (value?.trim() || fallback).replace(/\/+$/, "");
}

function apiInfoUrl(apiUrl: string): string {
  const info = new URL(apiUrl);
  info.pathname = `${info.pathname.replace(/\/+$/, "")}/info`;
  return info.toString();
}

function boundedMs(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

export function resolveHyperliquidEnv(e: Env, isTestnet: boolean): HyperliquidEnv {
  const apiUrl = endpoint(e.HL_API_URL, isTestnet ? HL_TESTNET_API : HL_MAINNET_API);
  const rpcUrl = endpoint(e.HL_RPC_URL, isTestnet ? HL_TESTNET_RPC : HL_MAINNET_RPC);
  const api = new URL(apiUrl);
  const rpc = new URL(rpcUrl);
  if (api.protocol !== "http:" && api.protocol !== "https:") throw new Error("HL_API_URL must use http or https");
  if (rpc.protocol !== "http:" && rpc.protocol !== "https:") throw new Error("HL_RPC_URL must use http or https");
  const derivedWs = `${apiUrl.replace(/^http/, "ws")}/ws`;
  const wsUrl = endpoint(e.HL_WS_URL, derivedWs);
  const ws = new URL(wsUrl);
  if (ws.protocol !== "ws:" && ws.protocol !== "wss:") throw new Error("HL_WS_URL must use ws or wss");
  const key = e.HL_API_KEY?.trim();
  const header = e.HL_API_KEY_HEADER?.trim() || "Authorization";
  const scheme = e.HL_API_KEY_SCHEME === undefined ? "Bearer" : e.HL_API_KEY_SCHEME.trim();
  return {
    isTestnet,
    apiUrl,
    infoUrl: apiInfoUrl(apiUrl),
    wsUrl,
    rpcUrl,
    headers: key ? { [header]: scheme ? `${scheme} ${key}` : key } : {},
    fallbackMs: boundedMs(e.HL_FALLBACK_POLL_MS, 30_000, 1_000, 300_000),
  };
}

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

const hlTestnet = env("HL_TESTNET", "true") !== "false";
const jevProvider = resolveJevProvider(process.env);
const hyperliquid = resolveHyperliquidEnv(process.env, hlTestnet);
const jevModelId = resolveJevModelId(process.env, jevProvider);

export const config = {
  hlTestnet,
  hyperliquid,
  tickMs: Number(env("TICK_MS", "30000")),
  /** Book/price prints for the chart. Independent of Jev ticks. */
  priceMs: Math.max(50, Number(env("PRICE_MS", "1000"))),
  explorerTx: hlTestnet
    ? "https://app.hyperliquid-testnet.xyz/explorer/tx/"
    : "https://app.hyperliquid.xyz/explorer/tx/",
  privateKey: env("PRIVATE_KEY"),
  dryRun: env("DRY_RUN", "true") !== "false",
  /** Target notional of one post-only quote. */
  quoteUsd: Number(env("QUOTE_USD", "40")),
  quoteInsideTicks: Number(env("QUOTE_INSIDE_TICKS", "1")),
  /** How far an Ioc exit crosses the touch so it fills on the spot. */
  closeSlippageBps: Number(env("CLOSE_SLIPPAGE_BPS", "5")),
  horizonBlocks: Number(env("HORIZON_BLOCKS", "100")),
  model: env("MODEL", "mock") as "mock" | "jev",
  /** openrouter = OpenRouter. typesafe = official TypeSafe API. gateway = Vercel AI Gateway. */
  jevProvider,
  jevModelId,
  jevUsdPerMTok: 0.042,
  port: Number(env("PORT", "3000")),
  historySize: 1000,
  bankrollUsd: Number(env("BANKROLL_USD", "200")),
};

/** Apply one already-validated snapshot. Call only while execution is stopped. */
export function applySettingsToConfig(settings: TradingSettings, apiKey?: string): void {
  const endpoints = effectiveEndpoints(settings);
  config.hlTestnet = settings.network === "testnet";
  config.dryRun = settings.mode === "paper";
  config.tickMs = settings.tickMs;
  config.priceMs = settings.priceMs;
  config.quoteUsd = settings.quoteUsd;
  config.quoteInsideTicks = settings.quoteInsideTicks;
  config.closeSlippageBps = settings.closeSlippageBps;
  config.horizonBlocks = settings.horizonBlocks;
  config.bankrollUsd = settings.bankrollUsd;
  config.explorerTx = config.hlTestnet
    ? "https://app.hyperliquid-testnet.xyz/explorer/tx/"
    : "https://app.hyperliquid.xyz/explorer/tx/";
  config.hyperliquid = {
    isTestnet: config.hlTestnet,
    apiUrl: endpoints.apiUrl,
    infoUrl: apiInfoUrl(endpoints.apiUrl),
    wsUrl: endpoints.wsUrl,
    rpcUrl: endpoints.rpcUrl,
    headers: apiKey
      ? {
          [settings.hyperliquidApiKeyHeader]: settings.hyperliquidApiKeyScheme
            ? `${settings.hyperliquidApiKeyScheme} ${apiKey}`
            : apiKey,
        }
      : {},
    fallbackMs: settings.fallbackMs,
  };
}

export function hexKey(key: string): `0x${string}` {
  return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
}

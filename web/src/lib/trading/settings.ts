import { deriveWebSocketUrl, NETWORK_ENDPOINTS, validateEndpoint, type TradingNetwork } from "./networks";

export const SUPPORTED_COINS = ["BTC", "ETH", "SOL", "DOGE", "BNB"] as const;
export type SupportedCoin = (typeof SUPPORTED_COINS)[number];

export interface TradingSettings {
  version: 1;
  network: TradingNetwork;
  mode: "paper" | "real";
  enabledCoins: SupportedCoin[];
  tickMs: number;
  priceMs: number;
  quoteUsd: number;
  quoteInsideTicks: number;
  closeSlippageBps: number;
  horizonBlocks: number;
  bankrollUsd: number;
  runDurationMinutes: number;
  hyperliquidApiUrl: string | null;
  hyperliquidWsUrl: string | null;
  hyperliquidApiKeyHeader: string;
  hyperliquidApiKeyScheme: string;
  fallbackMs: number;
  rpcUrl: string | null;
}

export type RunStatus = "off" | "starting" | "running" | "paused" | "stopping" | "expired" | "attention-required";

export interface RunSnapshot {
  runId: string | null;
  status: RunStatus;
  startedAt: number | null;
  deadlineAt: number | null;
  stoppedAt: number | null;
  durationMs: number;
  stopReason: string | null;
  serverNow: number;
}

export interface ConnectionValidation {
  ok: boolean;
  realAllowed: boolean;
  message: string;
  apiUrl: string;
  wsUrl: string;
  rpcUrl: string;
  checkedAt: number;
}

export const DEFAULT_SETTINGS: Readonly<TradingSettings> = Object.freeze({
  version: 1,
  network: "testnet",
  mode: "paper",
  enabledCoins: [...SUPPORTED_COINS],
  tickMs: 30_000,
  priceMs: 1_000,
  quoteUsd: 40,
  quoteInsideTicks: 1,
  closeSlippageBps: 5,
  horizonBlocks: 100,
  bankrollUsd: 200,
  runDurationMinutes: 30,
  hyperliquidApiUrl: null,
  hyperliquidWsUrl: null,
  hyperliquidApiKeyHeader: "Authorization",
  hyperliquidApiKeyScheme: "Bearer",
  fallbackMs: 30_000,
  rpcUrl: null,
});

const SETTINGS_KEYS: Record<keyof TradingSettings, true> = {
  version: true, network: true, mode: true, enabledCoins: true, tickMs: true, priceMs: true,
  quoteUsd: true, quoteInsideTicks: true, closeSlippageBps: true, horizonBlocks: true,
  bankrollUsd: true, runDurationMinutes: true, hyperliquidApiUrl: true, hyperliquidWsUrl: true,
  hyperliquidApiKeyHeader: true, hyperliquidApiKeyScheme: true, fallbackMs: true, rpcUrl: true,
};
const COINS: Record<SupportedCoin, true> = { BTC: true, ETH: true, SOL: true, DOGE: true, BNB: true };
const RESERVED_HEADERS: Record<string, true> = {
  host: true, cookie: true, "set-cookie": true, "content-length": true, origin: true,
  connection: true, "transfer-encoding": true, upgrade: true, "proxy-authorization": true,
  "proxy-authenticate": true,
};
const HEADER_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function objectInput(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("Settings must be an object");
  const value = input as Record<string, unknown>;
  for (const key of Object.keys(value)) if (!Object.hasOwn(SETTINGS_KEYS, key)) throw new Error(`Unknown settings field: ${key}`);
  for (const key of Object.keys(SETTINGS_KEYS)) if (!Object.hasOwn(value, key)) throw new Error(`Missing settings field: ${key}`);
  return value;
}

function choice<T extends string>(value: unknown, field: string, choices: readonly T[]): T {
  if (typeof value !== "string" || !choices.includes(value as T)) throw new Error(`${field} must be ${choices.join(" or ")}`);
  return value as T;
}

function numberIn(value: unknown, field: string, min: number, max: number, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field} must be a finite number`);
  if (integer && !Number.isInteger(value)) throw new Error(`${field} must be an integer`);
  if (value < min || value > max) throw new Error(`${field} must be between ${min} and ${max}`);
  return value;
}

function nullableEndpoint(value: unknown, field: "api" | "ws" | "rpc"): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error(`${field} URL must be a string or null`);
  if (!value.trim()) return null;
  return validateEndpoint(value, field);
}

function validateHeader(value: unknown): string {
  if (typeof value !== "string" || !HEADER_TOKEN.test(value)) throw new Error("hyperliquidApiKeyHeader must be a valid HTTP header name");
  if (RESERVED_HEADERS[value.toLowerCase()]) throw new Error(`${value} is a reserved HTTP header and cannot carry an API key`);
  return value;
}

function validateScheme(value: unknown): string {
  if (typeof value !== "string") throw new Error("hyperliquidApiKeyScheme must be a string");
  const trimmed = value.trim();
  if (/\r|\n/.test(value)) throw new Error("hyperliquidApiKeyScheme cannot contain line breaks");
  if (trimmed && !HEADER_TOKEN.test(trimmed)) throw new Error("hyperliquidApiKeyScheme must be one HTTP authentication token or blank");
  return trimmed;
}

export function validateApiKey(value: string): string {
  if (typeof value !== "string") throw new Error("API key must be a string");
  const trimmed = value.trim();
  if (!trimmed) throw new Error("API key cannot be blank");
  if (/\r|\n/.test(value)) throw new Error("API key cannot contain line breaks");
  return trimmed;
}

export function validateSettings(input: unknown): TradingSettings {
  const value = objectInput(input);
  const enabled = value.enabledCoins;
  if (!Array.isArray(enabled)) throw new Error("enabledCoins must be an array");
  const enabledCoins: SupportedCoin[] = [];
  const seen = new Set<SupportedCoin>();
  for (const coin of enabled) {
    if (typeof coin !== "string" || !Object.hasOwn(COINS, coin)) throw new Error(`Unsupported coin: ${String(coin)}`);
    if (!seen.has(coin as SupportedCoin)) { seen.add(coin as SupportedCoin); enabledCoins.push(coin as SupportedCoin); }
  }

  const runDurationMinutes = numberIn(value.runDurationMinutes, "runDurationMinutes", 1, Math.floor((Number.MAX_SAFE_INTEGER - Date.now()) / 60_000), true);
  const durationMs = runDurationMinutes * 60_000;
  if (!Number.isSafeInteger(durationMs) || !Number.isSafeInteger(Date.now() + durationMs)) throw new Error("runDurationMinutes is too large to produce a safe deadline");
  if (value.version !== 1) throw new Error("version must be 1");


  return {
    version: 1,
    network: choice(value.network, "network", ["testnet", "mainnet"]),
    mode: choice(value.mode, "mode", ["paper", "real"]),
    enabledCoins,
    tickMs: numberIn(value.tickMs, "tickMs", 5_000, 300_000, true),
    priceMs: numberIn(value.priceMs, "priceMs", 50, 5_000, true),
    quoteUsd: numberIn(value.quoteUsd, "quoteUsd", Number.MIN_VALUE, Number.MAX_VALUE),
    quoteInsideTicks: numberIn(value.quoteInsideTicks, "quoteInsideTicks", 0, 10, true),
    closeSlippageBps: numberIn(value.closeSlippageBps, "closeSlippageBps", 0, 100),
    horizonBlocks: numberIn(value.horizonBlocks, "horizonBlocks", 20, 400, true),
    bankrollUsd: numberIn(value.bankrollUsd, "bankrollUsd", Number.MIN_VALUE, Number.MAX_VALUE),
    runDurationMinutes,
    hyperliquidApiUrl: nullableEndpoint(value.hyperliquidApiUrl, "api"),
    hyperliquidWsUrl: nullableEndpoint(value.hyperliquidWsUrl, "ws"),
    hyperliquidApiKeyHeader: validateHeader(value.hyperliquidApiKeyHeader),
    hyperliquidApiKeyScheme: validateScheme(value.hyperliquidApiKeyScheme),
    fallbackMs: numberIn(value.fallbackMs, "fallbackMs", 1_000, 300_000, true),
    rpcUrl: nullableEndpoint(value.rpcUrl, "rpc"),
  };
}

export function effectiveEndpoints(settings: TradingSettings): { apiUrl: string; wsUrl: string; rpcUrl: string } {
  const defaults = NETWORK_ENDPOINTS[settings.network];
  const apiUrl = settings.hyperliquidApiUrl ?? defaults.apiUrl;
  return {
    apiUrl,
    wsUrl: settings.hyperliquidWsUrl ?? deriveWebSocketUrl(apiUrl),
    rpcUrl: settings.rpcUrl ?? defaults.rpcUrl,
  };
}

/** A transport change cannot silently retain authority granted for another route. */
export function authorizationChanged(previous: TradingSettings, next: TradingSettings): boolean {
  const before = effectiveEndpoints(previous);
  const after = effectiveEndpoints(next);
  return previous.network !== next.network
    || previous.mode !== next.mode
    || before.apiUrl !== after.apiUrl
    || before.wsUrl !== after.wsUrl
    || before.rpcUrl !== after.rpcUrl
    || previous.hyperliquidApiKeyHeader !== next.hyperliquidApiKeyHeader
    || previous.hyperliquidApiKeyScheme !== next.hyperliquidApiKeyScheme;
}

function mayContainCredential(raw: string): boolean {
  const url = new URL(raw);
  return Boolean(url.search) || (url.pathname !== "/" && url.pathname !== "/ws");
}

export function persistableSettings(settings: TradingSettings): TradingSettings {
  const valid = validateSettings(settings);
  return {
    ...valid,
    hyperliquidApiUrl: valid.hyperliquidApiUrl && !mayContainCredential(valid.hyperliquidApiUrl) ? valid.hyperliquidApiUrl : null,
    hyperliquidWsUrl: valid.hyperliquidWsUrl && !mayContainCredential(valid.hyperliquidWsUrl) ? valid.hyperliquidWsUrl : null,
    rpcUrl: null,
  };
}

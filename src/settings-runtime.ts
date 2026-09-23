import { applySettingsToConfig, config, type Env } from "./config";
import {
  DEFAULT_SETTINGS,
  effectiveEndpoints,
  validateApiKey,
  validateSettings,
  type ConnectionValidation,
  type OperatorSnapshot,
  type RunSnapshot,
  type TradingSettings,
} from "./settings";

export interface LifecycleControl {
  snapshot(): RunSnapshot;
  start(): Promise<RunSnapshot>;
  stop(reason?: string): Promise<RunSnapshot>;
  reconcile(): Promise<RunSnapshot>;
  applyDuration(minutes: number): void;
}

export interface SettingsRuntimeOptions {
  lifecycle: LifecycleControl;
  rebuild(settings: TradingSettings, apiKey?: string): Promise<void>;
  env?: Env;
}

type EndpointField = "hyperliquidApiUrl" | "hyperliquidWsUrl" | "rpcUrl";
const ENDPOINT_FIELDS: Record<EndpointField, true> = {
  hyperliquidApiUrl: true,
  hyperliquidWsUrl: true,
  rpcUrl: true,
};

function clearedEndpointFields(input: unknown): EndpointField[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new Error("clearedEndpoints must be an array");
  const fields: EndpointField[] = [];
  for (const field of input) {
    if (typeof field !== "string" || !ENDPOINT_FIELDS[field as EndpointField]) {
      throw new Error("clearedEndpoints may contain only URL setting fields");
    }
    if (!fields.includes(field as EndpointField)) fields.push(field as EndpointField);
  }
  return fields;
}

function numberOverride(env: Env, name: string, fallback: number): number {
  return env[name] === undefined || env[name]?.trim() === "" ? fallback : Number(env[name]);
}

export function settingsFromEnv(env: Env = process.env): TradingSettings {
  const base = DEFAULT_SETTINGS;
  return validateSettings({
    ...base,
    network: env.HL_TESTNET === undefined ? base.network : env.HL_TESTNET === "false" ? "mainnet" : "testnet",
    mode: env.DRY_RUN === undefined ? base.mode : env.DRY_RUN === "false" ? "real" : "paper",
    enabledCoins: env.HL_COINS === undefined
      ? [...base.enabledCoins]
      : env.HL_COINS.split(",").map((coin) => coin.trim()).filter(Boolean),
    tickMs: numberOverride(env, "TICK_MS", base.tickMs),
    priceMs: numberOverride(env, "PRICE_MS", base.priceMs),
    quoteUsd: numberOverride(env, "QUOTE_USD", base.quoteUsd),
    quoteInsideTicks: numberOverride(env, "QUOTE_INSIDE_TICKS", base.quoteInsideTicks),
    closeSlippageBps: numberOverride(env, "CLOSE_SLIPPAGE_BPS", base.closeSlippageBps),
    horizonBlocks: numberOverride(env, "HORIZON_BLOCKS", base.horizonBlocks),
    bankrollUsd: numberOverride(env, "BANKROLL_USD", base.bankrollUsd),
    runDurationMinutes: numberOverride(env, "RUN_DURATION_MINUTES", base.runDurationMinutes),
    hyperliquidApiUrl: env.HL_API_URL?.trim() || null,
    hyperliquidWsUrl: env.HL_WS_URL?.trim() || null,
    hyperliquidApiKeyHeader: env.HL_API_KEY_HEADER?.trim() || base.hyperliquidApiKeyHeader,
    hyperliquidApiKeyScheme: env.HL_API_KEY_SCHEME === undefined ? base.hyperliquidApiKeyScheme : env.HL_API_KEY_SCHEME.trim(),
    fallbackMs: numberOverride(env, "HL_FALLBACK_POLL_MS", base.fallbackMs),
    rpcUrl: env.HL_RPC_URL?.trim() || null,
  });
}

function credentialBearingUrl(raw: string | null): boolean {
  if (!raw) return false;
  const url = new URL(raw);
  return Boolean(url.username || url.password || url.search || /(?:token|key|secret|auth|credential)/i.test(url.pathname));
}

function responseSettings(settings: TradingSettings): TradingSettings {
  return {
    ...settings,
    hyperliquidApiUrl: credentialBearingUrl(settings.hyperliquidApiUrl) ? null : settings.hyperliquidApiUrl,
    hyperliquidWsUrl: credentialBearingUrl(settings.hyperliquidWsUrl) ? null : settings.hyperliquidWsUrl,
    rpcUrl: credentialBearingUrl(settings.rpcUrl) ? null : settings.rpcUrl,
  };
}

function responseConnection(connection: ConnectionValidation, apiKey?: string): ConnectionValidation {
  const redact = (raw: string): string => {
    if (!credentialBearingUrl(raw)) return raw;
    const url = new URL(raw);
    return url.origin;
  };
  let message = connection.message;
  for (const endpoint of [connection.apiUrl, connection.wsUrl, connection.rpcUrl]) {
    message = message.split(endpoint).join(redact(endpoint));
  }
  if (apiKey) message = message.split(apiKey).join("[redacted]");
  return {
    ...connection,
    message,
    apiUrl: redact(connection.apiUrl),
    wsUrl: redact(connection.wsUrl),
    rpcUrl: redact(connection.rpcUrl),
  };
}

function sessionOverrides(applied: TradingSettings, baseline: TradingSettings): (keyof TradingSettings)[] {
  return (Object.keys(applied) as (keyof TradingSettings)[]).filter((field) => {
    const current = applied[field];
    const configured = baseline[field];
    if (Array.isArray(current) && Array.isArray(configured)) {
      return current.length !== configured.length || current.some((value, index) => value !== configured[index]);
    }
    return current !== configured;
  });
}

function redactedEndpoints(settings: TradingSettings): EndpointField[] {
  return (Object.keys(ENDPOINT_FIELDS) as EndpointField[])
    .filter((field) => credentialBearingUrl(settings[field]));
}

export class SettingsRuntime {
  private applied: TradingSettings;
  private apiKey: string | undefined;
  private apiKeyHost: string | null;
  private connection: ConnectionValidation | null = null;
  readonly baseline: TradingSettings;

  constructor(private readonly options: SettingsRuntimeOptions) {
    const env = options.env ?? process.env;
    this.baseline = settingsFromEnv(env);
    this.applied = this.baseline;
    this.apiKey = env.HL_API_KEY?.trim() ? validateApiKey(env.HL_API_KEY) : undefined;
    this.apiKeyHost = this.apiKey ? new URL(effectiveEndpoints(this.applied).apiUrl).host : null;
    applySettingsToConfig(this.applied, this.apiKey);
  }

  settings(): TradingSettings {
    return { ...this.applied, enabledCoins: [...this.applied.enabledCoins] };
  }

  credential(): string | undefined {
    return this.apiKey;
  }

  credentialFor(settings: TradingSettings): string | undefined {
    const host = new URL(effectiveEndpoints(settings).apiUrl).host;
    return host === this.apiKeyHost ? this.apiKey : undefined;
  }

  setConnection(connection: ConnectionValidation | null, apiKey = this.apiKey): ConnectionValidation | null {
    this.connection = connection ? responseConnection(connection, apiKey) : null;
    return this.connection;
  }

  async apply(
    input: unknown,
    apiKey?: unknown,
    assertCurrent?: () => void,
    clearedEndpointsInput?: unknown,
  ): Promise<TradingSettings> {
    const status = this.options.lifecycle.snapshot().status;
    if (status !== "off" && status !== "expired") throw new Error("Stop trading before changing settings");
    const cleared = clearedEndpointFields(clearedEndpointsInput);
    if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("Settings must be an object");
    const candidate = { ...(input as Record<string, unknown>) };
    const hidden = redactedEndpoints(this.applied);
    for (const field of hidden) {
      if (candidate[field] === null && !cleared.includes(field)) candidate[field] = this.applied[field];
    }
    for (const field of cleared) {
      if (candidate[field] !== null) throw new Error(`${field} must be null when explicitly cleared`);
    }
    const next = validateSettings(candidate);
    const nextHost = new URL(effectiveEndpoints(next).apiUrl).host;
    let nextKey = nextHost === this.apiKeyHost ? this.apiKey : undefined;
    if (apiKey !== undefined) nextKey = apiKey === "" ? undefined : validateApiKey(apiKey as string);

    await this.options.rebuild(next, nextKey);
    assertCurrent?.();
    const currentStatus = this.options.lifecycle.snapshot().status;
    if (currentStatus !== "off" && currentStatus !== "expired") throw new Error("Trading started while settings were rebuilding; settings were not applied");
    this.applied = next;
    this.apiKey = nextKey;
    this.apiKeyHost = nextKey ? nextHost : null;
    this.connection = null;
    applySettingsToConfig(next, nextKey);
    this.options.lifecycle.applyDuration(next.runDurationMinutes);
    return this.settings();
  }

  snapshot(): OperatorSnapshot {
    const env = this.options.env ?? process.env;
    return {
      settings: responseSettings(this.applied),
      baseline: responseSettings(this.baseline),
      overrides: sessionOverrides(this.applied, this.baseline),
      configuration: {
        model: config.model,
        jevProvider: config.jevProvider,
        jevModelId: config.jevModelId,
        port: config.port,
        providerKeys: {
          openrouter: Boolean(env.OPENROUTER_API_KEY?.trim()),
          typesafe: Boolean(env.TYPESAFE_API_KEY?.trim()),
          gateway: Boolean(env.AI_GATEWAY_API_KEY?.trim()),
        },
        walletConfigured: Boolean(env.PRIVATE_KEY?.trim() || env.WALLETS_JSON?.trim()),
      },
      redactedEndpoints: redactedEndpoints(this.applied),
      apiKeyConfigured: Boolean(this.apiKey),
      connection: this.connection,
      run: this.options.lifecycle.snapshot(),
    };
  }
}

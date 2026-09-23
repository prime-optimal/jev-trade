import { HttpTransport, type HttpTransportOptions } from "@nktkas/hyperliquid";
import { SymbolConverter } from "@nktkas/hyperliquid/utils";
import { config, resolveHyperliquidEnv, type HyperliquidEnv } from "./config";
import { effectiveEndpoints, validateApiKey, validateSettings, type TradingSettings } from "./settings";

const OFFICIAL_API_HOSTS: Readonly<Record<string, true>> = {
  "api.hyperliquid.xyz": true,
  "api.hyperliquid-testnet.xyz": true,
};

function isOfficialApiHost(apiUrl: string): boolean {
  return OFFICIAL_API_HOSTS[new URL(apiUrl).hostname.toLowerCase()] === true;
}

function apiHeaders(settings: HyperliquidEnv): Record<string, string> {
  if (isOfficialApiHost(settings.apiUrl) && Object.keys(settings.headers).length > 0) {
    throw new Error("API keys are not supported for official Hyperliquid API hosts");
  }
  return settings.headers;
}

const TRANSPORT_URL = /\b(?:https?|wss?):\/\/[^\s"'<>]+/gi;

export function safeTransportMessage(
  error: unknown,
  settings: HyperliquidEnv = config.hyperliquid,
): string {
  const source = error instanceof Error
    ? error.message
    : typeof error === "string" ? error : "Transport request failed";
  let sanitized = source.replace(/[\r\n]+/g, " ");
  const secrets = new Set<string>();
  for (const value of Object.values(settings.headers)) {
    if (!value) continue;
    secrets.add(value);
    const separator = value.indexOf(" ");
    if (separator >= 0 && separator + 1 < value.length) secrets.add(value.slice(separator + 1));
  }
  for (const secret of [...secrets].sort((left, right) => right.length - left.length)) {
    sanitized = sanitized.replaceAll(secret, "[redacted]");
  }
  sanitized = sanitized.replace(TRANSPORT_URL, (raw) => {
    try {
      const url = new URL(raw);
      const hasSensitiveLocation = url.pathname !== "/" || url.search !== "" || url.hash !== "";
      return `${url.protocol}//${url.host}${hasSensitiveLocation ? "/[redacted]" : ""}`;
    } catch {
      return "[transport-url-redacted]";
    }
  });
  return sanitized.slice(0, 600) || "Transport request failed";
}

export function infoRequestInit(
  payload: unknown,
  settings: HyperliquidEnv = config.hyperliquid,
  signal?: AbortSignal,
): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...apiHeaders(settings) },
    body: JSON.stringify(payload),
    redirect: "error",
    signal,
  };
}

export async function infoPost(
  payload: unknown,
  settings: HyperliquidEnv = config.hyperliquid,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(settings.infoUrl, infoRequestInit(payload, settings, signal));
}

export function httpTransportOptions(settings: HyperliquidEnv = config.hyperliquid): HttpTransportOptions {
  return {
    isTestnet: settings.isTestnet,
    apiUrl: settings.apiUrl,
    rpcUrl: settings.rpcUrl,
    fetchOptions: { headers: apiHeaders(settings), redirect: "error" },
  };
}

export function runtimeTransport(settings: TradingSettings, apiKey?: string): HyperliquidEnv {
  const valid = validateSettings(settings);
  const endpoints = effectiveEndpoints(valid);
  const key = apiKey === undefined ? undefined : validateApiKey(apiKey);
  if (key && valid.hyperliquidApiUrl === null) {
    throw new Error("An API key requires a custom Hyperliquid API URL");
  }
  if (key && isOfficialApiHost(endpoints.apiUrl)) {
    throw new Error("API keys are not supported for official Hyperliquid API hosts");
  }
  const resolved = resolveHyperliquidEnv({
    HL_API_URL: endpoints.apiUrl,
    HL_WS_URL: endpoints.wsUrl,
    HL_RPC_URL: endpoints.rpcUrl,
    HL_FALLBACK_POLL_MS: String(valid.fallbackMs),
    HL_API_KEY: key,
    HL_API_KEY_HEADER: valid.hyperliquidApiKeyHeader,
    HL_API_KEY_SCHEME: valid.hyperliquidApiKeyScheme,
  }, valid.network === "testnet");
  return resolved;
}
export type BeforeExchangeRequest = (payload: unknown) => void | Promise<void>;

class ApiScopedHttpTransport extends HttpTransport {
  private readonly rpcTransport: HttpTransport;

  constructor(settings: HyperliquidEnv, private readonly beforeExchange?: BeforeExchangeRequest) {
    super(httpTransportOptions(settings));
    this.rpcTransport = new HttpTransport({
      isTestnet: settings.isTestnet,
      apiUrl: settings.apiUrl,
      rpcUrl: settings.rpcUrl,
      fetchOptions: { redirect: "error" },
    });
  }

  override async request<T>(
    endpoint: "info" | "exchange" | "explorer",
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    if (endpoint === "explorer") return this.rpcTransport.request(endpoint, payload, signal);
    if (endpoint === "exchange") await this.beforeExchange?.(payload);
    return super.request(endpoint, payload, signal);
  }
}

export function createHttpTransport(
  settings: HyperliquidEnv = config.hyperliquid,
  beforeExchange?: BeforeExchangeRequest,
): HttpTransport {
  return new ApiScopedHttpTransport(settings, beforeExchange);
}

type SymbolLookup = Pick<SymbolConverter, "getAssetId" | "getSzDecimals">;
type PerpMeta = { universe?: { name?: string; maxLeverage?: number }[] };

export class HyperliquidMetadataCache {
  private converterPromise: Promise<SymbolLookup> | null = null;
  private metaPromise: Promise<PerpMeta> | null = null;

  constructor(
    private readonly createConverter: () => Promise<SymbolLookup> =
      () => SymbolConverter.create({ transport: createHttpTransport() }),
    private readonly loadMeta: () => Promise<PerpMeta> = async () => {
      const response = await infoPost({ type: "meta" });
      if (!response.ok) throw new Error(`hl meta HTTP ${response.status}`);
      return response.json() as Promise<PerpMeta>;
    },
  ) {}

  reset(): void {
    this.converterPromise = null;
    this.metaPromise = null;
  }

  symbolConverter(): Promise<SymbolLookup> {
    if (!this.converterPromise) {
      this.converterPromise = this.createConverter().catch((error) => {
        this.converterPromise = null;
        throw error;
      });
    }
    return this.converterPromise;
  }

  async maxLeverage(coin: string): Promise<number | null> {
    if (!this.metaPromise) {
      this.metaPromise = this.loadMeta().catch((error) => {
        this.metaPromise = null;
        throw error;
      });
    }
    const meta = await this.metaPromise;
    const value = Number(meta.universe?.find((asset) => asset.name === coin)?.maxLeverage);
    return Number.isFinite(value) && value >= 1 ? Math.floor(value) : null;
  }
}

export const hyperliquidMetadata = new HyperliquidMetadataCache();

export function resetHyperliquidMetadata(): void {
  hyperliquidMetadata.reset();
}

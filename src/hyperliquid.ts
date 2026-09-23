import { HttpTransport, type HttpTransportOptions } from "@nktkas/hyperliquid";
import { SymbolConverter } from "@nktkas/hyperliquid/utils";
import { config, type HyperliquidEnv } from "./config";

export function infoRequestInit(payload: unknown, settings: HyperliquidEnv = config.hyperliquid): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...settings.headers },
    body: JSON.stringify(payload),
  };
}

export async function infoPost(payload: unknown, settings: HyperliquidEnv = config.hyperliquid): Promise<Response> {
  return fetch(settings.infoUrl, infoRequestInit(payload, settings));
}

export function httpTransportOptions(settings: HyperliquidEnv = config.hyperliquid): HttpTransportOptions {
  return {
    isTestnet: settings.isTestnet,
    apiUrl: settings.apiUrl,
    rpcUrl: settings.rpcUrl,
    fetchOptions: { headers: settings.headers },
  };
}
class ApiScopedHttpTransport extends HttpTransport {
  private readonly rpcTransport: HttpTransport;

  constructor(settings: HyperliquidEnv) {
    super(httpTransportOptions(settings));
    this.rpcTransport = new HttpTransport({
      isTestnet: settings.isTestnet,
      apiUrl: settings.apiUrl,
      rpcUrl: settings.rpcUrl,
    });
  }

  override request<T>(
    endpoint: "info" | "exchange" | "explorer",
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    if (endpoint === "explorer") return this.rpcTransport.request(endpoint, payload, signal);
    return super.request(endpoint, payload, signal);
  }
}

export function createHttpTransport(settings: HyperliquidEnv = config.hyperliquid): HttpTransport {
  return new ApiScopedHttpTransport(settings);
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

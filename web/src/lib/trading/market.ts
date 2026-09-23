import type { TradingSettings } from "./settings";
import type { HyperliquidTransport } from "./feed";

export interface MarketMetadata {
  coin: string;
  assetIndex: number;
  szDecimals: number;
  maxLeverage: number;
  enabled: boolean;
  delisted: boolean;
}

/** Keep the entire universe visible, including disabled and delisted markets. */
export async function loadMarkets(
  transport: HyperliquidTransport,
  enabledCoins: readonly string[],
  signal?: AbortSignal,
): Promise<MarketMetadata[]> {
  const response = await transport.info({ type: "meta" }, signal) as {
    universe?: { name: string; szDecimals: number; maxLeverage: number; isDelisted?: boolean }[];
  };
  if (!Array.isArray(response.universe)) throw new Error("Invalid market metadata");
  const enabled = new Set(enabledCoins);
  return response.universe.map((asset, assetIndex) => {
    if (typeof asset.name !== "string" || !asset.name || !Number.isInteger(asset.szDecimals)
      || asset.szDecimals < 0 || asset.szDecimals > 8 || !Number.isInteger(asset.maxLeverage)
      || asset.maxLeverage < 1) throw new Error("Invalid market metadata");
    return {
      coin: asset.name, assetIndex, szDecimals: asset.szDecimals, maxLeverage: asset.maxLeverage,
      enabled: enabled.has(asset.name) && !asset.isDelisted, delisted: asset.isDelisted === true,
    };
  });
}

export function requireMarket(markets: readonly MarketMetadata[], coin: string): MarketMetadata {
  const market = markets.find((item) => item.coin === coin);
  if (!market || !market.enabled || market.delisted) throw new Error(`Market is not ready: ${coin}`);
  return market;
}

export function requireReadyMarkets(markets: readonly MarketMetadata[], settings: Pick<TradingSettings, "enabledCoins">): void {
  for (const coin of settings.enabledCoins) requireMarket(markets, coin);
}

export function requireLeverage(market: MarketMetadata, leverage: number): number {
  if (!market.enabled || market.delisted || !Number.isInteger(market.maxLeverage) || market.maxLeverage < 1
    || !Number.isInteger(leverage) || leverage < 1 || leverage > market.maxLeverage) {
    throw new Error("Leverage exceeds ready market limits");
  }
  return leverage;
}

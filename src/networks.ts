export type TradingNetwork = "testnet" | "mainnet";

export interface NetworkEndpoints {
  apiUrl: string;
  wsUrl: string;
  rpcUrl: string;
}

export const NETWORK_ENDPOINTS: Readonly<Record<TradingNetwork, Readonly<NetworkEndpoints>>> = {
  testnet: {
    apiUrl: "https://api.hyperliquid-testnet.xyz",
    wsUrl: "wss://api.hyperliquid-testnet.xyz/ws",
    rpcUrl: "https://rpc.hyperliquid-testnet.xyz",
  },
  mainnet: {
    apiUrl: "https://api.hyperliquid.xyz",
    wsUrl: "wss://api.hyperliquid.xyz/ws",
    rpcUrl: "https://rpc.hyperliquid.xyz",
  },
};

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export function validateEndpoint(value: string, kind: "api" | "ws" | "rpc"): string {
  if (/\r|\n/.test(value)) throw new Error(`${kind} URL cannot contain line breaks`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${kind} URL cannot be blank`);

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`${kind} URL must be a valid absolute URL`);
  }

  const allowed: Record<string, true> = kind === "ws" ? { "ws:": true, "wss:": true } : { "http:": true, "https:": true };
  if (!allowed[url.protocol]) {
    throw new Error(`${kind} URL must use ${kind === "ws" ? "wss" : "https"}, except local development`);
  }
  if (url.username || url.password) throw new Error(`${kind} URL cannot contain a username or password`);
  if (url.hash) throw new Error(`${kind} URL cannot contain a fragment`);
  if (!url.hostname) throw new Error(`${kind} URL must include a hostname`);

  const secureProtocol = kind === "ws" ? "wss:" : "https:";
  if (url.protocol !== secureProtocol && !isLocalHostname(url.hostname)) {
    throw new Error(`${kind} URL must use ${secureProtocol.slice(0, -1)} unless the hostname is local`);
  }

  return trimmed.replace(/\/+$/, "");
}

export function deriveWebSocketUrl(apiUrl: string): string {
  const api = new URL(apiUrl);
  api.protocol = api.protocol === "https:" ? "wss:" : "ws:";
  api.pathname = `${api.pathname.replace(/\/+$/, "")}/ws`;
  api.search = "";
  return api.toString().replace(/\/$/, "");
}

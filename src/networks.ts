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

/** Signing identity follows the selected network, never a transport URL. */
export interface NetworkIdentity {
  chainId: 421614 | 42161;
  signatureChainId: "0x66eee" | "0xa4b1";
  hyperliquidChain: "Testnet" | "Mainnet";
  chainName: string;
  rpcUrl: string;
  blockExplorerUrl: string;
}

export const NETWORK_IDENTITIES: Readonly<Record<TradingNetwork, Readonly<NetworkIdentity>>> = {
  testnet: {
    chainId: 421614,
    signatureChainId: "0x66eee",
    hyperliquidChain: "Testnet",
    chainName: "Arbitrum Sepolia",
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    blockExplorerUrl: "https://sepolia.arbiscan.io",
  },
  mainnet: {
    chainId: 42161,
    signatureChainId: "0xa4b1",
    hyperliquidChain: "Mainnet",
    chainName: "Arbitrum One",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    blockExplorerUrl: "https://arbiscan.io",
  },
};

/**
 * Public feeds and paper trading do not require a wallet chain.
 * Real authorization explicitly switches to signatureChainId. On wallet error
 * 4902, request wallet-approved chain addition using this identity, then switch.
 * Custom Hyperliquid and SDK RPC endpoints never supply wallet chain metadata.
 */
export function networkIdentity(network: TradingNetwork): Readonly<NetworkIdentity> {
  return NETWORK_IDENTITIES[network];
}

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

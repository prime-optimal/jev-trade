import { expect, test } from "bun:test";
import { resolveHyperliquidEnv } from "../src/config";
import { shouldRunHttpFallback } from "../src/feed";
import { createHttpTransport, HyperliquidMetadataCache, httpTransportOptions, infoPost, infoRequestInit } from "../src/hyperliquid";

test("Hyperliquid endpoints default by network and WebSocket derives from API base", () => {
  expect(resolveHyperliquidEnv({}, false)).toMatchObject({
    apiUrl: "https://api.hyperliquid.xyz",
    infoUrl: "https://api.hyperliquid.xyz/info",
    wsUrl: "wss://api.hyperliquid.xyz/ws",
    rpcUrl: "https://rpc.hyperliquid.xyz",
    fallbackMs: 30_000,
  });
  expect(resolveHyperliquidEnv({}, true)).toMatchObject({
    apiUrl: "https://api.hyperliquid-testnet.xyz",
    wsUrl: "wss://api.hyperliquid-testnet.xyz/ws",
    rpcUrl: "https://rpc.hyperliquid-testnet.xyz",
  });
  expect(resolveHyperliquidEnv({ HL_API_URL: "http://proxy.local/hl/" }, false)).toMatchObject({
    apiUrl: "http://proxy.local/hl",
    infoUrl: "http://proxy.local/hl/info",
    wsUrl: "ws://proxy.local/hl/ws",
  });
  expect(resolveHyperliquidEnv({ HL_API_URL: "https://api.local", HL_WS_URL: "wss://socket.local/custom" }, false).wsUrl)
    .toBe("wss://socket.local/custom");
});

test("Hyperliquid auth supports default, custom, and raw key headers", () => {
  expect(resolveHyperliquidEnv({ HL_API_KEY: "secret" }, false).headers)
    .toEqual({ Authorization: "Bearer secret" });
  expect(resolveHyperliquidEnv({
    HL_API_KEY: "secret",
    HL_API_KEY_HEADER: "X-Api-Key",
    HL_API_KEY_SCHEME: "",
  }, false).headers).toEqual({ "X-Api-Key": "secret" });
  expect(resolveHyperliquidEnv({}, false).headers).toEqual({});
});

test("Hyperliquid fallback cadence defaults safely and is bounded", () => {
  expect(resolveHyperliquidEnv({ HL_FALLBACK_POLL_MS: "nope" }, false).fallbackMs).toBe(30_000);
  expect(resolveHyperliquidEnv({ HL_FALLBACK_POLL_MS: "1" }, false).fallbackMs).toBe(1_000);
  expect(resolveHyperliquidEnv({ HL_FALLBACK_POLL_MS: "999999" }, false).fallbackMs).toBe(300_000);
});

test("raw info and SDK transports share endpoint and authentication settings", () => {
  const settings = resolveHyperliquidEnv({
    HL_API_URL: "https://api.local/base",
    HL_RPC_URL: "https://rpc.local/base",
    HL_API_KEY: "key",
  }, false);
  const request = infoRequestInit({ type: "meta" }, settings);
  expect(request).toMatchObject({ method: "POST", body: JSON.stringify({ type: "meta" }) });
  expect(request.headers).toEqual({ "content-type": "application/json", Authorization: "Bearer key" });
  expect(httpTransportOptions(settings)).toEqual({
    isTestnet: false,
    apiUrl: "https://api.local/base",
    rpcUrl: "https://rpc.local/base",
    fetchOptions: { headers: { Authorization: "Bearer key" } },
  });
});

test("SDK API authentication is not sent to a distinct RPC endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const requests: { url: string; authorization: string | null }[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    return new Response('{"ok":true}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const settings = resolveHyperliquidEnv({
      HL_API_URL: "https://api.local/base",
      HL_RPC_URL: "https://rpc.other/base",
      HL_API_KEY: "key",
    }, false);
    const transport = createHttpTransport(settings);
    await transport.request("info", { type: "allMids" });
    await transport.request("explorer", { method: "eth_blockNumber" });
    expect(requests).toEqual([
      { url: "https://api.local/base/info", authorization: "Bearer key" },
      { url: "https://rpc.other/base/explorer", authorization: null },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("info requests use the configured API URL and authentication", async () => {
  const originalFetch = globalThis.fetch;
  let request: { input: string | URL | Request; init?: RequestInit } | null = null;
  globalThis.fetch = async (input, init) => {
    request = { input, init };
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const settings = resolveHyperliquidEnv({
      HL_API_URL: "https://api.local/base",
      HL_API_KEY: "key",
    }, false);
    await infoPost({ type: "allMids" }, settings);
    expect(request?.input).toBe("https://api.local/base/info");
    expect(request?.init?.headers).toEqual({
      "content-type": "application/json",
      Authorization: "Bearer key",
    });
    expect(request?.init?.body).toBe(JSON.stringify({ type: "allMids" }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("five sleeves share immutable Hyperliquid startup metadata", async () => {
  let converterRequests = 0;
  let metaRequests = 0;
  const converter = {
    getAssetId: (coin: string) => ["BTC", "ETH", "SOL", "DOGE", "BNB"].indexOf(coin),
    getSzDecimals: () => 4,
  };
  const cache = new HyperliquidMetadataCache(
    async () => {
      converterRequests++;
      return converter;
    },
    async () => {
      metaRequests++;
      return {
        universe: ["BTC", "ETH", "SOL", "DOGE", "BNB"].map((name) => ({
          name,
          maxLeverage: 20,
        })),
      };
    },
  );

  const coins = ["BTC", "ETH", "SOL", "DOGE", "BNB"];
  const results = await Promise.all(coins.map(async (coin) => ({
    converter: await cache.symbolConverter(),
    maxLeverage: await cache.maxLeverage(coin),
  })));

  expect(converterRequests).toBe(1);
  expect(metaRequests).toBe(1);
  expect(results.map((result) => result.converter)).toEqual(Array(5).fill(converter));
  expect(results.map((result) => result.maxLeverage)).toEqual(Array(5).fill(20));
});

test("HTTP fallback runs only while the WebSocket is not open", () => {
  expect(shouldRunHttpFallback(null)).toBe(true);
  expect(shouldRunHttpFallback(WebSocket.CONNECTING)).toBe(true);
  expect(shouldRunHttpFallback(WebSocket.OPEN)).toBe(false);
  expect(shouldRunHttpFallback(WebSocket.CLOSING)).toBe(true);
  expect(shouldRunHttpFallback(WebSocket.CLOSED)).toBe(true);
});

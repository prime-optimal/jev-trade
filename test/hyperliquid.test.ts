import { expect, test } from "bun:test";
import { resolveHyperliquidEnv } from "../src/config";
import { shouldRunHttpFallback } from "../src/feed";
import {
  createHttpTransport,
  HyperliquidMetadataCache,
  httpTransportOptions,
  infoPost,
  infoRequestInit,
  runtimeTransport,
  safeTransportMessage,
} from "../src/hyperliquid";
import { DEFAULT_SETTINGS, type TradingSettings } from "../src/settings";

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
    fetchOptions: { headers: { Authorization: "Bearer key" }, redirect: "error" },
  });
});

test("transport credentials reject official API host aliases instead of being silently ignored", () => {
  const official = resolveHyperliquidEnv({
    HL_API_URL: "https://API.HYPERLIQUID.XYZ:443",
    HL_API_KEY: "must-not-leak",
  }, false);
  expect(() => infoRequestInit({ type: "meta" }, official))
    .toThrow("API keys are not supported for official Hyperliquid API hosts");
  expect(() => httpTransportOptions(official))
    .toThrow("API keys are not supported for official Hyperliquid API hosts");
});

test("transport errors redact credentials and URL paths without hiding venue rejection codes", () => {
  const transport = resolveHyperliquidEnv({
    HL_API_URL: "https://provider.example/private/base",
    HL_RPC_URL: "https://rpc.example/private/base",
    HL_API_KEY: "fake-credential",
  }, false);
  const message = safeTransportMessage(
    new Error(
      "429 venue rejected Bearer fake-credential fake-credential "
      + "https://provider.example/private/base/exchange?token=fake-credential "
      + "wss://stream.example/private/ws?key=fake-credential\r\ninjected",
    ),
    transport,
  );
  expect(message).toContain("429 venue rejected");
  expect(message).toContain("https://provider.example/[redacted]");
  expect(message).toContain("wss://stream.example/[redacted]");
  expect(message).not.toContain("fake-credential");
  expect(message).not.toContain("/private/");
  expect(message).not.toContain("\n");
});

test("SDK API authentication is not sent to a distinct RPC endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const requests: { url: string; authorization: string | null }[] = [];
  globalThis.fetch = (async (input, init) => {
    requests.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    return new Response('{"ok":true}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const settings = resolveHyperliquidEnv({
      HL_API_URL: "https://api.local/base",
      HL_RPC_URL: "https://rpc.other/base",
      HL_API_KEY: "key",
    }, false);
    const transport = createHttpTransport(settings);
    await transport.request("info", { type: "allMids" });
    await transport.request("explorer", {
      type: "userDetails",
      user: "0x0000000000000000000000000000000000000000",
    });
    expect(requests).toEqual([
      { url: "https://api.local/base/info", authorization: "Bearer key" },
      { url: "https://rpc.other/base/explorer", authorization: null },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runtime resolver scopes API credentials to an explicit custom API destination", () => {
  const custom: TradingSettings = {
    ...DEFAULT_SETTINGS,
    enabledCoins: [...DEFAULT_SETTINGS.enabledCoins],
    hyperliquidApiUrl: "https://provider.example/hyperliquid",
    hyperliquidWsUrl: "wss://stream.example/ws",
    rpcUrl: "https://rpc.example/hyperliquid",
    hyperliquidApiKeyHeader: "X-Api-Key",
    hyperliquidApiKeyScheme: "",
  };
  expect(runtimeTransport(custom, " secret ")).toMatchObject({
    apiUrl: "https://provider.example/hyperliquid",
    wsUrl: "wss://stream.example/ws",
    rpcUrl: "https://rpc.example/hyperliquid",
    headers: { "X-Api-Key": "secret" },
  });
  expect(() => runtimeTransport({
    ...custom,
    hyperliquidApiUrl: null,
  }, "secret")).toThrow("requires a custom Hyperliquid API URL");
  expect(() => runtimeTransport({
    ...custom,
    hyperliquidApiUrl: "https://API.HYPERLIQUID.XYZ:443",
  }, "secret")).toThrow("API keys are not supported for official Hyperliquid API hosts");
});

test("exchange guard runs immediately before SDK submission and does not guard reads", async () => {
  const originalFetch = globalThis.fetch;
  const events: string[] = [];
  globalThis.fetch = (async (_input, init) => {
    events.push(`fetch:${String(init?.body)}`);
    return new Response("{\"ok\":true}", { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const transport = createHttpTransport(resolveHyperliquidEnv({}, true), async (payload) => {
      events.push(`guard:${JSON.stringify(payload)}`);
    });
    await transport.request("info", { type: "meta" });
    await transport.request("exchange", { action: { type: "order" } });
    expect(events).toEqual([
      "fetch:{\"type\":\"meta\"}",
      "guard:{\"action\":{\"type\":\"order\"}}",
      "fetch:{\"action\":{\"type\":\"order\"}}",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("info requests use the configured API URL and authentication", async () => {
  const originalFetch = globalThis.fetch;
  const requests: { input: string | URL | Request; init?: RequestInit }[] = [];
  globalThis.fetch = (async (input, init) => {
    requests.push({ input, init });
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const settings = resolveHyperliquidEnv({
      HL_API_URL: "https://api.local/base",
      HL_API_KEY: "key",
    }, false);
    await infoPost({ type: "allMids" }, settings);
    expect(requests[0]?.input).toBe("https://api.local/base/info");
    expect(requests[0]?.init?.headers).toEqual({
      "content-type": "application/json",
      Authorization: "Bearer key",
    });
    expect(requests[0]?.init?.body).toBe(JSON.stringify({ type: "allMids" }));
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

test("metadata cache reset reloads converter and venue metadata", async () => {
  let converterRequests = 0;
  let metaRequests = 0;
  const cache = new HyperliquidMetadataCache(
    async () => {
      converterRequests++;
      return { getAssetId: () => 0, getSzDecimals: () => 2 };
    },
    async () => {
      metaRequests++;
      return { universe: [{ name: "BTC", maxLeverage: 10 }] };
    },
  );
  await cache.symbolConverter();
  await cache.maxLeverage("BTC");
  cache.reset();
  await cache.symbolConverter();
  await cache.maxLeverage("BTC");
  expect({ converterRequests, metaRequests }).toEqual({ converterRequests: 2, metaRequests: 2 });
});

test("HTTP fallback runs only while the WebSocket is not open", () => {
  expect(shouldRunHttpFallback(null)).toBe(true);
  expect(shouldRunHttpFallback(WebSocket.CONNECTING)).toBe(true);
  expect(shouldRunHttpFallback(WebSocket.OPEN)).toBe(false);
  expect(shouldRunHttpFallback(WebSocket.CLOSING)).toBe(true);
  expect(shouldRunHttpFallback(WebSocket.CLOSED)).toBe(true);
});

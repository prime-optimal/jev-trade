import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SETTINGS,
  effectiveEndpoints,
  persistableSettings,
  validateApiKey,
  validateSettings,
  type TradingSettings,
} from "../src/settings";

const settings = (changes: Partial<TradingSettings> = {}): TradingSettings => ({
  ...DEFAULT_SETTINGS,
  enabledCoins: [...DEFAULT_SETTINGS.enabledCoins],
  ...changes,
});

describe("settings schema", () => {
  test("accepts defaults and deduplicates supported coins while allowing none", () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(validateSettings(settings({ enabledCoins: ["BTC", "BTC", "ETH"] })).enabledCoins).toEqual(["BTC", "ETH"]);
    expect(validateSettings(settings({ enabledCoins: [] })).enabledCoins).toEqual([]);
  });

  test("rejects unknown, missing, unsupported, non-finite, fractional, and unsafe values", () => {
    expect(() => validateSettings({ ...settings(), surprise: true })).toThrow("Unknown settings field: surprise");
    const { tickMs: _tickMs, ...missingTick } = settings();
    expect(() => validateSettings(missingTick)).toThrow("Missing settings field: tickMs");
    expect(() => validateSettings(settings({ enabledCoins: ["BTC", "XRP" as "BTC"] }))).toThrow("Unsupported coin: XRP");
    expect(() => validateSettings(settings({ enabledCoins: ["toString" as "BTC"] }))).toThrow("Unsupported coin: toString");
    expect(() => validateSettings(settings({ quoteUsd: Number.POSITIVE_INFINITY }))).toThrow("finite number");
    expect(() => validateSettings(settings({ runDurationMinutes: 1.5 }))).toThrow("integer");
    expect(() => validateSettings(settings({ runDurationMinutes: Number.MAX_SAFE_INTEGER }))).toThrow("between");
    expect(() => validateSettings(settings({ tickMs: 4_999 }))).toThrow("between 5000 and 300000");
  });
});

describe("endpoint validation and resolution", () => {
  test("uses network defaults and preserves custom provider base paths", () => {
    expect(effectiveEndpoints(settings())).toEqual({
      apiUrl: "https://api.hyperliquid-testnet.xyz",
      wsUrl: "wss://api.hyperliquid-testnet.xyz/ws",
      rpcUrl: "https://rpc.hyperliquid-testnet.xyz",
    });
    expect(effectiveEndpoints(validateSettings(settings({
      hyperliquidApiUrl: "https://provider.example/hyperliquid/v1/",
    })))).toEqual({
      apiUrl: "https://provider.example/hyperliquid/v1",
      wsUrl: "wss://provider.example/hyperliquid/v1/ws",
      rpcUrl: "https://rpc.hyperliquid-testnet.xyz",
    });
  });

  test("honors an independent websocket override", () => {
    const effective = effectiveEndpoints(validateSettings(settings({
      network: "mainnet",
      hyperliquidApiUrl: "https://provider.example/base",
      hyperliquidWsUrl: "wss://stream.example/market",
      rpcUrl: "https://rpc.example/provider/base",
    })));
    expect(effective).toEqual({
      apiUrl: "https://provider.example/base",
      wsUrl: "wss://stream.example/market",
      rpcUrl: "https://rpc.example/provider/base",
    });
  });

  test("rejects insecure remote, credential, fragment, malformed, and line-break URLs", () => {
    for (const hyperliquidApiUrl of [
      "http://provider.example",
      "https://user:password@provider.example",
      "https://provider.example/#secret",
      "not a url",
      "https://provider.example/\r\nHost: attacker.example",
      "\nhttps://provider.example",
    ]) {
      expect(() => validateSettings(settings({ hyperliquidApiUrl }))).toThrow();
    }
    expect(validateSettings(settings({ hyperliquidApiUrl: "http://localhost:8787/base" })).hyperliquidApiUrl)
      .toBe("http://localhost:8787/base");
    expect(() => validateSettings(settings({ hyperliquidWsUrl: "ws://provider.example/ws" }))).toThrow("must use wss");
  });
});

describe("transport authentication", () => {
  test("rejects reserved or injected header names and schemes", () => {
    for (const hyperliquidApiKeyHeader of ["Host", "cookie", "Content-Length", "Origin", "X-Key\r\nHost"]) {
      expect(() => validateSettings(settings({ hyperliquidApiKeyHeader }))).toThrow();
    }
    expect(() => validateSettings(settings({ hyperliquidApiKeyScheme: "Bearer\r\nX-Leak: yes" }))).toThrow("line breaks");
    expect(() => validateSettings(settings({ hyperliquidApiKeyScheme: "Bearer token" }))).toThrow("one HTTP authentication token");
    expect(validateSettings(settings({ hyperliquidApiKeyScheme: "" })).hyperliquidApiKeyScheme).toBe("");
  });

  test("normalizes API keys but rejects blanks and CRLF injection", () => {
    expect(validateApiKey("  secret-value  ")).toBe("secret-value");
    expect(() => validateApiKey("   ")).toThrow("blank");
    expect(() => validateApiKey("secret\r\nX-Leak: yes")).toThrow("line breaks");
  });
});

test("persistence removes RPC URLs and every custom path or query that could hide credentials", () => {
  const clean = persistableSettings(settings({
    hyperliquidApiUrl: "https://provider.example",
    hyperliquidWsUrl: "wss://stream.example/ws",
    rpcUrl: "https://rpc.example",
  }));
  expect(clean.hyperliquidApiUrl).toBe("https://provider.example");
  expect(clean.hyperliquidWsUrl).toBe("wss://stream.example/ws");
  expect(clean.rpcUrl).toBeNull();

  const redacted = persistableSettings(settings({
    hyperliquidApiUrl: "https://provider.example/v2/secretopaque",
    hyperliquidWsUrl: "wss://stream.example/tenant/acme",
  }));
  expect(redacted.hyperliquidApiUrl).toBeNull();
  expect(redacted.hyperliquidWsUrl).toBeNull();

  expect(persistableSettings(settings({
    hyperliquidApiUrl: "https://provider.example?opaque=secret",
  })).hyperliquidApiUrl).toBeNull();
});

test("dashboard settings contracts stay exact copies", async () => {
  expect(await Bun.file("web/src/lib/trading/settings.ts").text()).toBe(await Bun.file("src/settings.ts").text());
  expect(await Bun.file("web/src/lib/trading/networks.ts").text()).toBe(await Bun.file("src/networks.ts").text());
});

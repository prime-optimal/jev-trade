import { expect, test } from "bun:test";
import { DEFAULT_SETTINGS, type TradingSettings } from "../src/settings";
import { validateConnection } from "../src/transport-validation";

const settings = (changes: Partial<TradingSettings> = {}): TradingSettings => ({
  ...DEFAULT_SETTINGS,
  enabledCoins: [...DEFAULT_SETTINGS.enabledCoins],
  ...changes,
});

class CompatibleWebSocket {
  static readonly OPEN = 1;
  readonly url: string;
  readonly readyState = CompatibleWebSocket.OPEN;
  private listeners = new Map<string, ((event: { data?: string }) => void)[]>();

  constructor(url: string | URL) {
    this.url = String(url);
    queueMicrotask(() => this.emit("open", {}));
  }

  addEventListener(type: string, listener: (event: { data?: string }) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: { data?: string }) => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener));
  }

  send(body: string): void {
    const request = JSON.parse(body) as { subscription?: { type?: string } };
    if (request.subscription?.type === "allMids") {
      queueMicrotask(() => this.emit("message", { data: JSON.stringify({ channel: "allMids", data: { mids: {} } }) }));
    }
  }

  close(): void {}

  private emit(type: string, event: { data?: string }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

async function withTransportMocks<T>(
  fetcher: Fetcher,
  operation: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  globalThis.fetch = fetcher as typeof fetch;
  globalThis.WebSocket = CompatibleWebSocket as unknown as typeof WebSocket;
  try {
    return await operation();
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
}

function compatibleResponse(input: string | URL | Request): Response {
  const url = String(input);
  if (url.endsWith("/info")) {
    return Response.json({ universe: [{ name: "BTC", maxLeverage: 20 }] });
  }
  if (url.endsWith("/explorer")) {
    return Response.json({ type: "userDetails", txs: [] });
  }
  return new Response("not found", { status: 404 });
}

test("validation uses metadata, market WebSocket, and the SDK explorer userDetails protocol", async () => {
  const requests: { url: string; body: string; authorization: string | null }[] = [];
  const result = await withTransportMocks(async (input, init) => {
    requests.push({
      url: String(input),
      body: String(init?.body),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    return compatibleResponse(input);
  }, () => validateConnection(settings()));

  expect(result).toMatchObject({ ok: true, realAllowed: true });
  expect(requests).toEqual([
    {
      url: "https://api.hyperliquid-testnet.xyz/info",
      body: JSON.stringify({ type: "meta" }),
      authorization: null,
    },
    {
      url: "https://rpc.hyperliquid-testnet.xyz/explorer",
      body: JSON.stringify({
        type: "userDetails",
        user: "0x0000000000000000000000000000000000000000",
      }),
      authorization: null,
    },
  ]);
});

test("RPC incompatibility reports the failed stage without exposing its URL", async () => {
  const result = await withTransportMocks(async (input) => {
    if (String(input).endsWith("/info")) return compatibleResponse(input);
    return Response.json({ type: "error", message: "unsupported explorer protocol at secret URL" });
  }, () => validateConnection(settings()));

  expect(result).toMatchObject({ ok: false, realAllowed: false });
  expect(result.message).toBe(
    "Hyperliquid RPC validation failed. The RPC URL must support SDK explorer requests.",
  );
  expect(result.message).not.toContain("secret");
  expect(result.message).not.toContain("http");
});

test("known official wrong-network endpoint rejects before making requests", async () => {
  let requests = 0;
  const result = await withTransportMocks(async () => {
    requests++;
    return compatibleResponse("https://api.hyperliquid.xyz/info");
  }, () => validateConnection(settings({ hyperliquidApiUrl: "https://api.hyperliquid.xyz" })));

  expect(result).toMatchObject({ ok: false, realAllowed: false });
  expect(result.message).toContain("other Hyperliquid network");
  expect(requests).toBe(0);
});

test("custom endpoint failures never fall back and validation messages do not expose destinations", async () => {
  const urls: string[] = [];
  const custom = settings({
    hyperliquidApiUrl: "https://provider.example/private/path",
    hyperliquidWsUrl: "wss://stream.example/custom",
    rpcUrl: "https://rpc.example/private/token",
  });
  const result = await withTransportMocks(async (input) => {
    urls.push(String(input));
    throw new Error(`secret destination ${String(input)}`);
  }, () => validateConnection(custom));

  expect(result).toMatchObject({ ok: false, realAllowed: false });
  expect(urls).toEqual([
    "https://provider.example/private/path/info",
    "https://rpc.example/private/token/explorer",
  ]);
  expect(result.message).not.toContain("provider.example");
  expect(result.message).not.toContain("token");
});

test("custom compatible endpoints remain barred from real execution when identity is uncertain", async () => {
  const custom = settings({
    hyperliquidApiUrl: "https://provider.example/hyperliquid",
    hyperliquidWsUrl: "wss://stream.example/custom",
    rpcUrl: "https://rpc.example/hyperliquid",
  });
  const result = await withTransportMocks(async (input) => compatibleResponse(input), () => validateConnection(custom));
  expect(result).toMatchObject({ ok: true, realAllowed: false });
  expect(result.message).toContain("network identity cannot be verified");
});

test("API authentication is sent only to the custom HTTP API and never RPC", async () => {
  const authorizations: [string, string | null][] = [];
  const custom = settings({
    hyperliquidApiUrl: "https://provider.example/hyperliquid",
    hyperliquidWsUrl: "wss://stream.example/custom",
    rpcUrl: "https://rpc.example/hyperliquid",
  });
  const result = await withTransportMocks(async (input, init) => {
    authorizations.push([String(input), new Headers(init?.headers).get("authorization")]);
    return compatibleResponse(input);
  }, () => validateConnection(custom, "transport-secret"));

  expect(result.ok).toBe(true);
  expect(authorizations).toEqual([
    ["https://provider.example/hyperliquid/info", "Bearer transport-secret"],
    ["https://rpc.example/hyperliquid/explorer", null],
  ]);
});

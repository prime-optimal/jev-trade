import { afterEach, describe, expect, test } from "bun:test";
import { createWalletAdapter, discoverWallets, walletError, type DiscoveryHost, type WalletProvider } from "../web/src/lib/wallet/provider";
import { AGENT_LIFETIME_MS, createAgentSession, matchesAgent, prepareNetworkFromClick, type AgentMetadata } from "../web/src/lib/wallet/agent";
import { createBrowserSession } from "../web/src/lib/trading/session";
import { DEFAULT_SETTINGS } from "../web/src/lib/trading/settings";

const owner = `0x${"a".repeat(40)}` as const;
const otherOwner = `0x${"b".repeat(40)}` as const;
const signature = `0x${"1".repeat(64)}${"2".repeat(64)}1b`;
const originalFetch = globalThis.fetch;
const cleanups: (() => void)[] = [];
afterEach(() => { globalThis.fetch = originalFetch; for (const cleanup of cleanups.splice(0)) cleanup(); });
class SyntheticProvider implements WalletProvider {
  isBraveWallet = true;
  accounts = [owner] as string[];
  chain = "0x66eee";
  calls: string[] = [];
  listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  signing: () => Promise<unknown> = async () => signature;
  async request({ method }: { method: string }) {
    this.calls.push(method);
    if (method === "eth_requestAccounts" || method === "eth_accounts") return this.accounts;
    if (method === "eth_chainId") return this.chain;
    if (method === "eth_signTypedData_v4") return await this.signing();
    if (method === "wallet_switchEthereumChain") { this.chain = "0x66eee"; this.emit("chainChanged", this.chain); return null; }
    throw { code: 4200 };
  }
  on(event: string, listener: (...args: unknown[]) => void) {
    let group = this.listeners.get(event);
    if (!group) { group = new Set(); this.listeners.set(event, group); }
    group.add(listener);
  }
  removeListener(event: string, listener: (...args: unknown[]) => void) { this.listeners.get(event)?.delete(listener); }
  emit(event: string, value?: unknown) { for (const listener of this.listeners.get(event) ?? []) listener(value); }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function connected() {
  const provider = new SyntheticProvider();
  const wallet = createWalletAdapter(provider);
  cleanups.push(() => wallet.teardown());
  await wallet.connectFromClick();
  return { provider, wallet };
}
function exchangeFixture() {
  const approvals: { agentAddress: string; agentName: string }[] = [];
  let agentActions = 0;
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.type === "extraAgents") {
      return Response.json(approvals.map(action => ({ address: action.agentAddress, name: "Jev Trade", validUntil: Number(action.agentName.split(" ").at(-1)) })));
    }
    if (body.action?.type === "approveAgent") approvals.push(body.action);
    else agentActions++;
    return Response.json({ status: "ok", response: { type: "default" } });
  }) as typeof fetch;
  return { approvals, actions: () => agentActions };
}
describe("wallet discovery and connection", () => {
  test("listens before requesting, deduplicates UUIDs and never picks MetaMask alone", () => {
    const host = new EventTarget() as DiscoveryHost;
    const provider = new SyntheticProvider();
    const announce = () => host.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { info: { uuid: "brave", name: "Brave Wallet", rdns: "com.brave.wallet" }, provider } }));
    host.addEventListener("eip6963:requestProvider", announce);
    const discovery = discoverWallets(host);
    expect(discovery.selectBrave()).toBe(provider);
    discovery.retry();
    expect(discovery.list()).toHaveLength(1);
    discovery.teardown();
    announce();
    expect(discovery.list()).toEqual([]);
    const missing = new EventTarget() as DiscoveryHost;
    missing.ethereum = { ...provider, isMetaMask: true };
    const fallback = discoverWallets(missing);
    expect(fallback.selectBrave()).toBeNull();
    expect(fallback.guidance().status).toBe("unsupported");
    missing.navigator = { brave: {} };
    expect(fallback.guidance().status).toBe("setup");
    missing.braveEthereum = provider;
    expect(fallback.selectBrave()).toBe(provider);
    fallback.teardown();
  });
  test("connect is explicit, rejection does not retry, and normalized events invalidate the session", async () => {
    const provider = new SyntheticProvider();
    const wallet = createWalletAdapter(provider);
    cleanups.push(() => wallet.teardown());
    expect(provider.calls).toEqual([]);
    await expect(wallet.request({ method: "eth_requestAccounts" })).rejects.toThrow("user click");
    provider.accounts = [];
    await expect(wallet.connectFromClick()).rejects.toThrow("unlock");
    provider.accounts = [owner.toUpperCase().replace("0X", "0x"), otherOwner];
    await wallet.connectFromClick();
    expect(wallet.snapshot().owner).toBe(owner);
    const epoch = wallet.snapshot().epoch;
    provider.emit("chainChanged", "0xA4B1");
    expect(wallet.snapshot().chainId).toBe("0xa4b1");
    expect(wallet.snapshot().epoch).toBeGreaterThan(epoch);
    provider.emit("accountsChanged", [otherOwner]);
    expect(wallet.snapshot().owner).toBe(otherOwner);
    provider.emit("disconnect");
    expect(wallet.snapshot().connected).toBe(false);
  });
  test("maps actionable provider errors without automatic retry", async () => {
    for (const code of [4001, 4100, 4200, 4900, 4901]) {
      let requests = 0;
      const provider = new SyntheticProvider();
      provider.request = async () => { requests++; throw { code }; };
      const wallet = createWalletAdapter(provider);
      await expect(wallet.connectFromClick()).rejects.toThrow(walletError({ code }).message);
      expect(requests).toBe(1);
      wallet.teardown();
    }
  });
  test("network setup is explicit and separate from approval", async () => {
    const { provider, wallet } = await connected();
    provider.chain = "0xa4b1";
    provider.emit("chainChanged", provider.chain);
    await prepareNetworkFromClick(wallet, "testnet");
    expect(wallet.snapshot().chainId).toBe("0x66eee");
    expect(provider.calls).not.toContain("eth_signTypedData_v4");
  });
});
describe("ephemeral agent authorization", () => {
  test("signature rejection leaves no usable signer and sends no agent action", async () => {
    const fixture = exchangeFixture();
    const { provider, wallet } = await connected();
    provider.signing = async () => { throw { code: 4001 }; };
    const session = createAgentSession({ wallet, network: "testnet", onStop() {} });
    cleanups.push(() => session.endSession());
    await expect(session.authorizeFromClick()).rejects.toThrow();
    expect(session.metadata()).toBeNull();
    await expect(session.cancel({ cancels: [] })).rejects.toThrow("unavailable");
    expect(fixture.approvals).toEqual([]);
    expect(fixture.actions()).toBe(0);
  });
  test("late approval cannot survive account, chain, disconnect, network or end-session changes", async () => {
    for (const change of ["account", "chain", "disconnect", "network", "end"] as const) {
      const fixture = exchangeFixture();
      const { provider, wallet } = await connected();
      const entered = deferred<void>();
      const result = deferred<unknown>();
      provider.signing = () => { entered.resolve(); return result.promise; };
      const session = createAgentSession({ wallet, network: "testnet", onStop() {} });
      cleanups.push(() => session.endSession());
      const approval = session.authorizeFromClick();
      await entered.promise;
      await expect(session.authorizeFromClick()).rejects.toThrow("pending");
      if (change === "account") provider.emit("accountsChanged", [otherOwner]);
      if (change === "chain") provider.emit("chainChanged", "0xa4b1");
      if (change === "disconnect") provider.emit("disconnect");
      if (change === "network") session.setNetwork("mainnet");
      if (change === "end") session.endSession();
      result.resolve(signature);
      await expect(approval).rejects.toThrow();
      expect(session.metadata()).toBeNull();
      expect(fixture.approvals).toEqual([]);
      await expect(session.cancel({ cancels: [] })).rejects.toThrow("unavailable");
      expect(fixture.actions()).toBe(0);
    }
  });
  test("a submitted approval arriving after disconnect never enables trading", async () => {
    const { provider, wallet } = await connected();
    const sent = deferred<void>();
    const response = deferred<Response>();
    let requests = 0;
    globalThis.fetch = (async () => {
      requests++;
      sent.resolve();
      return await response.promise;
    }) as typeof fetch;
    const session = createAgentSession({ wallet, network: "testnet", onStop() {} });
    cleanups.push(() => session.endSession());
    const approval = session.authorizeFromClick();
    await sent.promise;
    provider.emit("disconnect");
    response.resolve(Response.json({ status: "ok", response: { type: "default" } }));
    await expect(approval).rejects.toThrow();
    expect(session.metadata()).toBeNull();
    await expect(session.cancel({ cancels: [] })).rejects.toThrow("unavailable");
    expect(requests).toBe(1);
  });
  test("replacement uses a fresh key, persists only metadata and expiry disables every action", async () => {
    const fixture = exchangeFixture();
    const { wallet } = await connected();
    let time = Date.now();
    let stops = 0;
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const session = createAgentSession({ wallet, network: "testnet", now: () => time, storage, onStop: () => { stops++; } });
    cleanups.push(() => session.endSession());
    const first = await session.authorizeFromClick();
    expect(first.expiresAt).toBe(time + AGENT_LIFETIME_MS);
    expect(first.name).toBe(`Jev Trade valid_until ${first.expiresAt}`);
    expect(JSON.parse([...data.values()][0]!)).toEqual(first);
    await expect(session.authorizeFromClick()).rejects.toThrow("replacement");
    const second = await session.authorizeFromClick({ replace: true });
    expect(second.address).not.toBe(first.address);
    time = second.expiresAt - 30_000;
    expect(session.metadata()).toEqual(second);
    expect(stops).toBe(1);
    await expect(session.order({ orders: [], grouping: "na" })).rejects.toThrow("stopping");
    time = second.expiresAt;
    expect(session.metadata()).toBeNull();
    await expect(session.cancel({ cancels: [] })).rejects.toThrow("unavailable");
    expect(fixture.actions()).toBe(0);
    session.endSession();
    const reloaded = createAgentSession({ wallet, network: "testnet", storage, onStop() {} });
    cleanups.push(() => reloaded.endSession());
    expect(reloaded.replacementRequired()).toBe(true);
    expect(reloaded.metadata()).toBeNull();
    await expect(reloaded.authorizeFromClick()).rejects.toThrow("replacement");
  });
  test("real SDK forwards acceptance deadlines outside action params", async () => {
    exchangeFixture();
    const approvalFetch = globalThis.fetch;
    const requests: Array<{ action: { type: string; expiresAfter?: number }; expiresAfter: number }> = [];
    globalThis.fetch = (async (input, init) => {
      const body = JSON.parse(String(init?.body));
      if (!body.action || body.action.type === "approveAgent") return approvalFetch(input, init);
      requests.push(body);
      return Response.json({ status: "ok", response: body.action.type === "order"
        ? { type: "order", data: { statuses: [{ resting: { oid: 42 } }] } }
        : body.action.type === "cancel" ? { type: "cancel", data: { statuses: ["success"] } } : { type: "default" } });
    }) as typeof fetch;
    const { wallet } = await connected();
    const agent = createAgentSession({ wallet, network: "testnet", onStop() {} });
    cleanups.push(() => agent.endSession());
    await agent.authorizeFromClick();
    const expiresAfter = Date.now() + 5_000;
    await agent.updateLeverage({ asset: 0, leverage: 2, isCross: true, expiresAfter });
    await agent.order({ orders: [{ a: 0, b: true, p: "100", s: "1", r: false, t: { limit: { tif: "Alo" } } }], grouping: "na", expiresAfter });
    await agent.cancel({ cancels: [{ a: 0, o: 42 }], expiresAfter });
    expect(requests.map(request => [request.action.type, request.expiresAfter, request.action.expiresAfter])).toEqual([
      ["updateLeverage", expiresAfter, undefined], ["order", expiresAfter, undefined], ["cancel", expiresAfter, undefined],
    ]);
  });
  test("wallet change stops the run but preserves exact-owned cleanup until endSession", async () => {
    exchangeFixture();
    const approvalFetch = globalThis.fetch;
    let canceled = false;
    let hideEvidence = true;
    const actions: string[] = [];
    globalThis.fetch = (async (input, init) => {
      const body = JSON.parse(String(init?.body));
      if (!body.action || body.action.type === "approveAgent") return approvalFetch(input, init);
      actions.push(body.action.type);
      if (body.action.type === "cancelByCloid") canceled = true;
      return Response.json({ status: "ok", response: body.action.type === "order"
        ? { type: "order", data: { statuses: [{ resting: { oid: 42 } }] } }
        : body.action.type === "cancelByCloid" ? { type: "cancel", data: { statuses: ["success"] } } : { type: "default" } });
    }) as typeof fetch;
    const { provider, wallet } = await connected();
    let stopped: Promise<void> | undefined;
    const agent = createAgentSession({ wallet, network: "testnet", onStop: () => { stopped = session.stop("Wallet changed"); } });
    cleanups.push(() => agent.endSession());
    const metadata = await agent.authorizeFromClick();
    const session = createBrowserSession({
      owner, settings: { ...DEFAULT_SETTINGS, mode: "real", network: "testnet", enabledCoins: ["BTC"] },
      markets: [{ coin: "BTC", asset: 0, enabled: true, maxLeverage: 20, szDecimals: 3 }],
      locks: { acquire: async () => ({ release() {} }) },
      authorize: async () => ({ ...metadata, exchange: {
        async updateLeverage(input) { await agent.updateLeverage(input); },
        async place(order) {
          await agent.order({ orders: [{ a: order.asset, b: order.buy, p: order.price, s: order.size, r: order.reduceOnly, t: { limit: { tif: order.tif } }, c: order.cloid }], grouping: "na", expiresAfter: order.expiresAfter });
          return { cloid: order.cloid, state: "open", oid: 42 };
        },
        async cancel(order) { await agent.cancelOwned(order); },
        async lookup(cloid) { return hideEvidence ? null : { cloid, state: canceled ? "canceled" : "open", oid: 42 }; },
      }, clear: () => agent.endSession() }),
      subscribeAccount: (_owner, listener) => { listener({ accountValue: 200, withdrawable: 200, receivedAt: Date.now(), positions: {} }); return () => {}; },
    });
    await session.start({ wholeNetPosition: true });
    const order = { asset: 0, coin: "BTC", buy: true, price: "100", size: "1", reduceOnly: false };
    await session.submit(order, 2, Date.now());
    provider.emit("accountsChanged", [otherOwner]);
    expect(session.snapshot().status).toBe("stopping");
    await stopped;
    expect(session.snapshot().status).toBe("attention-required");
    expect(canceled).toBe(true);
    await expect(session.submit(order, 2, Date.now())).rejects.toThrow();
    await expect(agent.order({ orders: [], grouping: "na" })).rejects.toThrow();
    await expect(agent.cancelOwned({ asset: 0, cloid: `0x${"f".repeat(32)}`, expiresAfter: Date.now() + 5000 })).rejects.toThrow("unowned");
    hideEvidence = false;
    await session.reconcile();
    expect(session.snapshot().status).toBe("off");
    expect(agent.metadata()).toBeNull();
    await expect(agent.cancel({ cancels: [{ a: 0, o: 42 }] })).rejects.toThrow("unavailable");
    expect(actions).toEqual(["updateLeverage", "order", "cancelByCloid"]);
  });
  test("agent matching requires address, exact expiry and full or exact base name", () => {
    const metadata: AgentMetadata = { owner, network: "testnet", address: otherOwner, expiresAt: 1000, name: "Jev Trade valid_until 1000" };
    expect(matchesAgent(metadata, { address: otherOwner, name: "Jev Trade", validUntil: 1000 })).toBe(true);
    expect(matchesAgent(metadata, { address: otherOwner, name: metadata.name, validUntil: 1000 })).toBe(true);
    expect(matchesAgent(metadata, { address: otherOwner, name: "Jev Trade attacker", validUntil: 1000 })).toBe(false);
    expect(matchesAgent(metadata, { address: owner, name: metadata.name, validUntil: 1000 })).toBe(false);
    expect(matchesAgent(metadata, { address: otherOwner, name: metadata.name, validUntil: null })).toBe(false);
  });
});

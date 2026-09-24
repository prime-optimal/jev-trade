export interface WalletProvider {
  request(args: { method: string; params?: readonly unknown[] | object }): Promise<unknown>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
  isBraveWallet?: boolean;
}
export type Address = `0x${string}`;
export function normalizeAccounts(value: unknown): Address[] {
  return Array.isArray(value) ? value.filter((a): a is Address => typeof a === "string" && /^0x[\da-f]{40}$/i.test(a)).map(a => a.toLowerCase() as Address) : [];
}
export function normalizeChain(value: unknown): `0x${string}` | null {
  try {
    if (typeof value !== "string" || !/^0x[\da-f]+$/i.test(value)) return null;
    return `0x${BigInt(value).toString(16)}`;
  } catch { return null; }
}
export function walletError(error: unknown): Error & { code?: number } {
  let code: number | undefined;
  let cause = error;
  const seen = new Set<object>();
  while (cause !== null && typeof cause === "object" && !seen.has(cause)) {
    seen.add(cause);
    if ("code" in cause && [4001, 4100, 4200, 4900, 4901, 4902].includes(Number(cause.code))) {
      code = Number(cause.code);
      break;
    }
    cause = "cause" in cause ? cause.cause : null;
  }
  const messages: Record<number, string> = {
    4001: "Request declined. Nothing was authorized. Retry only when you are ready.",
    4100: "Unlock Brave Wallet and allow this site to access your account, then Retry.",
    4200: "This wallet does not support the requested method. Update Brave and Retry.",
    4900: "Wallet disconnected. Open Brave Wallet, restore its connection, then Retry.",
    4901: "Wallet is disconnected from the selected chain. Switch to the requested network and Retry.",
  };
  return Object.assign(new Error(code !== undefined && messages[code] ? messages[code] : error instanceof Error ? error.message : "Wallet request failed. Open Brave Wallet and Retry."), { code });
}
function isProvider(value: unknown): value is WalletProvider {
  return typeof value === "object" && value !== null && "request" in value && typeof value.request === "function" && "on" in value && typeof value.on === "function" && "removeListener" in value && typeof value.removeListener === "function";
}
export interface DiscoveryHost extends EventTarget {
  braveEthereum?: unknown;
  ethereum?: unknown;
  navigator?: { brave?: unknown };
}
export interface WalletAnnouncement { info: { uuid: string; name: string; rdns: string }; provider: WalletProvider }
/** Call from a client effect. The listener stays installed until teardown. No icons or markup are retained. */
export function discoverWallets(host: DiscoveryHost, changed: () => void = () => {}) {
  const wallets = new Map<string, WalletAnnouncement>();
  const announce = (event: Event) => {
    const detail: unknown = (event as CustomEvent).detail;
    if (!detail || typeof detail !== "object" || !("info" in detail) || !("provider" in detail)) return;
    const info = detail.info;
    if (!info || typeof info !== "object" || !("uuid" in info) || !("name" in info) || !("rdns" in info)) return;
    if (typeof info.uuid !== "string" || !info.uuid || typeof info.name !== "string" || typeof info.rdns !== "string" || !isProvider(detail.provider) || wallets.has(info.uuid)) return;
    wallets.set(info.uuid, { info: { uuid: info.uuid, name: info.name, rdns: info.rdns }, provider: detail.provider });
    changed();
  };
  const retry = () => host.dispatchEvent(new Event("eip6963:requestProvider"));
  host.addEventListener("eip6963:announceProvider", announce);
  retry();
  return {
    retry,
    list: () => [...wallets.values()],
    selectBrave(): WalletProvider | null {
      for (const { info, provider } of wallets.values()) {
        if (info.rdns.toLowerCase() === "com.brave.wallet" || /^brave(?: wallet)?$/i.test(info.name)) return provider;
      }
      if (isProvider(host.braveEthereum) && host.braveEthereum.isBraveWallet === true) return host.braveEthereum;
      if (isProvider(host.ethereum) && host.ethereum.isBraveWallet === true) return host.ethereum;
      return null;
    },
    guidance() {
      const available = this.selectBrave();
      return available || host.navigator?.brave
        ? { status: "setup" as const, message: "Open Brave Wallet to create or unlock your wallet, then Retry." }
        : { status: "unsupported" as const, message: "Open this page in Brave with Brave Wallet enabled, then Retry." };
    },
    teardown: () => { host.removeEventListener("eip6963:announceProvider", announce); wallets.clear(); },
  };
}
export interface WalletSnapshot { owner: Address | null; chainId: `0x${string}` | null; epoch: number; connected: boolean }
/** Brand-neutral adapter. connectFromClick is the only account-permission request. */
export function createWalletAdapter(provider: WalletProvider) {
  let state: WalletSnapshot = { owner: null, chainId: null, epoch: 0, connected: false };
  let disposed = false;
  let connecting = false;
  const listeners = new Set<(state: WalletSnapshot) => void>();
  const update = (patch: Partial<WalletSnapshot>) => {
    state = { ...state, ...patch, epoch: state.epoch + 1 };
    for (const listener of listeners) listener({ ...state });
  };
  const accounts = (value: unknown) => { const owner = normalizeAccounts(value)[0] ?? null; update({ owner, connected: owner !== null }); };
  const chain = (value: unknown) => update({ chainId: normalizeChain(value) });
  const disconnected = () => update({ owner: null, chainId: null, connected: false });
  provider.on("accountsChanged", accounts);
  provider.on("chainChanged", chain);
  provider.on("disconnect", disconnected);
  return {
    provider,
    snapshot: () => ({ ...state }),
    subscribe(listener: (state: WalletSnapshot) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async request(args: Parameters<WalletProvider["request"]>[0]) {
      if (disposed) throw new Error("Wallet adapter ended.");
      if (args.method === "eth_requestAccounts") throw new Error("Use Connect from a user click.");
      try { return await provider.request(args); } catch (error) { throw walletError(error); }
    },
    async connectFromClick() {
      if (disposed || connecting) throw new Error("Connection unavailable or already pending.");
      connecting = true;
      const epoch = state.epoch;
      try {
        const result = await provider.request({ method: "eth_requestAccounts" });
        if (disposed || state.epoch !== epoch) throw new Error("Wallet changed during connection. Retry.");
        const owner = normalizeAccounts(result)[0];
        if (!owner) throw new Error("Create or unlock Brave Wallet, then Retry.");
        const chainId = normalizeChain(await provider.request({ method: "eth_chainId" }));
        if (disposed || state.epoch !== epoch) throw new Error("Wallet changed during connection. Retry.");
        if (!chainId) throw new Error("Wallet returned an invalid chain. Retry.");
        update({ owner, chainId, connected: true });
        return { ...state };
      } catch (error) { throw walletError(error); } finally { connecting = false; }
    },
    // Local disconnect does not claim provider permission revocation.
    disconnect: disconnected,
    teardown() {
      disposed = true;
      disconnected();
      provider.removeListener("accountsChanged", accounts);
      provider.removeListener("chainChanged", chain);
      provider.removeListener("disconnect", disconnected);
      listeners.clear();
    },
  };
}
export interface WalletAdapter {
  readonly provider: WalletProvider;
  snapshot(): WalletSnapshot;
  subscribe(listener: (state: WalletSnapshot) => void): () => void;
  request(args: Parameters<WalletProvider["request"]>[0]): Promise<unknown>;
  connectFromClick(): Promise<WalletSnapshot>;
  disconnect(): void;
  teardown(): void;
}

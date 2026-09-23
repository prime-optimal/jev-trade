import type { HyperliquidTransport } from "./feed";

export interface AccountPosition {
  size: number;
  entryPrice: number;
  leverage: number;
  unrealizedUsd: number;
  liquidationPx: number | null;
}
export interface BrowserAccountSnapshot {
  accountValue: number;
  withdrawable: number;
  receivedAt: number;
  positions: Record<string, AccountPosition>;
}

export function accountFromClearinghouse(value: unknown, receivedAt: number): BrowserAccountSnapshot {
  const state = value as {
    marginSummary?: { accountValue?: string }; withdrawable?: string;
    assetPositions?: { position: { coin: string; szi: string; entryPx: string | null;
      leverage: { value: number }; unrealizedPnl: string; liquidationPx: string | null } }[];
  } | null;
  if (!state?.marginSummary || !Array.isArray(state.assetPositions)) throw new Error("Invalid account snapshot");
  const number = (input: unknown): number => {
    if (input === null || input === undefined || input === "") throw new Error("Incomplete account snapshot");
    const result = Number(input);
    if (!Number.isFinite(result)) throw new Error("Invalid account value");
    return result;
  };
  const positions: Record<string, AccountPosition> = Object.create(null);
  for (const { position } of state.assetPositions) {
    if (!position || typeof position.coin !== "string" || !position.coin) throw new Error("Invalid account position");
    const size = number(position.szi);
    positions[position.coin] = {
      size, entryPrice: size === 0 ? 0 : number(position.entryPx), leverage: number(position.leverage?.value),
      unrealizedUsd: number(position.unrealizedPnl),
      liquidationPx: position.liquidationPx === null ? null : number(position.liquidationPx),
    };
  }
  return { accountValue: number(state.marginSummary.accountValue), withdrawable: number(state.withdrawable), receivedAt, positions };
}

/** One owner watch per session, never one equity copy per asset. */
export function createAccountSubscriber(
  transport: HyperliquidTransport,
  options: {
    now?: () => number;
    onError: (error: Error) => void;
    onFills?: (data: unknown) => void;
    onOrders?: (data: unknown) => void;
  },
): (owner: string, onSnapshot: (snapshot: BrowserAccountSnapshot) => void) => Promise<() => void> {
  let watching = false;
  return async (owner, onSnapshot) => {
    if (watching) throw new Error("An account subscription already exists");
    if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) throw new Error("Invalid account owner");
    watching = true;
    let active = true;
    let received = false;
    const stops: (() => void)[] = [];
    const abort = new AbortController();
    const stop = () => {
      if (!active) return;
      active = false;
      watching = false;
      abort.abort();
      for (const unsubscribe of stops) unsubscribe();
    };
    const emit = (value: unknown) => {
      if (!active) return;
      onSnapshot(accountFromClearinghouse(value, (options.now ?? Date.now)()));
    };
    try {
      stops.push(transport.onDisconnect(() => { if (active) options.onError(new Error("Account connection lost")); }));
      stops.push(transport.subscribe({ type: "clearinghouseState", user: owner }, ({ data }) => {
        if (!active) return;
        try {
          const message = data as { clearinghouseState?: unknown } | null;
          emit(message?.clearinghouseState ?? data);
          received = true;
        } catch { options.onError(new Error("Invalid account update")); }
      }));
      if (options.onFills) stops.push(transport.subscribe({ type: "userFills", user: owner }, ({ data }) => { if (active) options.onFills?.(data); }));
      if (options.onOrders) stops.push(transport.subscribe({ type: "orderUpdates", user: owner }, ({ data }) => { if (active) options.onOrders?.(data); }));
      const state = await transport.info({ type: "clearinghouseState", user: owner }, abort.signal);
      if (!received) emit(state);
      return stop;
    } catch (error) {
      stop();
      throw error;
    }
  };
}

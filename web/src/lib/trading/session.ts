import { createExchangeCore, withDeadline, type DirectExchange, type ExchangeCore, type ExchangeOrder } from "./exchange";
import { createOrderJournal, type Cloid, type JournalEntry } from "./journal";
import type { LockProvider, OwnerLock } from "./locks";
import { validateSettings, type TradingSettings, type RunStatus } from "./settings";

export interface SessionPosition { size: number; entryPrice: number; leverage: number }
export interface SessionAccount {
  accountValue: number;
  withdrawable: number;
  receivedAt: number;
  positions: Record<string, SessionPosition>;
}
export interface ExecutionMarket { coin: string; asset: number; szDecimals: number; maxLeverage: number; enabled: boolean }
export interface SessionPermit {
  owner: string;
  network: TradingSettings["network"];
  exchange: DirectExchange;
  expiresAt: number;
  /** Destroys the closure-held signer, only called after owned cleanup. */
  clear(): void;
}
export interface SessionOptions {
  owner: string;
  settings: TradingSettings;
  locks: LockProvider;
  markets: readonly ExecutionMarket[];
  /** Invoke the #21 agent approval from a user click, while the owner lock is held. */
  authorize?: () => Promise<SessionPermit>;
  subscribeAccount?: (owner: string, listener: (account: SessionAccount) => void) => Promise<() => void> | (() => void);
  now?: () => number;
  onChange?: () => void;
}
export interface SessionSnapshot {
  epoch: number; owner: string; settings: TradingSettings; status: RunStatus;
  reason: string | null; deadlineAt: number | null; account: SessionAccount;
  reservedMargin: number; orders: JournalEntry[];
}
export interface BrowserSession {
  snapshot(): SessionSnapshot;
  start(confirmation?: { wholeNetPosition: true }): Promise<void>;
  submit(order: ExchangeOrder, leverage: number, observedAt: number): Promise<Cloid | string>;
  /** Apply a public-tape simulated fill to an existing paper reservation. */
  paperFill(id: string, size: number, price: number, feeUsd?: number): void;
  cancel(id: string): Promise<void>;
  guard(input: { visible: boolean; online: boolean; observedAt: number; lastWakeAt: number }): boolean;
  stop(reason?: string): Promise<void>;
  reconcile(): Promise<void>;
}
interface PaperOrder { order: ExchangeOrder; leverage: number; remaining: number; margin: number }
/** Keep this controller in a closure/ref, not React state. Snapshots contain no signing capability. */
export function createBrowserSession(options: SessionOptions): BrowserSession {
  const settings = validateSettings(options.settings);
  const owner = options.owner.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(owner)) throw new Error("Invalid owner");
  const now = options.now ?? Date.now;
  const markets = new Map(options.markets.map(market => [market.coin, { ...market }]));
  const journal = createOrderJournal();
  const paper = new Map<string, PaperOrder>();
  let cash = settings.bankrollUsd;
  let reservedMargin = 0;
  let sequence = 0;
  let epoch = 0;
  let status: RunStatus = "off";
  let reason: string | null = null;
  let deadlineAt: number | null = null;
  let account: SessionAccount = { accountValue: settings.mode === "paper" ? cash : 0, withdrawable: settings.mode === "paper" ? cash : 0, receivedAt: 0, positions: {} };
  let lock: OwnerLock | null = null;
  let authorization: SessionPermit | null = null;
  let exchange: ExchangeCore | null = null;
  let unsubscribe: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopping: Promise<void> | null = null;
  let starting: Promise<void> | null = null;
  let accountReady = settings.mode === "paper";
  let cleanupTask: Promise<void> | null = null;
  const notify = () => options.onChange?.();
  function updatePaperAccount() {
    const positionMargin = Object.values(account.positions).reduce((sum, position) => sum + Math.abs(position.size) * position.entryPrice / position.leverage, 0);
    account = { ...account, accountValue: cash, withdrawable: Math.max(0, cash - positionMargin - reservedMargin), receivedAt: now() };
  }
  async function cleanup() {
    await starting?.catch(() => undefined);
    await exchange?.drain();
    for (const entry of journal.unresolved()) {
      try { await exchange?.cancel(entry.cloid); } catch { /* Preserve journal for explicit reconciliation. */ }
    }
    if (journal.unresolved().length) throw new Error("Owned orders still require reconciliation");
    authorization?.clear();
    authorization = null;
    exchange = null;
    unsubscribe?.(); unsubscribe = null;
    lock?.release(); lock = null;
    paper.clear(); reservedMargin = 0;
    if (settings.mode === "paper") updatePaperAccount();
    status = "off";
    notify();
  }
  const session: BrowserSession = {
    snapshot() {
      return { epoch, owner, settings: { ...settings, enabledCoins: [...settings.enabledCoins] }, status, reason, deadlineAt,
        account: { ...account, positions: Object.fromEntries(Object.entries(account.positions).map(([coin, position]) => [coin, { ...position }])) }, reservedMargin, orders: journal.all() };
    },
    async start(confirmation) {
      if (status !== "off" || starting) throw new Error("Session is already active");
      if (settings.mode === "real" && (!confirmation?.wholeNetPosition || !options.authorize || !options.subscribeAccount)) throw new Error("Confirm whole-account net-position management before real trading");
      const captured = ++epoch;
      status = "starting"; reason = null;
      accountReady = settings.mode === "paper";
      starting = (async () => {
        if (settings.mode === "real") {
          lock = await options.locks.acquire(owner, settings.network);
          if (epoch !== captured) throw new Error("Start invalidated");
          authorization = await options.authorize!();
          if (authorization.owner.toLowerCase() !== owner || authorization.network !== settings.network) throw new Error("Agent identity does not match the session");
          exchange = createExchangeCore(authorization.exchange, journal, now);
          if (epoch !== captured) throw new Error("Start invalidated");
          unsubscribe = await options.subscribeAccount!(owner, next => {
            if (epoch !== captured || status === "off") return;
            if (![next.accountValue, next.withdrawable, next.receivedAt].every(Number.isFinite)) return;
            account = { ...next, positions: Object.fromEntries(Object.entries(next.positions).map(([coin, position]) => [coin, { ...position }])) };
            accountReady = true;
            notify();
          });
        }
        if (epoch !== captured) throw new Error("Start invalidated");
        deadlineAt = Math.min(now() + settings.runDurationMinutes * 60_000, authorization ? authorization.expiresAt - 30_000 : Infinity);
        if (!Number.isFinite(deadlineAt) || deadlineAt <= now()) throw new Error("Agent deadline has elapsed");
        status = "running";
        timer = setTimeout(() => { void session.stop("Run deadline reached"); }, deadlineAt - now());
        notify();
      })();
      try { await starting; }
      catch (error) {
        if (epoch === captured) { status = "stopping"; epoch++; }
        throw error;
      } finally {
        starting = null;
        if (status === "stopping" && !stopping) await session.stop("Start did not complete");
      }
    },
    async submit(order, leverage, observedAt) {
      const captured = epoch;
      const current = () => status === "running" && epoch === captured && deadlineAt !== null && now() < deadlineAt && now() - observedAt <= settings.fallbackMs && observedAt <= now();
      if (!current()) throw new Error("Session or market data is not ready");
      const market = markets.get(order.coin);
      if (!market || !market.enabled || market.asset !== order.asset || !settings.enabledCoins.includes(order.coin as TradingSettings["enabledCoins"][number])) throw new Error("Market is disabled or metadata is unavailable");
      if (!Number.isInteger(leverage) || leverage < 1 || !Number.isFinite(market.maxLeverage) || leverage > market.maxLeverage || !Number.isInteger(market.asset) || market.asset < 0) throw new Error("Explicit valid leverage and metadata are required");
      const size = Number(order.size), price = Number(order.price);
      if (![size, price].every(value => Number.isFinite(value) && value > 0) || !Number.isInteger(market.szDecimals) || market.szDecimals < 0 || market.szDecimals > 8 || Math.abs(size * 10 ** market.szDecimals - Math.round(size * 10 ** market.szDecimals)) > 1e-6) throw new Error("Invalid order size or price");
      const position = account.positions[order.coin];
      if (order.reduceOnly && (!position || !position.size || order.buy !== (position.size < 0) || size > Math.abs(position.size))) throw new Error("Exit must reduce the confirmed net position");
      if (settings.mode === "real") {
        if (!exchange || !accountReady || now() - account.receivedAt > settings.fallbackMs) throw new Error("Account snapshot is stale");
        if (journal.unresolved().some(entry => entry.coin === order.coin)) throw new Error("Reconcile the existing asset order first");
        return exchange.place({ ...order, leverage }, captured, () => current() && !journal.unresolved().some(entry => entry.coin === order.coin));
      }
      const margin = order.reduceOnly ? 0 : size * price / leverage;
      if (margin > account.withdrawable) throw new Error("Insufficient shared paper margin");
      if (Array.from(paper.values()).some(entry => entry.order.coin === order.coin)) throw new Error("Cancel the existing paper order first");
      const id = `paper-${++sequence}`;
      paper.set(id, { order: { ...order }, leverage, remaining: size, margin });
      reservedMargin += margin; updatePaperAccount(); notify();
      return id;
    },
    paperFill(id, size, price, feeUsd = 0) {
      const pending = paper.get(id);
      if (!pending || settings.mode !== "paper" || status !== "running") throw new Error("Paper order is not active");
      if (![size, price].every(value => Number.isFinite(value) && value > 0) || !Number.isFinite(feeUsd) || feeUsd < 0 || size > pending.remaining) throw new Error("Invalid paper fill");
      if (!pending.order.reduceOnly && (pending.order.buy ? price > Number(pending.order.price) : price < Number(pending.order.price))) throw new Error("Fill does not cross the resting limit");
      const previous = account.positions[pending.order.coin] ?? { size: 0, entryPrice: 0, leverage: pending.leverage };
      const delta = pending.order.buy ? size : -size;
      if (pending.order.reduceOnly && (delta * previous.size >= 0 || size > Math.abs(previous.size))) throw new Error("Paper exit exceeds net position");
      const closing = previous.size * delta < 0 ? Math.min(Math.abs(previous.size), size) : 0;
      cash += closing * (price - previous.entryPrice) * Math.sign(previous.size) - feeUsd;
      const nextSize = previous.size + delta;
      const entryPrice = nextSize === 0 ? 0 : previous.size * delta >= 0 ? (Math.abs(previous.size) * previous.entryPrice + size * price) / Math.abs(nextSize) : Math.sign(nextSize) === Math.sign(previous.size) ? previous.entryPrice : price;
      account.positions[pending.order.coin] = { size: nextSize, entryPrice, leverage: pending.leverage };
      const released = pending.margin * size / pending.remaining;
      reservedMargin -= released; pending.margin -= released; pending.remaining -= size;
      if (pending.remaining <= 0 || pending.order.reduceOnly) {
        reservedMargin -= pending.margin;
        paper.delete(id);
      }
      updatePaperAccount(); notify();
    },
    async cancel(id) {
      if (settings.mode === "paper") {
        const pending = paper.get(id);
        if (!pending) throw new Error("Unknown paper order");
        reservedMargin -= pending.margin; paper.delete(id); updatePaperAccount(); notify();
      } else { await exchange?.cancel(id as Cloid); notify(); }
    },
    guard(input) {
      if (status !== "running") return false;
      if (!input.visible || !input.online || ![input.observedAt, input.lastWakeAt].every(value => Number.isFinite(value) && value <= now()) || now() - input.observedAt > settings.fallbackMs || now() - input.lastWakeAt > settings.fallbackMs || now() >= deadlineAt!) {
        void session.stop("Visibility, connection, sleep, or freshness guard stopped trading"); return false;
      }
      return true;
    },
    async stop(stopReason = "Session ended") {
      if (stopping) return stopping;
      if (status === "off") return;
      epoch++; status = "stopping"; reason = stopReason; clearTimeout(timer); notify();
      cleanupTask ??= cleanup().finally(() => { cleanupTask = null; });
      stopping = withDeadline(cleanupTask, 10_000).catch(() => { status = "attention-required"; notify(); }).finally(() => { stopping = null; });
      return stopping;
    },
    async reconcile() {
      if (status === "running") {
        for (const entry of journal.unresolved()) await exchange?.reconcile(entry.cloid);
        notify();
        return;
      }
      if (status !== "attention-required") throw new Error("No cleanup requires attention");
      await session.stop(reason ?? "Reconcile owned orders");
    },
  };
  return session;
}

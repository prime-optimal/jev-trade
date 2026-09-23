import type { Cloid, OrderJournal, OrderState } from "./journal";
export const ACCEPTANCE_MS = 5_000;
export interface ExchangeOrder {
  asset: number; coin: string; buy: boolean; price: string; size: string; reduceOnly: boolean;
}
export interface OrderEvidence {
  cloid: Cloid;
  state: Exclude<OrderState, "pending" | "unknown">;
  oid?: number;
}
/** Implement with direct Hyperliquid clients, never an application API proxy. */
export interface DirectExchange {
  updateLeverage(input: { asset: number; leverage: number; isCross: true; expiresAfter: number }): Promise<void>;
  place(order: ExchangeOrder & { cloid: Cloid; tif: "Alo" | "Ioc"; expiresAfter: number }): Promise<OrderEvidence>;
  cancel(order: { asset: number; cloid: Cloid; expiresAfter: number }): Promise<void>;
  /** Null is not proof of rejection: a request may still be inside its acceptance window. */
  lookup(cloid: Cloid): Promise<OrderEvidence | null>;
}
export interface SerialQueue {
  run<T>(operation: () => Promise<T>): Promise<T>;
  drain(): Promise<void>;
}
export function createSerialQueue(): SerialQueue {
  let tail = Promise.resolve();
  return {
    run(operation) { const result = tail.then(operation); tail = result.then(() => undefined, () => undefined); return result; },
    drain() { return tail; },
  };
}
export async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Operation deadline exceeded")), ms); })]);
  } finally { clearTimeout(timer); }
}
export interface ExchangeCore {
  place(order: ExchangeOrder & { leverage: number }, epoch: number, current: () => boolean): Promise<Cloid>;
  cancel(cloid: Cloid): Promise<void>;
  reconcile(cloid: Cloid): Promise<boolean>;
  drain(): Promise<void>;
}
export function createExchangeCore(client: DirectExchange, journal: OrderJournal, now = Date.now): ExchangeCore {
  const queue = createSerialQueue();
  function apply(cloid: Cloid, evidence: OrderEvidence) {
    if (evidence.cloid !== cloid) throw new Error("Mismatched order evidence");
    journal.update(cloid, { state: evidence.state, oid: evidence.oid, cancelPending: false });
  }
  async function reconcile(cloid: Cloid) {
    const entry = journal.get(cloid);
    if (!entry) throw new Error("Unknown order");
    const evidence = await withDeadline(client.lookup(cloid), ACCEPTANCE_MS);
    if (evidence) apply(cloid, evidence);
    // Even after expiry, absence alone is not terminal evidence. Keep the lock and ask for reconciliation.
    return Boolean(evidence && evidence.state !== "open" && now() >= entry.expiresAfter);
  }
  return {
    place(order, epoch, current) {
      return queue.run(async () => {
        if (!current()) throw new Error("Session changed before submission");
        await withDeadline(client.updateLeverage({ asset: order.asset, leverage: order.leverage, isCross: true, expiresAfter: now() + ACCEPTANCE_MS }), ACCEPTANCE_MS);
        if (!current()) throw new Error("Session changed while setting leverage");
        const submittedAt = now();
        const entry = journal.begin({ asset: order.asset, coin: order.coin, epoch, submittedAt, expiresAfter: submittedAt + ACCEPTANCE_MS });
        try {
          const result = await withDeadline(client.place({ ...order, cloid: entry.cloid, tif: order.reduceOnly ? "Ioc" : "Alo", expiresAfter: entry.expiresAfter }), ACCEPTANCE_MS);
          apply(entry.cloid, result);
        } catch {
          journal.update(entry.cloid, { state: "unknown" });
          try { await reconcile(entry.cloid); } catch { /* Preserve ambiguity, never resubmit. */ }
        }
        return entry.cloid;
      });
    },
    cancel(cloid) {
      return queue.run(async () => {
        const entry = journal.get(cloid);
        if (!entry) throw new Error("Cannot cancel an unowned order");
        if (["filled", "canceled", "rejected"].includes(entry.state)) return;
        if (entry.cancelPending) { await reconcile(cloid); return; }
        journal.update(cloid, { cancelPending: true });
        try { await withDeadline(client.cancel({ asset: entry.asset, cloid, expiresAfter: now() + ACCEPTANCE_MS }), ACCEPTANCE_MS); }
        catch { /* Cancellation is ambiguous until exact order evidence arrives. */ }
        await reconcile(cloid);
      });
    },
    reconcile(cloid) { return queue.run(() => reconcile(cloid)); },
    drain: queue.drain,
  };
}

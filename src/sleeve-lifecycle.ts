import type { SleeveView } from "./server";
import { safeTransportMessage } from "./hyperliquid";
import type { SleeveConfig } from "./sleeves";
import type { Meta, SleeveMeta } from "./legacy-types";

export const RETRY_DELAY_MS = 1_800_000;

export type InitializedSleeve = {
  wallet: string | null;
  view: SleeveView;
  start: () => void;
  stop?: () => void;
  dispose?: () => void;
};


export interface SleeveLifecycle {
  views: SleeveView[];
  initializeAll(): Promise<void>;
  allReady(): boolean;
  anyReady(): boolean;
  startAll(): void;
  stopAll(): void;
  disposeAll(): void;
  settled(): Promise<void>;
}
type SleeveLifecycleOptions = {
  specs: SleeveConfig[];
  meta: Meta;
  initialize: (spec: SleeveConfig) => Promise<InitializedSleeve>;
  onStatus: (sleeve: SleeveMeta) => void;
  now?: () => number;
  schedule?: (run: () => void, delay: number) => unknown;
  retryDelayMs?: number;
  autoStart?: boolean;
  canRetry?: () => boolean;
  views?: SleeveView[];
};

export function publicError(error: unknown): string {
  const message = safeTransportMessage(error)
    .replace(/0x[a-f\d]{64}/gi, "0x[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return message.slice(0, 240) || "Sleeve initialization failed";
}

export function createSleeveLifecycle(options: SleeveLifecycleOptions): SleeveLifecycle {
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((run, delay) => setTimeout(run, delay));
  const retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
  const views = options.views ?? [];
  const active = new Set<Promise<void>>();
  const initializedByIndex = new Map<number, InitializedSleeve>();
  let running = options.autoStart ?? true;
  let disposed = false;

  options.meta.sleeves.push(...options.specs.map((spec): SleeveMeta => ({
    coin: spec.coin,
    pair: spec.pair,
    label: spec.label,
    wallet: null,
    status: "starting",
    error: null,
    retryAt: null,
  })));

  const publish = (sleeve: SleeveMeta) => options.onStatus({ ...sleeve });

  const scheduleRetry = (index: number, sleeve: SleeveMeta) => {
    schedule(() => {
      if (disposed) return;
      if (options.canRetry?.() === false) {
        scheduleRetry(index, sleeve);
        return;
      }
      sleeve.status = "starting";
      sleeve.error = null;
      sleeve.retryAt = null;
      publish(sleeve);
      track(attempt(index));
    }, retryDelayMs);
  };

  const attempt = async (index: number): Promise<void> => {
    if (disposed || initializedByIndex.has(index)) return;
    const spec = options.specs[index]!;
    const sleeve = options.meta.sleeves[index]!;
    try {
      const initialized = await options.initialize(spec);
      if (disposed) {
        initialized.dispose?.();
        return;
      }
      initializedByIndex.set(index, initialized);
      sleeve.wallet = initialized.wallet;
      sleeve.status = "live";
      sleeve.error = null;
      sleeve.retryAt = null;
      if (running) initialized.start();
      views.push(initialized.view);
      publish(sleeve);
    } catch (error) {
      sleeve.wallet = null;
      sleeve.status = "retrying";
      sleeve.error = publicError(error);
      sleeve.retryAt = now() + retryDelayMs;
      console.warn(`${sleeve.label} initialization failed, retrying: ${sleeve.error}`);
      publish(sleeve);
      scheduleRetry(index, sleeve);
    }
  };

  const track = (promise: Promise<void>) => {
    active.add(promise);
    promise.finally(() => active.delete(promise));
    return promise;
  };

  return {
    views,
    initializeAll: async () => {
      for (const [index] of options.specs.entries()) await track(attempt(index));
    },
    allReady: () => initializedByIndex.size === options.specs.length,
    anyReady: () => initializedByIndex.size > 0,
    startAll: () => {
      if (disposed || running) return;
      running = true;
      for (const initialized of initializedByIndex.values()) initialized.start();
    },
    stopAll: () => {
      running = false;
      for (const initialized of initializedByIndex.values()) initialized.stop?.();
    },
    disposeAll: () => {
      disposed = true;
      running = false;
      for (const initialized of initializedByIndex.values()) initialized.dispose?.();
      initializedByIndex.clear();
      views.length = 0;
    },
    settled: async () => {
      while (active.size) await Promise.all([...active]);
    },
  };
}

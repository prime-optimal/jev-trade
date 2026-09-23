import type { SleeveView } from "./server";
import type { SleeveConfig } from "./sleeves";
import type { Meta, SleeveMeta } from "./types";

export const RETRY_DELAY_MS = 1_800_000;

type InitializedSleeve = {
  wallet: string | null;
  view: SleeveView;
  start: () => void;
};

type SleeveLifecycleOptions = {
  specs: SleeveConfig[];
  meta: Meta;
  initialize: (spec: SleeveConfig) => Promise<InitializedSleeve>;
  onStatus: (sleeve: SleeveMeta) => void;
  now?: () => number;
  schedule?: (run: () => void, delay: number) => unknown;
  retryDelayMs?: number;
};

export function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/0x[a-f\d]{64}/gi, "0x[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240) || "Sleeve initialization failed";
}

export function createSleeveLifecycle(options: SleeveLifecycleOptions) {
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((run, delay) => setTimeout(run, delay));
  const retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
  const views: SleeveView[] = [];
  const active = new Set<Promise<void>>();

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

  const attempt = async (index: number): Promise<void> => {
    const spec = options.specs[index]!;
    const sleeve = options.meta.sleeves[index]!;
    try {
      const initialized = await options.initialize(spec);
      sleeve.wallet = initialized.wallet;
      sleeve.status = "live";
      sleeve.error = null;
      sleeve.retryAt = null;
      initialized.start();
      views.push(initialized.view);
      publish(sleeve);
    } catch (error) {
      sleeve.wallet = null;
      sleeve.status = "retrying";
      sleeve.error = publicError(error);
      sleeve.retryAt = now() + retryDelayMs;
      publish(sleeve);
      schedule(() => {
        sleeve.status = "starting";
        sleeve.error = null;
        sleeve.retryAt = null;
        publish(sleeve);
        track(attempt(index));
      }, retryDelayMs);
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
    settled: async () => {
      while (active.size) await Promise.all([...active]);
    },
  };
}

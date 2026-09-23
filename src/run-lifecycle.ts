import type { RunSnapshot } from "./settings";

export type { RunSnapshot, RunStatus } from "./settings";

export interface RunGuard {
  readonly runId: string;
  isLive(): boolean;
  assertLive(): void;
}

export type RunHooks = {
  start(guard: RunGuard): Promise<void>;
  stop(): Promise<void>;
};

export interface RunLifecycle {
  snapshot(): RunSnapshot;
  start(): Promise<RunSnapshot>;
  stop(reason?: string): Promise<RunSnapshot>;
  reconcile(): Promise<RunSnapshot>;
  applyDuration(minutes: number): void;
}

type Timer = ReturnType<typeof setTimeout>;

type RunLifecycleOptions = {
  durationMinutes: number;
  hooks: RunHooks;
  now?: () => number;
  monotonicNow?: () => number;
  schedule?: (run: () => void, delayMs: number) => Timer;
  cancelSchedule?: (timer: Timer) => void;
  cleanupTimeoutMs?: number;
  makeRunId?: () => string;
  onChange?: (snapshot: RunSnapshot) => void;
};

/** Authoritative execution lifecycle. Timers wake it, while guards enforce both clocks. */
export function createRunLifecycle(options: RunLifecycleOptions): RunLifecycle {
  const now = options.now ?? Date.now;
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const schedule = options.schedule ?? ((run, delay) => setTimeout(run, delay));
  const cancelSchedule = options.cancelSchedule ?? clearTimeout;
  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? 10_000;
  const makeRunId = options.makeRunId ?? (() => crypto.randomUUID());
  let durationMs = checkedDuration(options.durationMinutes);
  let state = emptySnapshot(durationMs);
  let activeToken: { id: string; valid: boolean; monoDeadline: number } | null = null;
  let expiryTimer: Timer | null = null;
  let transition: Promise<RunSnapshot> | null = null;
  let attentionWasExpiry = false;
  let cleanupInFlight: Promise<void> | null = null;
  let cleanupSettled = false;
  let cleanupFailure: unknown = null;

  const publish = () => {
    const copy = { ...state, serverNow: now() };
    options.onChange?.(copy);
    return copy;
  };
  const clearExpiry = () => {
    if (expiryTimer != null) cancelSchedule(expiryTimer);
    expiryTimer = null;
  };
  const expired = (token: { monoDeadline: number }) =>
    now() >= (state.deadlineAt ?? Number.NEGATIVE_INFINITY) || monotonicNow() >= token.monoDeadline;
  const isTokenLive = (token: { id: string; valid: boolean; monoDeadline: number }) => {
    const live = token.valid && activeToken === token && (state.status === "starting" || state.status === "running") && !expired(token);
    if (!live && token.valid && activeToken === token && expired(token)) void stop("expired");
    return live;
  };
  const beginCleanup = () => {
    if (cleanupInFlight) return cleanupInFlight;
    cleanupSettled = false;
    cleanupFailure = null;
    cleanupInFlight = options.hooks.stop().then(
      () => { cleanupSettled = true; },
      (error) => { cleanupFailure = error; cleanupSettled = true; },
    );
    return cleanupInFlight;
  };
  const clearCleanup = () => {
    cleanupInFlight = null;
    cleanupSettled = false;
    cleanupFailure = null;
  };
  const stopHookBounded = async () => {
    let timeout: Timer | null = null;
    try {
      await Promise.race([
        beginCleanup(),
        new Promise<never>((_, reject) => {
          timeout = schedule(() => reject(new Error("owned order cleanup timed out")), cleanupTimeoutMs);
        }),
      ]);
      if (cleanupFailure) throw cleanupFailure;
    } finally {
      if (timeout != null) cancelSchedule(timeout);
    }
  };

  const stop = (reason = "manual"): Promise<RunSnapshot> => {
    if (transition && state.status === "stopping") return transition;
    if (state.status === "off" || state.status === "expired" || state.status === "attention-required") {
      return Promise.resolve({ ...state, serverNow: now() });
    }
    const wasExpiry = reason === "expired";
    attentionWasExpiry = wasExpiry;
    const startedAt = state.startedAt ?? now();
    const wallElapsed = Math.max(0, now() - startedAt);
    const monotonicElapsed = activeToken
      ? Math.max(0, durationMs - Math.max(0, activeToken.monoDeadline - monotonicNow()))
      : wallElapsed;
    const elapsed = wasExpiry ? durationMs : Math.min(durationMs, Math.max(wallElapsed, monotonicElapsed));
    if (activeToken) activeToken.valid = false;
    clearExpiry();
    state = { ...state, status: "stopping", stoppedAt: startedAt + elapsed, stopReason: reason };
    publish();
    const stopping = (async () => {
      try {
        await stopHookBounded();
        activeToken = null;
        state = { ...state, status: wasExpiry ? "expired" : "off" };
        clearCleanup();
      } catch {
        state = {
          ...state,
          status: "attention-required",
          stopReason: "cleanup-failed: Owned orders could not be reconciled; attention required",
        };
      }
      return publish();
    })();
    transition = stopping;
    stopping.finally(() => {
      if (transition === stopping) transition = null;
    });
    return stopping;
  };

  const start = (): Promise<RunSnapshot> => {
    if (state.status === "running" || state.status === "starting") {
      return transition ?? Promise.resolve({ ...state, serverNow: now() });
    }
    if (state.status === "stopping") return transition!;
    if (state.status === "attention-required") return Promise.reject(new Error("reconcile owned orders before starting"));

    const wallStarted = now();
    const token = { id: makeRunId(), valid: true, monoDeadline: monotonicNow() + durationMs };
    activeToken = token;
    state = {
      runId: token.id,
      status: "starting",
      startedAt: wallStarted,
      deadlineAt: wallStarted + durationMs,
      stoppedAt: null,
      durationMs,
      stopReason: null,
      serverNow: wallStarted,
    };
    publish();
    const guard: RunGuard = {
      runId: token.id,
      isLive: () => isTokenLive(token),
      assertLive: () => {
        if (!isTokenLive(token)) throw new Error(`run ${token.id} is not live`);
      },
    };
    const starting = (async () => {
      try {
        await options.hooks.start(guard);
        if (!isTokenLive(token)) return { ...state };
        state = { ...state, status: "running" };
        expiryTimer = schedule(() => void stop("expired"), Math.max(0, token.monoDeadline - monotonicNow()));
        return publish();
      } catch {
        if (!token.valid || activeToken !== token) return { ...state };
        token.valid = false;
        activeToken = null;
        state = {
          ...state,
          status: "attention-required",
          stoppedAt: now(),
          stopReason: "startup-failed: Execution could not start; attention required",
        };
        return publish();
      }
    })();
    transition = starting;
    starting.finally(() => {
      if (transition === starting) transition = null;
    });
    return starting;
  };

  return {
    snapshot: () => ({ ...state, serverNow: now() }),
    start,
    stop,
    async reconcile() {
      if (state.status !== "attention-required") return { ...state, serverNow: now() };
      if (cleanupInFlight && !cleanupSettled) {
        state = { ...state, stopReason: "owned order cleanup is still pending" };
        return publish();
      }
      try {
        if (cleanupFailure) {
          clearCleanup();
          await stopHookBounded();
        }
        activeToken = null;
        clearCleanup();
        state = { ...state, status: attentionWasExpiry ? "expired" : "off", stopReason: attentionWasExpiry ? "expired" : "reconciled" };
      } catch {
        state = { ...state, stopReason: "cleanup-failed: Owned orders could not be reconciled; attention required" };
      }
      return publish();
    },
    applyDuration(minutes: number) {
      if (state.status !== "off" && state.status !== "expired") throw new Error("run duration can only change while stopped");
      durationMs = checkedDuration(minutes);
      state = { ...state, durationMs };
      publish();
    },
  };
}

function checkedDuration(minutes: number): number {
  const durationMs = minutes * 60_000;
  if (!Number.isInteger(minutes) || minutes <= 0 || !Number.isSafeInteger(durationMs)) {
    throw new Error("run duration must be a positive safe integer number of minutes");
  }
  return durationMs;
}

function emptySnapshot(durationMs: number): RunSnapshot {
  return {
    runId: null,
    status: "off",
    startedAt: null,
    deadlineAt: null,
    stoppedAt: null,
    durationMs,
    stopReason: null,
    serverNow: Date.now(),
  };
}

import { describe, expect, test } from "bun:test";
import { createRunLifecycle, type RunGuard } from "../src/run-lifecycle";

type Scheduled = { run: () => void; delay: number; cancelled: boolean };

function harness(hooks?: { start?(guard: RunGuard): Promise<void>; stop?(): Promise<void> }) {
  let wall = 1_000_000;
  let mono = 10_000;
  let starts = 0;
  let stops = 0;
  const timers: Scheduled[] = [];
  const lifecycle = createRunLifecycle({
    durationMinutes: 1,
    now: () => wall,
    monotonicNow: () => mono,
    makeRunId: () => `run-${starts + 1}`,
    schedule: (run, delay) => {
      const timer = { run, delay, cancelled: false };
      timers.push(timer);
      return timer as unknown as ReturnType<typeof setTimeout>;
    },
    cancelSchedule: (timer) => {
      (timer as unknown as Scheduled).cancelled = true;
    },
    hooks: {
      async start(guard) {
        starts++;
        await hooks?.start?.(guard);
      },
      async stop() {
        stops++;
        await hooks?.stop?.();
      },
    },
  });
  return {
    lifecycle,
    timers,
    counts: () => ({ starts, stops }),
    advance: (wallMs: number, monoMs = wallMs) => { wall += wallMs; mono += monoMs; },
    rollbackWall: (ms: number) => { wall -= ms; },
  };
}

describe("authoritative run lifecycle", () => {
  test("starts off and repeated commands do not create a second run", async () => {
    const h = harness();
    expect(h.lifecycle.snapshot()).toMatchObject({ status: "off", runId: null, durationMs: 60_000 });
    expect(h.counts()).toEqual({ starts: 0, stops: 0 });
    const first = await h.lifecycle.start();
    const second = await h.lifecycle.start();
    expect(first.status).toBe("running");
    expect(second.runId).toBe(first.runId);
    expect(h.counts().starts).toBe(1);
    await h.lifecycle.stop();
    await h.lifecycle.stop();
    expect(h.counts().stops).toBe(1);
  });

  test("monotonic deadline expires despite wall clock rollback", async () => {
    const h = harness();
    await h.lifecycle.start();
    h.rollbackWall(120_000);
    h.advance(0, 60_000);
    h.timers.find((timer) => timer.delay === 60_000)!.run();
    const expired = await h.lifecycle.stop("expired");
    expect(expired).toMatchObject({
      status: "expired",
      stopReason: "expired",
      stoppedAt: 1_060_000,
    });
    expect(h.counts().stops).toBe(1);
  });

  test("stop during startup invalidates that run before startup completes", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    let guard: RunGuard | null = null;
    const h = harness({ start: async (next) => { guard = next; await waiting; } });
    const starting = h.lifecycle.start();
    expect(h.lifecycle.snapshot().status).toBe("starting");
    const stopping = h.lifecycle.stop("operator");
    expect(guard!.isLive()).toBe(false);
    release();
    await Promise.all([starting, stopping]);
    expect(h.lifecycle.snapshot().status).toBe("off");
    expect(h.counts()).toEqual({ starts: 1, stops: 1 });
  });

  test("cleanup failure requires reconciliation and blocks restart", async () => {
    let fail = true;
    const h = harness({ stop: async () => { if (fail) throw new Error("residual order unknown"); } });
    await h.lifecycle.start();
    expect((await h.lifecycle.stop()).status).toBe("attention-required");
    await expect(h.lifecycle.start()).rejects.toThrow("reconcile");
    fail = false;
    expect((await h.lifecycle.reconcile()).status).toBe("off");
    expect((await h.lifecycle.start()).status).toBe("running");
  });

  test("default clock and run ID start and stop in the real runtime", async () => {
    const lifecycle = createRunLifecycle({
      durationMinutes: 1,
      hooks: {
        async start(guard) {
          expect(guard.runId).toMatch(/^[0-9a-f-]{36}$/);
          guard.assertLive();
        },
        async stop() {},
      },
    });
    const running = await lifecycle.start();
    expect(running.status).toBe("running");
    expect(running.deadlineAt! - running.startedAt!).toBe(60_000);
    expect((await lifecycle.stop()).status).toBe("off");
  });

  test("timed out cleanup must settle before reconcile permits a fresh run", async () => {
    let release!: () => void;
    const cleanup = new Promise<void>((resolve) => { release = resolve; });
    const h = harness({ stop: () => cleanup });
    await h.lifecycle.start();
    const stopping = h.lifecycle.stop();
    h.timers.find((timer) => timer.delay === 10_000 && !timer.cancelled)!.run();
    expect((await stopping).status).toBe("attention-required");
    expect((await h.lifecycle.reconcile()).status).toBe("attention-required");
    await expect(h.lifecycle.start()).rejects.toThrow("reconcile");
    release();
    await cleanup;
    await Promise.resolve();
    expect((await h.lifecycle.reconcile()).status).toBe("off");
    expect((await h.lifecycle.start()).status).toBe("running");
    expect(h.counts().stops).toBe(1);
  });

  test("never publishes hook error details", async () => {
    const secret = "https://provider.example/private?key=secret";
    const startup = createRunLifecycle({
      durationMinutes: 1,
      hooks: {
        async start() { throw new Error(secret); },
        async stop() {},
      },
    });
    expect(JSON.stringify(await startup.start())).not.toContain("secret");

    const cleanup = createRunLifecycle({
      durationMinutes: 1,
      hooks: {
        async start() {},
        async stop() { throw new Error(secret); },
      },
    });
    await cleanup.start();
    expect(JSON.stringify(await cleanup.stop())).not.toContain("secret");
  });
});

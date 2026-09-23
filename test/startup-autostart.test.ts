import { describe, expect, test } from "bun:test";
import { createRunLifecycle } from "../src/run-lifecycle";
import { createStartupAutostart, type StartupAutostart } from "../src/startup-autostart";

function fakeExecution(mode: "paper" | "real") {
  let ready = false;
  let resourceStarts = 0;
  let startup: StartupAutostart | undefined;
  const lifecycle = createRunLifecycle({
    durationMinutes: 5,
    onChange: (snapshot) => startup?.observe(snapshot.status),
    hooks: {
      start: async () => {
        if (!ready) throw new Error("no execution resources are ready");
        resourceStarts++;
      },
      stop: async () => {},
    },
  });
  const coordinator = createStartupAutostart({
    status: () => lifecycle.snapshot().status,
    anyReady: () => ready,
    start: () => lifecycle.start(),
  });
  startup = coordinator;

  return {
    lifecycle,
    startup: coordinator,
    arm: () => coordinator.arm(mode),
    makeReady: () => { ready = true; },
    markReady: async () => {
      ready = true;
      await coordinator.request();
    },
    resourceStarts: () => resourceStarts,
  };
}

describe("process startup autostart", () => {
  test("waits for arming, then starts one paper run when the committed executor is already ready", async () => {
    const execution = fakeExecution("paper");

    await execution.markReady();
    expect(execution.lifecycle.snapshot().status).toBe("off");

    await execution.arm();

    expect(execution.lifecycle.snapshot()).toMatchObject({
      status: "running",
      durationMs: 300_000,
    });
    expect(execution.lifecycle.snapshot().deadlineAt).not.toBeNull();
    expect(execution.resourceStarts()).toBe(1);
  });

  test("stays Off when every sleeve fails, then starts once on first ready recovery", async () => {
    const execution = fakeExecution("paper");

    await execution.arm();
    expect(execution.lifecycle.snapshot().status).toBe("off");

    await execution.markReady();
    expect(execution.lifecycle.snapshot().status).toBe("running");

    await execution.startup.request();
    expect(execution.resourceStarts()).toBe(1);
  });

  test("does not restart after a manual stop or expiry", async () => {
    for (const finish of ["manual", "expired"] as const) {
      const execution = fakeExecution("paper");
      await execution.markReady();
      await execution.arm();
      await execution.lifecycle.stop(finish);

      await execution.startup.request();

      expect(execution.lifecycle.snapshot().status).toBe(finish === "manual" ? "off" : "expired");
      expect(execution.resourceStarts()).toBe(1);
    }
  });

  test("manual start before first recovery cancels the startup request", async () => {
    const execution = fakeExecution("paper");
    await execution.arm();
    execution.makeReady();
    await execution.lifecycle.start();
    await execution.lifecycle.stop();

    await execution.startup.request();

    expect(execution.lifecycle.snapshot().status).toBe("off");
    expect(execution.resourceStarts()).toBe(1);
  });

  test("leaves real mode manual even when execution resources are ready", async () => {
    const execution = fakeExecution("real");

    await execution.markReady();
    await execution.arm();

    expect(execution.lifecycle.snapshot().status).toBe("off");
    expect(execution.resourceStarts()).toBe(0);
  });
});

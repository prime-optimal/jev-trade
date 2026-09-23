import type { RunStatus } from "./run-lifecycle";

type StartupAutostartOptions = {
  status: () => RunStatus;
  anyReady: () => boolean;
  start: () => Promise<unknown>;
};

export type StartupAutostart = {
  arm(mode: "paper" | "real"): Promise<void>;
  observe(status: RunStatus): void;
  request(): Promise<void>;
};

/** One-shot paper run request owned by this process startup. */
export function createStartupAutostart(options: StartupAutostartOptions): StartupAutostart {
  let pending = false;

  const request = async () => {
    if (!pending || options.status() !== "off" || !options.anyReady()) return;
    pending = false;
    await options.start();
  };

  return {
    arm: async (mode) => {
      pending = mode === "paper";
      await request();
    },
    observe: (status) => {
      if (status !== "off") pending = false;
    },
    request,
  };
}

import { createDecisionStore } from "./decision-store";
import { config, runtimeEnv } from "./config";
import { createExecutionRuntime } from "./execution-runtime";
import { safeTransportMessage } from "./hyperliquid";
import { createOperatorControl } from "./operator-control";
import { createPaperSessions } from "./paper-sessions";
import { startServer } from "./server";
import { loadSleeves } from "./sleeves";

const OPERATOR_OWNER_ID = "operator";
const decisionStore = createDecisionStore();
await decisionStore.ready();
const runtime = createExecutionRuntime({
  specs: loadSleeves(),
  journal: { enqueue: (event) => decisionStore.enqueue(OPERATOR_OWNER_ID, event) },
});
const sessions = createPaperSessions({
  store: decisionStore,
  ownerSecret: runtimeEnv.DECISION_OWNER_SECRET,
});
const server = startServer(runtime.meta, runtime.views, runtime.lifecycle.snapshot, {
  fetch: (request) => sessions.fetch(request),
});
runtime.attachSink(server);

const operator = createOperatorControl({
  lifecycle: runtime.lifecycle,
  rebuild: runtime.rebuild,
  decisionStore,
  decisionOwnerId: OPERATOR_OWNER_ID,
});
await runtime.rebuild(operator.runtime.settings(), operator.runtime.credential());
runtime.lifecycle.applyDuration(operator.runtime.settings().runDurationMinutes);
await runtime.armAutostart(operator.runtime.settings().mode);
operator.listen();

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  operator.close();
  server.close();
  const runtimeDrain = runtime.dispose();
  const drains = await Promise.allSettled([sessions.close(), runtimeDrain]);
  const failures = drains.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
  try {
    await decisionStore.close();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length) throw new AggregateError(failures, "shutdown did not drain cleanly");
};
const exitAfterShutdown = () => {
  void shutdown().then(
    () => process.exit(0),
    (error) => {
      console.error("shutdown failed:", safeTransportMessage(error).slice(0, 240));
      process.exit(1);
    },
  );
};
process.once("SIGINT", exitAfterShutdown);
process.once("SIGTERM", exitAfterShutdown);

console.log(`jev-trade ready ${runtime.lifecycle.snapshot().status} model=${runtime.meta.model}${config.model === "jev" ? ` ${config.jevProvider}` : ""} :${server.port}`);

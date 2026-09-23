import { config } from "./config";
import { createExecutionRuntime } from "./execution-runtime";
import { createOperatorControl } from "./operator-control";
import { createPaperSessions } from "./paper-sessions";
import { startServer } from "./server";
import { loadSleeves } from "./sleeves";

const runtime = createExecutionRuntime({ specs: loadSleeves() });
const sessions = createPaperSessions();
const server = startServer(runtime.meta, runtime.views, runtime.lifecycle.snapshot, {
  fetch: (request) => sessions.fetch(request),
});
runtime.attachSink(server);

const operator = createOperatorControl({ lifecycle: runtime.lifecycle, rebuild: runtime.rebuild });
await runtime.rebuild(operator.runtime.settings(), operator.runtime.credential());
runtime.lifecycle.applyDuration(operator.runtime.settings().runDurationMinutes);
await runtime.armAutostart(operator.runtime.settings().mode);
operator.listen();

console.log(`jev-trade ready ${runtime.lifecycle.snapshot().status} model=${runtime.meta.model}${config.model === "jev" ? ` ${config.jevProvider}` : ""} :${server.port}`);

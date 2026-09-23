import { createModel } from "./model";
import { startServer } from "./server";

const server = startServer(createModel());
console.log(`jev inference ready :${server.port}`);

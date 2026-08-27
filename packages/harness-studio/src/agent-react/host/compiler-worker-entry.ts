import { parentPort } from "node:worker_threads";
import { createOxcCompiler } from "../kernel/index.js";
import {
  isOxcWorkerRequest,
  OXC_WORKER_RESPONSE,
  type OxcWorkerResponse,
} from "./compiler-worker-protocol.js";

if (parentPort === null) throw new Error("The AgentReact compiler entry must run inside a Worker.");
const port = parentPort;

port.on("message", (value: unknown) => {
  if (!isOxcWorkerRequest(value)) return;
  const output = createOxcCompiler(value.limits).compileModule(value.input);
  void Promise.resolve(output).then((compiled) => {
    const response: OxcWorkerResponse = {
      type: OXC_WORKER_RESPONSE,
      requestId: value.requestId,
      output: compiled,
    };
    port.postMessage(response);
  });
});

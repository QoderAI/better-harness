import { access } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import {
  AGENT_REACT_PROFILE_VERSION,
  type CompileModuleInput,
  type CompileModuleOutput,
  type OxcCompilerPort,
} from "../contracts/index.js";
import {
  DEFAULT_OXC_COMPILE_LIMITS,
  OXC_COMPILER_VERSION,
  type OxcCompileLimits,
} from "../kernel/index.js";
import {
  isOxcWorkerResponse,
  OXC_WORKER_REQUEST,
  type OxcWorkerRequest,
} from "./compiler-worker-protocol.js";

export interface WorkerOxcCompiler extends OxcCompilerPort {
  close(): Promise<void>;
}

export interface WorkerOxcCompilerOptions {
  readonly timeoutMs?: number;
  readonly limits?: Partial<OxcCompileLimits>;
  readonly workerUrl?: URL;
  readonly createWorker?: (url: URL) => Worker;
}

export const DEFAULT_OXC_WORKER_TIMEOUT_MS = 5_000;

/**
 * Production Oxc adapter.
 *
 * Native parsing never runs on the Studio server thread. A timeout or crash
 * terminates the whole Worker, which is the only reliable cancellation boundary
 * for a synchronous native parser. The next call starts a clean Worker.
 */
export function createWorkerOxcCompiler(options: WorkerOxcCompilerOptions = {}): WorkerOxcCompiler {
  const timeoutMs = options.timeoutMs ?? DEFAULT_OXC_WORKER_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("The Oxc Worker timeout must be a positive safe integer.");
  }
  const limits = Object.freeze({ ...DEFAULT_OXC_COMPILE_LIMITS, ...(options.limits ?? {}) });
  const createWorker = options.createWorker ?? ((url: URL) => new Worker(url));
  let workerUrl = options.workerUrl;
  let worker: Worker | undefined;
  let requestId = 0;
  let closed = false;

  const reset = async (): Promise<void> => {
    const current = worker;
    worker = undefined;
    if (current !== undefined) await current.terminate();
  };

  return {
    compilerVersion: `${OXC_COMPILER_VERSION}+worker`,
    profileVersion: AGENT_REACT_PROFILE_VERSION,
    policyFingerprint: JSON.stringify({ limits, timeoutMs, transport: "worker_threads" }),
    async compileModule(input: CompileModuleInput): Promise<CompileModuleOutput> {
      if (closed) throw new Error("The Oxc Worker compiler is closed.");
      workerUrl ??= await resolveCompilerWorkerUrl();
      const active = worker ??= createWorker(workerUrl);
      requestId += 1;
      const mine = requestId;
      const request: OxcWorkerRequest = {
        type: OXC_WORKER_REQUEST,
        requestId: mine,
        input,
        limits,
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await new Promise<CompileModuleOutput>((resolve, reject) => {
          const cleanup = (): void => {
            if (timer !== undefined) clearTimeout(timer);
            active.off("message", onMessage);
            active.off("error", onError);
            active.off("exit", onExit);
          };
          const onMessage = (value: unknown): void => {
            if (!isOxcWorkerResponse(value) || value.requestId !== mine) return;
            cleanup();
            resolve(value.output);
          };
          const onError = (error: Error): void => {
            cleanup();
            reject(error);
          };
          const onExit = (code: number): void => {
            if (code === 0) return;
            cleanup();
            reject(new Error(`Oxc Worker exited with code ${code}.`));
          };
          active.on("message", onMessage);
          active.once("error", onError);
          active.once("exit", onExit);
          timer = setTimeout(() => {
            cleanup();
            reject(new OxcWorkerDeadlineExceeded());
          }, timeoutMs);
          active.postMessage(request);
        });
      } catch (error) {
        await reset();
        return {
          module: input.module.path,
          diagnostics: [{
            level: "error",
            code: "limit/compile-timeout",
            message: error instanceof OxcWorkerDeadlineExceeded
              ? `Module compilation exceeded the ${timeoutMs}ms Worker deadline.`
              : "The isolated Oxc compiler failed and was restarted.",
            module: input.module.path,
          }],
        };
      }
    },
    async close() {
      closed = true;
      await reset();
    },
  };
}

class OxcWorkerDeadlineExceeded extends Error {}

async function resolveCompilerWorkerUrl(): Promise<URL> {
  const adjacent = new URL("./compiler-worker-entry.js", import.meta.url);
  try {
    await access(fileURLToPath(adjacent));
    return adjacent;
  } catch {
    // Vitest imports TypeScript from src/, while npm test has already built the
    // worker into dist/. Resolve that emitted entry without teaching production
    // code about a test runner or requiring a TypeScript loader in the Worker.
    const sourceMarker = "/src/agent-react/host/worker-oxc-compiler.ts";
    const sourcePath = fileURLToPath(import.meta.url).split("\\").join("/");
    if (!sourcePath.endsWith(sourceMarker)) throw new Error("The emitted Oxc Worker entry is unavailable.");
    const packageRoot = sourcePath.slice(0, -sourceMarker.length);
    return pathToFileURL(`${packageRoot}/dist/agent-react/host/compiler-worker-entry.js`);
  }
}

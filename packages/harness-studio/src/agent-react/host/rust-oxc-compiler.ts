import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createSemanticOxcCompiler, type NativeOxcBackend, type NativeOxcError } from "../kernel/index.js";
import { DEFAULT_OXC_COMPILE_LIMITS, type OxcCompileLimits } from "../kernel/index.js";
import type { ManagedOxcCompiler } from "./compiler-factory.js";

const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_PENDING = 16;
/** One re-queue after another request killed the service; bounds restart storms. */
const MAX_RESTARTS = 1;
export const RUST_OXC_COMPILER_VERSION = "oxc-rust-0.147.0+jsonl-v1";

export interface RustOxcCompilerOptions {
  readonly executable: string;
  /** Trusted desktop host selection; NSXPC never silently falls back to stdio. */
  readonly transport?: "stdio" | "nsxpc";
  readonly timeoutMs?: number;
  readonly limits?: Partial<OxcCompileLimits>;
  /** Host/test seam; never supplied by renderer requests. */
  readonly spawnProcess?: (executable: string) => ChildProcessWithoutNullStreams;
}
export interface RustOxcCompiler extends ManagedOxcCompiler {
  /** Last compiler service PID, retained after close for isolation receipts. */
  readonly processId: number | undefined;
  readonly bridgeProcessId: number | undefined;
}
interface Queued {
  readonly id: number;
  readonly method: "parse" | "transform";
  readonly frame: string;
  readonly resolve: (value: Record<string, unknown>) => void;
  readonly reject: (error: Error) => void;
  restarts: number;
}
interface Inflight extends Queued {
  readonly timer: ReturnType<typeof setTimeout>;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function nativeErrors(value: unknown): value is NativeOxcError[] {
  return Array.isArray(value) && value.every((item) => record(item)
    && typeof item.message === "string"
    && (item.labels === undefined || (Array.isArray(item.labels) && item.labels.every((label) => record(label)
      && Number.isSafeInteger(label.start) && Number(label.start) >= 0))));
}
function validResult(value: unknown, method: Queued["method"]): value is Record<string, unknown> {
  if (!record(value) || !nativeErrors(value.errors)) return false;
  if (method === "parse") return value.errors.length > 0 || (record(value.program)
    && value.program.type === "Program" && Array.isArray(value.program.body));
  return typeof value.code === "string" && (value.map === undefined || value.map === null || record(value.map));
}

/** Dedicated Rust process per compiler/build; no native addon imports in this module. */
export function createRustOxcCompiler(options: RustOxcCompilerOptions): RustOxcCompiler {
  const transport = options.transport ?? "stdio";
  if (transport !== "stdio" && transport !== "nsxpc") throw new TypeError("Unknown OXC transport.");
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new RangeError("OXC service timeout must be a positive safe integer.");
  const limits = { ...DEFAULT_OXC_COMPILE_LIMITS, ...options.limits };
  for (const key of ["maxModuleBytes", "maxOutputBytes"] as const) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0 || limits[key] > DEFAULT_OXC_COMPILE_LIMITS[key]) {
      throw new RangeError(`OXC service ${key} exceeds the supported policy.`);
    }
  }
  const launch = options.spawnProcess ?? ((executable: string) => spawn(executable, [], { stdio: "pipe", windowsHide: true }));
  let child: ChildProcessWithoutNullStreams | undefined;
  let lastPid: number | undefined;
  let bridgePid: number | undefined;
  let sequence = 0;
  let closed = false;
  let inflight: Inflight | undefined;
  const queue: Queued[] = [];
  const exiting = new Set<Promise<void>>();

  /**
   * The service compiles one request at a time, so only the in-flight request is
   * implicated in a failure. Queued requests were never written and carry no side
   * effect: re-queue them onto a fresh process instead of failing them for another
   * request's fault, and give up after MAX_RESTARTS so a service that cannot run
   * cannot spin up processes indefinitely.
   */
  const fail = (active: ChildProcessWithoutNullStreams, error: Error): void => {
    if (child !== active) return;
    child = undefined;
    const failed = inflight;
    inflight = undefined;
    if (failed) { clearTimeout(failed.timer); failed.reject(error); }
    active.kill("SIGKILL");
    for (const request of queue.splice(0)) {
      if (request.restarts >= MAX_RESTARTS) request.reject(error);
      else { request.restarts += 1; queue.push(request); }
    }
    pump();
  };
  /** Writes at most one request at a time so a deadline measures service work, not queue depth. */
  const pump = (): void => {
    if (inflight || queue.length === 0 || closed) return;
    const next = queue.shift()!;
    let active: ChildProcessWithoutNullStreams;
    try { active = start(); }
    catch (error) {
      next.reject(error instanceof Error ? error : new Error("OXC Rust service could not start."));
      pump();
      return;
    }
    const timer = setTimeout(() => fail(active, new Error(`OXC Rust service exceeded the ${timeoutMs}ms deadline.`)), timeoutMs);
    inflight = { ...next, timer };
    active.stdin.write(next.frame, (error) => { if (error) fail(active, new Error("OXC service write failed.")); });
  };
  const start = (): ChildProcessWithoutNullStreams => {
    if (child) return child;
    const active = child = launch(options.executable);
    bridgePid = active.pid;
    lastPid = transport === "stdio" ? active.pid : undefined;
    let buffer = Buffer.alloc(0);
    const exited = new Promise<void>((resolve) => active.once("close", resolve));
    exiting.add(exited);
    void exited.then(() => exiting.delete(exited));
    active.stderr.resume(); // Drain diagnostics without unbounded accumulation or mixing stdout frames.
    active.on("error", () => fail(active, new Error("OXC Rust service could not start.")));
    active.stdin.on("error", () => fail(active, new Error("OXC Rust service input closed.")));
    active.on("exit", () => fail(active, new Error("OXC Rust service exited during compilation.")));
    active.stdout.on("data", (chunk: Buffer) => {
      if (child !== active) return;
      if (buffer.length + chunk.length > MAX_FRAME_BYTES + 1) { fail(active, new Error("OXC service response exceeds its frame limit.")); return; }
      buffer = Buffer.concat([buffer, chunk]);
      let newline: number;
      while ((newline = buffer.indexOf(10)) !== -1) {
        const frame = buffer.subarray(0, newline);
        buffer = buffer.subarray(newline + 1);
        let value: unknown;
        try { value = JSON.parse(frame.toString("utf8")); }
        catch { fail(active, new Error("OXC service returned malformed JSON.")); return; }
        if (!record(value) || value.version !== 1 || !Number.isSafeInteger(value.id)) {
          fail(active, new Error("OXC service returned an invalid envelope.")); return;
        }
        const request = inflight;
        if (!request || request.id !== Number(value.id)) { fail(active, new Error("OXC service returned an unknown request id.")); return; }
        const validIdentity = transport === "stdio"
          ? value.pid === active.pid && value.transport === undefined
          : value.transport === "nsxpc" && value.bridgePid === active.pid
            && Number.isSafeInteger(value.pid) && Number(value.pid) > 0 && value.pid !== active.pid
            && (lastPid === undefined || value.pid === lastPid);
        if (!validIdentity || !validResult(value.result, request.method)) {
          fail(active, new Error("OXC service failed or returned an invalid result.")); return;
        }
        lastPid = Number(value.pid);
        clearTimeout(request.timer);
        inflight = undefined;
        request.resolve(value.result);
        pump();
      }
    });
    return active;
  };

  const call = async (method: Queued["method"], filename: string, source: string): Promise<Record<string, unknown>> => {
    if (closed) throw new Error("OXC Rust compiler is closed.");
    if (queue.length + (inflight ? 1 : 0) >= MAX_PENDING) throw new Error("OXC service queue is full.");
    const id = ++sequence;
    if (id > 0xffffffff) throw new Error("OXC request ids exhausted.");
    const frame = JSON.stringify({ version: 1, id, method, filename, source }) + "\n";
    if (Buffer.byteLength(frame) > MAX_REQUEST_BYTES) throw new Error("OXC service request exceeds its frame limit.");
    return await new Promise((resolve, reject) => {
      queue.push({ id, method, frame, resolve, reject, restarts: 0 });
      pump();
    });
  };
  const backend: NativeOxcBackend = {
    async parse(filename, source) {
      const value = await call("parse", filename, source);
      return { program: value.program, errors: value.errors as NativeOxcError[] };
    },
    async transform(filename, source) {
      const value = await call("transform", filename, source);
      return { code: value.code as string, ...(value.map == null ? {} : { map: value.map }), errors: value.errors as NativeOxcError[] };
    },
  };
  const semantic = createSemanticOxcCompiler(backend, RUST_OXC_COMPILER_VERSION, limits);
  return {
    ...semantic,
    policyFingerprint: JSON.stringify({ limits, timeoutMs, transport: transport === "nsxpc" ? "rust-nsxpc-v1" : "rust-jsonl-v1" }),
    get processId() { return lastPid; },
    get bridgeProcessId() { return bridgePid; },
    async compileModule(input) {
      if (closed) throw new Error("OXC Rust compiler is closed.");
      try { return await semantic.compileModule(input); }
      catch {
        return { module: input.module.path, diagnostics: [{ level: "error", code: "limit/compile-timeout", module: input.module.path,
          message: "The isolated Rust OXC service failed, was cancelled, or exceeded its deadline; retry with a fresh process." }] };
      }
    },
    async close() {
      closed = true;
      for (const request of queue.splice(0)) request.reject(new Error("OXC Rust compiler is closed."));
      if (child) fail(child, new Error("OXC Rust compiler is closed."));
      await Promise.all([...exiting]);
    },
  };
}

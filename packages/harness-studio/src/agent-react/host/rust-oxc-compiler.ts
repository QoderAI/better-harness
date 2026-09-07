import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createSemanticOxcCompiler, type NativeOxcBackend, type NativeOxcError } from "../kernel/index.js";
import { DEFAULT_OXC_COMPILE_LIMITS, type OxcCompileLimits } from "../kernel/index.js";
import type { ManagedOxcCompiler } from "./compiler-factory.js";

const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_PENDING = 16;
export const RUST_OXC_COMPILER_VERSION = "oxc-rust-0.147.0+jsonl-v1";

export interface RustOxcCompilerOptions {
  readonly executable: string;
  readonly timeoutMs?: number;
  readonly limits?: Partial<OxcCompileLimits>;
  /** Host/test seam; never supplied by renderer requests. */
  readonly spawnProcess?: (executable: string) => ChildProcessWithoutNullStreams;
}
export interface RustOxcCompiler extends ManagedOxcCompiler {
  /** Last child PID, retained after close for process-isolation receipts. */
  readonly processId: number | undefined;
}
interface Pending {
  readonly method: "parse" | "transform";
  readonly resolve: (value: Record<string, unknown>) => void;
  readonly reject: (error: Error) => void;
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
function validResult(value: unknown, method: Pending["method"]): value is Record<string, unknown> {
  if (!record(value) || !nativeErrors(value.errors)) return false;
  if (method === "parse") return value.errors.length > 0 || (record(value.program)
    && value.program.type === "Program" && Array.isArray(value.program.body));
  return typeof value.code === "string" && (value.map === undefined || value.map === null || record(value.map));
}

/** Dedicated Rust process per compiler/build; no native addon imports in this module. */
export function createRustOxcCompiler(options: RustOxcCompilerOptions): RustOxcCompiler {
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
  let sequence = 0;
  let closed = false;
  const pending = new Map<number, Pending>();
  const exiting = new Set<Promise<void>>();

  const fail = (active: ChildProcessWithoutNullStreams, error: Error): void => {
    if (child !== active) return;
    child = undefined;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
    pending.clear();
    active.kill("SIGKILL");
  };
  const start = (): ChildProcessWithoutNullStreams => {
    if (child) return child;
    const active = child = launch(options.executable);
    lastPid = active.pid;
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
        const request = pending.get(Number(value.id));
        if (!request) { fail(active, new Error("OXC service returned an unknown request id.")); return; }
        if (value.pid !== active.pid || !validResult(value.result, request.method)) {
          fail(active, new Error("OXC service failed or returned an invalid result.")); return;
        }
        clearTimeout(request.timer);
        pending.delete(Number(value.id));
        request.resolve(value.result);
      }
    });
    return active;
  };

  const call = async (method: Pending["method"], filename: string, source: string): Promise<Record<string, unknown>> => {
    if (closed) throw new Error("OXC Rust compiler is closed.");
    if (pending.size >= MAX_PENDING) throw new Error("OXC service queue is full.");
    const id = ++sequence;
    if (id > 0xffffffff) throw new Error("OXC request ids exhausted.");
    const frame = JSON.stringify({ version: 1, id, method, filename, source }) + "\n";
    if (Buffer.byteLength(frame) > MAX_REQUEST_BYTES) throw new Error("OXC service request exceeds its frame limit.");
    const active = start();
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(active, new Error(`OXC Rust service exceeded the ${timeoutMs}ms deadline.`)), timeoutMs);
      pending.set(id, { method, resolve, reject, timer });
      active.stdin.write(frame, (error) => { if (error) fail(active, new Error("OXC service write failed.")); });
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
    policyFingerprint: JSON.stringify({ limits, timeoutMs, transport: "rust-jsonl-v1" }),
    get processId() { return lastPid; },
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
      if (child) fail(child, new Error("OXC Rust compiler is closed."));
      await Promise.all([...exiting]);
    },
  };
}

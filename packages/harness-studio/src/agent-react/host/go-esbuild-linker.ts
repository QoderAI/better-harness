import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { Diagnostic } from "../contracts/index.js";
import { entryModuleSource, type LinkResult, type ManagedArtifactLinker } from "../linker/index.js";

export const GO_ESBUILD_LINKER_VERSION = "esbuild-go-0.28.2+link-v1";
const MAX_FRAME = 64 * 1024 * 1024;
const MAX_PENDING = 16;
/** One re-queue after another request killed the service; bounds restart storms. */
const MAX_RESTARTS = 1;

export interface GoEsbuildLinkerOptions {
  readonly executable: string;
  readonly transport?: "stdio" | "nsxpc";
  readonly timeoutMs?: number;
  /** Trusted host/test seam, never supplied by artifact source or HTTP input. */
  readonly spawnProcess?: (executable: string) => ChildProcessWithoutNullStreams;
}
export interface GoEsbuildLinker extends ManagedArtifactLinker {
  readonly processId: number | undefined;
  readonly bridgeProcessId: number | undefined;
}
interface Queued {
  readonly id: number;
  readonly frame: string;
  readonly resolve: (result: LinkResult) => void;
  readonly reject: (error: Error) => void;
  readonly maxOutputBytes: number;
  restarts: number;
}
interface Inflight extends Queued {
  readonly timer: ReturnType<typeof setTimeout>;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function diagnostic(value: unknown): value is Diagnostic {
  return record(value) && (value.level === "error" || value.level === "warning")
    && typeof value.code === "string" && ["link/failed", "link/package-not-allowed", "limit/output-bytes"].includes(value.code)
    && typeof value.message === "string"
    && (value.module === undefined || typeof value.module === "string")
    && (value.line === undefined || (Number.isSafeInteger(value.line) && Number(value.line) > 0))
    && (value.column === undefined || (Number.isSafeInteger(value.column) && Number(value.column) >= 0));
}
function validResult(value: unknown, maxOutputBytes: number): value is LinkResult {
  if (!record(value) || !Array.isArray(value.diagnostics) || !value.diagnostics.every(diagnostic)) return false;
  const hasError = value.diagnostics.some((entry) => entry.level === "error");
  return value.status === "ready"
    ? !hasError && typeof value.bundle === "string" && Buffer.byteLength(value.bundle) <= maxOutputBytes
    : value.status === "failed" && hasError && (value.bundle === undefined || value.bundle === "");
}

/** A bounded process bridge with strict engine/transport identity and no fallback. */
export function createGoEsbuildLinker(options: GoEsbuildLinkerOptions): GoEsbuildLinker {
  const transport = options.transport ?? "stdio";
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!["stdio", "nsxpc"].includes(transport)) throw new TypeError("Unknown esbuild transport.");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) throw new RangeError("Invalid esbuild deadline.");
  const launch = options.spawnProcess ?? ((executable: string) => spawn(executable, [], { stdio: "pipe", windowsHide: true }));
  let child: ChildProcessWithoutNullStreams | undefined;
  let lastPid: number | undefined;
  let bridgePid: number | undefined;
  let closed = false;
  let sequence = 0;
  let inflight: Inflight | undefined;
  const queue: Queued[] = [];
  const exiting = new Set<Promise<void>>();

  /**
   * The service links one request at a time, so only the in-flight request is
   * implicated in a failure. Queued requests were never written and carry no side
   * effect: re-queue them onto a fresh process instead of failing them for another
   * request's fault, and give up after MAX_RESTARTS so a service that cannot run
   * cannot spin up processes indefinitely.
   */
  function fail(active: ChildProcessWithoutNullStreams, reason: string): void {
    if (child !== active) return;
    child = undefined;
    const failed = inflight;
    inflight = undefined;
    if (failed) { clearTimeout(failed.timer); failed.reject(new Error(reason)); }
    active.kill("SIGKILL");
    for (const request of queue.splice(0)) {
      if (request.restarts >= MAX_RESTARTS) request.reject(new Error(reason));
      else { request.restarts += 1; queue.push(request); }
    }
    pump();
  }
  /** Writes at most one request at a time so a deadline measures service work, not queue depth. */
  function pump(): void {
    if (inflight || queue.length === 0 || closed) return;
    const next = queue.shift()!;
    let active: ChildProcessWithoutNullStreams;
    try { active = start(); }
    catch { next.reject(new Error("Go esbuild service could not start.")); pump(); return; }
    const timer = setTimeout(() => fail(active, "Go esbuild exceeded its deadline."), timeoutMs);
    inflight = { ...next, timer };
    active.stdin.write(next.frame, (error) => { if (error) fail(active, "Go esbuild write failed."); });
  }
  function start(): ChildProcessWithoutNullStreams {
    if (child) return child;
    const active = child = launch(options.executable);
    bridgePid = active.pid;
    lastPid = transport === "stdio" ? active.pid : undefined;
    const exited = new Promise<void>((resolve) => active.once("close", resolve));
    exiting.add(exited);
    void exited.then(() => exiting.delete(exited));
    let chunks: Buffer[] = [];
    let bytes = 0;
    active.stderr.resume();
    active.on("error", () => fail(active, "Go esbuild service could not start."));
    active.stdin.on("error", () => fail(active, "Go esbuild input closed."));
    active.on("exit", () => fail(active, "Go esbuild service exited."));
    active.stdout.on("data", (chunk: Buffer) => {
      if (child !== active) return;
      let offset = 0;
      while (offset < chunk.length) {
        const end = chunk.indexOf(10, offset);
        const part = chunk.subarray(offset, end === -1 ? chunk.length : end);
        bytes += part.length;
        if (bytes > MAX_FRAME) { fail(active, "Go esbuild response exceeds its frame limit."); return; }
        chunks.push(part);
        if (end === -1) return;
        let value: unknown;
        try { value = JSON.parse(Buffer.concat(chunks, bytes).toString("utf8")); }
        catch { fail(active, "Go esbuild returned malformed JSON."); return; }
        chunks = []; bytes = 0; offset = end + 1;
        if (!record(value) || value.version !== 1 || !Number.isSafeInteger(value.id) || value.engineVersion !== GO_ESBUILD_LINKER_VERSION) {
          fail(active, "Go esbuild returned an incompatible envelope."); return;
        }
        const request = inflight && inflight.id === Number(value.id) ? inflight : undefined;
        const validIdentity = transport === "stdio"
          ? value.pid === active.pid && value.transport === undefined
          : value.transport === "nsxpc" && value.bridgePid === active.pid
            && Number.isSafeInteger(value.pid) && Number(value.pid) > 0 && value.pid !== active.pid
            && (lastPid === undefined || lastPid === value.pid);
        if (!request || !validIdentity || !validResult(value.result, request.maxOutputBytes)) {
          fail(active, "Go esbuild returned an invalid result or process identity."); return;
        }
        lastPid = Number(value.pid);
        clearTimeout(request.timer);
        inflight = undefined;
        request.resolve(value.result);
        pump();
      }
    });
    return active;
  }

  return {
    linkerVersion: GO_ESBUILD_LINKER_VERSION,
    policyFingerprint: JSON.stringify({ transport, timeoutMs, maxFrame: MAX_FRAME, resolver: "agent-react-vfs-es2022-v1" }),
    get processId() { return lastPid; },
    get bridgeProcessId() { return bridgePid; },
    async link(input) {
      if (closed) throw new Error("Go esbuild linker is closed.");
      if (input.compiledModules.size > 512 || [...input.compiledModules.values()].some((code) => Buffer.byteLength(code) > 1024 * 1024)
        || [...input.compiledModules.values()].reduce((total, code) => total + Buffer.byteLength(code), 0) > 32 * 1024 * 1024
        || !Number.isSafeInteger(input.maxOutputBytes) || input.maxOutputBytes <= 0 || input.maxOutputBytes > 16 * 1024 * 1024) {
        return { status: "failed", diagnostics: [{ level: "error", code: "link/failed", message: "Go esbuild input exceeds its supported limits." }] };
      }
      const id = ++sequence;
      const frame = JSON.stringify({ version: 1, id, method: "link", entryModule: input.entryModule,
        entrySource: entryModuleSource(input.entryModule),
        modules: [...input.compiledModules].map(([path, code]) => ({ path, code })),
        runtimePackages: input.resolver.allowedPackages.map((specifier) => ({ specifier, external: input.resolver.resolveRuntimePackage(specifier) })),
        maxOutputBytes: input.maxOutputBytes,
      }) + "\n";
      if (Buffer.byteLength(frame) > MAX_FRAME || id > 0xffffffff) {
        return { status: "failed", diagnostics: [{ level: "error", code: "link/failed", message: "Go esbuild request exceeds its frame or sequence limit." }] };
      }
      try {
        if (queue.length + (inflight ? 1 : 0) >= MAX_PENDING) throw new Error("Go esbuild queue is full.");
        return await new Promise<LinkResult>((resolve, reject) => {
          queue.push({ id, frame, resolve, reject, maxOutputBytes: input.maxOutputBytes, restarts: 0 });
          pump();
        });
      } catch {
        return { status: "failed", diagnostics: [{ level: "error", code: "limit/compile-timeout",
          message: "The isolated Go esbuild service failed, was cancelled, or exceeded its deadline; retry with a fresh build." }] };
      }
    },
    async close() {
      closed = true;
      for (const request of queue.splice(0)) request.reject(new Error("Go esbuild linker is closed."));
      if (child) fail(child, "Go esbuild linker is closed.");
      await Promise.all([...exiting]);
    },
  };
}

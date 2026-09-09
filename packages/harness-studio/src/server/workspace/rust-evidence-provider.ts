import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { StudioWorkspaceDiscovery, StudioWorkspaceSessionProvider } from "../studio-types.js";

export const EVIDENCE_HOST_PROTOCOL_VERSION = "evidence-rust-1.0.0+jsonl-v1";
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_PENDING = 16;
/** One re-queue after another request killed the host; bounds restart storms. */
const MAX_RESTARTS = 1;

export interface RustEvidenceHostOptions {
  readonly executable: string;
  readonly transport?: "stdio" | "nsxpc";
  readonly timeoutMs?: number;
  readonly spawnProcess?: (executable: string) => ChildProcessWithoutNullStreams;
}

export interface RustEvidenceHost {
  readonly processId: number | undefined;
  readonly bridgeProcessId: number | undefined;
  describe(): Promise<Record<string, unknown>>;
  discover(params: {
    workspace: string;
    maxSessions?: number;
    includeToolTrace?: boolean;
    includeDialogue?: boolean;
  }): Promise<Record<string, unknown>>;
  observe(params: { workspace: string; sessions: unknown[] }): Promise<Record<string, unknown>>;
  discoverMemory(params: Record<string, unknown>): Promise<Record<string, unknown>>;
  readMemory(params: Record<string, unknown>): Promise<Record<string, unknown>>;
  analyzeSessionPerformance(params: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

interface Queued {
  readonly id: number;
  readonly method: string;
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

/**
 * One supervised evidence-host process. NSXPC never silently falls back to stdio.
 */
export function createRustEvidenceHost(options: RustEvidenceHostOptions): RustEvidenceHost {
  const transport = options.transport ?? "stdio";
  if (transport !== "stdio" && transport !== "nsxpc") throw new TypeError("Unknown evidence transport.");
  if (options.executable.trim().length === 0) throw new Error("The evidence host executable must be a non-empty path.");
  const timeoutMs = options.timeoutMs ?? 60_000;
  const launch = options.spawnProcess ?? ((executable: string) => spawn(executable, [], { stdio: "pipe", windowsHide: true }));
  let child: ChildProcessWithoutNullStreams | undefined;
  let sequence = 0;
  let closed = false;
  let transportProven = transport !== "nsxpc";
  let servicePid: number | undefined;
  let bridgePid: number | undefined;
  let inflight: Inflight | undefined;
  const queue: Queued[] = [];
  let buffer = "";
  let bufferBytes = 0;

  /**
   * The host answers one request at a time, so only the in-flight request is
   * implicated in a failure. Queued requests were never written and carry no side
   * effect: re-queue them onto a fresh process instead of failing them for another
   * request's fault, and give up after MAX_RESTARTS so a host that cannot run
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
  /** Writes at most one request at a time so a deadline measures host work, not queue depth. */
  const pump = (): void => {
    if (inflight || queue.length === 0 || closed) return;
    const next = queue.shift()!;
    let active: ChildProcessWithoutNullStreams;
    try { active = start(); }
    catch (error) {
      next.reject(error instanceof Error ? error : new Error("Evidence host could not start."));
      pump();
      return;
    }
    const timer = setTimeout(() => fail(active, new Error(`Evidence host ${next.method} timed out.`)), timeoutMs);
    inflight = { ...next, timer };
    active.stdin.write(`${next.frame}\n`, (error) => { if (error) fail(active, new Error("Evidence host input closed.")); });
  };

  const start = (): ChildProcessWithoutNullStreams => {
    if (child) return child;
    buffer = "";
    bufferBytes = 0;
    const active = child = launch(options.executable);
    bridgePid = active.pid;
    active.stderr.resume();
    active.on("error", () => fail(active, new Error("Evidence host could not start.")));
    active.stdin.on("error", () => fail(active, new Error("Evidence host input closed.")));
    active.on("exit", () => fail(active, new Error("Evidence host exited during a request.")));
    active.stdout.setEncoding("utf8");
    active.stdout.on("data", (chunk: string) => {
      if (child !== active) return;
      // Frame limits are byte limits: a decoded string counts UTF-16 units, so
      // multi-byte evidence would otherwise buy several times the stated budget.
      bufferBytes += Buffer.byteLength(chunk, "utf8");
      if (bufferBytes > MAX_FRAME_BYTES + 1) {
        fail(active, new Error("Evidence host response exceeds its frame limit."));
        return;
      }
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        bufferBytes -= Buffer.byteLength(line, "utf8") + 1;
        if (line.trim() === "") continue;
        let value: unknown;
        try { value = JSON.parse(line); } catch {
          fail(active, new Error("Evidence host returned malformed JSON."));
          return;
        }
        if (!record(value) || value.version !== 1) {
          fail(active, new Error("Evidence host returned an invalid envelope."));
          return;
        }
        const event = record(value.event) ? value.event : undefined;
        if (event?.type === "transport") {
          if (
            transport !== "nsxpc"
            || event.transport !== "nsxpc"
            || !Number.isInteger(event.servicePid)
            || !Number.isInteger(event.bridgePid)
            || Number(event.servicePid) <= 0
            || event.servicePid === event.bridgePid
          ) {
            fail(active, new Error("The evidence host did not prove an NSXPC service before its first frame; refusing a silent stdio fallback."));
            return;
          }
          transportProven = true;
          servicePid = Number(event.servicePid);
          bridgePid = Number(event.bridgePid);
          continue;
        }
        if (!transportProven) {
          fail(active, new Error("The evidence host did not prove an NSXPC service before its first frame; refusing a silent stdio fallback."));
          return;
        }
        if (!Number.isSafeInteger(value.id)) {
          fail(active, new Error("Evidence host returned an invalid envelope."));
          return;
        }
        const request = inflight;
        if (!request || request.id !== Number(value.id)) {
          fail(active, new Error("Evidence host returned an unknown request id."));
          return;
        }
        clearTimeout(request.timer);
        inflight = undefined;
        if (record(value.error)) {
          request.reject(new Error(typeof value.error.message === "string" ? value.error.message : "Evidence host request failed."));
        } else if (!record(value.result)) {
          request.reject(new Error("Evidence host returned an empty result."));
        } else {
          request.resolve(value.result);
        }
        pump();
      }
    });
    return active;
  };

  const call = (method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
    if (closed) return Promise.reject(new Error("Evidence host is closed."));
    if (queue.length + (inflight ? 1 : 0) >= MAX_PENDING) return Promise.reject(new Error("Evidence host queue is full."));
    const id = ++sequence;
    const frame = JSON.stringify({ version: 1, id, method, params });
    if (Buffer.byteLength(frame, "utf8") > MAX_REQUEST_BYTES) return Promise.reject(new Error("Evidence host request exceeds its frame limit."));
    return new Promise((resolve, reject) => {
      queue.push({ id, method, frame, resolve, reject, restarts: 0 });
      pump();
    });
  };

  return {
    get processId() { return transport === "nsxpc" ? servicePid : child?.pid; },
    get bridgeProcessId() { return bridgePid; },
    async describe() {
      const result = await call("host.describe");
      if (result.protocol !== EVIDENCE_HOST_PROTOCOL_VERSION) {
        throw new Error(`Unexpected evidence host protocol: ${String(result.protocol)}`);
      }
      return result;
    },
    discover(params) {
      return call("sessions.discover", params);
    },
    observe(params) {
      return call("artifacts.observe", params);
    },
    discoverMemory(params) { return call("memory.discover", params); },
    readMemory(params) { return call("memory.read", params); },
    analyzeSessionPerformance(params) { return call("sessions.performance", params); },
    async close() {
      if (closed) return;
      try { if (child) await call("shutdown"); } catch { /* process may already be gone */ }
      closed = true;
      // Read the child after the await: a request that timed out while shutdown was
      // queued restarts the host, and the process to reap is the current one.
      const active = child;
      child = undefined;
      const stopped = new Error("Evidence host is closed.");
      if (inflight) { clearTimeout(inflight.timer); inflight.reject(stopped); inflight = undefined; }
      for (const request of queue.splice(0)) request.reject(stopped);
      active?.kill("SIGKILL");
    },
  };
}

interface BundledRuntime {
  createInspectorWorkspaceSessionProvider(options?: {
    collect?: (input: Record<string, unknown>) => Promise<{ sessions: unknown[]; providers: unknown[] }>;
  }): { discover(workspacePath: string): Promise<StudioWorkspaceDiscovery> };
}

/**
 * Desktop Session provider: Rust discovers Grok/Qoder evidence; the bundled
 * Inspector runtime still builds git history and the workbench report.
 */
export function createRustEvidenceWorkspaceSessionProvider(
  host: RustEvidenceHost,
): StudioWorkspaceSessionProvider {
  let runtime: Promise<BundledRuntime> | undefined;
  return {
    async discover(workspacePath: string) {
      const collected = await host.discover({
        workspace: workspacePath,
        maxSessions: 100,
        includeToolTrace: true,
        includeDialogue: true,
      });
      runtime ??= import(new URL("../runtime/inspector-workspace-runtime.mjs", import.meta.url).href) as Promise<BundledRuntime>;
      const provider = (await runtime).createInspectorWorkspaceSessionProvider({
        collect: async () => ({
          sessions: Array.isArray(collected.sessions) ? collected.sessions : [],
          providers: Array.isArray(collected.providers) ? collected.providers : [],
        }),
      });
      return await provider.discover(workspacePath);
    },
  };
}

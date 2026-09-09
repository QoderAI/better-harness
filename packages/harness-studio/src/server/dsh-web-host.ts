import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { findExecutable } from "./acp-agent-catalog.js";

export interface DshWebCommand { command: string; args?: readonly string[] }
export interface DshDesignState { phase: "idle" | "compiling" | "waiting" | "activating" | "active" | "error"; entry: string; message: string; revision?: string }
export interface DshWebState { status: "stopped" | "starting" | "ready" | "error"; url?: string; error?: string; design?: DshDesignState }
export interface DshWebHost {
  state(): DshWebState;
  open(cwd: string): Promise<DshWebState>;
  stop(): Promise<void>;
  close(): Promise<void>;
}

/** Resolve npm's Windows shim to its JS entry; never pass a shell command string. */
export async function discoverDshWebCommand(): Promise<DshWebCommand | undefined> {
  const command = await findExecutable("dsh");
  if (!command) return undefined;
  if (process.platform !== "win32" || !/\.(cmd|bat)$/i.test(command)) return { command };
  try {
    const require = createRequire(join(dirname(command), "package.json"));
    const manifest = require.resolve("@deepseek-ai/dsh/package.json");
    const pkg = JSON.parse(await readFile(manifest, "utf8")) as { bin?: { dsh?: string } };
    const node = await findExecutable("node");
    return node && typeof pkg.bin?.dsh === "string"
      ? { command: node, args: [resolve(dirname(manifest), pkg.bin.dsh)] } : undefined;
  } catch { return undefined; }
}

/** Accept only the exact native Web readiness announcement and loopback authority. */
export function dshReadyUrl(line: string): string | undefined {
  if (!line.startsWith("dsh web: ")) return undefined;
  try {
    const url = new URL(line.slice("dsh web: ".length).trim());
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password || url.pathname !== "/" || !url.searchParams.get("token")) return undefined;
    return url.href;
  } catch { return undefined; }
}

interface Entry {
  cwd: string;
  child: ChildProcess;
  state: DshWebState;
  ready: Promise<DshWebState>;
  exited: Promise<void>;
  stopping?: Promise<void>;
  stopPolling?: () => void;
}

/** Lifecycle only: all frontend, authentication and interactive APIs stay in DSH. */
export function createDshWebHost(command: DshWebCommand, input: { startupTimeoutMs?: number; env?: NodeJS.ProcessEnv; designHome?: string; designRuntime?: string } = {}): DshWebHost {
  const entries = new Map<string, Entry>();
  let closed = false;
  let opening: Promise<DshWebState> | undefined;
  let stopping: Promise<void> | undefined;
  let generation = 0;
  async function terminate(entry: Entry): Promise<void> {
    entry.stopPolling?.();
    if (entry.stopping) return entry.stopping;
    entry.stopping = (async () => {
      if (entry.child.exitCode !== null || entry.child.signalCode !== null || !entry.child.pid) return;
      if (process.platform === "win32") {
        await new Promise<void>((resolveDone, rejectDone) => execFile("taskkill", ["/PID", String(entry.child.pid), "/T", "/F"], { windowsHide: true, timeout: 5000 }, error => {
          if (!error) { resolveDone(); return; }
          try { process.kill(entry.child.pid!, 0); rejectDone(new Error("Could not stop the DSH Web process.")); }
          catch (probe) { if ((probe as NodeJS.ErrnoException).code === "ESRCH") resolveDone(); else rejectDone(new Error("Could not confirm DSH Web stopped.")); }
        }));
      } else {
        const kill = (signal: NodeJS.Signals) => { try { process.kill(-entry.child.pid!, signal); } catch { /* already exited */ } };
        kill("SIGTERM");
        const timer = setTimeout(() => kill("SIGKILL"), 3000);
        await entry.exited;
        clearTimeout(timer);
      }
    })();
    return entry.stopping;
  }
  async function open(cwd: string): Promise<DshWebState> {
      const version = generation;
      const id = "desktop";
      if (closed) throw new Error("DSH host is shutting down.");
      const previous = entries.get(id);
      if (previous) {
        if (!previous.stopping && (previous.state.status === "starting" || previous.state.status === "ready")) return previous.ready;
        await terminate(previous);
        const replacement = entries.get(id);
        if (replacement !== previous && replacement) return replacement.ready;
      }
      if (closed) throw new Error("DSH host is shutting down.");
      let design: { home: string; profile: string; patch: string; token: string; entry: string } | undefined;
      if (input.designHome) {
        const capability = await import(input.designRuntime ? pathToFileURL(input.designRuntime).href : new URL("./runtime/dsh-design/index.mjs", import.meta.url).href);
        design = await capability.prepareDshDesignProfile({ home: input.designHome, cwd });
      }
      if (closed || version !== generation) throw new Error("DSH host is shutting down.");
      // Fixed flags are appended to a trusted host configuration, never renderer input.
      const child = spawn(command.command, [...(command.args ?? []), "--profile", design?.profile ?? "web", ...(design ? ["--patch", design.patch] : []), "--no-open", "--host", "127.0.0.1", "--port", "0"], {
        cwd, env: { ...(input.env ?? process.env), ...(design ? { DSH_HOME: design.home } : {}) }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32",
      });
      let settle!: (state: DshWebState) => void;
      let exit!: () => void;
      const entry: Entry = { cwd, child, state: { status: "starting" }, ready: new Promise(done => { settle = done; }), exited: new Promise(done => { exit = done; }) };
      entries.set(id, entry);
      const fail = (error: string) => { entry.stopPolling?.(); entry.state = { status: "error", error }; settle({ ...entry.state }); };
      const pollDesign = (url: string) => {
        if (!design) return;
        const controller = new AbortController();
        let pollTimer: ReturnType<typeof setTimeout>;
        const refresh = async () => {
          try {
            const response = await fetch(new URL("/harness-design/status", url), { headers: { "X-Harness-Design-Token": design!.token }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]) });
            if (!response.ok) throw new Error("Controller unavailable");
            const value = await response.json() as DshDesignState;
            if (!["idle", "compiling", "waiting", "activating", "active", "error"].includes(value.phase) || typeof value.message !== "string") throw new Error("Invalid controller status");
            if (!controller.signal.aborted) entry.state = { ...entry.state, design: { phase: value.phase, entry: design!.entry, message: value.message.slice(0, 2000), ...(typeof value.revision === "string" && /^[a-f0-9]{64}$/.test(value.revision) ? { revision: value.revision } : {}) } };
          } catch {
            if (!controller.signal.aborted) entry.state = { ...entry.state, design: { phase: "error", entry: design!.entry, message: "Harness Design controller is unavailable; plugin activation is unconfirmed." } };
          } finally { if (!controller.signal.aborted) pollTimer = setTimeout(() => void refresh(), 1000); }
        };
        entry.stopPolling = () => { controller.abort(); clearTimeout(pollTimer); };
        void refresh();
      };
      const timer = setTimeout(() => { fail("DSH Web did not become ready. Check the installed web profile and frontend, then retry."); void terminate(entry); }, input.startupTimeoutMs ?? 45000);
      let pending = "";
      child.stdout!.setEncoding("utf8");
      child.stdout!.on("data", (chunk: string) => {
        // Do not retain or forward subprocess diagnostics, which can contain credentials.
        pending += chunk;
        if (pending.length > 65536) { clearTimeout(timer); fail("DSH Web emitted an oversized startup record."); void terminate(entry); pending = ""; return; }
        let end: number;
        while ((end = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, end).replace(/\r$/, ""); pending = pending.slice(end + 1);
          const url = dshReadyUrl(line);
          if (url && entry.state.status === "starting") { clearTimeout(timer); entry.state = { status: "ready", url }; pollDesign(url); settle({ ...entry.state }); }
        }
      });
      child.stderr!.resume();
      child.on("error", () => { clearTimeout(timer); fail("Could not launch DSH Web. Check its executable and web profile."); exit(); });
      child.on("exit", () => { clearTimeout(timer); pending = ""; fail("DSH Web has exited. Reopen it to restore sessions in the official interface."); exit(); });
      return entry.ready;
  }
  async function stop(): Promise<void> {
    generation++;
    await Promise.all([...entries.values()].map(terminate));
    await opening?.catch(() => {});
    entries.clear();
  }
  return {
    state: () => ({ ...(entries.get("desktop")?.state ?? { status: opening ? "starting" : "stopped" }) }),
    open(cwd) {
      if (closed) return Promise.reject(new Error("DSH host is shutting down."));
      if (stopping) return Promise.reject(new Error("DSH host is stopping."));
      opening ??= open(cwd).finally(() => { opening = undefined; });
      return opening;
    },
    stop() { stopping ??= stop().finally(() => { stopping = undefined; }); return stopping; },
    async close() { closed = true; await (stopping ?? stop()); },
  };
}

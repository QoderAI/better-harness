import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { IPty } from "node-pty";
import { findExecutable } from "./acp-agent-catalog.js";

export interface PiCommand { command: string; args?: string[] }
export interface PiTerminalState { status: "stopped" | "ready" | "error"; id?: string; data?: string; cursor?: number; error?: string }
export interface PiTerminalHost {
  state(binding: string, cursor?: number): PiTerminalState;
  open(binding: string, cwd: string, appearance?: "light" | "dark"): Promise<PiTerminalState>;
  control(binding: string, id: string, input: { data?: string; cols?: number; rows?: number }): void;
  close(): Promise<void>;
}
export async function discoverPiCommand(): Promise<PiCommand | undefined> {
  const command = await findExecutable("pi");
  if (!command) return undefined;
  if (process.platform !== "win32" || !/\.(cmd|bat)$/i.test(command)) return { command };
  try {
    const require = createRequire(join(dirname(command), "package.json"));
    const entry = require.resolve("@earendil-works/pi-coding-agent");
    // Current npm entry is dist/index.js; resolve the package's declared CLI.
    const root = resolve(dirname(entry), "..");
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    const node = await findExecutable("node");
    return node && typeof pkg.bin?.pi === "string" ? { command: node, args: [resolve(root, pkg.bin.pi)] } : undefined;
  } catch { return undefined; }
}

interface Session { binding: string; id: string; pty: IPty; output: string; ended: boolean; error?: string; exited: Promise<void> }
/** Host only transports terminal bytes. Pi owns rendering, commands and tools. */
export function createPiTerminalHost(command: PiCommand, options: { env?: NodeJS.ProcessEnv; maxOutput?: number } = {}): PiTerminalHost {
  let session: Session | undefined, closed = false;
  let serial = Promise.resolve();
  async function stop() {
    const current = session;
    if (!current || current.ended) return;
    if (process.platform === "win32") {
      await new Promise<void>((done, reject) => execFile("taskkill", ["/PID", String(current.pty.pid), "/T", "/F"], { windowsHide: true, timeout: 5000 }, error => {
        if (!error || current.ended) done(); else reject(new Error("Could not stop Pi."));
      }));
    } else {
      const kill = (signal: NodeJS.Signals) => { try { process.kill(-current.pty.pid, signal); } catch { current.pty.kill(signal); } };
      kill("SIGTERM");
      const timer = setTimeout(() => { try { kill("SIGKILL"); } catch { /* exited */ } }, 2000);
      await current.exited;
      clearTimeout(timer);
    }
  }
  const state = (binding: string, cursor = 0): PiTerminalState => {
    if (!session || session.binding !== binding) return { status: "stopped" };
    const start = Math.min(Math.max(0, cursor), session.output.length);
    const end = Math.min(start + 131072, session.output.length);
    return { status: session.ended || session.error ? "error" : "ready", id: session.id,
      data: session.output.slice(start, end), cursor: end,
      ...(session.error || session.ended ? { error: session.error ?? "Pi has exited. Start it again to continue." } : {}) };
  };
  return {
    state,
    async open(binding, cwd, appearance) {
      // Serialize starts with shutdown so an import/spawn cannot escape close().
      const opening = serial.then(async () => {
        if (closed) throw new Error("Pi host is shutting down.");
        if (session?.binding === binding && !session.ended && !session.error) return state(binding);
        await stop();
        const { spawn } = await import("node-pty");
        const pty = spawn(command.command, command.args ?? [], { cwd, name: "xterm-256color", cols: 100, rows: 30,
          env: { ...(options.env ?? process.env), TERM: "xterm-256color", COLORTERM: "truecolor",
            ...(appearance ? { COLORFGBG: appearance === "light" ? "0;15" : "15;0" } : {}) } });
        let exited!: () => void;
        const current: Session = { binding, id: randomUUID(), pty, output: "", ended: false, exited: new Promise(done => { exited = done; }) };
        session = current;
        pty.onData(data => {
          if (current.error) return;
          if (current.output.length + data.length > (options.maxOutput ?? 4 * 1024 * 1024)) {
            current.error = "Pi terminal output limit reached. Start it again to continue.";
            void stop().catch(() => { current.error = "Could not stop Pi after its output limit."; });
          } else current.output += data;
        });
        pty.onExit(() => { current.ended = true; exited(); });
        return state(binding);
      });
      serial = opening.then(() => {}, () => {});
      return opening;
    },
    control(binding, id, input) {
      if (closed || !session || session.binding !== binding || session.id !== id || session.ended || session.error) throw new Error("Pi terminal session is no longer active.");
      if (input.data !== undefined && (typeof input.data !== "string" || input.data.length > 16384)) throw new Error("Invalid terminal input.");
      if (input.cols !== undefined || input.rows !== undefined) {
        if (!Number.isInteger(input.cols) || !Number.isInteger(input.rows) || input.cols! < 2 || input.cols! > 500 || input.rows! < 2 || input.rows! > 200) throw new Error("Invalid terminal dimensions.");
        session.pty.resize(input.cols!, input.rows!);
      }
      if (input.data !== undefined) session.pty.write(input.data);
    },
    async close() { closed = true; await serial; await stop(); session = undefined; },
  };
}

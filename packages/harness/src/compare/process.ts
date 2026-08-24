import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export interface CommandResult {
  command: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

const MAX_CAPTURE_BYTES = 1_000_000;
const KILL_ESCALATION_MS = 2_000;

/**
 * Resolve `npm` without a shell so validation commands also run on Windows,
 * where the `npm` entry point is a `.cmd` shim that `spawn` cannot execute.
 */
export function npmInvocation(args: string[]): { command: string; args: string[] } {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    join(dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  const cli = candidates.find((candidate) => candidate && candidate.endsWith(".js") && existsSync(candidate));
  return cli ? { command: process.execPath, args: [cli, ...args] } : { command: "npm", args };
}

export async function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number; env: NodeJS.ProcessEnv },
): Promise<CommandResult> {
  const started = Date.now();
  return await new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      // A process group lets a timeout stop the spawned tool and everything it started.
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const append = (current: string, chunk: Buffer): string => {
      if (Buffer.byteLength(current) >= MAX_CAPTURE_BYTES) return current;
      const remaining = MAX_CAPTURE_BYTES - Buffer.byteLength(current);
      return current + chunk.subarray(0, remaining).toString("utf8");
    };
    child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
    child.once("error", reject);
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, options.timeoutMs);
    child.once("close", (code) => {
      clearTimeout(timer);
      resolveResult({
        command: [command, ...args],
        exitCode: code ?? 1,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - started,
      });
    });
  });
}

/** Stop a timed-out tool together with the children it spawned. */
function killProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", () => child.kill("SIGKILL"));
    return;
  }
  signalGroup(pid, child, "SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) signalGroup(pid, child, "SIGKILL");
  }, KILL_ESCALATION_MS).unref();
}

function signalGroup(pid: number, child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    child.kill(signal);
  }
}

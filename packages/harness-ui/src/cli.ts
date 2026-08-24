#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PiSdkExecutor, QoderSdkExecutor } from "@qoder-ai/harness/exec";
import type { HarnessUiExecutorFactory } from "./run.js";
import { startHarnessUiServer } from "./server.js";

const builtInExecutorFactory: HarnessUiExecutorFactory = (context) => {
  if (context.runtimeId === "qoder") {
    return new QoderSdkExecutor({ onRunEvent: context.onRunEvent });
  }
  if (context.runtimeId === "pi") {
    return new PiSdkExecutor({ onRunEvent: context.onRunEvent });
  }
  throw new Error(`No built-in executor for runtime '${context.runtimeId}'.`);
};

const HELP = `harness-ui — serve a .harness assembly over the AG-UI protocol

Usage:
  harness-ui serve <file.harness> [options]
  harness-ui --help

Options:
  --harness <id>   Harness to resolve (default: the file's only harness)
  --runtime <id>   Target runtime (default: the file's only target)
  --port <n>       Listen port (default: 3210)
  --host <addr>    Bind address (default: 127.0.0.1)
  --allow-origin <origin>
                    Permit one exact browser origin (repeatable)
  --unsafe-allow-remote
                    Permit a non-loopback --host. POST /agui is unauthenticated
                    and runs a coding agent in --cwd; only use behind a gateway.
  --cwd <dir>      Working directory for executor runs (default: process cwd)
  --source-root <dir>
                    Root a 'source' skill's path locks and delivers against
                    (default: the directory containing <file.harness>)
  -h, --help       Print help without reading any file or opening a port

Endpoints:
  POST /agui       AG-UI RunAgentInput in, SSE stream of AG-UI events out
  GET  /healthz    Liveness probe
`;

export interface HarnessUiCliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/** Resolve the skill root owned by a `.harness` document. */
export function resolveHarnessUiSourceRoot(file: string, explicitRoot?: string): string {
  return explicitRoot ?? dirname(resolve(file));
}

interface ParsedArgs {
  command?: string;
  file?: string;
  harness?: string;
  runtime?: string;
  port: number;
  host: string;
  cwd?: string;
  sourceRoot?: string;
  allowedOrigins: string[];
  allowRemote: boolean;
  help: boolean;
  error?: string;
}

export function parseHarnessUiArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    port: 3210,
    host: "127.0.0.1",
    allowedOrigins: [],
    allowRemote: false,
    help: false,
  };
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const takeValue = (): string | undefined => {
      index += 1;
      return argv[index];
    };
    switch (arg) {
      case "-h":
      case "--help":
        parsed.help = true;
        break;
      case "--harness":
        parsed.harness = takeValue();
        break;
      case "--runtime":
        parsed.runtime = takeValue();
        break;
      case "--host":
        parsed.host = takeValue() ?? parsed.host;
        break;
      case "--cwd":
        parsed.cwd = takeValue();
        break;
      case "--source-root":
        parsed.sourceRoot = takeValue();
        break;
      case "--unsafe-allow-remote":
        parsed.allowRemote = true;
        break;
      case "--allow-origin": {
        const value = takeValue();
        if (value === undefined) {
          parsed.error = "--allow-origin requires an absolute http(s) origin.";
        } else {
          parsed.allowedOrigins.push(value);
        }
        break;
      }
      case "--port": {
        const value = Number(takeValue());
        if (!Number.isInteger(value) || value < 0 || value > 65535) {
          parsed.error = "--port must be an integer between 0 and 65535.";
        } else {
          parsed.port = value;
        }
        break;
      }
      default:
        if (arg.startsWith("-")) {
          parsed.error = `Unknown option '${arg}'.`;
        } else {
          positionals.push(arg);
        }
    }
  }
  parsed.command = positionals[0];
  parsed.file = positionals[1];
  return parsed;
}

/** In-process CLI entry; returns the exit code (0 keeps the server running). */
export async function runHarnessUiCli(argv: string[], io: HarnessUiCliIo): Promise<number> {
  const parsed = parseHarnessUiArgs(argv);
  if (parsed.help || argv.length === 0) {
    io.stdout(HELP);
    return 0;
  }
  if (parsed.error !== undefined) {
    io.stderr(`${parsed.error}\n`);
    return 2;
  }
  if (parsed.command !== "serve" || parsed.file === undefined) {
    io.stderr("Usage: harness-ui serve <file.harness> [options] (see --help)\n");
    return 2;
  }
  const source = await readFile(parsed.file, "utf8");
  // Skills are conventionally declared relative to their `.harness` file (see
  // examples/*.harness), so serving one without a flag still delivers them.
  const sourceRoot = resolveHarnessUiSourceRoot(parsed.file, parsed.sourceRoot);
  const started = await startHarnessUiServer({
    source,
    executorFactory: builtInExecutorFactory,
    port: parsed.port,
    host: parsed.host,
    allowRemote: parsed.allowRemote,
    sourceRoot,
    ...(parsed.harness !== undefined ? { harnessId: parsed.harness } : {}),
    ...(parsed.runtime !== undefined ? { runtimeId: parsed.runtime } : {}),
    ...(parsed.cwd !== undefined ? { cwd: parsed.cwd } : {}),
    ...(parsed.allowedOrigins.length > 0 ? { allowedOrigins: parsed.allowedOrigins } : {}),
  });
  if (parsed.allowRemote) {
    io.stderr(
      `Warning: ${started.url}/agui is reachable beyond loopback and has no authentication. ` +
        `Anyone who can route to it can run a coding agent in ${parsed.cwd ?? process.cwd()}.\n`,
    );
  }
  io.stdout(`AG-UI endpoint for ${parsed.file}: ${started.url}/agui\n`);
  return 0;
}

const invokedDirectly =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  runHarnessUiCli(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  }).then(
    (code) => {
      // Exit only on failure or pure-help invocations; a running server keeps
      // the event loop alive by itself.
      if (code !== 0) {
        process.exit(code);
      }
    },
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}

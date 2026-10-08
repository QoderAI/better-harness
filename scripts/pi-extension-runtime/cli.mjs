#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createExtensionCompiler } from "./compiler.mjs";

const help = `Experimental Pi extension runtime compiler

Usage:
  node scripts/pi-extension-runtime/cli.mjs build --entry <source.ts> --out <compiled.ts> [--json]
  node scripts/pi-extension-runtime/cli.mjs watch --entry <source.ts> --out <compiled.ts> [--json]
  node scripts/pi-extension-runtime/cli.mjs run --entry <source.ts> --out <compiled.ts> --pi-cli <installed-cli.js> [-- <Pi args>]

build: Compile once; failure preserves the previous output. Exit 1 on failure.
watch: Incrementally rebuild every 500 ms; report changes/errors. Ctrl+C stops.
run:   Compile, then launch official Pi. /harness-reload compiles and reloads.
       The harness_reload tool queues the same command after a turn.

Paths are relative to the current project. No packages are installed.
Output contains bundled JavaScript; .ts forces Pi's reloadable module loader.
Only trusted source should be compiled and loaded. WASM is not a sandbox.
`;

export function parseArgs(args) {
  if (!args.length || ["--help", "-h"].includes(args[0])) return { help: true };
  const [command, ...rest] = args;
  if (!["build", "watch", "run"].includes(command)) throw new Error(`Unknown command: ${command}`);
  const options = { command, piArgs: [] };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === "--help" || flag === "-h") return { help: true };
    if (flag === "--" && command === "run") { options.piArgs = rest.slice(i + 1); break; }
    if (flag === "--json" && command !== "run" && !options.json) { options.json = true; continue; }
    const key = { "--entry": "entry", "--out": "outfile", "--pi-cli": "piCli" }[flag];
    if (!key || (key === "piCli" && command !== "run")) throw new Error(`Unknown option: ${flag}`);
    if (options[key]) throw new Error(`Duplicate option: ${flag}`);
    const value = rest[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    options[key] = path.resolve(value);
  }
  if (!options.entry || !options.outfile) throw new Error("--entry and --out are required.");
  if (command === "run" && !options.piCli) throw new Error("run requires --pi-cli pointing to an installed Pi JavaScript CLI.");
  return options;
}

export function launchArguments(options) {
  return [options.piCli, ...options.piArgs, "-e",
    fileURLToPath(new URL("./pi-extension.mjs", import.meta.url)), "-e", options.outfile];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { process.stdout.write(help); return; }
  if (options.piCli) await access(options.piCli);
  const compiler = await createExtensionCompiler(options);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let child;
  const report = (result) => {
    if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else if (result.status === "ready") process.stderr.write(`Compiled ${result.revision.slice(0, 12)}: ${result.bytes} bytes, ${Math.round(result.durationMs)} ms\n`);
    else process.stderr.write(`${result.diagnostics.map((d) => d.text).join("\n")}\n`);
  };
  try {
    let result = await compiler.rebuild();
    report(result);
    if (options.command === "watch") {
      let previous = JSON.stringify([result.status, result.revision, result.diagnostics]);
      while (!controller.signal.aborted) {
        await delay(500, undefined, { signal: controller.signal }).catch(() => {});
        if (controller.signal.aborted) break;
        result = await compiler.rebuild();
        const signature = JSON.stringify([result.status, result.revision, result.diagnostics]);
        if (signature !== previous) report(result);
        previous = signature;
      }
    } else if (result.status !== "ready") process.exitCode = 1;
    else if (options.command === "run" && !controller.signal.aborted) {
      await compiler.dispose();
      // Use the supplied JS entry and current Node, avoiding npm shell shims.
      child = spawn(process.execPath, launchArguments(options), {
        stdio: "inherit", signal: controller.signal,
        env: { ...process.env, BH_PI_EXTENSION_ENTRY: options.entry, BH_PI_EXTENSION_OUTPUT: options.outfile },
      });
      process.exitCode = await new Promise((resolve, reject) => {
        child.once("error", (error) => error.name === "AbortError" ? undefined : reject(error));
        child.once("exit", (code, signal) => resolve(code ?? (signal ? 130 : 1)));
      });
    }
  } finally {
    await compiler.dispose();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}

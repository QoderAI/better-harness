#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { createPluginRuntime } from "./runtime.mjs";

const help = `Experimental DSH plugin runtime compiler

Usage:
  node scripts/dsh-plugin-runtime/cli.mjs build --entry <plugin.ts> --home <experiment-home> [--json]
  node scripts/dsh-plugin-runtime/cli.mjs watch --entry <plugin.ts> --home <experiment-home> [--json]
  node scripts/dsh-plugin-runtime/cli.mjs run --entry <plugin.ts> --home <experiment-home> --dsh-cli <installed-bin.js> [--port <number>] [--watch] [--control-stdio]

build publishes an immutable module and its native DSH Profile patch.
watch rebuilds and activates after saves in a running experiment DSH.
run compiles, then starts official DSH Web on loopback. Open its printed URL.
--watch on run enables compile/activation after saves; default is explicit build.
--control-stdio accepts "stop" or EOF on stdin for portable automated shutdown.
Use an empty, dedicated home. Existing general-purpose DSH homes are rejected.
Use an idle experiment session: plugin reload may interrupt its active work.
No packages are installed. Published does not mean native activation succeeded.
`;

export function parseArgs(args) {
  if (!args.length || ["--help", "-h"].includes(args[0])) return { help: true };
  const [command, ...rest] = args;
  if (!["build", "watch", "run"].includes(command)) throw new Error(`Unknown command: ${command}`);
  const options = { command, port: 0 };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (["--help", "-h"].includes(flag)) return { help: true };
    if (flag === "--json" && command !== "run" && !options.json) { options.json = true; continue; }
    if (flag === "--watch" && command === "run" && !options.watch) { options.watch = true; continue; }
    if (flag === "--control-stdio" && command === "run" && !options.controlStdio) { options.controlStdio = true; continue; }
    const key = { "--entry": "entry", "--home": "home", "--dsh-cli": "dshCli", "--port": "port" }[flag];
    if (!key || (["dshCli", "port"].includes(key) && command !== "run")) throw new Error(`Unknown option: ${flag}`);
    if (options[key] && key !== "port") throw new Error(`Duplicate option: ${flag}`);
    const value = rest[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    if (key === "port") {
      if (!/^\d+$/.test(value) || Number(value) > 65535) throw new Error("Port must be an integer from 0 to 65535.");
      options.port = Number(value);
    } else options[key] = path.resolve(value);
  }
  if (!options.entry || !options.home) throw new Error("--entry and --home are required.");
  if (command === "run" && !options.dshCli) throw new Error("run requires an installed DSH JavaScript --dsh-cli entry.");
  return options;
}

export function launchArguments(options) {
  return [options.dshCli, "--profile", "wasm", "--host", "127.0.0.1", "--port", String(options.port), "--no-open"];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { process.stdout.write(help); return; }
  if (options.dshCli) await access(options.dshCli);
  const runtime = await createPluginRuntime(options);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  const report = (result) => {
    if (result.status === "unchanged") return;
    if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else if (result.status === "published") process.stderr.write(`Published ${result.revision.slice(0, 12)} (${Math.round(result.durationMs)} ms); native activation pending.\n`);
    else process.stderr.write(`${result.diagnostics.map((d) => d.text).join("\n")}\n`);
  };
  let child, childExit, killTimer, control;
  try {
    const initial = await runtime.build(); report(initial);
    if (initial.status === "failed" && options.command !== "watch") { process.exitCode = 1; return; }
    if (options.command === "run") {
      child = spawn(process.execPath, launchArguments(options), { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, DSH_HOME: options.home } });
      childExit = new Promise((resolve) => {
        child.once("error", (error) => { process.stderr.write(`${error.message}\n`); stop(); resolve(1); });
        child.once("exit", (code, signal) => { stop(); resolve(code ?? (signal ? 130 : 1)); });
      });
      const terminate = () => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 6000); killTimer.unref();
      };
      controller.signal.addEventListener("abort", terminate, { once: true });
      if (controller.signal.aborted) terminate();
      if (options.controlStdio) {
        control = createInterface({ input: process.stdin });
        control.on("line", (line) => { if (line.trim() === "stop") stop(); });
        control.on("close", stop);
      }
    }
    if (options.command === "watch" || options.watch) {
      while (!controller.signal.aborted) {
        await delay(500, undefined, { signal: controller.signal }).catch(() => {});
        if (!controller.signal.aborted) report(await runtime.build({ onlyChanged: true }));
      }
    }
    if (childExit) process.exitCode = await childExit;
  } finally {
    control?.close(); clearTimeout(killTimer); await runtime.dispose();
    process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}

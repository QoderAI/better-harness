#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseArgs, parseBooleanFlag } from "../../session-analysis/index.mjs";
import { errorPayload, jsonDocument, successPayload } from "../../better-harness-cli/output.mjs";
import {
  hostDoctor,
  prepareHostRun,
  readRunPlan,
  verifyHostRun,
  writeRunPlan,
} from "./index.mjs";

export const HOST_RUNTIME_HELP = `Usage: better-harness harness <host-doctor|prepare-run|verify-run> [options]

Host runtime contract for Pi and WorkBuddy orchestration.

Commands:
  host-doctor   Check host, runtime, model/session binding, and output route.
  prepare-run   Collect one frozen evidence bundle and write a private run plan.
  verify-run    Verify three specialist results against a private run plan.

Options:
  --workspace <path>       Target workspace (default: current directory)
  --platform <name>        pi or workbuddy (required for host runtime)
  --depth <quick|normal>   Evidence depth (default: normal)
  --output <file>          Private output file for prepare-run
  --plan <file>            Private run plan for verify-run
  --results <file>         Private specialist results for verify-run
  --json                   Emit OpenCLI JSON
`;

const ALLOWED = new Set([
  "workspace", "platform", "provider", "language", "depth", "since", "until", "evidence-limit",
  "include-user-home", "include-memories", "output", "plan", "results", "exclude-session-id",
  "pi-home", "workbuddy-home", "model", "codebuddy-session-id",
  "workbuddy-session-id", "json", "help", "h",
]);

function assertOptions(command, options) {
  const unknown = Object.keys(options).filter((key) => key !== "_" && !ALLOWED.has(key));
  if (options._.length > 0 || unknown.length > 0) {
    const token = options._[0] ?? `--${unknown[0]}`;
    throw Object.assign(new Error(`unknown host runtime argument: ${token}`), { code: "UNKNOWN_ARGUMENT" });
  }
  if (!command || !new Set(["host-doctor", "prepare-run", "verify-run"]).has(command)) {
    throw Object.assign(new Error(`unknown host runtime command: ${command ?? ""}`), { code: "UNKNOWN_HOST_RUNTIME_COMMAND" });
  }
  if (command !== "host-doctor" && !options.platform) {
    throw Object.assign(new Error("--platform is required for host runtime runs"), { code: "MISSING_PLATFORM" });
  }
}

function cleanOptions(options) {
  const next = { ...options };
  delete next._;
  for (const key of ["include-user-home", "include-memories"]) {
    if (key in next) next[key] = parseBooleanFlag(next[key]);
  }
  return next;
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const { command, options } = parseArgs(argv);
  if (options.help || options.h) {
    process.stdout.write(HOST_RUNTIME_HELP);
    return 0;
  }
  try {
    assertOptions(command, options);
    const normalized = cleanOptions(options);
    let result;
    if (command === "host-doctor") {
      result = await hostDoctor(normalized);
    } else if (command === "prepare-run") {
      if (!normalized.output) throw Object.assign(new Error("--output is required for prepare-run"), { code: "MISSING_OUTPUT" });
      const envelope = await prepareHostRun(normalized, dependencies);
      const outputPath = await writeRunPlan(envelope, normalized.output);
      result = {
        status: envelope.status,
        runId: envelope.plan.runId,
        provider: envelope.plan.provider,
        depth: envelope.plan.depth,
        outputPath,
        lanes: envelope.plan.expected.laneNames,
      };
    } else {
      if (!normalized.plan || !normalized.results) {
        throw Object.assign(new Error("--plan and --results are required for verify-run"), { code: "MISSING_VERIFY_INPUT" });
      }
      const plan = await readRunPlan(normalized.plan);
      const results = JSON.parse(await (await import("node:fs/promises")).readFile(path.resolve(normalized.results), "utf8"));
      result = await verifyHostRun(plan, results);
    }
    const payload = result.status === "fail"
      ? { ...successPayload(result), ok: false }
      : successPayload(result);
    process.stdout.write(jsonDocument(payload));
    return result.ok === false || result.status === "fail" ? 1 : 0;
  } catch (error) {
    const payload = errorPayload({
      code: error.code ?? "HOST_RUNTIME_FAILED",
      message: error.message,
      hint: "Use `better-harness harness host-doctor --platform pi|workbuddy --json` for bounded diagnostics.",
    });
    process.stdout.write(jsonDocument(payload));
    return 1;
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) process.exitCode = await main();

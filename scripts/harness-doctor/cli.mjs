#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { runHarnessDoctor } from "./index.mjs";
import {
  LifecycleCliError,
  normalizeReadOnlyTimeout,
  parseReadOnlyOptions,
  runReadOnlyCommand,
  validateWorkspace,
} from "../plugin-lifecycle/index.mjs";

function usage() {
  return [
    "Better Harness doctor",
    "",
    "Usage:",
    "  better-harness doctor [--platform <host|all>] [options]",
    "",
    "Options:",
    "  --platform <id|all>   Host id or alias (default: all)",
    "  --workspace <path>    Workspace used for project-scope inventory",
    "  --host-home <path>    Isolated provider home; requires one platform",
    "  --timeout <ms>        Bounded operation timeout metadata (default: 5000)",
    "  --json                Emit one command-contract.v1 JSON document",
    "  --no-color            Disable terminal color",
    "  -h, --help            Print help without probing hosts",
    "",
  ].join("\n");
}

export function parseDoctorArgs(argv) {
  const parsed = parseReadOnlyOptions(argv, {
    valueOptions: { "--platform": "platform" },
    defaults: { platform: "all" },
  });
  if (!parsed.options.help && parsed.positionals.length > 0) {
    throw new LifecycleCliError(
      "UNEXPECTED_POSITIONAL",
      `Unexpected argument: ${parsed.positionals[0]}`,
      { kind: "usage" },
    );
  }
  return normalizeReadOnlyTimeout(parsed.options);
}

export function renderDoctor(result) {
  const lines = [
    "Better Harness doctor",
    "",
    `Package: ${result.runtime.name} ${result.runtime.version}`,
    `Node: ${result.runtime.nodeVersion} (${result.runtime.nodeRange})`,
    `Platform: ${result.runtime.platform}/${result.runtime.architecture}`,
    "Network: none; writes: none; transcripts: not read",
    "",
    "Hosts:",
  ];
  for (const target of result.targets) {
    const lifecycle = target.lifecycle
      .map((entry) => (
        `${entry.surfaceId}@${entry.scope}[${entry.hostDiscovery}]:${entry.installation}/${entry.verification}`
      ))
      .join(", ");
    lines.push(`  ${target.hostId.padEnd(10)} ${target.hostDiscovery.padEnd(10)} ${lifecycle}`);
  }
  const warnings = result.diagnostics.filter((item) => item.severity !== "info");
  if (warnings.length > 0) lines.push("", "Diagnostics:", ...warnings.map((item) => `  ${item.code}: ${item.message}`));
  lines.push("");
  return lines.join("\n");
}

export async function main(argv = process.argv.slice(2)) {
  return runReadOnlyCommand({
    argv,
    command: "better-harness doctor",
    parse: parseDoctorArgs,
    usage,
    prepare: async (options) => ({
      ...options,
      workspace: await validateWorkspace(options.workspace),
    }),
    execute: runHarnessDoctor,
    renderHuman: renderDoctor,
  });
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  process.exitCode = await main();
}

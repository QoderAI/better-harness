#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { resolveWorkspaceTopology } from "./index.mjs";

const HELP = `Usage:
  workspace-topology --workspace <path> [--json]

Options:
  --workspace <path>                 Workspace root or package target.
  --max-files <n>                    Maximum visible inventory entries.
  --max-members <n>                  Maximum retained workspace members.
  --max-instruction-scopes <n>       Maximum retained instruction scopes.
  --format <text|json>               Output format (default: text).
  --json                             Alias for --format json.
  --help                             Show this help without probing the workspace.
`;

export function parseArgs(argv = []) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      throw Object.assign(new Error(`unexpected argument: ${arg}`), { code: "UNEXPECTED_ARGUMENT" });
    }
    const body = arg.slice(2);
    const equal = body.indexOf("=");
    if (equal !== -1) {
      const name = body.slice(0, equal);
      const value = body.slice(equal + 1);
      if (name === "json" || name === "help") {
        const normalized = value.toLowerCase();
        if (normalized !== "true" && normalized !== "false") {
          throw Object.assign(
            new Error(`--${name} expects true or false`),
            { code: "INVALID_BOOLEAN_OPTION" },
          );
        }
        options[name] = normalized === "true";
      } else {
        options[name] = value;
      }
      continue;
    }
    if (body === "json" || body === "help") {
      options[body] = true;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw Object.assign(new Error(`missing value for --${body}`), { code: "MISSING_OPTION_VALUE" });
    }
    options[body] = next;
    index += 1;
  }
  return options;
}

function humanSummary(result) {
  const { topology, analysisScope } = result;
  return [
    `Workspace topology: ${topology.status}`,
    `Target: ${topology.target.kind} (${topology.target.route})`,
    `Git root: ${topology.gitRoot ?? "none"}`,
    `Members: ${topology.members.items.length}/${topology.members.total}`,
    `Instruction scopes: ${topology.instructionScopes.items.length}/${topology.instructionScopes.total}`,
    `Analysis scope: ${analysisScope.kind} (${analysisScope.route})`,
    `Inventory: ${topology.discovery.inventoryMode}, scanned ${topology.discovery.scanned}, omitted ${topology.discovery.omitted}`,
  ].join("\n");
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  let options;
  try {
    options = parseArgs(argv);
    if (options.help) {
      if (dependencies.stdout?.write) dependencies.stdout.write(HELP);
      else process.stdout.write(HELP);
      return 0;
    }
    const format = options.json ? "json" : String(options.format ?? "text");
    if (!new Set(["text", "json"]).has(format)) {
      throw Object.assign(new Error(`unsupported format: ${format}`), { code: "UNSUPPORTED_FORMAT" });
    }
    const result = await (dependencies.resolveWorkspaceTopology ?? resolveWorkspaceTopology)(options);
    const output = format === "json"
      ? `${JSON.stringify({ topology: result.topology, analysisScope: result.analysisScope })}\n`
      : `${humanSummary(result)}\n`;
    if (dependencies.stdout?.write) dependencies.stdout.write(output);
    else process.stdout.write(output);
    return 0;
  } catch (error) {
    const message = `${error.code ? `${error.code}: ` : ""}${error.message}\n`;
    if (dependencies.stderr?.write) dependencies.stderr.write(message);
    else process.stderr.write(message);
    return 1;
  }
}

const currentFile = fileURLToPath(import.meta.url);
let isEntrypoint = false;
try {
  isEntrypoint = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(currentFile);
} catch {
  isEntrypoint = process.argv[1] === currentFile;
}
if (isEntrypoint) {
  process.exitCode = await main();
}

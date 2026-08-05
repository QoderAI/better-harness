#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  LifecycleCliError,
  normalizeReadOnlyTimeout,
  parseReadOnlyOptions,
  runReadOnlyCommand,
  validateWorkspace,
} from "./index.mjs";
import {
  PLUGIN_COMMAND_DEFINITIONS,
  PLUGIN_VALUE_OPTIONS,
  pluginCommandNames,
  requirePluginCommandDefinition,
} from "./command-definitions.mjs";

function usage(definition) {
  return [
    `Better Harness plugin ${definition.name}`,
    "",
    "Usage:",
    `  ${definition.usageLine}`,
    "",
    "Options:",
    "  --host <id|all>       Host id or alias",
    "  --surface <id>        Host surface; requires one explicit host",
    ...(definition.allowedOptions.includes("scope")
      ? ["  --scope <scope>       user, project, local, session, or bundled"]
      : []),
    "  --workspace <path>    Workspace used for project-scope inventory",
    "  --host-home <path>    Isolated provider home; requires one explicit host",
    "  --timeout <ms>        Bounded operation timeout metadata (default: 5000)",
    "  --json                Emit one command-contract.v1 JSON document",
    "  --no-color            Disable terminal color",
    "  -h, --help            Print help without probing hosts",
    "",
    "This command is read-only. It never executes lifecycle plan steps.",
    "",
  ].join("\n");
}

function applyPositionalContract(definition, positionals, options) {
  if (definition.positionals.kind === "enum") {
    if (positionals.length !== 1 || !definition.positionals.values.includes(positionals[0])) {
      throw new LifecycleCliError(
        definition.positionals.error.code,
        definition.positionals.error.message,
        { kind: "usage" },
      );
    }
    options[definition.positionals.key] = positionals[0];
    return;
  }

  if (positionals.length > 0) {
    throw new LifecycleCliError(
      "UNEXPECTED_POSITIONAL",
      `Unexpected argument: ${positionals[0]}`,
      { kind: "usage" },
    );
  }
}

function validateOptionOwnership(definition, options) {
  for (const [option, key] of Object.entries(PLUGIN_VALUE_OPTIONS)) {
    if (options[key] == null || definition.allowedOptions.includes(key)) continue;
    const owners = PLUGIN_COMMAND_DEFINITIONS
      .filter((entry) => entry.allowedOptions.includes(key))
      .map((entry) => entry.name);
    const ownerLabel = owners.length === 1
      ? `plugin ${owners[0]}`
      : `plugin ${owners.join(" or plugin ")}`;
    throw new LifecycleCliError(
      "OPTION_NOT_ALLOWED",
      `${option} is supported only by ${ownerLabel}.`,
      { kind: "usage" },
    );
  }
}

function parsePluginDefinitionArgs(definition, argv) {
  const parsed = parseReadOnlyOptions(argv, {
    valueOptions: PLUGIN_VALUE_OPTIONS,
  });
  const options = normalizeReadOnlyTimeout(parsed.options);
  if (options.help) return options;
  applyPositionalContract(definition, parsed.positionals, options);
  validateOptionOwnership(definition, options);
  return options;
}

export function parsePluginCliArgs(command, argv) {
  return parsePluginDefinitionArgs(requirePluginCommandDefinition(command), argv);
}

function commandName(command) {
  return `better-harness plugin ${command}`;
}

export async function runPluginCommand(command, argv = process.argv.slice(2)) {
  const definition = requirePluginCommandDefinition(command);
  return runReadOnlyCommand({
    argv,
    command: commandName(definition.name),
    parse: (args) => parsePluginDefinitionArgs(definition, args),
    usage: () => usage(definition),
    prepare: async (options) => ({
      ...options,
      workspace: await validateWorkspace(options.workspace),
    }),
    execute: definition.execute,
    renderHuman: (result) => definition.renderHuman(result, definition),
  });
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write([
      "Better Harness plugin lifecycle",
      "",
      "Usage:",
      `  better-harness plugin <${pluginCommandNames().join("|")}> [options]`,
      "",
      "This command is read-only and does not provide apply.",
      "",
    ].join("\n"));
    return 0;
  }
  return runPluginCommand(command, rest);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  process.exitCode = await main();
}

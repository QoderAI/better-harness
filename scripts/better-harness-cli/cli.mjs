import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  audienceIncludes,
  commandInventory,
  commandMetadata,
  directDispatchFor,
  groupCommand,
  listVisibleCommandNames,
  normalizeAudienceFilter,
} from "./registry.mjs";
import { errorPayload, jsonDocument, successPayload } from "./output.mjs";
import { openCliSchema } from "./schema.mjs";
import { createStyle, formatRows, shouldUseColor } from "./format.mjs";

const scriptsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(scriptsRoot, "..");
const programName = "better-harness";

const HELP_GROUPS = [
  {
    title: "Quickstart",
    audience: "workflow",
    commands: ["report"],
  },
  {
    title: "Workflows",
    audience: "workflow",
    commands: ["harness"],
  },
  {
    title: "Project Evidence",
    audience: "advanced",
    commands: ["session-analysis", "dependency-governance", "cloc"],
  },
  {
    title: "Agent Assets",
    audience: "advanced",
    commands: ["agent-customize", "agent-lint", "coding-agent-practices"],
  },
  {
    title: "Maintainer Diagnostics",
    audience: "maintainer",
    commands: ["core-change-watch"],
  },
];

const ROOT_EXAMPLES = [
  { audience: "workflow", text: "better-harness report" },
  { audience: "workflow", text: "better-harness harness analyze --workspace . --language en --format json" },
  { audience: "workflow", text: "better-harness harness checkup --phase scan --provider qoder --workspace . --json" },
  { audience: "advanced", text: "better-harness harness render --findings <input>/findings.json --mode qoder-canvas --out .qoder/better-harness --target . --validate --json" },
  { audience: "advanced", text: "better-harness harness report-quality --report <run>/report.md" },
  { audience: "advanced", text: "better-harness harness validate-canvas --canvas <run>/report.canvas.tsx" },
  { audience: "maintainer", text: "better-harness core-change-watch project-profile --json" },
  { audience: "maintainer", text: "better-harness core-change-watch change-drift --json" },
  { audience: "advanced", text: "better-harness dependency-governance --json --benchmark" },
  { audience: "advanced", text: "better-harness agent-lint --json" },
  { audience: "workflow", text: "better-harness commands --json" },
];

const GROUP_EXAMPLES = {
  "harness": [
    { audience: "workflow", text: "better-harness harness analyze --workspace . --language en --format json" },
    { audience: "workflow", text: "better-harness harness checkup --phase scan --provider qoder --workspace . --json" },
    { audience: "maintainer", text: "better-harness harness source --workspace . --source <scratch>/report.source.json --language en" },
    { audience: "advanced", text: "better-harness harness render --findings <input>/findings.json --mode qoder-canvas --out .qoder/better-harness --target . --validate --json" },
    { audience: "advanced", text: "better-harness harness preview-canvas <run>/report.canvas.tsx --open" },
    { audience: "advanced", text: "better-harness harness report-quality --report <run>/report.md" },
    { audience: "advanced", text: "better-harness harness validate-canvas --canvas <run>/report.canvas.tsx" },
  ],
  "core-change-watch": [
    { audience: "maintainer", text: "better-harness core-change-watch project-profile --json" },
    { audience: "maintainer", text: "better-harness core-change-watch diff-impact --json" },
    { audience: "maintainer", text: "better-harness core-change-watch change-drift --json" },
  ],
  "coding-agent-practices": [
    { audience: "advanced", text: "better-harness coding-agent-practices asset-baseline codex --workspace . --json" },
    { audience: "advanced", text: "better-harness coding-agent-practices inventory qoder --workspace ." },
  ],
};

function scriptPath(relativePath) {
  return path.join(scriptsRoot, relativePath);
}

function packageVersion() {
  try {
    const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    return packageJson.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function commandRow(name, summary, style) {
  return formatRows([{ left: name, right: summary }], { style })[0];
}

function usage({ color = shouldUseColor(), audience = "workflow" } = {}) {
  const style = createStyle(color);
  const lines = [
    style.bold("Better Harness CLI"),
    "",
    "Repository-local AI delivery harness tools.",
    "",
    style.bold("Usage:"),
    `  ${programName} <command> [args]`,
    `  ${programName} <command> <subcommand> [args]`,
    "",
    style.bold("Commands:"),
    `  Audience: ${audience}`,
  ];

  const groupedNames = new Set();
  for (const group of HELP_GROUPS) {
    if (!audienceIncludes(group.audience, audience)) continue;
    const rows = [];
    for (const name of group.commands) {
      const command = commandMetadata(name, { audience });
      if (!command) continue;
      groupedNames.add(name);
      rows.push({
        left: name,
        right: command.summary,
        detail: command.kind === "group"
          ? `subcommands: ${command.subcommands.map((subcommand) => subcommand.name).join(", ")}`
          : undefined,
      });
    }
    if (rows.length > 0) {
      lines.push("", `  ${style.bold(group.title)}`, ...formatRows(rows, { indent: 4, style }));
    }
  }

  const ungroupedRows = listVisibleCommandNames({ audience })
    .filter((name) => !groupedNames.has(name))
    .map((name) => {
      const command = commandMetadata(name, { audience });
      return { left: name, right: command.summary };
    });
  if (ungroupedRows.length > 0) {
    lines.push("", `  ${style.bold("Other")}`, ...formatRows(ungroupedRows, { indent: 4, style }));
  }

  const examples = ROOT_EXAMPLES
    .filter((example) => audienceIncludes(example.audience, audience))
    .map((example) => example.text);

  lines.push(
    "",
    style.bold("Examples:"),
    ...examples.map((example) => `  ${example}`),
    "",
    style.bold("Discovery:"),
    commandRow("commands", "List available commands; add --json for machine-readable inventory", style),
    commandRow("command describe", "Describe one command; add --json for the command contract", style),
    commandRow("schema", "Emit the OpenCLI schema as JSON", style),
    commandRow("--help --audience advanced", "Include workflow and advanced commands", style),
    commandRow("--help --audience maintainer", "Include every registered command", style),
    "",
    style.bold("Options:"),
    "  -h, --help              Print help",
    "  -V, --version           Print version",
  );

  return `${lines.join("\n")}\n`;
}

function groupUsage(name, group, { color = shouldUseColor(), audience = "workflow" } = {}) {
  const style = createStyle(color);
  const metadata = commandMetadata(name, { audience }) ?? commandMetadata(name);
  const subcommands = metadata?.subcommands ?? [];
  const lines = [
    style.bold(`Better Harness ${name}`),
    "",
    metadata?.description ?? group.summary,
    "",
    style.bold("Usage:"),
    `  ${programName} ${name} <SUBCOMMAND> [ARGS]`,
    "",
    style.bold("Subcommands:"),
    `  Audience: ${audience}`,
    ...formatRows(subcommands.map((subcommand) => ({
      left: subcommand.name,
      right: subcommand.summary ?? subcommand.name,
    })), { style }),
  ];

  const examples = (GROUP_EXAMPLES[name] ?? [])
    .filter((example) => audienceIncludes(example.audience, audience))
    .map((example) => example.text);
  if (examples.length > 0) {
    lines.push("", style.bold("Examples:"), ...examples.map((example) => `  ${example}`));
  }

  lines.push(
    "",
    style.bold("Discovery:"),
    `  ${programName} ${name} --help --audience advanced`,
    `  ${programName} ${name} --help --audience maintainer`,
  );

  lines.push(
    "",
    style.bold("Options:"),
    "  -h, --help              Print help",
    "",
  );
  return lines.join("\n");
}

function commandDescription(command) {
  const lines = [
    `Command: ${command.name}`,
    `Audience: ${command.audience}`,
    `Summary: ${command.summary}`,
  ];
  if (command.description && command.description !== command.summary) {
    lines.push(`Description: ${command.description}`);
  }
  if (command.aliases.length > 0) {
    lines.push(`Aliases: ${command.aliases.map((alias) => alias.name).join(", ")}`);
  }
  if (command.kind === "direct") {
    lines.push(`Script: ${command.script}`);
  } else {
    lines.push("Subcommands:");
    for (const subcommand of command.subcommands) {
      const summary = subcommand.summary ? ` - ${subcommand.summary}` : "";
      lines.push(`  ${subcommand.name.padEnd(24)} [${subcommand.audience}] ${subcommand.script}${summary}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function isHelp(value) {
  return value === "--help" || value === "-h" || value === "help";
}

function isVersion(value) {
  return value === "--version" || value === "-V" || value === "version";
}

function hasJsonFlag(argv) {
  return argv.includes("--json");
}

function optionValue(argv, name) {
  const equalPrefix = `${name}=`;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === name) {
      return argv[index + 1];
    }
    if (value.startsWith(equalPrefix)) {
      return value.slice(equalPrefix.length);
    }
  }
  return undefined;
}

function requestedAudience(argv, fallback) {
  return normalizeAudienceFilter(optionValue(argv, "--audience") ?? fallback);
}

function unsupportedAudience(error, machine) {
  return rootError({
    code: "UNSUPPORTED_AUDIENCE",
    message: error.message,
    hint: "Use workflow, advanced, maintainer, or all.",
    machine,
  });
}

function rootError({ code, message, hint, exitCode = 1, machine }) {
  if (machine) {
    return {
      kind: "json",
      text: jsonDocument(errorPayload({ code, message, hint })),
      exitCode,
    };
  }
  const text = `${message}${hint ? `\n\n${hint}` : ""}`;
  return {
    kind: "error",
    message: text.endsWith("\n") ? text : `${text}\n`,
    exitCode,
  };
}

function commandSchema(argv) {
  const format = optionValue(argv, "--format") ?? "opencli";
  if (format !== "opencli") {
    return rootError({
      code: "UNSUPPORTED_SCHEMA_FORMAT",
      message: `Unsupported schema format: ${format}`,
      hint: "Use `better-harness schema --format opencli`.",
      machine: hasJsonFlag(argv),
    });
  }
  let audience;
  try {
    audience = requestedAudience(argv, "all");
  } catch (error) {
    return unsupportedAudience(error, hasJsonFlag(argv));
  }
  return {
    kind: "json",
    text: jsonDocument(successPayload(openCliSchema({ audience }))),
    exitCode: 0,
  };
}

export function resolveDispatch(argv = []) {
  const [command, subcommand, ...rest] = argv;
  const machine = hasJsonFlag(argv);
  if (!command || isHelp(command)) {
    try {
      return {
        kind: "help",
        text: usage({ audience: requestedAudience(argv, "workflow") }),
        exitCode: 0,
      };
    } catch (error) {
      return unsupportedAudience(error, machine);
    }
  }

  if (isVersion(command)) {
    return { kind: "help", text: `${programName} ${packageVersion()}\n`, exitCode: 0 };
  }

  if (command === "commands") {
    let audience;
    try {
      audience = requestedAudience(argv, machine ? "all" : "workflow");
    } catch (error) {
      return unsupportedAudience(error, machine);
    }
    if (!machine) {
      return { kind: "help", text: usage({ audience }), exitCode: 0 };
    }
    return {
      kind: "json",
      text: jsonDocument(successPayload(commandInventory({ audience }))),
      exitCode: 0,
    };
  }

  if (command === "command") {
    if (subcommand !== "describe") {
      return rootError({
        code: "UNKNOWN_COMMAND_SUBCOMMAND",
        message: `Unknown subcommand for command: ${subcommand ?? ""}`.trim(),
        hint: "Use `better-harness command describe <command> --json`.",
        machine,
      });
    }
    const [name] = rest;
    const metadata = commandMetadata(name);
    if (!metadata) {
      return rootError({
        code: "UNKNOWN_COMMAND",
        message: `Unknown command: ${name ?? ""}`.trim(),
        hint: "Use `better-harness commands --json` to list command names.",
        machine,
      });
    }
    if (!machine) {
      return {
        kind: "help",
        text: commandDescription(metadata),
        exitCode: 0,
      };
    }
    return {
      kind: "json",
      text: jsonDocument(successPayload({ command: metadata })),
      exitCode: 0,
    };
  }

  if (command === "schema") {
    return commandSchema(argv.slice(1));
  }

  const direct = directDispatchFor(command, subcommand);
  if (direct) {
    return {
      kind: "dispatch",
      script: scriptPath(direct.script),
      args: argv.slice(direct.consumesSubcommand ? 2 : 1),
    };
  }

  const group = groupCommand(command);
  if (!group) {
    return rootError({
      code: "UNKNOWN_COMMAND",
      message: `Unknown command: ${command}`,
      hint: machine
        ? "Use `better-harness commands --json` to list command names."
        : "Use `better-harness --help` to list commands.",
      machine,
    });
  }

  if (!subcommand || isHelp(subcommand)) {
    try {
      return {
        kind: "help",
        text: groupUsage(command, group, {
          audience: requestedAudience(argv, group.audience ?? "workflow"),
        }),
        exitCode: 0,
      };
    } catch (error) {
      return unsupportedAudience(error, machine);
    }
  }

  const script = group.subcommands.find((entry) => entry.name === subcommand)?.script;
  if (!script) {
    return rootError({
      code: "UNKNOWN_SUBCOMMAND",
      message: `Unknown subcommand for ${command}: ${subcommand}`,
      hint: `Use \`better-harness ${command} --help\` to list subcommands.`,
      machine,
    });
  }

  return {
    kind: "dispatch",
    script: scriptPath(script),
    args: rest,
  };
}

export function main(argv = process.argv.slice(2)) {
  const dispatch = resolveDispatch(argv);
  if (dispatch.kind === "help" || dispatch.kind === "json") {
    process.stdout.write(dispatch.text);
    return dispatch.exitCode;
  }
  if (dispatch.kind === "error") {
    process.stderr.write(dispatch.message);
    return dispatch.exitCode;
  }

  const result = spawnSync(process.execPath, [dispatch.script, ...dispatch.args], {
    cwd: process.cwd(),
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    return 1;
  }
  return result.status ?? 1;
}

#!/usr/bin/env node

import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeCloc } from "./analyze.mjs";

const CLOC_HELP = `Usage: better-harness cloc [paths...] [options]

Count code, comments, and blank lines.

Options:
  --cwd <path>              Analyze this directory
  --workers <count>         Set the worker count
  --no-git                  Do not use Git for file discovery
  --tracked-only            Count tracked files only
  --markdown-code           Include Markdown code blocks
  --files                   Include counted file paths
  --json                    Emit JSON output
  -h, --help                Print help
`;

function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      args._.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const equalIndex = body.indexOf("=");
    if (equalIndex !== -1) {
      args[body.slice(0, equalIndex)] = body.slice(equalIndex + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[body] = next;
      index += 1;
    } else {
      args[body] = true;
    }
  }
  return args;
}

function pad(value, width) {
  return String(value).padStart(width, " ");
}

function printTextReport(report) {
  const rows = report.languages;
  const languageWidth = Math.max(8, ...rows.map((row) => row.language.length), "SUM".length);
  process.stdout.write([
    `${"Language".padEnd(languageWidth)} ${pad("Files", 7)} ${pad("Blank", 8)} ${pad("Comment", 8)} ${pad("Code", 8)}`,
    `${"-".repeat(languageWidth)} ${"-".repeat(7)} ${"-".repeat(8)} ${"-".repeat(8)} ${"-".repeat(8)}`,
    ...rows.map((row) => `${row.language.padEnd(languageWidth)} ${pad(row.files, 7)} ${pad(row.blank, 8)} ${pad(row.comment, 8)} ${pad(row.code, 8)}`),
    `${"-".repeat(languageWidth)} ${"-".repeat(7)} ${"-".repeat(8)} ${"-".repeat(8)} ${"-".repeat(8)}`,
    `${"SUM".padEnd(languageWidth)} ${pad(report.totals.files, 7)} ${pad(report.totals.blank, 8)} ${pad(report.totals.comment, 8)} ${pad(report.totals.code, 8)}`,
    "",
    `files: ${report.fileList.counted}/${report.fileList.candidates} (${report.fileList.strategy}), workers: ${report.workers}, elapsed: ${report.elapsedMs}ms`,
  ].join("\n"));
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.some((arg) => arg === "--help" || arg === "-h")) {
    process.stdout.write(CLOC_HELP);
    return;
  }
  const args = parseArgs(argv);
  const report = await analyzeCloc({
    cwd: args.cwd,
    paths: args._,
    workers: args.workers,
    useGit: !args["no-git"],
    trackedOnly: Boolean(args["tracked-only"]),
    markdownCode: Boolean(args["markdown-code"]),
    includeFiles: Boolean(args.files),
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  printTextReport(report);
}

function isDirectEntrypoint(entrypoint) {
  if (!entrypoint) return false;
  const currentFile = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entrypoint) === realpathSync(currentFile);
  } catch {
    return path.resolve(entrypoint) === path.resolve(currentFile);
  }
}

if (isDirectEntrypoint(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`cloc failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createSessionExecutionPlan,
  executeSessionExecutionPlan,
  readSessionExecutionPlan,
  SessionExecutorError,
  writeSessionExecutionPlan,
} from "./index.js";

const HELP = `Harness Session Executor POC

Continue an exact Pi JSONL checkpoint against an exact Git commit in an
isolated worktree, then create a new commit on a Better Harness namespaced ref.

Usage:
  harness-session-executor plan --workspace <repo> --base <commit> --session <file.jsonl> --entry <id> (--prompt <text> | --prompt-file <file>) --commit-message <message> --out <plan.json> [--json]
  harness-session-executor run --plan <plan.json> --yes [--json]

Commands:
  plan                    Resolve and freeze the immutable Git/session inputs
  run                     Revalidate and execute a saved plan

Options:
  --workspace <repo>      Git workspace (default: current directory)
  --base <commit>         Historical commit or commit-ish to use as the parent
  --session <file>        Pi session JSONL file
  --entry <id>            Exact Pi session entry id to continue from
  --prompt <text>         Continuation prompt (stored in the plan)
  --prompt-file <file>    Read the continuation prompt from a UTF-8 file
  --commit-message <msg>  Commit subject/body before provenance trailers
  --out <plan.json>       New plan file; existing files are never overwritten
  --plan <plan.json>      Plan file to execute
  --yes                   Confirm model-driven edits and Git object/ref creation
  --json                  Emit machine-readable output (the default output shape)
  -h, --help              Print help without reading Git, sessions, or files

The POC supports Pi sessions only. It never switches or moves the caller's
current branch. Adopt the result explicitly from the ref reported in the
execution receipt.
`;

const VALUE_OPTIONS = new Set([
  "--workspace",
  "--base",
  "--session",
  "--entry",
  "--prompt",
  "--prompt-file",
  "--commit-message",
  "--out",
  "--plan",
]);
const BOOLEAN_OPTIONS = new Set(["--yes", "--json"]);

type ParsedOptions = Record<string, string | true>;

class UsageError extends Error {
  readonly exitCode = 64;

  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

function parseOptions(argv: string[]): ParsedOptions {
  const options: ParsedOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (BOOLEAN_OPTIONS.has(flag)) {
      if (Object.hasOwn(options, flag)) throw new UsageError(`duplicate option: ${flag}`);
      options[flag] = true;
      continue;
    }
    if (!VALUE_OPTIONS.has(flag)) throw new UsageError("unrecognized option");
    if (Object.hasOwn(options, flag)) throw new UsageError(`duplicate option: ${flag}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new UsageError(`missing value for ${flag}`);
    options[flag] = value;
    index += 1;
  }
  return options;
}

function optionValue(options: ParsedOptions, flag: string): string | undefined {
  const value = options[flag];
  return typeof value === "string" ? value : undefined;
}

function requireOption(options: ParsedOptions, flag: string): string {
  const value = optionValue(options, flag);
  if (!value) throw new UsageError(`required option missing: ${flag}`);
  return value;
}

function rejectOptions(options: ParsedOptions, flags: string[], command: string): void {
  const unexpected = flags.find((flag) => Object.hasOwn(options, flag));
  if (unexpected) throw new UsageError(`${unexpected} is not valid for ${command}`);
}

async function runPlan(options: ParsedOptions): Promise<void> {
  rejectOptions(options, ["--plan", "--yes"], "plan");
  const promptValue = optionValue(options, "--prompt");
  const promptFile = optionValue(options, "--prompt-file");
  if ((promptValue === undefined) === (promptFile === undefined)) {
    throw new UsageError("plan requires exactly one of --prompt or --prompt-file");
  }
  const prompt = promptFile
    ? await readFile(path.resolve(promptFile), "utf8")
    : promptValue!;
  const plan = await createSessionExecutionPlan({
    workspace: path.resolve(optionValue(options, "--workspace") ?? process.cwd()),
    base: requireOption(options, "--base"),
    sessionFile: path.resolve(requireOption(options, "--session")),
    entryId: requireOption(options, "--entry"),
    prompt,
    commitMessage: requireOption(options, "--commit-message"),
  });
  const outputPath = await writeSessionExecutionPlan(requireOption(options, "--out"), plan);
  process.stdout.write(`${JSON.stringify({
    schemaVersion: plan.schemaVersion,
    planId: plan.planId,
    planFile: outputPath,
    provider: plan.provider,
    baseCommit: plan.workspace.baseCommit,
    checkpoint: {
      sessionId: plan.checkpoint.sessionId,
      entryId: plan.checkpoint.entryId,
      sessionSha256: plan.checkpoint.sessionSha256,
    },
    output: plan.output,
  }, null, 2)}\n`);
}

async function runExecution(options: ParsedOptions): Promise<void> {
  rejectOptions(options, [
    "--workspace",
    "--base",
    "--session",
    "--entry",
    "--prompt",
    "--prompt-file",
    "--commit-message",
    "--out",
  ], "run");
  if (options["--yes"] !== true) {
    throw new UsageError("run requires --yes because it invokes a model and creates Git state");
  }
  const plan = await readSessionExecutionPlan(requireOption(options, "--plan"));
  const receipt = await executeSessionExecutionPlan(plan);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return 0;
  }
  const [command, ...rest] = argv;
  if (command !== "plan" && command !== "run") {
    process.stderr.write("Unknown command; expected plan or run\n");
    return 64;
  }
  try {
    const options = parseOptions(rest);
    if (command === "plan") await runPlan(options);
    else await runExecution(options);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n`);
      return error.exitCode;
    }
    if (error instanceof SessionExecutorError) {
      process.stderr.write(`${error.code}: ${error.message}\n`);
      for (const warning of error.cleanupWarnings ?? []) process.stderr.write(`cleanup: ${warning}\n`);
      return 1;
    }
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}

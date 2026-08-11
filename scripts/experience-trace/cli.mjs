#!/usr/bin/env node

import { open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { EXPERIENCE_TRACE_COMMAND_MANIFEST } from "./command-manifest.mjs";

const SOURCE_MAX_BYTES = 16 * 1024 * 1024;
const TRACE_MAX_BYTES = 1024 * 1024;
const BINDING_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{15,95}$/u;
const HELP_TOKENS = new Set(["--help", "-h"]);
const VALUE_OPTIONS = Object.freeze({
  create: new Set(["--source", "--task-key", "--workspace-key", "--run-key", "--episode-ref"]),
  validate: new Set(["--trace"]),
});
const FLAG_OPTIONS = Object.freeze({
  create: new Set(["--no-session-evidence", "--jsonl"]),
  validate: new Set(),
});

const ERROR_DETAILS = Object.freeze({
  INVALID_USAGE: { exitCode: 64, message: "invalid experience-trace arguments" },
  MISSING_EPISODE_SELECTION: { exitCode: 64, message: "select exactly one episode mode" },
  INVALID_TRACE_BINDING: { exitCode: 1, message: "trace binding key is invalid" },
  SOURCE_READ_FAILED: { exitCode: 1, message: "unable to read report source" },
  TRACE_READ_FAILED: { exitCode: 1, message: "unable to read experience trace" },
  TRACE_BOUNDS_EXCEEDED: { exitCode: 1, message: "experience trace bounds exceeded" },
  INVALID_REPORT_SOURCE: { exitCode: 1, message: "report source is invalid" },
  UNSUPPORTED_TRACE_SOURCE_VERSION: { exitCode: 1, message: "report source version is unsupported" },
  UNSUPPORTED_TRACE_PLATFORM: { exitCode: 1, message: "report source platform is unsupported" },
  UNKNOWN_EPISODE_REF: { exitCode: 1, message: "selected episode is unavailable" },
  INVALID_EXPERIENCE_TRACE: { exitCode: 1, message: "experience trace is invalid" },
});

const CREATE_RUNTIME_CODES = new Set([
  "TRACE_BOUNDS_EXCEEDED",
  "INVALID_REPORT_SOURCE",
  "UNSUPPORTED_TRACE_SOURCE_VERSION",
  "UNSUPPORTED_TRACE_PLATFORM",
  "UNKNOWN_EPISODE_REF",
]);

class ExperienceTraceCliError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new ExperienceTraceCliError(code);
}

function helpText() {
  const { usage } = EXPERIENCE_TRACE_COMMAND_MANIFEST;
  return [
    "Better Harness Experience Trace v1",
    "",
    "Create a bounded task-scoped trace from one explicit Qoder report source,",
    "or validate one captured JSONL stream. Both phases are read-only.",
    "",
    "Usage:",
    `  ${usage.create}`,
    `  ${usage.validate}`,
    "",
    "Output:",
    "  create    Canonical JSONL only",
    "  validate  One canonical JSON validation document",
    "",
    "Options:",
    "  --source <report.source.json>    Explicit report-source input for create",
    "  --task-key <opaque>              Caller-owned task correlation key",
    "  --workspace-key <opaque>         Caller-owned workspace correlation key",
    "  --run-key <opaque>               Caller-owned run correlation key",
    "  --episode-ref <episode:opaque>   Select one retained Qoder Episode",
    "  --no-session-evidence            Declare that no native Episode applies",
    "  --jsonl                          Require JSONL output for create",
    "  --trace <trace.jsonl>            Explicit trace input for validate",
    "  -h, --help                       Print this help with no file reads",
    "",
  ].join("\n");
}

function isExactHelp(argv) {
  return (argv.length === 1 && HELP_TOKENS.has(argv[0]))
    || (argv.length === 2 && ["create", "validate"].includes(argv[0]) && HELP_TOKENS.has(argv[1]));
}

function parseOptions(phase, argv) {
  const options = Object.create(null);
  const valueOptions = VALUE_OPTIONS[phase];
  const flagOptions = FLAG_OPTIONS[phase];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (HELP_TOKENS.has(token) || !token.startsWith("--")) fail("INVALID_USAGE");
    if (flagOptions.has(token)) {
      if (Object.hasOwn(options, token)) fail("INVALID_USAGE");
      options[token] = true;
      continue;
    }
    if (!valueOptions.has(token)) fail("INVALID_USAGE");
    const value = argv[index + 1];
    if (value === undefined || value === "" || value.startsWith("--") || Object.hasOwn(options, token)) {
      fail("INVALID_USAGE");
    }
    options[token] = value;
    index += 1;
  }

  return options;
}

export function parseExperienceTraceArgs(argv = []) {
  if (isExactHelp(argv)) return { kind: "help" };

  const [phase, ...rest] = argv;
  if (phase !== "create" && phase !== "validate") fail("INVALID_USAGE");
  const options = parseOptions(phase, rest);

  if (phase === "create") {
    for (const option of ["--source", "--task-key", "--workspace-key", "--run-key"]) {
      if (!Object.hasOwn(options, option)) fail("INVALID_USAGE");
    }
    if (!options["--jsonl"]) fail("INVALID_USAGE");
    if (options["--episode-ref"] && options["--no-session-evidence"]) fail("INVALID_USAGE");
    if (!options["--episode-ref"] && !options["--no-session-evidence"]) {
      fail("MISSING_EPISODE_SELECTION");
    }
    return {
      kind: "create",
      sourcePath: options["--source"],
      taskKey: options["--task-key"],
      workspaceKey: options["--workspace-key"],
      runKey: options["--run-key"],
      ...(options["--episode-ref"] ? { episodeRef: options["--episode-ref"] } : {}),
      noSessionEvidence: Boolean(options["--no-session-evidence"]),
    };
  }

  if (!Object.hasOwn(options, "--trace")) fail("INVALID_USAGE");
  return { kind: "validate", tracePath: options["--trace"] };
}

function assertBindingSyntax(options) {
  if (![options.taskKey, options.workspaceKey, options.runKey].every((value) => BINDING_KEY_RE.test(value))) {
    fail("INVALID_TRACE_BINDING");
  }
}

async function readExplicitFile(filePath, maxBytes) {
  let handle;
  try {
    handle = await open(filePath, "r");
    const bytes = Buffer.allocUnsafe(maxBytes + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    return bytes.subarray(0, bytesRead);
  } finally {
    if (handle) await handle.close();
  }
}

function decodeUtf8(bytes) {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}

function sourceRuntimeError(error) {
  if (CREATE_RUNTIME_CODES.has(error?.code)) {
    return new ExperienceTraceCliError(error.code);
  }
  return new ExperienceTraceCliError("INVALID_REPORT_SOURCE");
}

function traceRuntimeError(error) {
  if (error?.code === "TRACE_BOUNDS_EXCEEDED") {
    return new ExperienceTraceCliError(error.code);
  }
  return new ExperienceTraceCliError("INVALID_EXPERIENCE_TRACE");
}

async function loadRuntime() {
  const [projectSource, contract] = await Promise.all([
    import("./project-source.mjs"),
    import("./contract.mjs"),
  ]);
  return { ...projectSource, ...contract };
}

async function createTrace(options) {
  assertBindingSyntax(options);
  let sourceBytes;
  try {
    sourceBytes = await readExplicitFile(options.sourcePath, SOURCE_MAX_BYTES);
  } catch {
    fail("SOURCE_READ_FAILED");
  }
  if (sourceBytes.length > SOURCE_MAX_BYTES) fail("TRACE_BOUNDS_EXCEEDED");

  let source;
  try {
    source = JSON.parse(decodeUtf8(sourceBytes));
  } catch {
    fail("INVALID_REPORT_SOURCE");
  }

  try {
    const { createExperienceTrace, parseAndValidateExperienceTraceJsonl } = await loadRuntime();
    const created = await createExperienceTrace(source, {
      taskKey: options.taskKey,
      workspaceKey: options.workspaceKey,
      runKey: options.runKey,
      ...(options.episodeRef ? { episodeRef: options.episodeRef } : {}),
      noSessionEvidence: options.noSessionEvidence,
    });
    const jsonl = created?.jsonl;
    if (typeof jsonl !== "string") fail("INVALID_REPORT_SOURCE");
    if (Buffer.byteLength(jsonl, "utf8") > TRACE_MAX_BYTES) fail("TRACE_BOUNDS_EXCEEDED");
    parseAndValidateExperienceTraceJsonl(Buffer.from(jsonl, "utf8"));
    return jsonl;
  } catch (error) {
    if (error instanceof ExperienceTraceCliError) throw error;
    throw sourceRuntimeError(error);
  }
}

async function validateTrace(options) {
  let traceBytes;
  try {
    traceBytes = await readExplicitFile(options.tracePath, TRACE_MAX_BYTES);
  } catch {
    fail("TRACE_READ_FAILED");
  }
  if (traceBytes.length > TRACE_MAX_BYTES) fail("TRACE_BOUNDS_EXCEEDED");

  try {
    const {
      canonicalJson,
      experienceTraceValidationDocument,
      parseAndValidateExperienceTraceJsonl,
    } = await loadRuntime();
    const records = parseAndValidateExperienceTraceJsonl(traceBytes);
    const validation = experienceTraceValidationDocument(records);
    return `${canonicalJson(validation)}\n`;
  } catch (error) {
    throw traceRuntimeError(error);
  }
}

function safeError(error) {
  if (error instanceof ExperienceTraceCliError && ERROR_DETAILS[error.code]) return error;
  return new ExperienceTraceCliError("INVALID_EXPERIENCE_TRACE");
}

export async function main(argv = process.argv.slice(2), {
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  try {
    const parsed = parseExperienceTraceArgs(argv);
    if (parsed.kind === "help") {
      stdout.write(helpText());
      return 0;
    }
    const output = parsed.kind === "create"
      ? await createTrace(parsed)
      : await validateTrace(parsed);
    stdout.write(output);
    return 0;
  } catch (error) {
    const safe = safeError(error);
    const detail = ERROR_DETAILS[safe.code];
    stderr.write(`${safe.code}: ${detail.message}\n`);
    return detail.exitCode;
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  process.exitCode = await main();
}

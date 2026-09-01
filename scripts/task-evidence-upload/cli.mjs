#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFile, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createUploadPlan,
  TaskEvidenceUploadError,
  validateUploadPlan,
  validateUploadReceipt,
} from "./index.mjs";

const PLAN_COMMAND = "better-harness upload plan";
const APPLY_COMMAND = "better-harness upload apply";
const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_SECONDS = 10;
const MAX_TIMEOUT_SECONDS = 120;

export function usage() {
  return `Better Harness task evidence upload

Prepare a reviewable task evidence plan locally, then apply it to the destination
recorded in that plan.

Usage:
  better-harness upload plan [options]
  better-harness upload apply [options]

Subcommands:
  plan   Build, validate, preview, and optionally save a local upload plan.
  apply  Send a prepared plan to its recorded destination and store the receipt.

Discovery:
  better-harness command describe upload --json
  better-harness command describe upload plan --json
  better-harness command describe upload apply --json

Options:
  -h, --help  Show this help without reading inputs or writing files.
`;
}

export function planUsage() {
  return `Better Harness task evidence upload plan

Usage:
  better-harness upload plan --input <file> --workspace <dir> \\
    --destination <https-url> --organization <id> [options]

Required:
  --input <file>          Strict better-harness.task-evidence-input/v1 JSON.
  --workspace <dir>      Local workspace used only for path redaction and labeling.
  --destination <url>    Organization endpoint; HTTPS except loopback HTTP.
  --organization <id>    Destination organization identifier.

Options:
  --workspace-label <s>  Replace the derived workspace basename in the packet.
  --out <file>           Atomically write the prepared plan as JSON.
  --json                 Emit one machine-readable command envelope.
  --no-color             Keep output plain for terminal automation.
  -h, --help             Show this help without reading inputs or writing files.

Safety:
  This step performs no network request. Use \`upload apply\` to send a plan you
  have reviewed.
`;
}

export function applyUsage() {
  return `Better Harness task evidence upload apply

Usage:
  better-harness upload apply --plan <file> [options]

Required:
  --plan <file>          A prepared better-harness.task-evidence-upload-plan/v1 JSON.

Options:
  --out <file>           Atomically write the returned receipt as JSON.
  --timeout <seconds>    Request timeout from 1 to ${MAX_TIMEOUT_SECONDS} (default: ${DEFAULT_TIMEOUT_SECONDS}).
  --json                 Emit one machine-readable command envelope.
  --no-color             Keep output plain for terminal automation.
  -h, --help             Show this help without reading the plan or using the network.

Effects:
  This step sends the reviewed plan to the endpoint recorded inside it. The
  destination is never taken from the command line, so applying cannot redirect
  evidence somewhere the prepared plan did not already name. The command fails
  when the destination returns a receipt that does not match the applied plan.
`;
}

function cliError(code, message, options) {
  throw new TaskEvidenceUploadError(code, message, options);
}

function assignOption(options, seen, key, value, name) {
  if (seen.has(key)) cliError("DUPLICATE_OPTION", `Option ${name} may be supplied only once.`);
  if (typeof value === "string" && value.length === 0) {
    cliError("MISSING_OPTION_VALUE", `Missing value for ${name}.`);
  }
  seen.add(key);
  options[key] = value;
}

function readOptionValue(argv, index, name) {
  const value = argv[index + 1];
  if (value == null || value.startsWith("-")) {
    cliError("MISSING_OPTION_VALUE", `Missing value for ${name}.`);
  }
  return value;
}

function parseOptions(argv, { valueOptions, booleanOptions, required }) {
  const options = { json: false, noColor: false };
  const seen = new Set();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const booleanKey = booleanOptions[argument];
    if (booleanKey) {
      assignOption(options, seen, booleanKey, true, argument);
      continue;
    }
    if (argument.startsWith("--")) {
      const equalsAt = argument.indexOf("=");
      const name = equalsAt === -1 ? argument : argument.slice(0, equalsAt);
      const key = valueOptions[name];
      if (!key) cliError("UNKNOWN_OPTION", `Unknown option: ${name}.`);
      const value = equalsAt === -1
        ? readOptionValue(argv, index, name)
        : argument.slice(equalsAt + 1);
      assignOption(options, seen, key, value, name);
      if (equalsAt === -1) index += 1;
      continue;
    }
    if (argument.startsWith("-")) {
      cliError("UNKNOWN_OPTION", `Unknown option: ${argument}.`);
    }
    cliError("UNEXPECTED_POSITIONAL", `Unexpected positional argument: ${argument}.`);
  }

  for (const [key, name] of required) {
    if (!options[key]) cliError("MISSING_REQUIRED_OPTION", `${name} is required.`);
  }
  return options;
}

const BOOLEAN_OPTIONS = Object.freeze({
  "--json": "json",
  "--no-color": "noColor",
});

export function parsePlanArgs(argv) {
  return parseOptions(argv, {
    valueOptions: {
      "--input": "input",
      "--workspace": "workspace",
      "--destination": "destination",
      "--organization": "organization",
      "--workspace-label": "workspaceLabel",
      "--out": "out",
    },
    booleanOptions: BOOLEAN_OPTIONS,
    required: [
      ["input", "--input"],
      ["workspace", "--workspace"],
      ["destination", "--destination"],
      ["organization", "--organization"],
    ],
  });
}

export function parseApplyArgs(argv) {
  const options = parseOptions(argv, {
    valueOptions: {
      "--plan": "plan",
      "--out": "out",
      "--timeout": "timeout",
    },
    booleanOptions: BOOLEAN_OPTIONS,
    required: [["plan", "--plan"]],
  });
  return { ...options, timeoutSeconds: normalizeTimeout(options.timeout) };
}

function normalizeTimeout(value) {
  if (value === undefined) return DEFAULT_TIMEOUT_SECONDS;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || !Number.isInteger(seconds) || seconds < 1 || seconds > MAX_TIMEOUT_SECONDS) {
    cliError(
      "INVALID_TIMEOUT",
      `--timeout must be a whole number of seconds from 1 to ${MAX_TIMEOUT_SECONDS}.`,
    );
  }
  return seconds;
}

function commandEnvelope({ command, data, meta }) {
  return {
    schemaVersion: "1",
    command,
    status: "ok",
    meta,
    data,
    diagnostics: [],
  };
}

function errorEnvelope(error, command) {
  return {
    schemaVersion: "1",
    command: error.command ?? command,
    status: "failed",
    meta: {
      sideEffects: error.sideEffects ?? "none",
      network: error.network ?? "none",
    },
    data: null,
    diagnostics: [
      {
        code: error.code ?? "OPERATION_FAILED",
        message: error instanceof TaskEvidenceUploadError
          ? error.message
          : "The task evidence upload command could not be completed.",
        ...(error.hint ? { hint: error.hint } : {}),
      },
    ],
  };
}

function displayPath(absolutePath, cwd) {
  const relative = path.relative(cwd, absolutePath);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join("/");
  }
  return path.basename(absolutePath);
}

async function readJsonDocument(filePath, {
  cwd = process.cwd(),
  read = readFile,
  missingCode,
  missingMessage,
  readFailedCode,
  readFailedMessage,
  tooLargeCode,
  invalidJsonCode,
  invalidJsonMessage,
} = {}) {
  const absolutePath = path.resolve(cwd, filePath);
  let source;
  try {
    source = await read(absolutePath);
  } catch (error) {
    cliError(
      error?.code === "ENOENT" ? missingCode : readFailedCode,
      error?.code === "ENOENT" ? missingMessage : readFailedMessage,
      { exitCode: 1 },
    );
  }
  const buffer = Buffer.isBuffer(source) ? source : Buffer.from(source);
  if (buffer.byteLength > MAX_INPUT_BYTES) {
    cliError(tooLargeCode, `The document must not exceed ${MAX_INPUT_BYTES} bytes.`);
  }
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    cliError(invalidJsonCode, invalidJsonMessage);
  }
}

export async function readTaskEvidenceInput(inputPath, { cwd = process.cwd(), read = readFile } = {}) {
  return readJsonDocument(inputPath, {
    cwd,
    read,
    missingCode: "INPUT_NOT_FOUND",
    missingMessage: "The task evidence input file does not exist.",
    readFailedCode: "INPUT_READ_FAILED",
    readFailedMessage: "The task evidence input file could not be read.",
    tooLargeCode: "INPUT_TOO_LARGE",
    invalidJsonCode: "INVALID_JSON",
    invalidJsonMessage: "The task evidence input is not valid JSON.",
  });
}

export async function readUploadPlan(planPath, { cwd = process.cwd(), read = readFile } = {}) {
  const document = await readJsonDocument(planPath, {
    cwd,
    read,
    missingCode: "PLAN_NOT_FOUND",
    missingMessage: "The upload plan file does not exist.",
    readFailedCode: "PLAN_READ_FAILED",
    readFailedMessage: "The upload plan file could not be read.",
    tooLargeCode: "PLAN_TOO_LARGE",
    invalidJsonCode: "INVALID_JSON",
    invalidJsonMessage: "The upload plan is not valid JSON.",
  });
  return validateUploadPlan(document);
}

async function writeJsonArtifact(document, outputPath, {
  cwd = process.cwd(),
  makeDirectory = mkdir,
  write = writeFile,
  move = rename,
  remove = unlink,
  createId = randomUUID,
} = {}) {
  const absolutePath = path.resolve(cwd, outputPath);
  const directory = path.dirname(absolutePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(absolutePath)}.${process.pid}.${createId()}.tmp`,
  );
  await makeDirectory(directory, { recursive: true });
  try {
    await write(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await move(temporaryPath, absolutePath);
  } catch (error) {
    try {
      await remove(temporaryPath);
    } catch {
      // The temporary file may not have been created. Preserve the primary error.
    }
    cliError("OUTPUT_WRITE_FAILED", "The local artifact could not be written.", { exitCode: 1 });
  }
  return {
    written: true,
    path: displayPath(absolutePath, cwd),
  };
}

export async function writeUploadPlan(plan, outputPath, options = {}) {
  validateUploadPlan(plan);
  return writeJsonArtifact(plan, outputPath, options);
}

export async function writeUploadReceipt(receipt, outputPath, options = {}) {
  validateUploadReceipt(receipt);
  return writeJsonArtifact(receipt, outputPath, options);
}

function networkError(code, message, hint) {
  const error = new TaskEvidenceUploadError(code, message, { exitCode: 1, hint });
  error.command = APPLY_COMMAND;
  error.network = "request";
  error.sideEffects = "remote-write-unknown";
  return error;
}

async function readBoundedResponse(response) {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw networkError("UPLOAD_RESPONSE_TOO_LARGE", "The destination returned an oversized response.");
  }
  if (response.body === null) return "";

  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw networkError("UPLOAD_RESPONSE_TOO_LARGE", "The destination returned an oversized response.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function applyUploadPlan(plan, {
  fetchImpl = globalThis.fetch,
  timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
} = {}) {
  validateUploadPlan(plan);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  let response;
  try {
    response = await fetchImpl(plan.destination.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "idempotency-key": plan.packetDigest,
      },
      body: JSON.stringify(plan),
      signal: controller.signal,
      redirect: "error",
    });
  } catch (error) {
    throw networkError(
      controller.signal.aborted ? "UPLOAD_TIMED_OUT" : "UPLOAD_REQUEST_FAILED",
      controller.signal.aborted
        ? `The destination did not respond within ${timeoutSeconds} seconds.`
        : "The destination could not be reached.",
      `Endpoint: ${plan.destination.endpoint}`,
    );
  } finally {
    clearTimeout(timer);
  }

  const body = await readBoundedResponse(response);
  if (!response.ok) {
    throw networkError(
      "UPLOAD_REJECTED",
      `The destination rejected the plan with status ${response.status}.`,
      body.trim().slice(0, 240) || undefined,
    );
  }

  let receipt;
  try {
    receipt = JSON.parse(body);
  } catch {
    throw networkError("INVALID_RECEIPT", "The destination did not return a valid JSON receipt.");
  }
  try {
    return validateUploadReceipt(receipt, { plan });
  } catch (error) {
    error.command = APPLY_COMMAND;
    error.network = "request";
    error.sideEffects = "remote-write-unknown";
    error.exitCode = 1;
    throw error;
  }
}

function renderPlan(plan, artifact) {
  const excluded = plan.packet.privacy.excludedEvidence.join(", ");
  return `Task evidence upload plan

State: ${plan.state}
Task: ${plan.packet.task.title} (${plan.packet.task.id})
Destination: ${plan.destination.endpoint}
Organization: ${plan.destination.organization}
Packet: ${plan.packetDigest} (${plan.packetBytes} bytes)
Plan: ${plan.planDigest}
Asset observations: ${plan.packet.assets.length}
Redactions: ${plan.packet.privacy.redactions}
Excluded evidence: ${excluded}
Local artifact: ${artifact ? artifact.path : "not written (preview only)"}
Network: none — no network request was made.

Inspect this plan before applying it with \`better-harness upload apply\`.
`;
}

function renderReceipt(plan, receipt, artifact) {
  return `Task evidence upload receipt

State: ${receipt.state}${receipt.state === "duplicate" ? " — the destination already held this packet" : ""}
Task: ${plan.packet.task.title} (${plan.packet.task.id})
Destination: ${receipt.destination.endpoint}
Organization: ${receipt.destination.organization}
Receipt: ${receipt.receiptId}
Accepted at: ${receipt.acceptedAt}
Packet: ${receipt.packetDigest}
Local artifact: ${artifact ? artifact.path : "not written (receipt shown only)"}
Network: request — the plan was sent to the endpoint recorded inside it.
`;
}

async function runPlan(rest, context) {
  const { cwd, stdout, now, read } = context;
  const options = parsePlanArgs(rest);
  const input = await readTaskEvidenceInput(options.input, { cwd, read });
  const plan = createUploadPlan({
    input,
    destination: options.destination,
    organization: options.organization,
    workspace: path.resolve(cwd, options.workspace),
    workspaceLabel: options.workspaceLabel,
    localWrite: Boolean(options.out),
    now: now(),
  });
  const artifact = options.out ? await writeUploadPlan(plan, options.out, context) : null;
  if (options.json) {
    stdout.write(`${JSON.stringify(commandEnvelope({
      command: PLAN_COMMAND,
      meta: { sideEffects: artifact ? "local-write" : "none", network: "none" },
      data: { plan, artifact },
    }), null, 2)}\n`);
  } else {
    stdout.write(renderPlan(plan, artifact));
  }
  return 0;
}

async function runApply(rest, context) {
  const { cwd, stdout, read, fetchImpl } = context;
  const options = parseApplyArgs(rest);
  const plan = await readUploadPlan(options.plan, { cwd, read });
  const receipt = await applyUploadPlan(plan, {
    fetchImpl,
    timeoutSeconds: options.timeoutSeconds,
  });
  // The remote write already happened, so a failed local write must not report
  // itself as a command with no effects.
  const artifact = options.out
    ? await writeUploadReceipt(receipt, options.out, context).catch((error) => {
      error.command = APPLY_COMMAND;
      error.network = "request";
      error.sideEffects = "remote-write";
      throw error;
    })
    : null;
  if (options.json) {
    stdout.write(`${JSON.stringify(commandEnvelope({
      command: APPLY_COMMAND,
      meta: {
        sideEffects: artifact ? "remote-write local-write" : "remote-write",
        network: "request",
      },
      data: { receipt, artifact },
    }), null, 2)}\n`);
  } else {
    stdout.write(renderReceipt(plan, receipt, artifact));
  }
  return 0;
}

const SUBCOMMANDS = Object.freeze({
  plan: { run: runPlan, command: PLAN_COMMAND, usage: planUsage },
  apply: { run: runApply, command: APPLY_COMMAND, usage: applyUsage },
});

function machineRequested(argv) {
  return argv.includes("--json");
}

export async function main(argv = process.argv.slice(2), {
  cwd = process.cwd(),
  stdout = process.stdout,
  stderr = process.stderr,
  now = () => new Date(),
  read = readFile,
  makeDirectory = mkdir,
  write = writeFile,
  move = rename,
  remove = unlink,
  createId = randomUUID,
  fetchImpl = globalThis.fetch,
} = {}) {
  const helpRequested = argv.length === 0
    || argv[0] === "help"
    || argv.some((argument) => argument === "--help" || argument === "-h");
  if (helpRequested) {
    stdout.write(SUBCOMMANDS[argv[0]]?.usage() ?? usage());
    return 0;
  }

  const [subcommand, ...rest] = argv;
  const entry = SUBCOMMANDS[subcommand];
  const wantsJson = machineRequested(argv);
  try {
    if (!entry) {
      const error = new TaskEvidenceUploadError(
        subcommand ? "UNKNOWN_SUBCOMMAND" : "MISSING_SUBCOMMAND",
        subcommand
          ? `Unknown subcommand for upload: ${subcommand}.`
          : "A task evidence upload subcommand is required.",
        { hint: "Use `better-harness upload --help`." },
      );
      error.command = "better-harness upload";
      throw error;
    }
    return await entry.run(rest, {
      cwd,
      stdout,
      now,
      read,
      makeDirectory,
      write,
      move,
      remove,
      createId,
      fetchImpl,
    });
  } catch (error) {
    const envelope = errorEnvelope(error, entry?.command ?? "better-harness upload");
    const exitCode = error instanceof TaskEvidenceUploadError ? error.exitCode : 1;
    if (wantsJson) {
      stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
    } else {
      const diagnostic = envelope.diagnostics[0];
      stderr.write(`${diagnostic.message}${diagnostic.hint ? `\n\n${diagnostic.hint}` : ""}\n`);
    }
    return exitCode;
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  process.exitCode = await main();
}

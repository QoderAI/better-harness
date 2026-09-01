#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFile, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createUploadPlan,
  TaskEvidenceUploadError,
  validateUploadPlan,
} from "./index.mjs";

const COMMAND = "better-harness upload plan";
const MAX_INPUT_BYTES = 1024 * 1024;

export function usage() {
  return `Better Harness task evidence upload

Prepare a reviewable task evidence plan locally. This command does not upload anything.

Usage:
  better-harness upload plan [options]

Subcommands:
  plan  Build, validate, preview, and optionally save a local upload plan.

Discovery:
  better-harness command describe upload --json
  better-harness command describe upload plan --json

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
  --destination <url>    Future organization endpoint; HTTPS except loopback HTTP.
  --organization <id>    Destination organization identifier.

Options:
  --workspace-label <s>  Replace the derived workspace basename in the packet.
  --out <file>           Atomically write the prepared plan as JSON.
  --json                 Emit one machine-readable command envelope.
  --no-color             Keep output plain for terminal automation.
  -h, --help             Show this help without reading inputs or writing files.

Safety:
  This slice performs no network request and has no apply subcommand.
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

export function parsePlanArgs(argv) {
  const options = { json: false, noColor: false };
  const seen = new Set();
  const valueOptions = {
    "--input": "input",
    "--workspace": "workspace",
    "--destination": "destination",
    "--organization": "organization",
    "--workspace-label": "workspaceLabel",
    "--out": "out",
  };
  const booleanOptions = {
    "--json": "json",
    "--no-color": "noColor",
  };

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

  for (const [key, name] of [
    ["input", "--input"],
    ["workspace", "--workspace"],
    ["destination", "--destination"],
    ["organization", "--organization"],
  ]) {
    if (!options[key]) cliError("MISSING_REQUIRED_OPTION", `${name} is required.`);
  }
  return options;
}

function commandEnvelope({ plan, artifact }) {
  return {
    schemaVersion: "1",
    command: COMMAND,
    status: "ok",
    meta: {
      sideEffects: artifact ? "local-write" : "none",
      network: "none",
    },
    data: {
      plan,
      artifact,
    },
    diagnostics: [],
  };
}

function errorEnvelope(error) {
  return {
    schemaVersion: "1",
    command: error.command ?? COMMAND,
    status: "failed",
    meta: {
      sideEffects: "none",
      network: "none",
    },
    data: null,
    diagnostics: [
      {
        code: error.code ?? "OPERATION_FAILED",
        message: error instanceof TaskEvidenceUploadError
          ? error.message
          : "The local upload plan could not be prepared.",
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

export async function readTaskEvidenceInput(inputPath, {
  cwd = process.cwd(),
  read = readFile,
} = {}) {
  const absolutePath = path.resolve(cwd, inputPath);
  let source;
  try {
    source = await read(absolutePath);
  } catch (error) {
    cliError(
      error?.code === "ENOENT" ? "INPUT_NOT_FOUND" : "INPUT_READ_FAILED",
      error?.code === "ENOENT"
        ? "The task evidence input file does not exist."
        : "The task evidence input file could not be read.",
      { exitCode: 1 },
    );
  }
  const buffer = Buffer.isBuffer(source) ? source : Buffer.from(source);
  if (buffer.byteLength > MAX_INPUT_BYTES) {
    cliError("INPUT_TOO_LARGE", `The task evidence input must not exceed ${MAX_INPUT_BYTES} bytes.`);
  }
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    cliError("INVALID_JSON", "The task evidence input is not valid JSON.");
  }
}

export async function writeUploadPlan(plan, outputPath, {
  cwd = process.cwd(),
  makeDirectory = mkdir,
  write = writeFile,
  move = rename,
  remove = unlink,
  createId = randomUUID,
} = {}) {
  validateUploadPlan(plan);
  const absolutePath = path.resolve(cwd, outputPath);
  const directory = path.dirname(absolutePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(absolutePath)}.${process.pid}.${createId()}.tmp`,
  );
  await makeDirectory(directory, { recursive: true });
  try {
    await write(temporaryPath, `${JSON.stringify(plan, null, 2)}\n`, {
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
    cliError("OUTPUT_WRITE_FAILED", "The local upload plan could not be written.", { exitCode: 1 });
  }
  return {
    written: true,
    path: displayPath(absolutePath, cwd),
  };
}

function renderHuman(plan, artifact) {
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

Inspect this plan before any future upload. The apply step is not available in this slice.
`;
}

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
} = {}) {
  if (argv.length === 0 || argv[0] === "help" || argv.some((argument) => argument === "--help" || argument === "-h")) {
    stdout.write(argv[0] === "plan" ? planUsage() : usage());
    return 0;
  }

  const wantsJson = machineRequested(argv);
  try {
    const [subcommand, ...rest] = argv;
    if (subcommand !== "plan") {
      const error = new TaskEvidenceUploadError(
        subcommand ? "UNKNOWN_SUBCOMMAND" : "MISSING_SUBCOMMAND",
        subcommand
          ? `Unknown subcommand for upload: ${subcommand}.`
          : "A task evidence upload subcommand is required.",
        { hint: "Use `better-harness upload plan --help`." },
      );
      error.command = "better-harness upload";
      throw error;
    }
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
    const artifact = options.out
      ? await writeUploadPlan(plan, options.out, {
        cwd,
        makeDirectory,
        write,
        move,
        remove,
        createId,
      })
      : null;
    if (options.json) {
      stdout.write(`${JSON.stringify(commandEnvelope({ plan, artifact }), null, 2)}\n`);
    } else {
      stdout.write(renderHuman(plan, artifact));
    }
    return 0;
  } catch (error) {
    const envelope = errorEnvelope(error);
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

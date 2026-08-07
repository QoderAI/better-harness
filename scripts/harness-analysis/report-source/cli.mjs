#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { chmod, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyReportSourceReview } from "./apply-review.mjs";
import {
  buildHarnessLeadDecisionTemplate,
  buildHarnessReviewPacket,
  compileHarnessLeadDecision,
  harnessLeadDecisionFromDocument,
} from "./review-packet.mjs";
import { validateHarnessReportSource } from "./source.mjs";

export const SOURCE_REVIEW_HELP = `Usage: better-harness harness source-review <create|decision|apply> [options]

Run the local report-source review lifecycle without authoring a decision or
calling a model. Keep source, packet, decision template, and review files local.

Phases:
  create    --source <report.source.json> --packet <review.packet.json>
            --decision <lead.decision.json>
  decision  --source <report.source.json> --packet <review.packet.json>
            --decision <lead.decision.json> --review <review.json>
  apply     --source <report.source.json> --packet <review.packet.json>
            --review <review.json> --yes

Options:
  --json    Emit one parser-safe JSON document
  --yes     Confirm replacement of --source during apply
  -h, --help
`;

const VALUE_OPTIONS = new Set(["source", "packet", "decision", "review"]);
const MACHINE_ERROR_MESSAGES = new Map([
  ["UNKNOWN_ARGUMENT", "source-review received an unsupported argument"],
  ["MISSING_ARGUMENT_VALUE", "a source-review option requires a value"],
  ["DUPLICATE_ARGUMENT", "a source-review option was supplied more than once"],
  ["INVALID_HELP_COMBINATION", "source-review help must be requested without other arguments"],
  ["MISSING_ARGUMENT", "source-review is missing a required option"],
  ["UNEXPECTED_ARGUMENT", "an option is not valid for the selected source-review phase"],
  ["INVALID_REPORT_SOURCE", "the selected report source is not readable valid JSON or failed validation"],
  ["INVALID_REVIEW_PACKET", "the selected review packet is not readable valid JSON or failed validation"],
  ["INVALID_LEAD_DECISION_TEMPLATE", "the lead decision template does not match the selected review packet"],
  ["INVALID_LEAD_DECISION", "the caller-authored lead decision failed validation"],
  ["INVALID_COMPILED_REVIEW", "the compiled review failed validation"],
  ["OUTPUT_PATH_CONFLICT", "source-review input and output roles require distinct files"],
  ["INVALID_SOURCE_REVIEW_PHASE", "source-review phase must be create, decision, or apply"],
  ["APPLY_CONFIRMATION_REQUIRED", "source-review apply requires explicit confirmation"],
]);

function parseArgs(argv) {
  const options = { json: false, yes: false };
  let phase = "";
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "-h" || value === "--help") options.help = true;
    else if (value === "--json") options.json = true;
    else if (value === "--yes") options.yes = true;
    else if (value.startsWith("--")) {
      const name = value.slice(2);
      if (!VALUE_OPTIONS.has(name)) throw Object.assign(new Error(`unknown source-review argument: ${value}`), { code: "UNKNOWN_ARGUMENT" });
      const supplied = argv[index + 1];
      if (!supplied || supplied.startsWith("--")) throw Object.assign(new Error(`${value} requires a value`), { code: "MISSING_ARGUMENT_VALUE" });
      if (options[name] !== undefined) throw Object.assign(new Error(`${value} may be supplied only once`), { code: "DUPLICATE_ARGUMENT" });
      options[name] = supplied;
      index += 1;
    } else if (!phase) phase = value;
    else throw Object.assign(new Error("source-review received an unexpected positional argument"), { code: "UNKNOWN_ARGUMENT" });
  }
  if (options.help && argv.length !== 1) {
    throw Object.assign(new Error("--help must be used without a phase or other arguments"), {
      code: "INVALID_HELP_COMBINATION",
    });
  }
  return { phase, options };
}

function requireOptions(options, names) {
  for (const name of names) {
    if (!options[name]) throw Object.assign(new Error(`--${name} is required`), { code: "MISSING_ARGUMENT" });
  }
}

function rejectOptions(options, names, phase) {
  for (const name of names) {
    if (options[name]) {
      throw Object.assign(new Error(`--${name} is not valid for source-review ${phase}`), {
        code: "UNEXPECTED_ARGUMENT",
      });
    }
  }
}

async function readJson(filePath, label) {
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    throw Object.assign(new Error(`${label} is not a readable local JSON file`), {
      code: `INVALID_${label.toUpperCase().replace(/[^A-Z0-9]+/gu, "_")}`,
    });
  }
  try {
    return JSON.parse(content);
  } catch {
    throw Object.assign(new Error(`${label} is not valid JSON`), {
      code: `INVALID_${label.toUpperCase().replace(/[^A-Z0-9]+/gu, "_")}`,
    });
  }
}

function assertDifferentPaths(left, right, message) {
  if (path.resolve(left) === path.resolve(right)) throw Object.assign(new Error(message), { code: "OUTPUT_PATH_CONFLICT" });
}

async function writeNewJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}

async function writeNewReviewInputs(packetPath, packet, decisionPath, decisionTemplate) {
  let packetCreated = false;
  try {
    await writeNewJson(packetPath, packet);
    packetCreated = true;
    await writeNewJson(decisionPath, decisionTemplate);
  } catch (error) {
    if (packetCreated) await rm(packetPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function atomicReplaceJson(filePath, value) {
  const metadata = await stat(filePath);
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    await chmod(temporaryPath, metadata.mode);
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

function assertValidSource(source) {
  const errors = validateHarnessReportSource(source);
  if (errors.length > 0) {
    throw Object.assign(new Error(errors.join("; ")), { code: "INVALID_REPORT_SOURCE", errors });
  }
}

export async function runSourceReview({ phase, options }) {
  if (!new Set(["create", "decision", "apply"]).has(phase)) {
    throw Object.assign(new Error("source-review phase must be create, decision, or apply"), {
      code: "INVALID_SOURCE_REVIEW_PHASE",
    });
  }
  requireOptions(options, ["source", "packet"]);
  const sourcePath = path.resolve(options.source);
  const packetPath = path.resolve(options.packet);
  assertDifferentPaths(sourcePath, packetPath, "--packet must not name --source");
  const source = await readJson(sourcePath, "report source");
  assertValidSource(source);

  if (phase === "create") {
    rejectOptions(options, ["review", "yes"], phase);
    requireOptions(options, ["decision"]);
    const decisionPath = path.resolve(options.decision);
    assertDifferentPaths(sourcePath, decisionPath, "--decision must not name --source");
    assertDifferentPaths(packetPath, decisionPath, "--decision must not name --packet");
    const packet = buildHarnessReviewPacket(source);
    const decisionTemplate = buildHarnessLeadDecisionTemplate(source, packet);
    await writeNewReviewInputs(packetPath, packet, decisionPath, decisionTemplate);
    return {
      kind: "harness-source-review",
      schemaVersion: 1,
      status: "packet-created",
      packetDigest: packet.packetDigest,
      nativeGroupCount: packet.nativeLearningReview?.packet?.groups?.length ?? 0,
      decisionRequired: Boolean(packet.nativeLearningReview?.packet),
      decisionTemplateCreated: true,
    };
  }

  const packet = await readJson(packetPath, "review packet");
  if (phase === "decision") {
    rejectOptions(options, ["yes"], phase);
    requireOptions(options, ["decision", "review"]);
    const decisionPath = path.resolve(options.decision);
    const reviewPath = path.resolve(options.review);
    assertDifferentPaths(sourcePath, reviewPath, "--review must not replace --source");
    assertDifferentPaths(packetPath, reviewPath, "--review must not replace --packet");
    assertDifferentPaths(decisionPath, reviewPath, "--review must not replace --decision");
    const document = await readJson(decisionPath, "lead decision");
    if (document?.kind !== "harness-lead-decision-template") {
      throw Object.assign(new Error("public source-review decision requires the template generated by create"), {
        code: "INVALID_LEAD_DECISION_TEMPLATE",
      });
    }
    const resolved = harnessLeadDecisionFromDocument(source, packet, document);
    if (resolved.errors.length > 0) {
      throw Object.assign(new Error(resolved.errors.join("; ")), {
        code: "INVALID_LEAD_DECISION_TEMPLATE",
      });
    }
    const compiled = compileHarnessLeadDecision(source, packet, resolved.decision);
    if (compiled.errors.length > 0) {
      throw Object.assign(new Error(compiled.errors.join("; ")), {
        code: "INVALID_LEAD_DECISION",
        errors: compiled.errors,
      });
    }
    await writeNewJson(reviewPath, compiled.review);
    return {
      kind: "harness-source-review",
      schemaVersion: 1,
      status: "decision-compiled",
      packetDigest: packet.packetDigest,
    };
  }

  rejectOptions(options, ["decision"], phase);
  requireOptions(options, ["review"]);
  if (!options.yes) {
    throw Object.assign(new Error("source-review apply requires --yes before replacing --source"), {
      code: "APPLY_CONFIRMATION_REQUIRED",
    });
  }
  const reviewPath = path.resolve(options.review);
  assertDifferentPaths(sourcePath, reviewPath, "--review must not name --source");
  assertDifferentPaths(packetPath, reviewPath, "--review must not name --packet");
  const review = await readJson(reviewPath, "compiled review");
  let reviewed;
  try {
    reviewed = applyReportSourceReview(source, review, { packet });
  } catch (error) {
    throw Object.assign(new Error(error.message), {
      code: "INVALID_COMPILED_REVIEW",
      ...(Array.isArray(error?.errors) ? { errors: error.errors } : {}),
    });
  }
  await atomicReplaceJson(sourcePath, reviewed);
  return {
    kind: "harness-source-review",
    schemaVersion: 1,
    status: "review-applied",
    packetDigest: packet.packetDigest,
    nativeStatus: reviewed.repositoryEvidence?.learningCaptureDiagnostics?.nativeLearningReview?.status ?? "absent",
  };
}

function successText(payload) {
  if (payload.status === "packet-created") return "source-review packet created";
  if (payload.status === "decision-compiled") return "source-review decision compiled";
  return "source-review applied";
}

export async function main(argv = process.argv.slice(2)) {
  const machine = argv.includes("--json");
  let parsed;
  try {
    parsed = parseArgs(argv);
    if (parsed.options.help) {
      process.stdout.write(SOURCE_REVIEW_HELP);
      return 0;
    }
    const payload = await runSourceReview(parsed);
    process.stdout.write(parsed.options.json ? `${JSON.stringify(payload, null, 2)}\n` : `${successText(payload)}\n`);
    return 0;
  } catch (error) {
    if (machine) {
      const code = typeof error?.code === "string" ? error.code : "SOURCE_REVIEW_FAILED";
      process.stdout.write(`${JSON.stringify({
        kind: "harness-source-review",
        schemaVersion: 1,
        status: "error",
        code,
        message: MACHINE_ERROR_MESSAGES.get(code)
          ?? "source-review failed while accessing a selected local file",
      }, null, 2)}\n`);
    } else {
      process.stderr.write(`source-review failed: ${error.message}\n`);
    }
    return 1;
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  process.exitCode = await main();
}

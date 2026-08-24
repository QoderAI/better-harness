#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { chmod, open, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assignmentSummariesFromFindings,
  isFullTaskLoopFindings,
  repairProgressFromFindings,
  validateCompactTaskLoopFindings,
  validateTaskLoopCanvasSplit,
  validateTaskLoopFindings,
} from "./task-loop-report.mjs";
import { normalizeReportData } from "./report-data-schema.mjs";
import { evaluateHtmlReport, renderHtml } from "./renderers/html.mjs";
import { renderMarkdown } from "./renderers/markdown.mjs";
import {
  findingTargetErrors,
  resolveWorkspaceTopology,
} from "../workspace-topology/index.mjs";
const LOCK_TIMEOUT_MS = 5_000;
const STALE_LOCK_MS = 10 * 60_000;

const HELP = `Usage: node scripts/harness-analysis/record-fix-output.mjs --workspace <root> --findings <findings.json> --finding-id <id> --expected-revision <n> --result <fix-output.json> [--consume-result] [--json]

Record the latest verified output, AI-authored Assignment Summary, and optional independent repair review for one current Agent Work Loop finding.
`;

function parseArgs(argv) {
  const options = { json: false, consumeResult: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--consume-result") options.consumeResult = true;
    else if (["--workspace", "--findings", "--finding-id", "--expected-revision", "--result"].includes(arg)) {
      options[arg.slice(2)] = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function parseExpectedRevision(value) {
  if (!/^\d+$/u.test(String(value ?? ""))) throw new Error("--expected-revision must be a non-negative integer");
  return Number(value);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireLock(lockPath) {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
      return handle;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const lockStat = await stat(lockPath).catch(() => null);
      if (lockStat && Date.now() - lockStat.mtimeMs > STALE_LOCK_MS) {
        await rm(lockPath, { force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw Object.assign(new Error("Timed out waiting for the findings fix-output lock"), { code: "FIX_OUTPUT_LOCK_TIMEOUT" });
      }
      await sleep(50);
    }
  }
}

async function releaseLock(lockPath, handle) {
  await handle?.close().catch(() => {});
  await rm(lockPath, { force: true }).catch(() => {});
}

async function atomicReplace(filePath, content) {
  const metadata = await stat(filePath);
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, content, { flag: "wx" });
    await chmod(temporaryPath, metadata.mode);
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

function reportErrors(context) {
  if (context.findingsShape === "full") return validateTaskLoopFindings(context.findings);
  if (context.family === "html") return validateCompactTaskLoopFindings(context.findings);
  return validateTaskLoopCanvasSplit(context.findings, context.canvas);
}

function assertValidReport(context, phase) {
  const errors = reportErrors(context);
  if (errors.length === 0) return;
  throw Object.assign(new Error(`${phase}: ${errors.join("; ")}`), {
    code: "INVALID_TASK_LOOP_FINDINGS",
    errors,
  });
}

function parseResultPayload(text) {
  const payload = JSON.parse(text);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("fix-output result must be an object");
  const supported = new Set(["actualOutput", "assignmentSummary", "postFixRepairReview", "postFixScoreReview"]);
  const unsupported = Object.keys(payload).filter((field) => !supported.has(field));
  if (unsupported.length > 0) throw new Error(`fix-output result has unsupported field: ${unsupported.join(", ")}`);
  if (!Array.isArray(payload.actualOutput)) throw new Error("fix-output result must contain actualOutput");
  if (!payload.assignmentSummary || typeof payload.assignmentSummary !== "object" || Array.isArray(payload.assignmentSummary)) {
    throw new Error("fix-output result must contain assignmentSummary");
  }
  return payload;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function assertOutputTargets(actualOutput, workspacePath, {
  findingTarget,
  topology,
} = {}) {
  const workspaceRealPath = await realpath(workspacePath);
  let homeRealPath;
  const topologyRoot = topology?.gitRoot ?? topology?.requestedWorkspace ?? workspaceRealPath;
  const projectRealPath = findingTarget ? await realpath(topologyRoot) : workspaceRealPath;
  const ownerRoot = findingTarget?.ownerRoute === null || findingTarget?.ownerRoute === undefined
    ? null
    : path.resolve(topologyRoot, ...String(findingTarget.ownerRoute).split("/"));
  const ownerRealPath = ownerRoot ? await realpath(ownerRoot) : null;
  for (const [index, output] of actualOutput.entries()) {
    if (!output?.path) continue;
    const logicalPath = String(output.path);
    const isGlobal = output.scope === "Global";
    if (isGlobal) homeRealPath ??= await realpath(os.homedir());
    const root = isGlobal ? homeRealPath : projectRealPath;
    const relativePath = isGlobal ? logicalPath.slice(2) : logicalPath;
    const targetPath = path.resolve(root, ...relativePath.split("/"));
    const targetStat = await stat(targetPath).catch(() => null);
    if (!targetStat?.isFile()) throw new Error(`actualOutput[${index}].path must resolve to an existing file`);
    const targetRealPath = await realpath(targetPath);
    if (!isWithin(root, targetRealPath)) throw new Error(`actualOutput[${index}].path resolves outside its ${output.scope} scope`);
    if (output.scope === "Project" && ownerRealPath && !isWithin(ownerRealPath, targetRealPath)) {
      throw new Error(`actualOutput[${index}].path resolves outside the finding target ownerRoute`);
    }
  }
}

async function readReportContext(findingsPath) {
  const findings = JSON.parse(await readFile(findingsPath, "utf8"));
  const findingsShape = isFullTaskLoopFindings(findings) ? "full" : "compact";
  const reportDir = path.dirname(findingsPath);
  const artifactExists = async (name) => {
    try {
      return (await stat(path.join(reportDir, name))).isFile();
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  };
  const [hasMarkdown, hasHtml, hasCanvasData, hasCanvasModule] = await Promise.all([
    artifactExists("report.md"),
    artifactExists("report.html"),
    artifactExists("canvas.json"),
    artifactExists("report.canvas.tsx"),
  ]);
  const hasHtmlArtifact = hasMarkdown || hasHtml;
  const hasCanvasArtifact = hasCanvasData || hasCanvasModule;
  const invalidContext = (message) => {
    throw Object.assign(new Error(message), { code: "INVALID_REPORT_CONTEXT" });
  };

  if (hasHtmlArtifact && hasCanvasArtifact) {
    invalidContext("compact report context mixes portable HTML and Qoder Canvas artifacts");
  }
  if (hasHtmlArtifact) {
    if (!hasMarkdown || !hasHtml) {
      invalidContext("portable HTML report context requires both report.md and report.html");
    }
    return {
      family: "html",
      findingsShape,
      findings,
      markdownPath: path.join(reportDir, "report.md"),
      htmlPath: path.join(reportDir, "report.html"),
    };
  }
  if (hasCanvasArtifact) {
    if (findingsShape === "full") {
      invalidContext("full findings cannot be combined with Qoder Canvas split artifacts");
    }
    if (!hasCanvasData) {
      invalidContext("Qoder Canvas report context requires canvas.json");
    }
    return {
      family: "qoder-canvas",
      findingsShape,
      findings,
      canvas: JSON.parse(await readFile(path.join(reportDir, "canvas.json"), "utf8")),
    };
  }
  if (findingsShape === "full") return { family: "full", findingsShape, findings };
  invalidContext("compact report context is missing portable HTML or Qoder Canvas artifacts");
}

function prepareHtmlArtifacts(context, { findingsPath, workspacePath }) {
  const reportData = normalizeReportData(context.findings, {
    mode: "html",
    language: context.findings.summary?.locale,
    target: workspacePath,
    dataPath: findingsPath,
  });
  const actionContext = { findingsPath };
  const markdown = renderMarkdown(reportData);
  const html = renderHtml(reportData, actionContext);
  const htmlCheck = evaluateHtmlReport(html, reportData, actionContext);
  if (htmlCheck.status === "fail") {
    throw Object.assign(new Error(`Updated HTML report validation failed: ${htmlCheck.errors.join("; ")}`), {
      code: "INVALID_UPDATED_HTML_REPORT",
      errors: htmlCheck.errors,
    });
  }
  return { markdown, html };
}

export async function recordFixOutput({
  workspace,
  findings: findingsOption,
  findingId,
  expectedRevision,
  result,
  consumeResult = false,
  topology,
  resolveTopology = resolveWorkspaceTopology,
  prepareHtmlReport = prepareHtmlArtifacts,
} = {}) {
  const workspacePath = path.resolve(String(workspace ?? ""));
  const findingsPath = path.resolve(String(findingsOption ?? ""));
  const resultPath = path.resolve(String(result ?? ""));
  const revision = parseExpectedRevision(expectedRevision);
  if (!findingId || typeof findingId !== "string") throw new Error("--finding-id is required");
  const workspaceStat = await stat(workspacePath).catch(() => null);
  if (!workspaceStat?.isDirectory()) throw new Error("--workspace must resolve to an existing directory");
  const workspaceRealPath = await realpath(workspacePath);
  const findingsRealPath = await realpath(findingsPath).catch(() => null);
  if (!findingsRealPath || !isWithin(workspaceRealPath, findingsRealPath)) {
    throw new Error("--findings must resolve to a file inside --workspace");
  }
  const resultPayload = parseResultPayload(await readFile(resultPath, "utf8"));
  const lockPath = `${findingsPath}.fix-output.lock`;
  const lockHandle = await acquireLock(lockPath);
  let payload;
  try {
    const context = await readReportContext(findingsPath);
    assertValidReport(context, "Current findings validation failed");
    const matches = context.findings.findings.filter((finding) => finding?.id === findingId);
    if (matches.length !== 1) throw new Error(`finding id must match exactly one row: ${findingId}`);
    const finding = matches[0];
    let repairTopology = topology;
    if (Object.hasOwn(finding, "target")) {
      repairTopology ??= (await resolveTopology({ workspace: workspaceRealPath })).topology;
      if (repairTopology.status !== "complete") {
        throw Object.assign(new Error("finding-bound repair requires complete workspace topology"), {
          code: "FINDING_TARGET_TOPOLOGY_INCOMPLETE",
        });
      }
      const targetErrors = findingTargetErrors(finding.target, {
        topology: repairTopology,
        required: true,
        requireOwnerRoute: true,
        prefix: `finding ${findingId}.target`,
      });
      if (targetErrors.length > 0) {
        throw Object.assign(new Error(targetErrors.join("; ")), {
          code: "FINDING_TARGET_MISMATCH",
          errors: targetErrors,
        });
      }
    }
    const currentRevision = Number.isInteger(finding.actualOutputRevision) ? finding.actualOutputRevision : 0;
    if (currentRevision !== revision) {
      throw Object.assign(new Error(`stale fix-output revision: expected ${revision}, found ${currentRevision}`), {
        code: "STALE_FIX_OUTPUT_REVISION",
      });
    }
    finding.actualOutputRevision = currentRevision + 1;
    finding.actualOutput = resultPayload.actualOutput.map((output) => ({ ...output }));
    finding.assignmentSummary = { ...resultPayload.assignmentSummary };
    if (resultPayload.postFixRepairReview === undefined) delete finding.postFixRepairReview;
    else finding.postFixRepairReview = JSON.parse(JSON.stringify(resultPayload.postFixRepairReview));
    delete finding.postFixScoreReview;
    context.findings.summary.assignmentSummaries = assignmentSummariesFromFindings(context.findings.findings);
    assertValidReport(context, "Updated findings validation failed");
    await assertOutputTargets(finding.actualOutput, workspacePath, {
      findingTarget: finding.target,
      topology: repairTopology,
    });
    const htmlArtifacts = context.family === "html"
      ? prepareHtmlReport(context, { findingsPath: findingsRealPath, workspacePath: workspaceRealPath })
      : null;
    if (htmlArtifacts) {
      await atomicReplace(context.markdownPath, htmlArtifacts.markdown);
      await atomicReplace(context.htmlPath, htmlArtifacts.html);
    }
    await atomicReplace(findingsPath, `${JSON.stringify(context.findings, null, 2)}\n`);
    payload = {
      kind: "harness-fix-output-record",
      status: "pass",
      findingsPath,
      findingId,
      previousRevision: currentRevision,
      revision: finding.actualOutputRevision,
      actualOutputCount: finding.actualOutput.length,
      assignmentSummaryCount: context.findings.summary.assignmentSummaries.length,
      repairProgress: repairProgressFromFindings(context.findings.findings),
      scoreRefresh: {
        status: "unchanged",
        reason: resultPayload.postFixScoreReview === undefined ? "deferred-outcome-window" : "legacy-review-deferred",
        dimensions: [],
      },
      reportFamily: context.family,
      resultConsumed: false,
    };
  } finally {
    await releaseLock(lockPath, lockHandle);
  }
  if (consumeResult) {
    payload.resultConsumed = await rm(resultPath).then(() => true).catch(() => false);
  }
  return payload;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }
  for (const field of ["workspace", "findings", "finding-id", "expected-revision", "result"]) {
    if (options[field] === undefined) throw new Error(`--${field} is required`);
  }
  const payload = await recordFixOutput({
    workspace: options.workspace,
    findings: options.findings,
    findingId: options["finding-id"],
    expectedRevision: options["expected-revision"],
    result: options.result,
    consumeResult: options.consumeResult,
  });
  process.stdout.write(options.json
    ? `${JSON.stringify(payload, null, 2)}\n`
    : `${payload.kind}: ${payload.status} (${payload.findingId} revision ${payload.revision})\n`);
  return 0;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    const message = String(error?.message ?? error);
    if (process.argv.includes("--json")) {
      process.stdout.write(`${JSON.stringify({
        kind: "harness-fix-output-record",
        status: "error",
        code: typeof error?.code === "string" ? error.code : "FIX_OUTPUT_RECORD_FAILED",
        message,
        ...(Array.isArray(error?.errors) ? { errors: error.errors } : {}),
      }, null, 2)}\n`);
    } else {
      process.stderr.write(`record-fix-output failed: ${message}\n`);
    }
    process.exitCode = 1;
  });
}

#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HOST_CAPABILITIES, hostIdsFor } from "../host-support/index.mjs";
import { evaluateHarnessReportQuality } from "./report-quality.mjs";
import { canvasArtifactsFromReportData, readJsonFile, findingsJsonFromReportData, normalizeReportData } from "./report-data-schema.mjs";
import { repairFindingsJsonData } from "./repair-findings-json.mjs";
import { allocateRunDir } from "./run-dir.mjs";
import { evaluateFindingsJson, validateHarnessCanvasArtifacts } from "./validate-canvas.mjs";
import { validateCursorCanvasArtifacts } from "./validate-cursor-canvas.mjs";
import { resolveWorkspaceTopology } from "../workspace-topology/index.mjs";
import { evaluateHtmlReport, renderHtml } from "./renderers/html.mjs";
import { renderMarkdown } from "./renderers/markdown.mjs";
import {
  FINDING_TARGET_REPORT_CONTRACT_VERSION,
  isAgentWorkLoopReport,
} from "./fluency-dimensions.mjs";
import {
  mergeTaskLoopCanvasData,
  projectTaskLoopFindings,
  reconcileTaskLoopFindingLinks,
} from "./task-loop-report.mjs";
import {
  QODER_CANVAS_FINDINGS_FILE,
  QODER_CANVAS_DATA_FILE,
  QODER_CANVAS_FILE,
  renderQoderCanvas,
} from "./renderers/qoder-canvas.mjs";
import {
  CURSOR_CANVAS_FINDINGS_FILE,
  CURSOR_CANVAS_DATA_FILE,
  CURSOR_CANVAS_FILE,
  renderCursorCanvas,
} from "./renderers/cursor-canvas.mjs";

function filesystemPathIdentity(value) {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

// Host ids accepted for report routing. Kept local so `--help` stays cheap;
// test/harness-report-render-cli.test.mjs guards it against the session
// platform registry in scripts/session-analysis/analyzer.mjs.
export const RENDER_REPORT_PLATFORMS = Object.freeze([
  ...hostIdsFor(HOST_CAPABILITIES.REPORT_RENDERING),
]);

// Each Canvas mode owns its own analyzer companion filename so the two routes
// stay independent even though they currently agree on `canvas.json`.
const ANALYZER_CANVAS_DATA_FILE_BY_MODE = Object.freeze({
  "qoder-canvas": QODER_CANVAS_DATA_FILE,
  "cursor-canvas": CURSOR_CANVAS_DATA_FILE,
});

const HELP = `Usage: better-harness harness render (--source <report.source.json> | --findings <findings.json>) --mode <qoder-canvas|cursor-canvas|markdown|html> --out <dir> --target <path> [options]

Render reviewed findings data into deterministic report artifacts.

Options:
  --findings <file>    Reviewed findings JSON with top-level summary and findings
  --canvas <file>      Explicit legacy canvas.json companion for a split Agent Work Loop bundle
  --source <file>      Reviewed Agent Work Loop report source; projection is performed in memory
  --mode <mode>        qoder-canvas, cursor-canvas, markdown, or html (default: qoder-canvas)
  --out <dir>          Output root (default: .qoder/better-harness, .cursor/better-harness for cursor-canvas, or .<platform>/better-harness for html)
  --platform <name>    Host id used for default html out root (alias: --provider)
  --run-dir <dir>      Run directory: relative values resolve below --out; absolute values remain exact
  --target <path>      Target project path used for run-directory slug
  --language <lang>    en or zh-CN (default: input summary.locale, then en)
  --sdk-root <path>    Canvas SDK root used for render-time validation
  --sdk-declarations <path>  Canvas SDK declarations used for render-time validation
  --validate           Run selected artifact validators after rendering
  --json               Emit machine-readable JSON
  -h, --help           Print this help
`;

function parseArgs(argv) {
  const options = { mode: "qoder-canvas", validate: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--validate") {
      options.validate = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (["--findings", "--canvas", "--source", "--mode", "--out", "--run-dir", "--target", "--language", "--sdk-root", "--sdk-declarations", "--platform", "--provider"].includes(arg)) {
      options[arg.slice(2)] = argv[++index];
    } else if (arg.startsWith("--findings=") || arg.startsWith("--canvas=") || arg.startsWith("--source=") || arg.startsWith("--mode=") || arg.startsWith("--out=") || arg.startsWith("--run-dir=") || arg.startsWith("--target=") || arg.startsWith("--language=") || arg.startsWith("--sdk-root=") || arg.startsWith("--sdk-declarations=") || arg.startsWith("--platform=") || arg.startsWith("--provider=")) {
      const [name, value] = arg.slice(2).split(/=(.*)/s);
      options[name] = value;
    } else {
      throw Object.assign(new Error(`Unknown argument: ${arg}`), { code: "UNKNOWN_ARGUMENT" });
    }
  }
  const hostId = String(options.platform ?? options.provider ?? "").toLowerCase();
  const supportedHtmlHosts = new Set(RENDER_REPORT_PLATFORMS);
  // Allow --help even when a bad platform is present; validate only for real runs.
  if (!options.help && hostId && !supportedHtmlHosts.has(hostId)) {
    throw Object.assign(
      new Error(`unsupported render platform: ${hostId}. Supported platforms: ${[...supportedHtmlHosts].join(", ")}.`),
      { code: "UNSUPPORTED_RENDER_PLATFORM" },
    );
  }
  options.out ??= options.mode === "cursor-canvas"
    ? ".cursor/better-harness"
    : options.mode === "html" && hostId && supportedHtmlHosts.has(hostId) && hostId !== "qoder"
      ? `.${hostId}/better-harness`
      : ".qoder/better-harness";
  return options;
}

function errorPayload(error) {
  const code = error?.code ?? "RENDER_FAILED";
  return {
    ok: false,
    kind: "harness-report-render",
    error: {
      code,
      message: String(error?.message ?? error),
      ...(error?.errors ? { details: error.errors } : {}),
    },
  };
}

function artifact(name, runDir) {
  return {
    name,
    path: path.join(runDir, name),
  };
}

function implicitAnalyzerCanvasPath(options, findingsPath) {
  const canvasDataFile = ANALYZER_CANVAS_DATA_FILE_BY_MODE[options.mode];
  if (options.canvas || !canvasDataFile) {
    return null;
  }
  const candidatePath = path.join(path.dirname(findingsPath), canvasDataFile);
  if (!existsSync(candidatePath)) return null;
  const candidate = readJsonFile(candidatePath);
  return Object.hasOwn(candidate ?? {}, "summaryFactsSchemaVersion") ? candidatePath : null;
}

function pathIsWithin(rootDir, candidateDir) {
  const relative = path.relative(rootDir, candidateDir);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

export function resolveReportOutputLocation(options) {
  const outDir = path.resolve(options.out);
  const requestedRunDir = options["run-dir"] ?? null;
  if (!requestedRunDir) {
    return {
      requestedOut: options.out,
      requestedRunDir,
      outDir,
      runDir: null,
      policy: "allocate-below-out",
    };
  }

  if (path.isAbsolute(requestedRunDir)) {
    return {
      requestedOut: options.out,
      requestedRunDir,
      outDir,
      runDir: path.resolve(requestedRunDir),
      policy: "exact-absolute-run-dir",
    };
  }

  const runDir = path.resolve(outDir, requestedRunDir);
  if (!pathIsWithin(outDir, runDir)) {
    throw Object.assign(new Error(`relative --run-dir must stay below --out: ${requestedRunDir}`), {
      code: "RUN_DIR_OUTSIDE_OUT",
    });
  }
  return {
    requestedOut: options.out,
    requestedRunDir,
    outDir,
    runDir,
    policy: "relative-below-out",
  };
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeArtifacts({ reportData, artifactDir, runDir }) {
  const artifacts = [];

  if (reportData.mode === "qoder-canvas") {
    const output = canvasArtifactsFromReportData(reportData);
    await writeJson(path.join(artifactDir, QODER_CANVAS_FINDINGS_FILE), output.findings);
    artifacts.push(artifact(QODER_CANVAS_FINDINGS_FILE, runDir));
    await writeJson(path.join(artifactDir, QODER_CANVAS_DATA_FILE), output.canvas);
    artifacts.push(artifact(QODER_CANVAS_DATA_FILE, runDir));
    const rendered = renderQoderCanvas(reportData);
    for (const [name, content] of Object.entries(rendered)) {
      await writeFile(path.join(artifactDir, name), content);
      artifacts.push(artifact(name, runDir));
    }
  } else if (reportData.mode === "cursor-canvas") {
    const output = canvasArtifactsFromReportData(reportData);
    await writeJson(path.join(artifactDir, CURSOR_CANVAS_FINDINGS_FILE), output.findings);
    artifacts.push(artifact(CURSOR_CANVAS_FINDINGS_FILE, runDir));
    await writeJson(path.join(artifactDir, CURSOR_CANVAS_DATA_FILE), output.canvas);
    artifacts.push(artifact(CURSOR_CANVAS_DATA_FILE, runDir));
    const rendered = renderCursorCanvas(reportData);
    for (const [name, content] of Object.entries(rendered)) {
      await writeFile(path.join(artifactDir, name), content);
      artifacts.push(artifact(name, runDir));
    }
  } else if (reportData.mode === "markdown") {
    const findingsJson = findingsJsonFromReportData(reportData);
    await writeJson(path.join(artifactDir, "findings.json"), findingsJson);
    artifacts.push(artifact("findings.json", runDir));
    await writeFile(path.join(artifactDir, "report.md"), renderMarkdown(reportData));
    artifacts.push(artifact("report.md", runDir));
  } else if (reportData.mode === "html") {
    const findingsJson = findingsJsonFromReportData(reportData);
    await writeJson(path.join(artifactDir, "findings.json"), findingsJson);
    artifacts.push(artifact("findings.json", runDir));
    await writeFile(path.join(artifactDir, "report.md"), renderMarkdown(reportData));
    await writeFile(
      path.join(artifactDir, "report.html"),
      renderHtml(reportData, { findingsPath: path.join(runDir, "findings.json") }),
    );
    artifacts.push(artifact("report.md", runDir), artifact("report.html", runDir));
  }

  return artifacts;
}

function checkResult(id, status, errors = [], warnings = [], summary = {}) {
  return { id, status, errors, warnings, summary };
}

async function validateArtifacts({ reportData, artifactDir, runDir, artifacts, outputLocation, sdkRoot, sdkDeclarationsPath }) {
  const expectedNames = new Set(artifacts.map((item) => item.name));
  const actualNames = (await readdir(artifactDir, { withFileTypes: true })).map((entry) => entry.name).sort();
  const unexpectedNames = actualNames.filter((name) => !expectedNames.has(name));
  const missingNames = [...expectedNames].filter((name) => !actualNames.includes(name));
  const artifactSetErrors = [
    ...missingNames.map((name) => `missing final artifact: ${name}`),
    ...unexpectedNames.map((name) => `unexpected run-directory artifact: ${name}`),
  ];
  const locationErrors = [];
  if (path.resolve(runDir) !== path.resolve(outputLocation.runDir)) {
    locationErrors.push(`resolved run directory does not match requested output location: ${runDir}`);
  }
  if (outputLocation.policy === "relative-below-out" && !pathIsWithin(outputLocation.outDir, runDir)) {
    locationErrors.push(`relative run directory escaped output root: ${runDir}`);
  }
  const checks = [checkResult("output-location", locationErrors.length > 0 ? "fail" : "pass", locationErrors, [], {
    requestedOut: outputLocation.requestedOut,
    requestedRunDir: outputLocation.requestedRunDir,
    resolvedOutDir: outputLocation.outDir,
    resolvedRunDir: runDir,
    policy: outputLocation.policy,
  }), checkResult("run-directory-artifacts", artifactSetErrors.length > 0 ? "fail" : "pass", artifactSetErrors, [], {
    expectedNames: [...expectedNames].sort(),
    actualNames,
  })];

  if (reportData.mode === "qoder-canvas") {
    const result = await validateHarnessCanvasArtifacts({
      canvasPath: path.join(artifactDir, QODER_CANVAS_FILE),
      findingsPath: path.join(artifactDir, QODER_CANVAS_FINDINGS_FILE),
      canvasDataPath: path.join(artifactDir, QODER_CANVAS_DATA_FILE),
      repoRoot: artifactDir,
      sdkRoot,
      sdkDeclarationsPath,
      preview: false,
    });
    checks.push(...result.checks);
  } else if (reportData.mode === "cursor-canvas") {
    const result = await validateCursorCanvasArtifacts({
      canvasPath: path.join(artifactDir, CURSOR_CANVAS_FILE),
      findingsPath: path.join(artifactDir, CURSOR_CANVAS_FINDINGS_FILE),
      canvasDataPath: path.join(artifactDir, CURSOR_CANVAS_DATA_FILE),
    });
    checks.push(...result.checks);
  } else {
    const findingsPath = path.join(artifactDir, "findings.json");
    const findingsText = readFileSync(findingsPath, "utf8");
    const reportPath = path.join(artifactDir, "report.md");
    const reportText = readFileSync(reportPath, "utf8");
    if (!isAgentWorkLoopReport(reportData)) {
      const reportQuality = evaluateHarnessReportQuality(reportText);
      checks.push(checkResult("report-quality", reportQuality.status, reportQuality.errors, reportQuality.warnings, reportQuality.summary));
    }
    checks.push(evaluateFindingsJson(findingsText, reportText, null, {
      allowStandaloneTaskLoop: true,
    }));
    if (reportData.mode === "html") {
      checks.push(evaluateHtmlReport(
        readFileSync(path.join(artifactDir, "report.html"), "utf8"),
        reportData,
        { findingsPath: path.join(runDir, "findings.json") },
      ));
    }
  }

  const errors = checks.flatMap((check) => check.errors.map((error) => `${check.id}: ${error}`));
  const warnings = checks.flatMap((check) => check.warnings.map((warning) => `${check.id}: ${warning}`));
  return {
    status: errors.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
    checks,
    errors,
    warnings,
  };
}

function artifactNamesForMode(mode) {
  if (mode === "qoder-canvas") {
    return [QODER_CANVAS_FINDINGS_FILE, QODER_CANVAS_DATA_FILE, QODER_CANVAS_FILE];
  }
  if (mode === "cursor-canvas") {
    return [CURSOR_CANVAS_FINDINGS_FILE, CURSOR_CANVAS_DATA_FILE, CURSOR_CANVAS_FILE];
  }
  if (mode === "markdown") return ["findings.json", "report.md"];
  if (mode === "html") return ["findings.json", "report.md", "report.html"];
  return [];
}

async function existingArtifactErrors(runDir, expectedNames) {
  if (!existsSync(runDir)) return [];
  const expected = new Set(expectedNames);
  const actualNames = (await readdir(runDir, { withFileTypes: true })).map((entry) => entry.name).sort();
  return actualNames
    .filter((name) => !expected.has(name))
    .map((name) => `unexpected run-directory artifact: ${name}`);
}

async function publishStagedRun(stageDir, runDir) {
  const parentDir = path.dirname(runDir);
  const baseName = path.basename(runDir);
  let backupDir = null;
  if (existsSync(runDir)) {
    backupDir = await mkdtemp(path.join(parentDir, `.${baseName}.backup-`));
    await rm(backupDir, { recursive: true, force: true });
    await rename(runDir, backupDir);
  }
  try {
    await rename(stageDir, runDir);
  } catch (error) {
    if (backupDir && !existsSync(runDir)) {
      try {
        await rename(backupDir, runDir);
        backupDir = null;
      } catch (rollbackError) {
        throw Object.assign(new Error(`report publication failed and rollback failed: ${error.message}; ${rollbackError.message}`), {
          code: "PUBLISH_ROLLBACK_FAILED",
          cause: error,
        });
      }
    }
    throw Object.assign(new Error(`report publication failed: ${error.message}`), {
      code: "PUBLISH_FAILED",
      cause: error,
    });
  }
  if (backupDir) await rm(backupDir, { recursive: true, force: true }).catch(() => {});
}

export async function renderReport(options) {
  const inputCount = [options.findings, options.source, options.sourceData].filter((value) => value !== undefined && value !== null).length;
  if (inputCount !== 1) {
    throw Object.assign(new Error("provide exactly one of --source or --findings"), { code: "INVALID_RENDER_INPUT" });
  }
  if (options.canvas && !options.findings) {
    throw Object.assign(new Error("--canvas requires --findings"), { code: "INVALID_RENDER_INPUT" });
  }
  const inputPath = options.sourceData === undefined ? path.resolve(options.source ?? options.findings) : null;
  let rawInput = options.sourceData === undefined ? readJsonFile(inputPath) : options.sourceData;
  if (options.findings && inputPath && isAgentWorkLoopReport(rawInput)) {
    const canvasPath = options.canvas
      ? path.resolve(options.canvas)
      : implicitAnalyzerCanvasPath(options, inputPath);
    if (canvasPath) {
      rawInput = mergeTaskLoopCanvasData(rawInput, readJsonFile(canvasPath));
    }
    rawInput = reconcileTaskLoopFindingLinks(rawInput);
  }
  const rawData = options.source || options.sourceData
    ? projectTaskLoopFindings(rawInput, {
        projectName: options.target ? path.basename(path.resolve(options.target)) : "",
        direct: options.direct === true,
      })
    : rawInput;
  const findings = Array.isArray(rawData?.findings) ? rawData.findings : [];
  const hasStructuredFindingTarget = findings.some((finding) =>
    finding && typeof finding === "object" && Object.hasOwn(finding, "target"));
  if (hasStructuredFindingTarget && !options.target) {
    throw Object.assign(new Error("--target is required when findings carry structured target metadata"), {
      code: "MISSING_RENDER_TARGET",
    });
  }
  const topology = options.topology
    ?? (options.target
      ? (await resolveWorkspaceTopology({ workspace: options.target })).topology
      : undefined);
  if (options.target && topology) {
    const [requestedTarget, topologyTarget] = await Promise.all([
      realpath(path.resolve(options.target)),
      realpath(path.resolve(topology.requestedWorkspace)),
    ]);
    if (filesystemPathIdentity(requestedTarget) !== filesystemPathIdentity(topologyTarget)) {
      throw Object.assign(new Error("--target does not match the frozen workspace topology"), {
        code: "RENDER_WORKSPACE_TOPOLOGY_MISMATCH",
      });
    }
  }
  const requiresPackageFindingTarget = topology?.target?.kind === "workspace-member"
    && Number.isInteger(rawData?.summary?.reportContractVersion)
    && rawData.summary.reportContractVersion >= FINDING_TARGET_REPORT_CONTRACT_VERSION;
  if ((hasStructuredFindingTarget || requiresPackageFindingTarget) && topology?.status !== "complete") {
    throw Object.assign(new Error("structured package findings require a complete workspace topology"), {
      code: "RENDER_WORKSPACE_TOPOLOGY_INCOMPLETE",
    });
  }
  const repaired = repairFindingsJsonData(rawData, {
    targetPath: options.target ?? rawData.summary?.project?.path ?? rawData.summary?.projectName,
  });
  const reportData = normalizeReportData(repaired.data, {
    mode: options.mode,
    language: options.language,
    target: options.target,
    dataPath: inputPath,
    topology,
  });
  const outputLocation = resolveReportOutputLocation(options);
  const allocatedRunDir = outputLocation.runDir === null;
  const runDir = outputLocation.runDir
    ?? await allocateRunDir({ outDir: outputLocation.outDir, targetPath: reportData.target.path });
  outputLocation.runDir = runDir;
  const expectedNames = artifactNamesForMode(reportData.mode);
  const artifacts = expectedNames.map((name) => artifact(name, runDir));
  const existingErrors = await existingArtifactErrors(runDir, expectedNames);
  if (existingErrors.length > 0) {
    const validation = {
      status: "fail",
      checks: [checkResult("run-directory-artifacts", "fail", existingErrors, [], { expectedNames: expectedNames.slice().sort() })],
      errors: existingErrors.map((error) => `run-directory-artifacts: ${error}`),
      warnings: [],
    };
    throw Object.assign(new Error(validation.errors.join("; ")), {
      code: "VALIDATION_FAILED",
      errors: validation.errors,
      result: { reportData, runDir, artifacts, validation },
    });
  }
  const parentDir = path.dirname(runDir);
  await mkdir(parentDir, { recursive: true });
  let stageDir = null;
  let validation = null;
  let published = false;
  try {
    stageDir = await mkdtemp(path.join(parentDir, `.${path.basename(runDir)}.staging-`));
    await writeArtifacts({ reportData, artifactDir: stageDir, runDir });
    validation = options.validate
      ? await validateArtifacts({
        reportData,
        artifactDir: stageDir,
        runDir,
        artifacts,
        outputLocation,
        sdkRoot: options["sdk-root"],
        sdkDeclarationsPath: options["sdk-declarations"],
      })
      : null;
    if (validation?.status === "fail") {
      throw Object.assign(new Error(validation.errors.join("; ")), {
        code: "VALIDATION_FAILED",
        errors: validation.errors,
        result: { reportData, runDir, artifacts, validation },
      });
    }
    await publishStagedRun(stageDir, runDir);
    published = true;
  } catch (error) {
    if (stageDir && existsSync(stageDir)) await rm(stageDir, { recursive: true, force: true });
    if (allocatedRunDir && !published && existsSync(runDir)) {
      const names = await readdir(runDir).catch(() => ["unknown"]);
      if (names.length === 0) await rm(runDir, { recursive: true, force: true });
    }
    throw error;
  }
  return {
    kind: "harness-report-render",
    status: validation?.status ?? "pass",
    mode: reportData.mode,
    language: reportData.language,
    target: reportData.target,
    runDir,
    outputLocation: {
      requestedOut: outputLocation.requestedOut,
      requestedRunDir: outputLocation.requestedRunDir,
      resolvedOutDir: outputLocation.outDir,
      resolvedRunDir: runDir,
      policy: outputLocation.policy,
    },
    artifacts,
    repair: {
      changed: repaired.changed,
      changeCount: repaired.changes.length,
    },
    validation,
  };
}

function renderHuman(result) {
  const lines = [
    `Harness report render: ${result.status}`,
    `Mode: ${result.mode}`,
    `Run directory: ${result.runDir}`,
    "Artifacts:",
    ...result.artifacts.map((item) => `  ${item.name}`),
  ];
  if (result.validation) {
    lines.push(`Validation: ${result.validation.status}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
    if (options.help) {
      process.stdout.write(HELP);
      return 0;
    }
    const result = await renderReport(options);
    process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : renderHuman(result));
    return 0;
  } catch (error) {
    const payload = error?.result
      ? { ...error.result, kind: "harness-report-render", status: "fail", error: { code: error.code, message: error.message, details: error.errors ?? [] } }
      : errorPayload(error);
    if (options?.json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      process.stderr.write(`${String(error?.message ?? error)}\n`);
    }
    return 1;
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  process.exitCode = await main();
}

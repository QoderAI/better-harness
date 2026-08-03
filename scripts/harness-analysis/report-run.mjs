#!/usr/bin/env node

import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseArgs } from "../session-analysis/index.mjs";
import { formatHarnessEvidence } from "./evidence-brief.mjs";
import { validateHarnessReportSource } from "./report-source/index.mjs";
import { projectTaskLoopReportFacts, taskLoopCanvasFromSummaryFacts } from "./task-loop-report.mjs";
import { createTaskLoopSourceFromSessions } from "./task-loop-source.mjs";

export const HARNESS_ANALYSIS_EVIDENCE_SCHEMA_VERSION = 1;

export const ANALYZE_HELP = `Usage: better-harness harness analyze --workspace <target> [options]

Return neutral, budgeted Harness evidence. This command writes no files unless
an explicit Qoder Canvas output is requested.

Options:
  --workspace <path>       Target workspace (required)
  --platform <name>        qoder, codex, claude, cursor, qwen, copilot, pi, workbuddy, or grok (default: qoder)
  --language <locale>      en or zh-CN (default: en)
  --since <ISO timestamp>  Include sessions at or after the frozen window start
  --until <ISO timestamp>  Include sessions at or before the frozen window end
  --format <text|json>     Plain-text evidence or evidence plus exact summary facts (default: text)
  --canvas-out <file>      With Qoder or Cursor JSON output, initialize canvas.json from exact summary facts
  --replace-canvas         Replace that exact canvas.json when overwrite was explicitly authorized
  --include-global-capabilities
                           Include authorized user/global capability metadata
`;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

const REPORT_PLATFORMS = ["qoder", "codex", "claude", "cursor", "qwen", "copilot", "pi", "workbuddy", "grok"];

function reportPlatform(value = "qoder") {
  const platform = String(value || "qoder").toLowerCase();
  if (!REPORT_PLATFORMS.includes(platform)) {
    throw Object.assign(
      new Error(
        `unsupported Harness report platform: ${platform}. Supported platforms: ${REPORT_PLATFORMS.join(", ")}.`,
      ),
      {
        code: "UNSUPPORTED_REPORT_PLATFORM",
      },
    );
  }
  return platform;
}

function flagEnabled(value) {
  return value === true || ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
}

function assertCliOptions(options) {
  const allowed = new Set([
    "workspace", "platform", "language", "since", "until", "format", "canvas-out", "replace-canvas", "include-global-capabilities",
    "qoder-home", "codex-home", "claude-home", "cursor-home", "qwen-home", "copilot-home", "pi-home", "workbuddy-home", "grok-home",
  ]);
  const positional = Array.isArray(options._) ? options._ : [];
  const unknown = Object.keys(options).filter((key) => key !== "_" && !allowed.has(key));
  if (positional.length > 0 || unknown.length > 0) {
    const token = positional[0] ?? `--${unknown[0]}`;
    throw Object.assign(new Error(`unknown analyze argument: ${token}`), { code: "UNKNOWN_ARGUMENT" });
  }
}

async function replaceCanvasAtomically(canvasPath, content) {
  const parentDir = path.dirname(canvasPath);
  const stageDir = await mkdtemp(path.join(parentDir, `.${path.basename(canvasPath)}.replace-`));
  const nextPath = path.join(stageDir, "next.json");
  const backupPath = path.join(stageDir, "previous.json");
  try {
    await writeFile(nextPath, content, { flag: "wx" });
    try {
      await rename(nextPath, canvasPath);
    } catch (error) {
      if (!new Set(["EACCES", "EEXIST", "EPERM", "ENOTEMPTY"]).has(error?.code)) throw error;
      await rename(canvasPath, backupPath);
      try {
        await rename(nextPath, canvasPath);
      } catch (replaceError) {
        try {
          await rename(backupPath, canvasPath);
        } catch (rollbackError) {
          throw Object.assign(new Error(`Canvas replacement failed and rollback failed: ${replaceError.message}; ${rollbackError.message}`), {
            code: "CANVAS_OUTPUT_REPLACE_ROLLBACK_FAILED",
            cause: replaceError,
          });
        }
        throw replaceError;
      }
    }
  } finally {
    await rm(stageDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function writeCanvasOutput(canvasPath, canvas, { replace = false } = {}) {
  const content = `${JSON.stringify(canvas, null, 2)}\n`;
  await mkdir(path.dirname(canvasPath), { recursive: true });
  try {
    await writeFile(canvasPath, content, { flag: "wx" });
    return false;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    if (!replace) {
      throw Object.assign(new Error(`--canvas-out refuses to replace an existing file: ${canvasPath}`), {
        code: "CANVAS_OUTPUT_EXISTS",
      });
    }
  }
  await replaceCanvasAtomically(canvasPath, content);
  return true;
}

export async function analyzeHarnessEvidence(options = {}) {
  if (!options.workspace) {
    throw Object.assign(new Error("--workspace is required"), { code: "MISSING_WORKSPACE" });
  }
  const workspace = path.resolve(options.workspace);
  const platform = reportPlatform(options.platform ?? "qoder");
  const language = options.language ?? "en";
  const format = options.format ?? "text";
  const requestedCanvasOut = options["canvas-out"] ?? options.canvasOut;
  const replaceCanvas = flagEnabled(options["replace-canvas"] ?? options.replaceCanvas);
  if (!new Set(["text", "json"]).has(format)) {
    throw Object.assign(new Error(`unsupported analyze format: ${format}`), {
      code: "UNSUPPORTED_ANALYZE_FORMAT",
    });
  }
  if (requestedCanvasOut && format !== "json") {
    throw Object.assign(new Error("--canvas-out requires --format json"), {
      code: "CANVAS_OUTPUT_REQUIRES_JSON",
    });
  }
  if (requestedCanvasOut && !new Set(["qoder", "cursor"]).has(platform)) {
    throw Object.assign(new Error("--canvas-out is supported for Qoder and Cursor Canvas bundles"), {
      code: "CANVAS_OUTPUT_REQUIRES_CANVAS_HOST",
    });
  }
  if (requestedCanvasOut && path.basename(String(requestedCanvasOut)) !== "canvas.json") {
    throw Object.assign(new Error("--canvas-out must target canvas.json"), {
      code: "INVALID_CANVAS_OUTPUT",
    });
  }
  if (replaceCanvas && !requestedCanvasOut) {
    throw Object.assign(new Error("--replace-canvas requires --canvas-out"), {
      code: "CANVAS_REPLACE_REQUIRES_OUTPUT",
    });
  }
  const sourceResult = options.sourceInput
    ? { source: clone(options.sourceInput), sessionBinding: options.sessionBinding ?? null }
    : await createTaskLoopSourceFromSessions({
        workspace,
        platform,
        language,
        since: options.since,
        until: options.until,
        selection: options.selection ?? "stratified",
        includeUsage: true,
        includeGlobalCapabilities: flagEnabled(options["include-global-capabilities"]),
        qoderHome: options["qoder-home"],
        codexHome: options["codex-home"],
        claudeHome: options["claude-home"],
        cursorHome: options["cursor-home"],
        qwenHome: options["qwen-home"],
        copilotHome: options["copilot-home"],
        piHome: options["pi-home"],
        sessionPopulation: options.sessionPopulation,
        workbuddyHome: options["workbuddy-home"],
        grokHome: options["grok-home"],
        topology: options.topology,
        analysisScope: options.analysisScope,
      });
  const source = sourceResult.source;
  const sourceErrors = validateHarnessReportSource(source);
  if (sourceErrors.length > 0) {
    throw Object.assign(new Error(sourceErrors.join("; ")), {
      code: "INVALID_REPORT_SOURCE",
      errors: sourceErrors,
    });
  }
  const evidence = formatHarnessEvidence(source, { workspace, platform, language });
  if (format === "text") return evidence;
  const summaryFacts = projectTaskLoopReportFacts(source);
  const canvasPath = requestedCanvasOut ? path.resolve(String(requestedCanvasOut)) : null;
  let canvasReplaced = false;
  if (canvasPath) {
    canvasReplaced = await writeCanvasOutput(
      canvasPath,
      taskLoopCanvasFromSummaryFacts(summaryFacts),
      { replace: replaceCanvas },
    );
  }
  return {
    kind: "better-harness.harness-analysis-evidence",
    schemaVersion: HARNESS_ANALYSIS_EVIDENCE_SCHEMA_VERSION,
    evidence,
    summaryFacts,
    ...(sourceResult.sessionBinding ? { sessionBinding: sourceResult.sessionBinding } : {}),
    ...(canvasPath ? { canvasPath, canvasReplaced } : {}),
  };
}

export async function analyzeMain(argv = process.argv.slice(2)) {
  const { options } = parseArgs(argv);
  if (options.help || options.h) {
    process.stdout.write(ANALYZE_HELP);
    return 0;
  }
  try {
    assertCliOptions(options);
    const result = await analyzeHarnessEvidence(options);
    process.stdout.write(typeof result === "string" ? `${result}\n` : `${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`harness analyze failed: ${error.message}\n`);
    return 1;
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) process.exitCode = await analyzeMain();

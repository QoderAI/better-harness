import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { isIgnored, languageFor, loadConfig } from "../blast-radius/config.mjs";
import { collectGitChanges } from "../blast-radius/git.mjs";
import { normalizeRelativePath, unique } from "../blast-radius/utils.mjs";

import { applyMappingPolicy } from "./policy.mjs";
import {
  isKnownTestFile,
  resolverForLanguage,
  resolveSourceFile,
} from "./resolvers/index.mjs";

const WRITE_MARKER = path.join(".better-harness", "state", "test-mapping", "last-write.json");
const WRITE_MARKER_TTL_MS = 15 * 60 * 1000;

function isStopEvent(eventName) {
  return eventName === "Stop" || eventName === "stop";
}

function isPostToolEvent(eventName) {
  return eventName === "PostToolUse" || eventName === "post-tool";
}

function markerPath(cwd) {
  return path.join(cwd, WRITE_MARKER);
}

async function recordWriteMarker(cwd, input = {}) {
  const filePath = markerPath(cwd);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        toolName: input.tool_name ?? input.toolName ?? null,
        filePath: input.tool_input?.file_path ?? input.toolInput?.filePath ?? null,
      },
      null,
      2,
    )}\n`,
  );
}

async function hasRecentWriteMarker(cwd) {
  const raw = await readFile(markerPath(cwd), "utf8").catch(() => "");
  if (!raw) {
    return false;
  }
  const parsed = JSON.parse(raw);
  const updatedAt = Date.parse(parsed.updatedAt);
  return Number.isFinite(updatedAt) && Date.now() - updatedAt <= WRITE_MARKER_TTL_MS;
}

async function clearWriteMarker(cwd) {
  await rm(markerPath(cwd), { force: true });
}

function countByKey(items, key) {
  const counts = {};
  for (const item of items) {
    const value = item[key];
    if (typeof value !== "string" || value.length === 0) {
      continue;
    }
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function existingPaths(repoRoot, candidates) {
  return candidates.filter((candidate) => existsSync(path.join(repoRoot, candidate)));
}

function normalizeCandidatePaths(paths) {
  return unique(paths.map((item) => item.replaceAll("\\", "/").replace(/^\.\//, "")));
}

function changedEntriesFromOptions(options) {
  if (Array.isArray(options.changedFiles)) {
    return options.changedFiles.map((filePath) => ({
      filePath,
      added: 0,
      deleted: 0,
      status: "explicit",
    }));
  }
  return options.changes?.files ?? null;
}

export async function analyzeTestMappings(repoRoot, options = {}) {
  const root = path.resolve(repoRoot || process.cwd());
  const config = options.config ?? (await loadConfig(root, options.configPath));
  const changedEntries =
    changedEntriesFromOptions(options) ?? (await collectGitChanges(root, config)).files;
  const changedFiles = unique(
    changedEntries
      .map((file) => normalizeRelativePath(root, file.filePath ?? file))
      .filter((file) => !isIgnored(file, config)),
  );
  const changedSet = new Set(changedFiles);
  const skippedTestFiles = changedFiles.filter((file) => isKnownTestFile(file));
  const sourceFiles = changedFiles.filter((file) => {
    if (skippedTestFiles.includes(file)) {
      return false;
    }
    return Boolean(resolverForLanguage(languageFor(file)));
  });

  const mappings = sourceFiles.map((sourceFile) => {
    const outcome = resolveSourceFile(sourceFile);
    const candidateTestFiles = normalizeCandidatePaths(outcome.candidateTestFiles ?? []);
    const changedTestFiles = candidateTestFiles.filter((candidate) => changedSet.has(candidate));
    const existingTestFiles = existingPaths(root, candidateTestFiles);
    const relatedTestFiles = normalizeCandidatePaths([
      ...existingTestFiles,
      ...changedTestFiles,
    ]);

    let status = "unknown";
    if (changedTestFiles.length > 0) {
      status = "changed";
    } else if (existingTestFiles.length > 0) {
      status = "exists";
    } else if (outcome.canAssertMissing) {
      status = "missing";
    }

    return applyMappingPolicy(
      {
        sourceFile,
        language: outcome.language,
        status,
        relatedTestFiles,
        candidateTestFiles,
        confidence: outcome.confidence,
        resolverKind: outcome.resolverKind,
      },
      config,
      options.policy,
    );
  });

  const statusCounts = countByKey(mappings, "status");
  const gateCounts = countByKey(mappings, "gate");
  const shouldBlock = (gateCounts.block ?? 0) > 0;
  const shouldNotify = shouldBlock || (gateCounts.remind ?? 0) > 0;

  return {
    status: shouldBlock ? "blocked" : shouldNotify ? "remind" : "ok",
    shouldNotify,
    shouldBlock,
    summary: (
      `Analyzed test mappings for ${sourceFiles.length} changed source file(s); ` +
      `skipped ${skippedTestFiles.length} changed test file(s).`
    ),
    changedFiles,
    skippedTestFiles,
    mappings,
    statusCounts,
    gateCounts,
  };
}

export function formatTestMappingMessage(report) {
  const lines = [
    report.shouldBlock
      ? "Better Harness test mapping check blocked completion for missing critical-path test evidence."
      : "Better Harness test mapping check found missing test evidence.",
    report.summary,
  ];

  const blocking = report.mappings.filter((mapping) => mapping.gate === "block");
  const reminders = report.mappings.filter((mapping) => mapping.gate === "remind");

  appendMappingSection(lines, "Blocking mappings:", blocking);
  appendMappingSection(lines, "Advisory mappings:", reminders);

  lines.push(
    "Suggested next step: add or update one of the candidate test files, or document why the changed path is intentionally untested.",
  );
  return lines.join("\n");
}

function appendMappingSection(lines, title, mappings) {
  if (mappings.length === 0) {
    return;
  }

  lines.push(title);
  for (const mapping of mappings.slice(0, 8)) {
    const candidates = mapping.candidateTestFiles.slice(0, 3).join(", ") || "-";
    lines.push(
      `- ${mapping.sourceFile} [${mapping.language}] status=${mapping.status} confidence=${mapping.confidence}`,
    );
    lines.push(`  candidates: ${candidates}`);
  }
}

function jsonHookOutput(eventName, payload) {
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: eventName,
      ...payload,
    },
  })}\n`;
}

export async function runHook(input = {}, options = {}) {
  const cwd = path.resolve(
    options.cwd ?? input.cwd ?? process.env.QODER_CWD ?? process.cwd(),
  );
  const eventName = options.mode
    ? options.mode
    : input.hook_event_name ?? input.hookEventName ?? "";

  if (isStopEvent(eventName) && input.stop_hook_active) {
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  if (isStopEvent(eventName)) {
    const writeObserved =
      input.better_harness_write_observed === true ||
      input.betterHarnessWriteObserved === true ||
      (await hasRecentWriteMarker(cwd));
    if (!writeObserved) {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    await clearWriteMarker(cwd);
  }

  if (isPostToolEvent(eventName) && input.stop_hook_active) {
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  const report = await analyzeTestMappings(cwd, options);
  if (!report.shouldNotify) {
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  const message = formatTestMappingMessage(report);

  if (isPostToolEvent(eventName)) {
    await recordWriteMarker(cwd, input);
    return {
      exitCode: 0,
      stdout: jsonHookOutput("PostToolUse", { feedback: message }),
      stderr: "",
    };
  }

  if (isStopEvent(eventName) && report.shouldBlock) {
    return {
      exitCode: 2,
      stdout: "",
      stderr: `${message}\n`,
    };
  }

  return {
    exitCode: 0,
    stdout: `${message}\n`,
    stderr: "",
  };
}

function parseArgs(argv) {
  const args = {
    json: false,
    failOnBlock: false,
    failOnMissing: false,
    mode: "",
    cwd: "",
    configPath: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      args.json = true;
    } else if (arg === "--fail-on-block") {
      args.failOnBlock = true;
    } else if (arg === "--fail-on-missing") {
      args.failOnMissing = true;
    } else if (arg === "--mode") {
      args.mode = argv[index + 1] ?? "";
      index += 1;
    } else if (arg.startsWith("--mode=")) {
      args.mode = arg.slice("--mode=".length);
    } else if (arg === "--cwd") {
      args.cwd = argv[index + 1] ?? "";
      index += 1;
    } else if (arg.startsWith("--cwd=")) {
      args.cwd = arg.slice("--cwd=".length);
    } else if (arg === "--config") {
      args.configPath = argv[index + 1] ?? "";
      index += 1;
    } else if (arg.startsWith("--config=")) {
      args.configPath = arg.slice("--config=".length);
    }
  }

  return args;
}

async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  return input;
}

export async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = path.resolve(args.cwd || process.env.QODER_CWD || process.cwd());

  if (args.json) {
    const report = await analyzeTestMappings(cwd, {
      configPath: args.configPath || undefined,
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (args.failOnBlock && report.shouldBlock) {
      process.exitCode = 2;
    } else if (args.failOnMissing && (report.statusCounts.missing ?? 0) > 0) {
      process.exitCode = 2;
    }
    return;
  }

  const rawInput = await readStdin();
  const input = rawInput.trim() ? JSON.parse(rawInput) : {};
  const result = await runHook(input, {
    mode: args.mode || undefined,
    cwd,
    configPath: args.configPath || undefined,
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  process.exitCode = result.exitCode;
}

#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const CURRENT_FILE = fileURLToPath(import.meta.url);
const PRODUCT_DIRECTORIES = ["better-harness"];
const PREFERRED_HOST_DIRECTORIES = [".qoder", ".codex"];

const DIMENSIONS = [
  ["task-understanding", "Task Understanding", 36],
  ["controlled-execution", "Controlled Execution", 32],
  ["change-validation", "Change Validation", 34],
  ["reliable-delivery", "Reliable Delivery", 35],
  ["learning-capture", "Learning Capture", 33],
];

const HELP = `Usage: node dev/terminal-demo/play-better-harness-history.mjs [options]

Animate one project's historical Better Harness / Harness findings.

Options:
  --workspace <path>  Discover report roots below one project (default: cwd)
  --history-root <p>  Read one explicit report root (repeatable; expands ~)
  --root <path>       Compatibility alias for --history-root
  --limit <number>    Keep only the most recent N scans
  --since <date>      Keep scans on or after YYYY-MM-DD
  --omit-zero <id>    Treat zero as missing for one dimension (repeatable)
  --speed <number>    Playback speed multiplier (default: 1)
  --no-animate        Print only the final frame
  --no-color          Disable ANSI colors
  -h, --help          Print this help
`;

export function parseArgs(argv) {
  const options = {
    workspace: process.cwd(),
    historyRoots: [],
    limit: undefined,
    since: undefined,
    omitZero: [],
    speed: 1,
    animate: undefined,
    color: undefined,
    help: false,
  };
  let positionalRoot;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--no-animate") options.animate = false;
    else if (arg === "--no-color") options.color = false;
    else if (arg === "--workspace") options.workspace = argv[++index];
    else if (arg.startsWith("--workspace=")) options.workspace = arg.slice(12);
    else if (arg === "--history-root" || arg === "--root") options.historyRoots.push(argv[++index]);
    else if (arg.startsWith("--history-root=")) options.historyRoots.push(arg.slice(15));
    else if (arg.startsWith("--root=")) options.historyRoots.push(arg.slice(7));
    else if (arg === "--limit") options.limit = Number(argv[++index]);
    else if (arg.startsWith("--limit=")) options.limit = Number(arg.slice(8));
    else if (arg === "--since") options.since = argv[++index];
    else if (arg.startsWith("--since=")) options.since = arg.slice(8);
    else if (arg === "--omit-zero") options.omitZero.push(argv[++index]);
    else if (arg.startsWith("--omit-zero=")) options.omitZero.push(arg.slice(12));
    else if (arg === "--speed") options.speed = Number(argv[++index]);
    else if (arg.startsWith("--speed=")) options.speed = Number(arg.slice(8));
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else if (!positionalRoot) positionalRoot = arg;
    else throw new Error(`Unexpected positional argument: ${arg}`);
  }

  if (positionalRoot) options.historyRoots.push(positionalRoot);
  if (!options.workspace) throw new Error("--workspace requires a path");
  if (options.historyRoots.some((root) => !root)) throw new Error("--history-root requires a path");
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit <= 0)) {
    throw new Error("--limit must be a positive integer");
  }
  if (options.since !== undefined && !validDateOnly(options.since)) {
    throw new Error("--since must use a valid YYYY-MM-DD date");
  }
  const dimensionIds = new Set(DIMENSIONS.map(([id]) => id));
  for (const dimensionId of options.omitZero) {
    if (!dimensionIds.has(dimensionId)) throw new Error(`Unknown dimension for --omit-zero: ${dimensionId}`);
  }
  if (!Number.isFinite(options.speed) || options.speed <= 0) {
    throw new Error("--speed must be a positive number");
  }
  options.workspace = expandUserPath(options.workspace);
  options.historyRoots = options.historyRoots.map(expandUserPath);
  return options;
}

function validDateOnly(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value ?? "");
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function expandUserPath(value) {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.resolve(homedir(), value.slice(2));
  }
  return path.resolve(value);
}

function hostDirectoryRank(name) {
  const index = PREFERRED_HOST_DIRECTORIES.indexOf(name);
  return index === -1 ? PREFERRED_HOST_DIRECTORIES.length : index;
}

export function discoverHistoryRoots(workspace) {
  if (!existsSync(workspace)) throw new Error(`Workspace does not exist: ${workspace}`);
  const hostDirectories = readdirSync(workspace, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((left, right) => hostDirectoryRank(left) - hostDirectoryRank(right) || left.localeCompare(right));
  const roots = [];

  for (const productDirectory of PRODUCT_DIRECTORIES) {
    for (const hostDirectory of hostDirectories) {
      const candidate = path.join(workspace, hostDirectory, productDirectory);
      if (existsSync(candidate)) roots.push(candidate);
    }
  }

  if (roots.length === 0) {
    throw new Error(`No Better Harness history roots found below workspace: ${workspace}`);
  }
  return roots;
}

export function resolveHistoryRoots(options) {
  return options.historyRoots.length > 0
    ? [...new Set(options.historyRoots)]
    : discoverHistoryRoots(options.workspace);
}

function findingsFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile() && entry.name === "findings.json") files.push(entryPath);
    }
  };
  visit(root);
  return files;
}

function identity(filePath) {
  const segments = path.normalize(filePath).split(path.sep);
  let date = "unknown-date";
  let time = "000000";
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (/^\d{4}-\d{2}-\d{2}$/u.test(segments[index]) && /^\d{6}-.+/u.test(segments[index + 1] ?? "")) {
      date = segments[index];
      time = segments[index + 1].slice(0, 6);
    }
  }
  return {
    date,
    key: `${date}T${time}`,
    shortLabel: `${date.slice(5)} ${time.slice(0, 2)}:${time.slice(2, 4)}`,
  };
}

function isReady(runDirectory) {
  const statusFile = path.join(runDirectory, "report.canvas.status.json");
  if (!existsSync(statusFile)) return false;
  try {
    return JSON.parse(readFileSync(statusFile, "utf8"))?.status === "ready";
  } catch {
    return false;
  }
}

function revisionFrom(summary) {
  return [
    summary?.sourceRevision,
    summary?.sourceFingerprint,
    summary?.revision,
    summary?.evidenceBoundary?.manifest?.sourceFingerprint,
  ].find((value) => typeof value === "string" && value.trim()) ?? null;
}

export function loadHistory(rootOrRoots) {
  const roots = Array.isArray(rootOrRoots) ? rootOrRoots : [rootOrRoots];
  for (const root of roots) {
    if (!existsSync(root)) throw new Error(`History root does not exist: ${root}`);
  }
  const runs = [];
  const files = [...new Set(roots.flatMap(findingsFiles))];

  for (const filePath of files) {
    let data;
    try {
      data = JSON.parse(readFileSync(filePath, "utf8"));
    } catch (error) {
      throw new Error(`Cannot read ${filePath}: ${error.message}`);
    }
    if (!data?.summary || !Array.isArray(data.summary.dimensions) || !Array.isArray(data.findings)) continue;

    const scoreById = new Map(data.summary.dimensions.map((dimension) => [dimension?.id, dimension?.score]));
    runs.push({
      ...identity(filePath),
      filePath,
      projectName: data.summary.projectName ?? data.summary.project?.name ?? "Project",
      modelId: data.summary.modelId ?? "unknown-model",
      contract: Number(data.summary.reportContractVersion ?? 0),
      revision: revisionFrom(data.summary),
      ready: isReady(path.dirname(filePath)),
      nested: (filePath.match(/[\\/]\.[^\\/]+[\\/]better-harness/gu) ?? []).length > 1,
      dimensions: DIMENSIONS.map(([id, label, color]) => ({
        id,
        label,
        color,
        score: Number.isFinite(Number(scoreById.get(id))) ? Number(scoreById.get(id)) : null,
      })),
      findings: data.findings.map((finding) => ({
        severity: String(finding?.severity ?? "Unknown"),
        title: String(finding?.title ?? finding?.id ?? "Finding"),
      })),
    });
  }

  runs.sort((left, right) => left.key.localeCompare(right.key) || left.filePath.localeCompare(right.filePath));
  if (runs.length === 0) throw new Error(`No usable findings.json below: ${roots.join(", ")}`);
  return runs;
}

export function omitZeroOutliers(runs, dimensionIds) {
  const omitted = new Set(dimensionIds);
  return runs.map((run) => ({
    ...run,
    dimensions: run.dimensions.map((dimension) => ({
      ...dimension,
      score: omitted.has(dimension.id) && dimension.score === 0 ? null : dimension.score,
      omittedZeroOutlier: omitted.has(dimension.id) && dimension.score === 0,
    })),
  }));
}

export function selectHistory(runs, { since, limit } = {}) {
  const dated = since === undefined
    ? runs
    : runs.filter((run) => run.date !== "unknown-date" && run.date >= since);
  const selected = limit === undefined ? dated : dated.slice(-limit);
  if (selected.length === 0) {
    const scope = since === undefined ? "the requested selection" : `on or after ${since}`;
    throw new Error(`No Harness history runs found ${scope}`);
  }
  return selected;
}

function ansi(enabled, code, text) {
  return enabled ? `\u001b[${code}m${text}\u001b[0m` : text;
}

function textWidth(text) {
  let width = 0;
  for (const character of String(text)) width += character.charCodeAt(0) > 255 ? 2 : 1;
  return width;
}

function pad(text, width) {
  return `${text}${" ".repeat(Math.max(0, width - textWidth(text)))}`;
}

function truncate(text, width) {
  let output = "";
  let used = 0;
  for (const character of String(text)) {
    const characterWidth = character.charCodeAt(0) > 255 ? 2 : 1;
    if (used + characterWidth > width - 1) return `${output}…`;
    output += character;
    used += characterWidth;
  }
  return output;
}

function bar(score, width = 20) {
  if (score === null || score === undefined) return " ".repeat(width);
  const normalized = Math.max(0, Math.min(100, Number(score)));
  const filled = Math.round(normalized / 100 * width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

function spark(value, max = 100) {
  if (value === null || value === undefined) return "·";
  const glyphs = "▁▂▃▄▅▆▇█";
  const index = Math.max(0, Math.min(7, Math.round(Number(value) / max * 7)));
  return glyphs[index];
}

function trend(runs, runIndex, valueAt) {
  const output = [];
  let previousIncludedIndex = null;
  for (let index = 0; index <= runIndex; index += 1) {
    const value = valueAt(runs[index], index);
    if (value === null || value === undefined) continue;
    if (previousIncludedIndex !== null && runs[index].contract !== runs[previousIncludedIndex].contract) {
      output.push("│");
    }
    output.push(spark(value));
    previousIncludedIndex = index;
  }
  return output.join("");
}

function delta(runs, runIndex, valueAt) {
  const current = valueAt(runs[runIndex]);
  if (current === null || current === undefined) return "n/a";
  let previousIndex = runIndex - 1;
  while (previousIndex >= 0) {
    const candidate = valueAt(runs[previousIndex]);
    if (candidate !== null && candidate !== undefined) break;
    previousIndex -= 1;
  }
  if (previousIndex < 0) return "baseline";
  if (runs[runIndex].contract !== runs[previousIndex].contract) return "contract break";
  const previous = valueAt(runs[previousIndex]);
  const change = Number(current) - Number(previous);
  if (change === 0) return "Δ 0";
  return change > 0 ? `Δ +${change}` : `Δ ${change}`;
}

function statusHistory(runs, runIndex) {
  return runs.slice(0, runIndex + 1).map((run, index) => {
    const boundary = index > 0 && run.contract !== runs[index - 1].contract ? "│" : "";
    return `${boundary}${run.ready ? "●" : "○"}`;
  }).join("");
}

export function renderFrame(runs, runIndex, {
  scores = runs[runIndex].dimensions.map((dimension) => dimension.score),
  color = false,
  columns = 100,
} = {}) {
  const run = runs[runIndex];
  const lines = [];
  const ruleWidth = Math.max(60, Math.min(104, columns - 2));
  const ready = run.ready ? ansi(color, "32", "● ready") : ansi(color, "2", "○ snapshot");

  lines.push(ansi(color, "1;36", "Better Harness · Harness History"));
  lines.push(`${run.projectName} · scan ${String(runIndex + 1).padStart(2, "0")}/${String(runs.length).padStart(2, "0")} · ${run.shortLabel}`);
  lines.push(`${run.modelId} · contract v${run.contract} · ${ready}${run.nested ? " · nested output" : ""} · ${run.findings.length} findings`);
  lines.push("─".repeat(ruleWidth));

  run.dimensions.forEach((dimension, dimensionIndex) => {
    const rawScore = scores[dimensionIndex];
    const score = rawScore === null || rawScore === undefined ? null : Math.round(rawScore);
    const valueAt = (item, index) => index === runIndex ? score : item.dimensions[dimensionIndex].score;
    const scoreLabel = score === null ? "—" : String(score);
    lines.push(`${pad(dimension.label, 21)} ${ansi(color, String(dimension.color), bar(score))} ${scoreLabel.padStart(3)}  ${pad(delta(runs, runIndex, (item) => item.dimensions[dimensionIndex].score), 14)} ${ansi(color, String(dimension.color), trend(runs, runIndex, valueAt))}`);
  });

  const maxFindings = Math.max(1, ...runs.map((item) => item.findings.length));
  lines.push("");
  lines.push(`${pad("Finding count", 21)} ${String(run.findings.length).padStart(3)}  ${pad(delta(runs, runIndex, (item) => item.findings.length), 14)} ${trend(runs, runIndex, (item) => item.findings.length / maxFindings * 100)}`);
  lines.push(`${pad("Artifact status", 21)} ${statusHistory(runs, runIndex)}`);
  lines.push("");
  lines.push(ansi(color, "1", "Current findings"));
  for (const finding of run.findings.slice(0, 3)) {
    const severity = ansi(color, finding.severity === "High" ? "31" : "33", finding.severity);
    lines.push(`  ${severity}${" ".repeat(Math.max(2, 9 - textWidth(finding.severity)))}${truncate(finding.title, ruleWidth - 13)}`);
  }
  if (run.findings.length > 3) lines.push(`  ${ansi(color, "2", `+ ${run.findings.length - 3} more findings`)}`);

  lines.push("");
  if (runIndex > 0 && run.contract !== runs[runIndex - 1].contract) {
    lines.push(ansi(color, "33", "Comparison boundary: report contract changed; absolute deltas are not interpreted."));
  } else if (!run.revision) {
    lines.push(ansi(color, "33", "Comparison boundary: source revision is missing; this is a report trend, not causal proof."));
  } else {
    lines.push(`Source revision: ${run.revision}`);
  }
  const omittedOutliers = runs.reduce((count, item) => count
    + item.dimensions.filter((dimension) => dimension.omittedZeroOutlier).length, 0);
  const omittedLabel = omittedOutliers > 0
    ? ` · ${omittedOutliers} zero outlier${omittedOutliers === 1 ? "" : "s"} omitted`
    : "";
  lines.push(ansi(color, "2", `Legend: ● ready marker · ○ snapshot · │ contract boundary${omittedLabel}`));
  return `${lines.join("\n")}\n`;
}

function interpolated(previous, current, progress) {
  return current.map((target, index) => {
    if (target === null || target === undefined) return null;
    const start = previous[index] === null || previous[index] === undefined ? target : previous[index];
    return Math.round(Number(start) + (Number(target) - Number(start)) * progress);
  });
}

function writeScreen(text, clear) {
  if (clear) process.stdout.write("\u001b[2J\u001b[H");
  process.stdout.write(text);
}

export async function playHistory(runs, {
  speed = 1,
  animate = Boolean(process.stdout.isTTY),
  color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
  columns = process.stdout.columns || 100,
} = {}) {
  if (!animate) {
    writeScreen(renderFrame(runs, runs.length - 1, { color, columns }), false);
    return;
  }

  const wait = (milliseconds) => delay(Math.max(12, Math.round(milliseconds / speed)));
  const restore = () => process.stdout.write("\u001b[?25h");
  const interrupt = () => {
    restore();
    process.exit(130);
  };
  process.stdout.write("\u001b[?25l");
  process.once("SIGINT", interrupt);

  try {
    writeScreen(`${ansi(color, "1;36", "Better Harness")}\n\nHistorical Harness trend · ${runs.length} scans\nFive independent dimensions · no averaged headline score\n`, true);
    await wait(700);

    for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
      const current = runs[runIndex].dimensions.map((dimension) => dimension.score);
      const previous = runIndex === 0
        ? current.map((score) => score === null ? null : 0)
        : runs[runIndex - 1].dimensions.map((dimension) => dimension.score);
      const frameCount = runIndex === 0 ? 10 : 6;
      for (let frame = 1; frame <= frameCount; frame += 1) {
        const progress = 1 - Math.pow(1 - frame / frameCount, 3);
        writeScreen(renderFrame(runs, runIndex, {
          scores: interpolated(previous, current, progress),
          color,
          columns,
        }), true);
        await wait(45);
      }
      await wait(runIndex === runs.length - 1 ? 900 : 260);
    }
  } finally {
    process.removeListener("SIGINT", interrupt);
    restore();
  }
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      process.stdout.write(HELP);
      return 0;
    }
    const roots = resolveHistoryRoots(options);
    const history = loadHistory(roots);
    const selected = selectHistory(history, { since: options.since, limit: options.limit });
    const runs = omitZeroOutliers(selected, options.omitZero);
    await playHistory(runs, {
      speed: options.speed,
      animate: options.animate ?? Boolean(process.stdout.isTTY),
      color: options.color ?? (Boolean(process.stdout.isTTY) && !process.env.NO_COLOR),
    });
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(CURRENT_FILE)) {
  process.exitCode = await main();
}

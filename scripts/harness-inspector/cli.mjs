#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  attachCheckpointFactsToSessions,
  boundedCommitLimit,
  boundedMaxSessions,
  collectCommitFacts,
  collectEntireCheckpointFacts,
  collectMultiPlatformSessionSummaries,
  correlateCommitsWithSessions,
  DEFAULT_COMMIT_LIMIT,
  DEFAULT_MAX_SESSIONS,
} from "../commit-session-link/index.mjs";
import { SUPPORTED_SESSION_PROVIDERS } from "../session-analysis/index.mjs";
import { emptyFeatureTree, FeatureTreeParseError, parseFeatureTreeMarkdown } from "./feature-tree.mjs";
import { openRenderedReport } from "./open-report.mjs";
import { renderHarnessInspectorHtml } from "./render-html.mjs";
import { buildHarnessInspectorReport } from "./report-model.mjs";

const HELP = `Harness Inspector v1

Render a read-only feature/story/prompt/session/commit provenance report with
Feature Tree and Date scope pickers.

Usage:
  npx @qoder-ai/better-harness inspector
  node scripts/harness-inspector/cli.mjs render [--workspace <dir>] [--platform <hosts>] [--feature-tree <file>] [--since <date>] [--until <date>] [--stage <name>] [--commits <n>] [--max-sessions <n>] [--out <file>] [--open]

Default:
  inspector             Render and open the current workspace with activity
                        from the latest 30 UTC days (up to 200 commits and
                        100 hydrated sessions)
  render                Uses the same 30-day window unless --since or --until
                        supplies a caller-owned time bound

Options:
  --workspace <dir>      Repository to inspect (default: current directory)
  --platform <hosts>     "all", one host, or a comma list such as qoder,claude (default: all)
  --feature-tree <file>  Markdown Feature Tree; defaults to .better-harness/feature-tree.md when present
  --since <date>         Earliest included session/commit timestamp or YYYY-MM-DD
  --until <date>         Latest included session/commit timestamp or YYYY-MM-DD
  --stage <name>         Initially select the matching Feature Tree stage
  --commits <n>          Bound scanned commits (default: ${DEFAULT_COMMIT_LIMIT})
  --max-sessions <n>     Bound hydrated sessions (default: ${DEFAULT_MAX_SESSIONS})
  --out <file>           Output HTML path
  --open                 Open the written report in the default browser
  -h, --help             Print help without reading the workspace

The report is self-contained and does not write Git metadata or native session state.
`;

const ALLOWED_OPTIONS = new Set([
  "--workspace",
  "--platform",
  "--feature-tree",
  "--since",
  "--until",
  "--stage",
  "--commits",
  "--max-sessions",
  "--out",
  "--open",
]);

// Boolean flags take no value, so a following token stays a flag position and an
// explicit "--open true" fails as an unrecognized option instead of silently
// swallowing the next argument.
const BOOLEAN_OPTIONS = new Set(["--open"]);
const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_WINDOW_COMMIT_LIMIT = 200;
const DEFAULT_WINDOW_SESSION_LIMIT = 100;

function utcDayLabel(value) {
  return value.toISOString().slice(0, 10);
}

function defaultWindowBounds(now = new Date()) {
  const end = new Date(now);
  if (Number.isNaN(end.getTime())) throw new TypeError("default Inspector clock must be a valid date");
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (DEFAULT_WINDOW_DAYS - 1));
  return { since: utcDayLabel(start), until: utcDayLabel(end) };
}

function defaultInspectorArgs(now = new Date()) {
  const { since, until } = defaultWindowBounds(now);
  return [
    "render",
    "--workspace", ".",
    "--open",
    "--since", since,
    "--until", until,
    "--commits", String(DEFAULT_WINDOW_COMMIT_LIMIT),
    "--max-sessions", String(DEFAULT_WINDOW_SESSION_LIMIT),
  ];
}

class UsageError extends Error {
  constructor(message, safeFlag = null) {
    super(safeFlag ? `${message}: ${safeFlag}` : message);
    this.exitCode = 64;
  }
}

export function parseRenderOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!ALLOWED_OPTIONS.has(flag)) throw new UsageError("unrecognized option");
    if (Object.hasOwn(options, flag)) throw new UsageError("duplicate option", flag);
    if (BOOLEAN_OPTIONS.has(flag)) {
      options[flag] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new UsageError("missing option value", flag);
    options[flag] = value;
    index += 1;
  }
  return options;
}

function normalizedBound(value, { endOfDay = false } = {}) {
  if (!value) return null;
  const text = String(value).trim();
  const expanded = /^\d{4}-\d{2}-\d{2}$/u.test(text)
    ? `${text}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`
    : text;
  const time = new Date(expanded);
  if (Number.isNaN(time.getTime())) throw new UsageError(endOfDay ? "invalid --until value" : "invalid --since value");
  return time.toISOString();
}

function withinBounds(value, since, until) {
  const time = new Date(value ?? "").getTime();
  if (Number.isNaN(time)) return false;
  if (since && time < new Date(since).getTime()) return false;
  if (until && time > new Date(until).getTime()) return false;
  return true;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadFeatureTree(repoRoot, requestedPath) {
  const filePath = requestedPath
    ? path.resolve(requestedPath)
    : path.join(repoRoot, ".better-harness", "feature-tree.md");
  if (!requestedPath && !(await exists(filePath))) return emptyFeatureTree();
  const markdown = await readFile(filePath, "utf8");
  return parseFeatureTreeMarkdown(markdown, { source: filePath });
}

// Resolve "all", one host, or a comma list into a validated platform list
// without echoing unrecognized values into error output.
function parsePlatforms(value) {
  const text = String(value ?? "all").trim().toLowerCase();
  if (text === "all") return [...SUPPORTED_SESSION_PROVIDERS];
  const requested = [...new Set(text.split(",").map((item) => item.trim()).filter(Boolean))];
  if (requested.length === 0 || requested.some((platform) => !SUPPORTED_SESSION_PROVIDERS.includes(platform))) {
    throw new UsageError(`--platform expects all or a comma list of ${SUPPORTED_SESSION_PROVIDERS.join(", ")}`);
  }
  return requested;
}

async function runRender(options, { open = openRenderedReport, cwd = process.cwd(), now = new Date() } = {}) {
  const workspace = path.resolve(cwd, options["--workspace"] ?? ".");
  const requestedPlatform = options["--platform"] ?? "all";
  const platforms = parsePlatforms(requestedPlatform);
  const hasExplicitWindow = Object.hasOwn(options, "--since") || Object.hasOwn(options, "--until");
  const defaultWindow = hasExplicitWindow ? { since: null, until: null } : defaultWindowBounds(now);
  const since = normalizedBound(options["--since"] ?? defaultWindow.since);
  const until = normalizedBound(options["--until"] ?? defaultWindow.until, { endOfDay: true });
  if (since && until && new Date(since) > new Date(until)) throw new UsageError("--since must not be after --until");
  const commitLimit = boundedCommitLimit(options["--commits"]);
  const sessionLimit = boundedMaxSessions(options["--max-sessions"]);
  const collected = collectCommitFacts({ workspace, limit: commitLimit, since, until });
  const commits = collected.commits.filter((commit) => withinBounds(commit.committedAt ?? commit.authoredAt, since, until));
  const { sessions: summaries, providers } = await collectMultiPlatformSessionSummaries({
    workspace,
    repoRoot: collected.repoRoot,
    platforms,
    since,
    until,
    maxSessions: sessionLimit,
    includeToolTrace: true,
    includeDialogue: true,
  });
  const checkpointResolution = collectEntireCheckpointFacts({ repoRoot: collected.repoRoot, commits });
  const sessions = attachCheckpointFactsToSessions(summaries, checkpointResolution.checkpoints);
  const correlated = correlateCommitsWithSessions(commits, sessions);
  const filesByCommit = new Map(commits.map((commit) => [commit.hash, commit.files]));
  const correlation = {
    ...correlated,
    commits: correlated.commits.map((commit) => ({
      ...commit,
      files: filesByCommit.get(commit.hash) ?? [],
    })),
  };
  const featureTree = await loadFeatureTree(collected.repoRoot, options["--feature-tree"]);
  const failedProviders = providers.filter((provider) => provider.status === "error");
  const missingProviders = providers.filter((provider) => provider.status === "no-evidence");
  const diagnostics = [
    ...(checkpointResolution.unresolved.length > 0
      ? [`${checkpointResolution.unresolved.length} Entire checkpoint link(s) could not be resolved locally.`]
      : []),
    ...failedProviders.map((provider) => `Session provider ${provider.platform} failed: ${provider.message ?? "unknown error"}`),
    ...(missingProviders.length > 0
      ? [`No local session evidence for ${missingProviders.map((provider) => provider.platform).join(", ")}.`]
      : []),
  ];
  const report = buildHarnessInspectorReport({
    repoRoot: collected.repoRoot,
    featureTree,
    sessions,
    correlation,
    providers,
    filters: {
      platform: requestedPlatform,
      since,
      until,
      stage: options["--stage"] ?? null,
      commitLimit,
      sessionLimit,
    },
    diagnostics,
  });
  const html = renderHarnessInspectorHtml(report);
  const outputPath = path.resolve(
    options["--out"]
      ?? path.join(collected.repoRoot, ".qoder", "better-harness-runs", "harness-inspector", "inspector.html"),
  );
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, "utf8");
  const opened = options["--open"] === true ? open(outputPath) : null;
  process.stdout.write(`${JSON.stringify({
    outputPath,
    ...(opened === null ? {} : { opened }),
    featureNodes: report.featureTree.nodes.length,
    stories: report.stories.length,
    days: report.days.length,
    sessions: report.sessions.length,
    commits: report.commits.length,
    toolCalls: report.sessions.reduce((sum, session) => sum + session.toolTrace.totalCalls, 0),
    providers: report.providers,
  }, null, 2)}\n`);
}

export async function main(argv = process.argv.slice(2), runtime = {}) {
  const effectiveArgv = argv.length === 0
    ? defaultInspectorArgs(runtime.now ?? new Date())
    : argv;
  if (effectiveArgv.includes("--help") || effectiveArgv.includes("-h")) {
    process.stdout.write(HELP);
    return 0;
  }
  // A leading option flag implies render, so "inspector --out report.html"
  // works without the explicit subcommand.
  const [command, ...rest] = effectiveArgv[0].startsWith("--")
    ? ["render", ...effectiveArgv]
    : effectiveArgv;
  if (command !== "render") {
    process.stderr.write("Unknown command; expected render\n");
    return 64;
  }
  try {
    await runRender(parseRenderOptions(rest), runtime);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n`);
      return error.exitCode;
    }
    if (error instanceof FeatureTreeParseError) {
      for (const item of error.diagnostics) process.stderr.write(`feature tree line ${item.line}: ${item.message}\n`);
      return 1;
    }
    process.stderr.write(`${error?.message ?? "Harness Inspector failed"}\n`);
    return 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}

import { analyzeClaudeStyleSessions } from "./claude-facets.mjs";
import { parseArgs } from "./cli.mjs";
import { createCodexCliJsonModelClient } from "./codex-json-model.mjs";

// Minimal AI-facing usage:
//   const analyzer = await createAnalyzer("qoder");
//   const result = await analyzer.analyze({ workspace: "/path/to/repo", command: "facets" });
//   // result => { scope, sources, sessions, facets, warnings }
// CLI workflow for AI agents:
//   node scripts/session-analysis.mjs sources --platform qoder --workspace /path/to/repo
//   node scripts/session-analysis.mjs facets --platform qoder --workspace /path/to/repo --limit 5
//   node scripts/session-analysis.mjs insights --platform qoder --workspace /path/to/repo --limit 5
//   node scripts/session-analysis.mjs facts --platform qoder --workspace /path/to/repo --limit 3
//   node scripts/session-analysis.mjs claude-facets --platform qoder --workspace /path/to/repo --limit 5
//   node scripts/session-analysis.mjs file-reads --platform qoder --workspace /path/to/repo --limit 5
//   node scripts/session-analysis.mjs show --platform qoder --workspace /path/to/repo --session-id <id> --include-events
// This module returns evidence and compact insight packs; the caller synthesizes
// any final narrative/report.

export const SESSION_ANALYSIS_HELP = `Usage: better-harness session-analysis [command] [options]

Inspect local Qoder, Codex, Claude, or Cursor session evidence. The default
command is sessions and the default platform is qoder. Help exits before
reading HOME or workspace.

Commands:
  sources       List configured local evidence roots and availability
  sessions      List bounded sessions (default)
  facets        Aggregate normalized session events
  insights      Project privacy-safe insight summaries
  facts         Emit bounded privacy-safe facts for semantic review
  claude-facets Run the opt-in semantic facet experiment
  file-reads    Summarize file-access diagnostics
  show          Show one session selected with --session-id
  events        Show normalized events selected with --session-id

Options:
  --platform <qoder|codex|claude|cursor>
                            Session host (default: qoder)
  --workspace <dir>         Workspace scope (default: current directory)
  --qoder-home <dir>        Qoder data root (default: ~/.qoder)
  --codex-home <dir>        Codex data root (default: ~/.codex)
  --claude-home <dir>       Claude Code data root (default: ~/.claude)
  --cursor-home <dir>       Cursor data root (default: ~/.cursor)
  --include-cache           Include optional Qoder cache evidence
  --include-global-capabilities
                            Include optional user-global Qoder evidence
  --since <date>            Inclusive start date or timestamp
  --until <date>            Inclusive end date or timestamp
  --limit <n>               Bound selected sessions
  --format <json|markdown>  Output format (default: json)
  -h, --help                Print this help without scanning local data
`;

function helpRequested(argv) {
  return argv[0] === "help" || argv.includes("-h") || argv.includes("--help");
}

export class SessionAnalyzer {
  async resolveScope(_options = {}) {
    throw new Error("resolveScope() must be implemented by a platform analyzer");
  }

  async discoverSourceRoots(_scope) {
    throw new Error("discoverSourceRoots() must be implemented by a platform analyzer");
  }

  async discoverSessions(_scope, _roots) {
    throw new Error("discoverSessions() must be implemented by a platform analyzer");
  }

  async readSession(_session, _scope, _options = {}) {
    throw new Error("readSession() must be implemented by a platform analyzer");
  }

  normalizeEvent(_raw, _sourceRef, _options = {}) {
    throw new Error("normalizeEvent() must be implemented by a platform analyzer");
  }

  normalizeEvents(raw, sourceRef, options = {}) {
    const event = this.normalizeEvent(raw, sourceRef, options);
    return event ? [event] : [];
  }

  mergeSession(events, session) {
    const summary = summarizeEvents(events);
    return {
      ...session,
      firstSeen: summary.timeRange.firstSeen ?? session.firstSeen,
      lastSeen: summary.timeRange.lastSeen ?? session.lastSeen,
      eventCounts: summary.eventCounts,
      messageCounts: summary.messageCounts,
    };
  }

  async analyze(options = {}) {
    const scope = await this.resolveScope(options);
    const roots = await this.discoverSourceRoots(scope);
    const sessions = Array.isArray(options.sessionInventory)
      ? [...options.sessionInventory]
      : await this.discoverSessions(scope, roots);
    const filteredSessions = filterSessionsByScope(sessions, scope);

    return {
      scope: publicScope(scope),
      sources: roots.map(toPublicSource),
      sessions: filteredSessions,
      facets: null,
      warnings: rootWarnings(roots),
    };
  }
}

function timestampMillis(value) {
  if (!value) {
    return null;
  }
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function mergeTimeRange(target, timestamp) {
  if (!timestamp) {
    return;
  }
  if (!target.firstSeen || timestampMillis(timestamp) < timestampMillis(target.firstSeen)) {
    target.firstSeen = timestamp;
  }
  if (!target.lastSeen || timestampMillis(timestamp) > timestampMillis(target.lastSeen)) {
    target.lastSeen = timestamp;
  }
}

function countBy(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function summarizeEvents(events) {
  const timeRange = { firstSeen: null, lastSeen: null };
  for (const event of events) {
    mergeTimeRange(timeRange, event.timestamp);
  }

  return {
    eventCounts: countBy(events, (event) => event.type),
    messageCounts: countBy(events, (event) =>
      event.type === "user" || event.type === "assistant" || event.type === "last-prompt" || event.type === "message"
        ? event.type
        : null,
    ),
    sourceCounts: countBy(events, (event) => event.sourceKind),
    timeRange,
  };
}

function filterSessionsByScope(sessions, scope) {
  return sessions.filter((session) => {
    if (scope.sessionId && session.sessionId !== scope.sessionId) {
      return false;
    }
    if (scope.sinceTime !== null && session.lastSeen && timestampMillis(session.lastSeen) < scope.sinceTime) {
      return false;
    }
    if (scope.untilTime !== null && session.firstSeen && timestampMillis(session.firstSeen) > scope.untilTime) {
      return false;
    }
    return true;
  });
}

function publicScope(scope) {
  return Object.fromEntries(
    Object.entries(scope).filter(([key]) => !key.endsWith("Time") && key !== "raw" && !key.startsWith("_")),
  );
}

function toPublicSource(root) {
  return {
    id: root.id,
    kind: root.kind,
    role: root.role,
    path: root.path,
    exists: root.exists,
    enabled: root.enabled,
    optional: root.optional,
    workspaceScoped: root.workspaceScoped,
  };
}

function rootWarnings(roots) {
  return [
    ...roots
      .filter((root) => root.enabled && root.optional && !root.exists)
      .map((root) => ({
        code: "missing-optional-root",
        message: `${root.kind} root does not exist: ${root.path}`,
        source: root.id,
      })),
    ...roots
      .filter((root) => !root.enabled)
      .map((root) => ({
        code: "disabled-source-root",
        message: root.disabledHint ? `${root.kind} root is disabled; ${root.disabledHint}` : `${root.kind} root is disabled`,
        source: root.id,
      })),
  ];
}

function platformFromArgs(argv) {
  const index = argv.indexOf("--platform");
  if (index !== -1 && argv[index + 1]) {
    return argv[index + 1];
  }

  const withEquals = argv.find((arg) => arg.startsWith("--platform="));
  if (withEquals) {
    return withEquals.slice("--platform=".length);
  }

  return "qoder";
}

async function loadPlatform(platform = "qoder") {
  if (platform === "qoder") {
    const module = await import("./platforms/qoder.mjs");
    return {
      Analyzer: module.QoderSessionAnalyzer,
      main: module.main,
    };
  }
  if (platform === "codex") {
    const module = await import("./platforms/codex.mjs");
    return {
      Analyzer: module.CodexSessionAnalyzer,
      main: module.main,
    };
  }
  if (platform === "claude") {
    const module = await import("./platforms/claude.mjs");
    return {
      Analyzer: module.ClaudeSessionAnalyzer,
      main: module.main,
    };
  }
  if (platform === "cursor") {
    const module = await import("./platforms/cursor.mjs");
    return {
      Analyzer: module.CursorSessionAnalyzer,
      main: module.main,
    };
  }
  throw new Error(`Unsupported platform: ${platform}. Supported platforms: qoder, codex, claude, cursor.`);
}

export async function createAnalyzer(platform = "qoder") {
  const { Analyzer } = await loadPlatform(platform);
  return new Analyzer();
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const stdout = dependencies.stdout ?? process.stdout;
  const { command, options } = parseArgs(argv);
  if (command === "claude-facets") {
    if (options.help === true) {
      stdout.write([
        "Usage: session-analysis claude-facets --platform <qoder|codex|claude|cursor> --workspace <path> [options]",
        "",
        "Options:",
        "  --limit <1-5>                 Maximum semantic facets (default: 5)",
        "  --selection <strategy>        Existing bounded session selection strategy",
        "  --since <date> --until <date> Freeze an explicit time window",
        "  --analysis-model codex-cli    JSON model route (default and only supported route)",
        "  --model-concurrency <1-4>     Concurrent per-session model calls (default: 2)",
        "  --format json                 Output format (default and only supported format)",
        "",
        "Privacy: compact redacted session semantics are sent to the configured Codex service;",
        "raw prompts, commands, tool output, paths, ids, and secrets are excluded.",
        "This experiment does not change findings, reports, scores, or caches.",
      ].join("\n") + "\n");
      return null;
    }
    const platform = options.platform ?? "qoder";
    const analysisModel = options["analysis-model"] ?? "codex-cli";
    const format = options.format ?? "json";
    if (analysisModel !== "codex-cli") {
      throw new Error(`Unsupported analysis model: ${analysisModel}. Supported models: codex-cli.`);
    }
    if (format !== "json") throw new Error(`claude-facets supports only JSON output, not ${format}`);
    const analyzer = await createAnalyzer(platform);
    const result = await analyzeClaudeStyleSessions({
      analyzer,
      platform,
      options,
      modelClient: createCodexCliJsonModelClient(),
    });
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
  if (helpRequested(argv)) {
    stdout.write(SESSION_ANALYSIS_HELP);
    return 0;
  }
  const platform = platformFromArgs(argv);
  const platformLoader = dependencies.loadPlatform ?? loadPlatform;
  const { main: platformMain } = await platformLoader(platform);
  return platformMain(argv);
}

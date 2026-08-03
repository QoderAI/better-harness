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

Inspect local Qoder, Codex, Claude, Cursor, Qwen, Copilot, Pi, WorkBuddy, or Grok session evidence. The
default command is sessions and the default platform is qoder. Help exits before
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
  --platform <qoder|codex|claude|cursor|qwen|copilot|pi|workbuddy|grok>
                            Session host (default: qoder)
  --workspace <dir>         Workspace scope (default: current directory)
  --qoder-home <dir>        Qoder data root (default: ~/.qoder)
  --codex-home <dir>        Codex data root (default: ~/.codex)
  --claude-home <dir>       Claude Code data root (default: ~/.claude)
  --cursor-home <dir>       Cursor data root (default: ~/.cursor)
  --qwen-home <dir>         Qwen Code data root (default: ~/.qwen)
  --copilot-home <dir>      Copilot CLI data root (default: ~/.copilot)
  --pi-home <dir>           Pi agent data root (default: ~/.pi/agent)
  --workbuddy-home <dir>    WorkBuddy data root (default: ~/.workbuddy)
  --grok-home <dir>         Grok CLI data root (default: ~/.grok or $GROK_HOME)
  --include-cache           Include optional Qoder cache evidence
  --include-global-capabilities
                            Include optional user-global Qoder evidence
  --since <date>            Inclusive start date or timestamp
  --until <date>            Inclusive end date or timestamp
  --limit <n>               Bound selected sessions
  --format <json|markdown>  Output format (default: json)
  -h, --help                Print this help without scanning local data
`;

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

// Single platform registry: adding a host adapter means adding one entry here
// and creating scripts/session-analysis/platforms/<host>.mjs.
const PLATFORM_MODULES = Object.freeze({
  qoder: { specifier: "./platforms/qoder.mjs", analyzer: "QoderSessionAnalyzer" },
  codex: { specifier: "./platforms/codex.mjs", analyzer: "CodexSessionAnalyzer" },
  claude: { specifier: "./platforms/claude.mjs", analyzer: "ClaudeSessionAnalyzer" },
  cursor: { specifier: "./platforms/cursor.mjs", analyzer: "CursorSessionAnalyzer" },
  qwen: { specifier: "./platforms/qwen.mjs", analyzer: "QwenSessionAnalyzer" },
  copilot: { specifier: "./platforms/copilot.mjs", analyzer: "CopilotSessionAnalyzer" },
  pi: { specifier: "./platforms/pi.mjs", analyzer: "PiSessionAnalyzer" },
  workbuddy: { specifier: "./platforms/workbuddy.mjs", analyzer: "WorkbuddySessionAnalyzer" },
  grok: { specifier: "./platforms/grok.mjs", analyzer: "GrokSessionAnalyzer" },
});

export const SUPPORTED_SESSION_PLATFORMS = Object.freeze(Object.keys(PLATFORM_MODULES));

async function loadPlatform(platform = "qoder") {
  const entry = PLATFORM_MODULES[platform];
  if (!entry) {
    throw new Error(`Unsupported platform: ${platform}. Supported platforms: ${SUPPORTED_SESSION_PLATFORMS.join(", ")}.`);
  }
  const module = await import(entry.specifier);
  return {
    Analyzer: module[entry.analyzer],
    main: module.main,
  };
}

export async function createAnalyzer(platform = "qoder") {
  const { Analyzer } = await loadPlatform(platform);
  return new Analyzer();
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const stdout = dependencies.stdout ?? process.stdout;
  const { command, options } = parseArgs(argv);
  if (command === "help") {
    stdout.write(SESSION_ANALYSIS_HELP);
    return 0;
  }
  if (options.help === true) {
    const factsOptions = command === "facts"
      ? [
          "",
          "Facts options:",
          "  --limit <1-5>            Maximum emitted task candidates (default: 5)",
          "  --selection <strategy>   stratified, latest-n, or all-eligible",
          "  --since <date> --until <date> Freeze the provider-specific review window",
          "  --debug                  Add local-only candidate-to-session-id locators",
          "  --output <path>          Write local diagnostic output to a file",
      ]
      : [];
    const eventOptions = command === "show" || command === "events"
      ? [
          "",
          "Event inspection options:",
          "  --session-id <id>          Raw session id from local facts --debug output",
          "  --include-events           Include normalized events in show output",
          "  --include-command-text     Include command text for local diagnosis",
          "  --include-user-text        Include user text for local diagnosis",
          "  --include-content          Include provider content for local diagnosis",
          "  --type <event-type>        Filter events output by normalized type",
        ]
      : [];
    const claudeOptions = command === "claude-facets"
      ? [
          "",
          "Claude facets options:",
          "  --limit <1-5>                 Maximum semantic facets (default: 5)",
          "  --selection <strategy>        Existing bounded session selection strategy",
          "  --since <date> --until <date> Freeze an explicit time window",
          "  --analysis-model codex-cli    JSON model route",
          "  --model-concurrency <1-4>     Concurrent per-session model calls (default: 2)",
          "",
          "Privacy: compact redacted session semantics are sent to the configured Codex service;",
          "raw prompts, commands, tool output, paths, ids, and secrets are excluded.",
          "This experiment does not change findings, reports, scores, or caches.",
        ]
      : [];
    stdout.write([
      `Usage: session-analysis${command ? ` ${command}` : " <command>"} --platform <qoder|codex|claude|cursor|qwen|copilot|pi|workbuddy|grok> --workspace <path> [options]`,
      "",
      "Commands: sources, sessions, facets, insights, facts, file-reads, show, events, claude-facets",
      ...factsOptions,
      ...eventOptions,
      ...claudeOptions,
      "",
      "Options: --workbuddy-home <dir> overrides the WorkBuddy data root (default: ~/.workbuddy); --grok-home <dir> overrides the Grok data root (default: ~/.grok or $GROK_HOME).",
      "",
      "Use facts --debug only for local diagnosis; it exposes raw session ids and must not be passed to report agents.",
    ].join("\n") + "\n");
    return null;
  }
  if (command === "claude-facets") {
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
  const platform = platformFromArgs(argv);
  const platformLoader = dependencies.loadPlatform ?? loadPlatform;
  const { main: platformMain } = await platformLoader(platform);
  return platformMain(argv);
}

import { formatHostList, HOST_CAPABILITIES, hostIdsFor } from "../host-support/index.mjs";
import { PLUGIN_COMMAND_MANIFEST } from "../plugin-lifecycle/command-manifest.mjs";

export const FORMAT_VERSION = "1.0";
export const CLI_NAME = "better-harness";
export const COMMAND_AUDIENCES = Object.freeze(["workflow", "advanced", "maintainer"]);

const AUDIENCE_RANK = Object.freeze({
  workflow: 0,
  advanced: 1,
  maintainer: 2,
  all: 2,
});

const COMMANDS = [
  {
    name: "report",
    kind: "direct",
    audience: "workflow",
    script: "harness-quickstart/cli.mjs",
    summary: "Gather static evidence and hand off to the Better Harness skill for a five-minute readiness report.",
    aliases: [{ name: "quickstart", hidden: true }],
  },
  {
    name: "agent-customize",
    kind: "direct",
    audience: "advanced",
    script: "agent-customize/cli.mjs",
    summary: "Inspect agent-facing Skills, MCPs, hooks, plugins, settings, and memory surfaces.",
    aliases: [{ name: "customize", hidden: true }],
  },
  {
    name: "plugin",
    kind: "group",
    audience: "advanced",
    summary: "Inspect, plan, and verify the Better Harness plugin lifecycle without applying changes.",
    description: "Normalize Better Harness installation evidence across Coding Agent hosts, emit read-only native lifecycle plans, and verify local plugin assets without executing host commands.",
    subcommands: PLUGIN_COMMAND_MANIFEST.map(({ name, audience, entryScript: script, summary }) => ({
      name,
      audience,
      script,
      summary,
    })),
  },
  {
    name: "doctor",
    kind: "direct",
    audience: "workflow",
    script: "harness-doctor/cli.mjs",
    summary: "Run bounded read-only Better Harness runtime and host diagnostics.",
  },
  {
    name: "agent-lint",
    kind: "direct",
    audience: "advanced",
    script: "agent-lint/cli.mjs",
    summary: "Parse AGENTS.md and local Markdown references for agent-instruction linting.",
  },
  {
    name: "cloc",
    kind: "direct",
    audience: "advanced",
    script: "cloc/cli.mjs",
    summary: "Count code, comments, and blank lines.",
  },
  {
    name: "dependency-governance",
    kind: "direct",
    audience: "advanced",
    script: "dependency-governance/cli.mjs",
    summary: "Detect dependency governance files, automation, audit signals, and stale dependency evidence.",
  },
  {
    name: "commit-session-link",
    kind: "direct",
    audience: "advanced",
    script: "commit-session-link/cli.mjs",
    summary: "Correlate local git commits with discovered coding-agent sessions and render a commit-view HTML report.",
    subcommands: [
      {
        name: "correlate",
        audience: "advanced",
        script: "commit-session-link/cli.mjs",
        summary: "Emit ranked commit-to-session matches with trailer, time, file, and cwd evidence as JSON.",
      },
      {
        name: "render",
        audience: "advanced",
        script: "commit-session-link/cli.mjs",
        summary: "Write a self-contained commit-view HTML report for one commit and its linked sessions.",
      },
      {
        name: "render-session",
        audience: "advanced",
        script: "commit-session-link/cli.mjs",
        summary: "Write a self-contained Session Viewer with activity, tool-call trace, and linked-commit markers.",
      },
    ],
  },
  {
    name: "harness-inspector",
    kind: "direct",
    audience: "advanced",
    script: "harness-inspector/cli.mjs",
    summary: "Inspect feature, Story, prompt, session, tool-call, and commit provenance by product tree or date.",
    aliases: [{ name: "inspector", hidden: true }],
    subcommands: [
      {
        name: "render",
        audience: "advanced",
        script: "harness-inspector/cli.mjs",
        summary: "Write a self-contained Harness Inspector with Feature Tree and Date scope pickers.",
      },
    ],
  },
  {
    name: "session-analysis",
    kind: "direct",
    audience: "advanced",
    script: "session-analysis.mjs",
    summary: `Collect and normalize ${formatHostList(hostIdsFor(HOST_CAPABILITIES.SESSION_ANALYSIS), { displayNames: true, conjunction: "and" })} session evidence.`,
    subcommands: [
      {
        name: "sources",
        audience: "advanced",
        script: "session-analysis.mjs",
        summary: "List enabled and available session evidence roots.",
      },
      {
        name: "sessions",
        audience: "advanced",
        script: "session-analysis.mjs",
        summary: "List discovered sessions for a bounded workspace scope.",
      },
      {
        name: "facets",
        audience: "maintainer",
        script: "session-analysis.mjs",
        summary: "Aggregate normalized session events into reusable facets.",
      },
      {
        name: "insights",
        audience: "maintainer",
        script: "session-analysis.mjs",
        summary: "Project compact insight cards and action candidates from facets.",
      },
      {
        name: "facts",
        audience: "advanced",
        script: "session-analysis.mjs",
        summary: "Emit bounded privacy-safe session facts for semantic review.",
        description: "Return sanitized user requests, edit/check facts, reliable result counts, and omission boundaries without complete session, facet, card, or action payloads.",
      },
      {
        name: "claude-facets",
        audience: "maintainer",
        script: "session-analysis.mjs",
        summary: "Run an opt-in Claude-style semantic facet and suggestion-lead experiment.",
        description: "Analyze bounded sessions with transient redacted transcripts and a read-only CLI model without changing facts, findings, reports, or caches.",
      },
      {
        name: "usage-summary",
        audience: "advanced",
        script: "session-analysis/usage-summary.mjs",
        summary: "Emit a bounded read-only usage and model-evidence boundary.",
        description: "Return compact selection, accounting, coverage, long-session, model-usage, and outcome-review fields without writing report or scratch files.",
      },
      {
        name: "file-reads",
        audience: "advanced",
        script: "session-analysis.mjs",
        summary: "Rank files read by agents and flag suspected wrong-file reads.",
      },
      {
        name: "show",
        audience: "advanced",
        script: "session-analysis.mjs",
        summary: "Show one session and optionally include normalized events.",
      },
      {
        name: "events",
        audience: "maintainer",
        script: "session-analysis.mjs",
        summary: "List normalized events for one session.",
      },
    ],
  },
  {
    name: "coding-agent-practices",
    kind: "group",
    audience: "advanced",
    summary: "Inspect coding-agent assets and practice evidence.",
    subcommands: [
      {
        name: "asset-baseline",
        audience: "advanced",
        script: "coding-agent-practices/asset-baseline.mjs",
        summary: "Collect compact lint, inventory, and integrity envelopes from one shared asset snapshot.",
      },
      { name: "inventory", audience: "advanced", script: "coding-agent-practices/inventory.mjs" },
      {
        name: "asset-integrity",
        audience: "advanced",
        script: "coding-agent-practices/asset-integrity.mjs",
        summary: "Review Memory title, enabled Plugin, and Hook metadata for bounded overlap candidates.",
      },
    ],
  },
  {
    name: "core-change-watch",
    kind: "group",
    audience: "maintainer",
    summary: "Build static project, history, core-path, and diff evidence.",
    subcommands: [
      { name: "change-drift", audience: "maintainer", script: "core-change-watch/change-drift.mjs" },
      { name: "core-candidates", audience: "maintainer", script: "core-change-watch/core-candidates.mjs" },
      { name: "diff-impact", audience: "maintainer", script: "core-change-watch/diff-impact.mjs" },
      { name: "evidence-pack", audience: "maintainer", script: "core-change-watch/evidence-pack.mjs" },
      { name: "git-history-profile", audience: "maintainer", script: "core-change-watch/git-history-profile.mjs" },
      { name: "project-profile", audience: "maintainer", script: "core-change-watch/project-profile.mjs" },
      { name: "qoder-consistency-schema", audience: "maintainer", script: "core-change-watch/qoder-consistency-schema.mjs" },
    ],
  },
  {
    name: "harness",
    kind: "group",
    audience: "workflow",
    summary: "Check Better Harness readiness reports and Canvas outputs.",
    description: "Collect privacy-safe project and session evidence for AI interpretation by the Better Harness skill, then validate AI-authored findings and derived Markdown, HTML, or Qoder Canvas reports while keeping AI Agent Practices visible.",
    subcommands: [
      {
        name: "evidence-bundle",
        audience: "workflow",
        script: "harness-analysis/evidence-bundle/cli.mjs",
        summary: "Collect the three specialist lanes and lead evidence in one frozen-context bundle.",
        description: "Return versioned Session Evidence, Project Harness, and Agent Customize envelopes with explicit lane status and unchanged diagnostic commands.",
      },
      {
        name: "host-doctor",
        audience: "advanced",
        script: "harness-analysis/host-runtime/host-doctor.mjs",
        summary: "Check a Pi or WorkBuddy host before independent specialist execution.",
        description: "Validate runtime resources, Node version, provider support, current-session binding, model boundary, and output route without reading raw sessions.",
      },
      {
        name: "prepare-run",
        audience: "advanced",
        script: "harness-analysis/host-runtime/prepare-run.mjs",
        summary: "Freeze one private three-lane host run plan.",
        description: "Collect one evidence bundle and write bounded lane envelopes plus input hashes to an explicitly supplied temporary path.",
      },
      {
        name: "verify-run",
        audience: "advanced",
        script: "harness-analysis/host-runtime/verify-run.mjs",
        summary: "Verify three independent specialist results against a run plan.",
        description: "Check lane count, context identities, input hashes, output shape, privacy fields, and quick/normal failure policy.",
      },
      {
        name: "workspace-topology",
        audience: "advanced",
        script: "workspace-topology/cli.mjs",
        summary: "Resolve the Git-aware workspace target and member topology.",
        description: "Report the canonical repository target, workspace members, instruction scopes, bounded inventory coverage, and path-scoped analysis contract without mutating the workspace.",
      },
      {
        name: "analyze",
        audience: "workflow",
        script: "harness-analysis/report-run.mjs",
        summary: "Return a neutral, budgeted Harness evidence brief.",
        description: "Scan evidence read-only and return bounded natural text for AI interpretation, plus exact report summary facts in JSON mode; explicit Qoder or Cursor canvas-out initializes them and replace-canvas refreshes only that authorized path.",
      },
      {
        name: "checkup",
        audience: "workflow",
        script: "coding-agent-practices/checkup.mjs",
        summary: "Scan agent customizations and produce a read-only cleanup plan.",
        description: "Compose configured asset, static instruction, and bounded session-use evidence; distinguish unobserved assets from safe disable candidates without changing configuration.",
      },
      {
        name: "selection-profile",
        audience: "maintainer",
        script: "session-analysis/selection-profile.mjs",
        summary: "Build a privacy-safe session selection profile.",
        description: "Freeze the eligible session population into a reader-safe profile and private snapshot so an AI can author a bounded declarative selection plan without reading raw session ids.",
      },
      {
        name: "source",
        audience: "maintainer",
        script: "harness-analysis/task-loop-source.mjs",
        summary: "Build the deterministic Agent Work Loop source envelope.",
        description: "Collect repository, practice, and session candidates into report.source.json while preserving evidence boundaries.",
      },
      {
        name: "source-review",
        audience: "maintainer",
        script: "harness-analysis/report-source/cli.mjs",
        summary: "Create, compile, and apply a bounded report-source review.",
        description: "Expose an explicit local create, caller-authored decision, and confirmed apply lifecycle without calling a model or merging native evidence aliases into the outer evidence namespace.",
      },
      {
        name: "task-loop-report",
        audience: "maintainer",
        script: "harness-analysis/task-loop-report.mjs",
        summary: "Project deterministic task-loop findings from report.source.json.",
        description: "Join static, episode, and delivery evidence without a total score; emit four task-loop dimensions, an autonomy-radius boundary, and three priority Harness moves.",
      },
      {
        name: "render",
        audience: "advanced",
        script: "harness-analysis/render-report.mjs",
        summary: "Render reviewed findings data into report artifacts.",
        description: "Render reviewed findings.json data into qoder-canvas, cursor-canvas, markdown, or html, and optionally run the selected validators.",
      },
      {
        name: "preview-canvas",
        audience: "advanced",
        script: "harness-analysis/canvas-preview-server.mjs",
        summary: "Preview a Qoder Canvas report on this machine.",
        description: "Serve a Qoder Canvas report on the loopback interface using an installed Qoder runtime or an explicitly supplied Canvas SDK runtime. This is a local inspection tool, not a hosted sharing service.",
      },
      {
        name: "report-quality",
        audience: "advanced",
        script: "harness-analysis/report-quality.mjs",
        summary: "Validate Markdown report and findings JSON readiness contracts.",
        description: "Check harness Markdown reports and findings.json for required sections, calibration-backed output, risk fields, confidence labels, AI Agent Practices visibility, and shared finding/action parity.",
      },
      {
        name: "repair-findings",
        audience: "maintainer",
        script: "harness-analysis/repair-findings-json.mjs",
        summary: "Normalize findings JSON schema drift.",
        description: "Deterministically repair common findings.json contract drift, including risk label casing, allowed domains, AI Agent Practices surfaces, dimension back-links, aiFixAcceptanceCheck, and full aiFixPrompt handoff wording.",
      },
      {
        name: "record-fix-output",
        audience: "workflow",
        script: "harness-analysis/record-fix-output.mjs",
        summary: "Record the latest verified output and Assignment Summary for one finding.",
        description: "Replace one report-contract v23 finding's latest actual output and AI-authored Assignment Summary under revision control, rebuild the exact latest-only projection, validate linked files, and atomically update findings.json without generating reader copy.",
      },
      {
        name: "validate-canvas",
        audience: "advanced",
        script: "harness-analysis/validate-canvas.mjs",
        summary: "Validate Qoder Canvas output parity and runtime boundaries.",
        description: "Check Qoder Canvas reports and optional report.md, including findings-backed data access, TypeScript transformability, allowed imports, SDK declaration selection, runtime exclusions, visual parity, and reader section structure.",
      },
    ],
  },
];

function validateCommandAudiences(commands) {
  for (const command of commands) {
    if (!COMMAND_AUDIENCES.includes(command.audience)) {
      throw new Error(`Command ${command.name} must declare a supported audience`);
    }
    for (const subcommand of command.subcommands ?? []) {
      if (!COMMAND_AUDIENCES.includes(subcommand.audience)) {
        throw new Error(`Command ${command.name} ${subcommand.name} must declare a supported audience`);
      }
      if (AUDIENCE_RANK[subcommand.audience] < AUDIENCE_RANK[command.audience]) {
        throw new Error(`Command ${command.name} ${subcommand.name} cannot be broader than its parent audience`);
      }
    }
  }
}

validateCommandAudiences(COMMANDS);

function scriptDisplayPath(script) {
  return `scripts/${script}`;
}

function normalizeSubcommand(subcommand) {
  return {
    name: subcommand.name,
    audience: subcommand.audience,
    ...(subcommand.summary ? { summary: subcommand.summary } : {}),
    ...(subcommand.description ? { description: subcommand.description } : {}),
    script: scriptDisplayPath(subcommand.script),
  };
}

function normalizeCommand(command) {
  return {
    name: command.name,
    kind: command.kind,
    audience: command.audience,
    summary: command.summary,
    description: command.description ?? command.summary,
    hidden: Boolean(command.hidden),
    aliases: command.aliases ?? [],
    ...(command.kind === "direct"
      ? { script: scriptDisplayPath(command.script), subcommands: (command.subcommands ?? []).map(normalizeSubcommand) }
      : { subcommands: command.subcommands.map(normalizeSubcommand) }),
  };
}

const COMMAND_METADATA = COMMANDS
  .map(normalizeCommand)
  .sort((left, right) => left.name.localeCompare(right.name));

export function normalizeAudienceFilter(audience = "all") {
  if (!Object.hasOwn(AUDIENCE_RANK, audience)) {
    throw new Error(
      `Unsupported audience: ${audience}. Use workflow, advanced, maintainer, or all.`,
    );
  }
  return audience;
}

export function audienceIncludes(entryAudience, requestedAudience = "all") {
  const normalized = normalizeAudienceFilter(requestedAudience);
  return AUDIENCE_RANK[entryAudience] <= AUDIENCE_RANK[normalized];
}

function filterCommandAudience(command, audience) {
  if (!audienceIncludes(command.audience, audience)) {
    return undefined;
  }
  if (!command.subcommands) {
    return command;
  }
  return {
    ...command,
    subcommands: command.subcommands.filter((subcommand) => audienceIncludes(subcommand.audience, audience)),
  };
}

export function commandInventory({ audience = "all" } = {}) {
  const normalizedAudience = normalizeAudienceFilter(audience);
  return {
    format_version: FORMAT_VERSION,
    name: CLI_NAME,
    audience: normalizedAudience,
    commands: COMMAND_METADATA
      .map((command) => filterCommandAudience(command, normalizedAudience))
      .filter(Boolean),
  };
}

export function listVisibleCommandNames({ audience = "all" } = {}) {
  const normalizedAudience = normalizeAudienceFilter(audience);
  return COMMANDS
    .filter((command) => !command.hidden && audienceIncludes(command.audience, normalizedAudience))
    .map((command) => command.name)
    .sort();
}

export function findCommand(name) {
  return COMMANDS.find((command) => command.name === name || command.aliases?.some((alias) => alias.name === name));
}

export function commandMetadata(name, { audience = "all" } = {}) {
  const normalizedAudience = normalizeAudienceFilter(audience);
  const command = findCommand(name);
  if (!command) {
    return undefined;
  }
  const metadata = COMMAND_METADATA.find((entry) => entry.name === command.name);
  return filterCommandAudience(metadata, normalizedAudience);
}

export function commandPathMetadata(name, subcommandName, { audience = "all" } = {}) {
  const command = commandMetadata(name, { audience });
  if (!command || subcommandName === undefined) {
    return command;
  }
  const subcommand = command.subcommands?.find((entry) => entry.name === subcommandName);
  if (!subcommand) {
    return undefined;
  }
  return {
    ...subcommand,
    path: [command.name, subcommand.name],
  };
}

export function directDispatchFor(name, subcommandName) {
  const command = findCommand(name);
  if (command?.kind !== "direct") {
    return undefined;
  }
  const subcommand = command.subcommands?.find((entry) => entry.name === subcommandName);
  if (subcommand?.script && subcommand.script !== command.script) {
    return { script: subcommand.script, consumesSubcommand: true };
  }
  return { script: command.script, consumesSubcommand: false };
}

export function groupCommand(name) {
  const command = findCommand(name);
  if (command?.kind !== "group") {
    return undefined;
  }
  // Dispatch uses raw script paths relative to scriptsRoot; discovery uses normalized "scripts/..." paths.
  return command;
}

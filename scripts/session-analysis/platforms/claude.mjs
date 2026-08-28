#!/usr/bin/env node

import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SessionAnalyzer } from "../analyzer.mjs";
import { parseArgs, parseBooleanFlag } from "../cli.mjs";
import { forEachJsonLine, isDirectory, pathExists, walkFiles } from "../fs.mjs";
import { expandHome, normalizeWorkspace } from "../paths.mjs";
import {
  bindSessionWorkspaceCwds,
  emitProviderResult,
  markSessionReadCoverage,
  runProviderAnalysis,
  runProviderCommand,
  sessionWorkspaceCwd,
  workspaceMatchScopeFromOptions,
} from "../provider-runner.mjs";
import { parseResultFacts } from "../result-facts.mjs";
import { mergeTimeRange, normalizeCliDate, normalizeTimestamp, timestampMillis, withinTimeRange } from "../time.mjs";
import { WORKSPACE_CWD_MATCH, classifyWorkspaceCwd } from "../workspace-match.mjs";

function isWorkspaceMatch(candidate, workspace) {
  if (!candidate) return false;
  const resolved = normalizeWorkspace(candidate);
  return resolved === workspace || resolved.startsWith(`${workspace}${path.sep}`);
}

function isScopedWorkspaceMatch(candidate, scope) {
  if (!scope?._workspaceMatchScope) return isWorkspaceMatch(candidate, scope.workspace);
  return classifyWorkspaceCwd(candidate, scope._workspaceMatchScope) !== WORKSPACE_CWD_MATCH.UNMATCHED;
}

// Claude Code folds "." and "_" into "-" per character (".claude" -> "--claude",
// "my_project" -> "my-project"), so the widest fold comes first; the narrower
// classes stay as fallbacks for directories named by older host versions.
const CLAUDE_SLUG_FOLD_CLASSES = [/[\\/._]/g, /[\\/.]/g, /[\\/]+/g];

// Directory listings and transcript reads stay bounded so the cwd recovery below
// cannot turn a slug miss into an unbounded scan of every recorded session.
const PROJECT_DIR_SCAN_LIMIT = 500;
const PROJECT_DIR_PROBE_FILES = 25;
const PROJECT_DIR_PROBE_LINES = 200;

export function workspaceToClaudeSlugVariants(workspace) {
  const expanded = expandHome(workspace ?? process.cwd());
  const normalized = path.win32.isAbsolute(expanded) ? path.win32.normalize(expanded) : normalizeWorkspace(expanded);
  return [...new Set(CLAUDE_SLUG_FOLD_CLASSES.flatMap((fold) => [
    normalized.replace(/:/g, "-").replace(fold, "-"),
    normalized.replace(/:/g, "").replace(fold, "-"),
  ]))];
}

async function transcriptRecordsScopedCwd(filePath, scope) {
  let matched = false;
  await forEachJsonLine(filePath, (raw) => {
    if (typeof raw?.cwd !== "string" || raw.cwd.length === 0) return true;
    if (!isScopedWorkspaceMatch(raw.cwd, scope)) return true;
    matched = true;
    return false;
  }, { maxLines: PROJECT_DIR_PROBE_LINES });
  return matched;
}

// The slug only selects which project directory to open, and discovery re-checks
// the recorded cwd one step later. When every guessed slug is missing, recover the
// directory from that same cwd so an unmodelled character fold reports the real
// sessions instead of a silent zero.
async function discoverProjectRootsByRecordedCwd(scope) {
  const projectsRoot = path.join(scope.home, "projects");
  let entries;
  try {
    entries = await readdir(projectsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const recovered = [];
  for (const entry of entries.slice(0, PROJECT_DIR_SCAN_LIMIT)) {
    const dirPath = path.join(projectsRoot, entry.name);
    if (!entry.isDirectory() && !await isDirectory(dirPath)) continue;
    const files = await walkFiles(dirPath, {
      maxDepth: 2,
      limit: PROJECT_DIR_PROBE_FILES,
      match: (file) => file.endsWith(".jsonl"),
    });
    for (const filePath of files) {
      if (!await transcriptRecordsScopedCwd(filePath, scope)) continue;
      recovered.push(dirPath);
      break;
    }
  }
  return recovered;
}

function inferSessionId(raw, fallback = null) {
  return raw?.sessionId ?? raw?.session_id ?? fallback;
}

function inferTimestamp(raw) {
  return normalizeTimestamp(raw?.timestamp ?? raw?.ts ?? raw?._timestamp ?? null);
}

function textItems(raw) {
  const content = raw?.message?.content ?? raw?.content ?? null;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content : [];
}

function textFromItems(items) {
  return items
    .filter((item) => typeof item === "string" || item?.type === "text" || item?.type === "input_text")
    .map((item) => typeof item === "string" ? item : item?.text ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function toolResultText(item, raw) {
  const content = item?.content ?? raw?.toolUseResult?.stdout ?? raw?.toolUseResult?.stderr ?? "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((value) => typeof value === "string" ? value : value?.text ?? value?.content ?? "").join("\n");
  }
  return "";
}

function inferUsage(raw) {
  const usage = raw?.message?.usage ?? raw?.usage;
  if (!usage || typeof usage !== "object") return null;
  const fields = {
    inputTokens: usage.input_tokens ?? usage.inputTokens,
    outputTokens: usage.output_tokens ?? usage.outputTokens,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? usage.cacheReadInputTokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens,
  };
  return Object.values(fields).some((value) => value !== undefined)
    ? Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, Number.isFinite(Number(value)) ? Number(value) : 0]))
    : null;
}

function inferFilePath(toolName, input = {}) {
  if (!/(?:read|edit|write|file|notebook)/i.test(String(toolName ?? ""))) return null;
  return input.file_path ?? input.filePath ?? input.path ?? null;
}

function inferCommandText(toolName, input = {}) {
  if (!/(?:bash|shell|exec|terminal)/i.test(String(toolName ?? ""))) return null;
  return input.command ?? input.cmd ?? null;
}

function evidenceRef(raw, sourceRef, type, itemIndex = null) {
  return {
    kind: sourceRef.kind,
    path: sourceRef.path,
    line: sourceRef.line ?? null,
    seq: itemIndex,
    type,
  };
}

function transcriptEvents(raw, sourceRef, options) {
  const rawType = raw?.type ?? "record";
  const sessionId = inferSessionId(raw, sourceRef.sessionId);
  const timestamp = inferTimestamp(raw);
  const cwd = raw?.cwd ?? null;
  const items = textItems(raw);
  const text = rawType === "last-prompt" ? String(raw?.lastPrompt ?? "").trim() : textFromItems(items);
  const events = [];
  const base = {
    sessionId,
    timestamp,
    sourceKind: sourceRef.kind,
    planningScope: "workspace",
    cwd,
    isSubagent: typeof raw?.isSidechain === "boolean" ? raw.isSidechain : null,
  };

  if (["user", "assistant", "last-prompt", "system"].includes(rawType)) {
    const event = {
      ...base,
      type: rawType,
      category: rawType,
      evidenceRef: evidenceRef(raw, sourceRef, rawType),
      summary: text ? `${rawType} message (${text.length} chars)` : rawType,
      contentLength: text.length,
    };
    if (rawType === "user" || rawType === "last-prompt") {
      event.userPrompt = text.length > 0;
      if (options.includeUserText && text) event.userText = text;
    }
    if (rawType === "assistant" && text) event.userVisibleAssistantMessage = true;
    if (options.includeContent && text) event.content = text;
    const model = raw?.message?.model ?? raw?.model;
    const usage = inferUsage(raw);
    if (model && !usage) event.model = model;
    if (raw?.permissionMode) event.permissionMode = raw.permissionMode;
    events.push(event);
    if (rawType === "assistant" && usage) {
      events.push({
        ...base,
        type: "model.response.completed",
        category: "model",
        model: model ?? null,
        modelUsage: usage,
        modelInvocationUsage: usage,
        usageFieldsObserved: true,
        usageBasis: "model-inference",
        usageSource: "claude-project-transcript",
        responseId: raw?.message?.id ?? raw?.uuid ?? null,
        evidenceRef: evidenceRef(raw, sourceRef, "model.response.completed"),
        summary: "Claude model response completed",
      });
    }
  } else {
    events.push({
      ...base,
      type: `metadata.${rawType}`,
      category: "metadata",
      evidenceRef: evidenceRef(raw, sourceRef, `metadata.${rawType}`),
      summary: rawType,
    });
  }

  items.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    if (item.type === "tool_use") {
      const input = item.input && typeof item.input === "object" ? item.input : {};
      const event = {
        ...base,
        type: "tool.call",
        category: "tool",
        lifecyclePhase: "request",
        toolName: item.name ?? "unknown-tool",
        toolInvocationId: item.id ?? null,
        evidenceRef: evidenceRef(raw, sourceRef, "tool.call", index),
        summary: `${item.name ?? "unknown-tool"} request`,
      };
      const commandText = inferCommandText(item.name, input);
      const filePath = inferFilePath(item.name, input);
      if (options.includeCommandText && commandText) event.commandText = commandText;
      if (filePath) event.filePath = filePath;
      if (item.name === "Skill") {
        const skillName = input.skill ?? input.name;
        if (skillName) {
          event.skillName = String(skillName).split(":").at(-1);
          event.skillNames = [event.skillName];
        }
      }
      events.push(event);
    }
    if (item.type === "tool_result") {
      const output = toolResultText(item, raw);
      const event = {
        ...base,
        type: "tool.result",
        category: "tool",
        lifecyclePhase: "result",
        toolInvocationId: item.tool_use_id ?? null,
        success: item.is_error === true ? false : true,
        hasError: item.is_error === true,
        evidenceRef: evidenceRef(raw, sourceRef, "tool.result", index),
        summary: item.is_error === true ? "tool result failed" : "tool result",
      };
      const resultFacts = parseResultFacts(output.slice(-8_192));
      if (resultFacts) event.resultFacts = resultFacts;
      events.push(event);
    }
  });
  return events;
}

function auditEvents(raw, sourceRef, options) {
  const auditType = raw?.event ?? raw?._event ?? "audit";
  const typeMap = {
    tool_input: "tool.call",
    tool_output: "tool.result",
    tool_error: "tool.result",
    permission_request: "permission.request",
    session_start: "session.start",
    session_end: "session.end",
    subagent_start: "subagent.start",
    subagent_stop: "subagent.stop",
    llm_input: "llm.input",
    llm_output: "llm.output",
  };
  const type = typeMap[auditType] ?? `audit.${auditType}`;
  const input = raw?.input && typeof raw.input === "object" ? raw.input : {};
  const output = typeof raw?.output === "string" ? raw.output : raw?.output?.stdout ?? raw?.output?.stderr ?? "";
  const event = {
    sessionId: inferSessionId(raw, sourceRef.sessionId),
    type,
    category: type.split(".")[0],
    timestamp: inferTimestamp(raw),
    sourceKind: sourceRef.kind,
    planningScope: "workspace",
    evidenceRef: evidenceRef(raw, sourceRef, type),
    summary: auditType,
  };
  if (raw?.cwd) event.cwd = raw.cwd;
  if (raw?.toolName) event.toolName = raw.toolName;
  if (raw?.toolUseId) event.toolInvocationId = raw.toolUseId;
  if (auditType === "tool_input") event.lifecyclePhase = "request";
  if (auditType === "tool_output" || auditType === "tool_error") {
    event.lifecyclePhase = "result";
    event.success = auditType === "tool_error" ? false : raw?.success !== false;
    if (event.success === false) event.hasError = true;
    const facts = parseResultFacts(String(output).slice(-8_192));
    if (facts) event.resultFacts = facts;
  }
  if (auditType === "permission_request") {
    event.lifecyclePhase = "pre";
    event.permissionDecision = String(raw?.guard?.decision ?? raw?.permissionLevel ?? "asked").toLowerCase();
  }
  const commandText = inferCommandText(raw?.toolName, input);
  const filePath = inferFilePath(raw?.toolName, input);
  if (options.includeCommandText && commandText) event.commandText = commandText;
  if (filePath) event.filePath = filePath;
  if (raw?.model) event.model = raw.model;
  return [event];
}

async function probeTranscript(filePath, scope) {
  const cwdCandidates = new Set();
  const summary = {
    sessionId: path.basename(filePath, ".jsonl"),
    firstSeen: null,
    lastSeen: null,
    workspaceMatch: false,
    cwds: [],
  };
  await forEachJsonLine(filePath, (raw) => {
    summary.sessionId = inferSessionId(raw, summary.sessionId);
    if (typeof raw?.cwd === "string" && raw.cwd.length > 0) cwdCandidates.add(raw.cwd);
    if (!scope._workspaceMatchScope && isWorkspaceMatch(raw?.cwd, scope.workspace)) {
      summary.workspaceMatch = true;
    }
    mergeTimeRange(summary, inferTimestamp(raw));
  });
  summary.cwds = [...cwdCandidates];
  if (scope._workspaceMatchScope) {
    summary.workspaceMatch = summary.cwds.some((cwd) => isScopedWorkspaceMatch(cwd, scope));
  }
  return summary;
}

function addRef(sessions, sessionId, workspace, ref) {
  if (!sessionId) return;
  const session = sessions.get(sessionId) ?? {
    sessionId,
    workspace,
    firstSeen: null,
    lastSeen: null,
    sourceKinds: new Set(),
    sourceRefs: [],
    workspaceCwdCandidates: new Map(),
  };
  if (typeof ref.cwd === "string" && ref.cwd.length > 0) {
    const priority = Number(ref.cwdPriority ?? 0);
    session.workspaceCwdCandidates.set(
      ref.cwd,
      Math.max(priority, session.workspaceCwdCandidates.get(ref.cwd) ?? Number.NEGATIVE_INFINITY),
    );
  }
  session.sourceKinds.add(ref.kind);
  session.sourceRefs.push(ref);
  mergeTimeRange(session, ref.firstSeen ?? ref.timestamp);
  mergeTimeRange(session, ref.lastSeen ?? ref.timestamp);
  sessions.set(sessionId, session);
}

function addWorkspaceCwdCandidates(session, candidates, priority) {
  if (!session) return;
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || candidate.length === 0) continue;
    session.workspaceCwdCandidates.set(
      candidate,
      Math.max(priority, session.workspaceCwdCandidates.get(candidate) ?? Number.NEGATIVE_INFINITY),
    );
  }
}

function finalizeSession(session) {
  const { workspaceCwdCandidates, ...publicSession } = session;
  const finalized = { ...publicSession, sourceKinds: [...session.sourceKinds].sort() };
  const priorities = [...workspaceCwdCandidates.values()];
  const strongest = priorities.length > 0 ? Math.max(...priorities) : null;
  return bindSessionWorkspaceCwds(
    finalized,
    strongest === null
      ? []
      : [...workspaceCwdCandidates]
        .filter(([_cwd, priority]) => priority === strongest)
        .map(([cwd]) => cwd),
  );
}

function dedupeEvents(events) {
  const seen = new Set();
  return events.filter((event) => {
    const key = event.toolInvocationId && event.lifecyclePhase
      ? `${event.sessionId}:${event.lifecyclePhase}:${event.toolInvocationId}`
      : null;
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export class ClaudeSessionAnalyzer extends SessionAnalyzer {
  currentSessionId() {
    return process.env.CLAUDE_SESSION_ID ?? null;
  }

  async resolveScope(options = {}) {
    const since = normalizeCliDate(options.since, false);
    const until = normalizeCliDate(options.until, true);
    const workspace = normalizeWorkspace(options.workspace);
    const workspaceMatchScope = workspaceMatchScopeFromOptions(options);
    const transcriptWorkspaces = [...new Set([
      workspace,
      workspaceMatchScope?.requestedWorkspace,
      workspaceMatchScope?.target.kind === "workspace-member" ? workspaceMatchScope.gitRoot : null,
    ].filter(Boolean))];
    return {
      platform: "claude",
      workspace,
      home: path.resolve(expandHome(options.home ?? options.claudeHome ?? options["claude-home"] ?? "~/.claude")),
      _workspaceSlugVariants: [...new Set(
        transcriptWorkspaces.flatMap((candidate) => workspaceToClaudeSlugVariants(candidate)),
      )],
      since: since.label,
      sinceTime: since.time,
      until: until.label,
      untilTime: until.time,
      sessionId: options["session-id"] ?? options.sessionId ?? options._?.[0] ?? null,
      includeGlobalCapabilities: parseBooleanFlag(options["include-global-capabilities"] ?? false),
      _workspaceMatchScope: workspaceMatchScope,
    };
  }

  async discoverSourceRoots(scope) {
    const slugPaths = scope._workspaceSlugVariants.map((slug) => path.join(scope.home, "projects", slug));
    const slugExists = (await Promise.all(slugPaths.map(pathExists))).some(Boolean);
    const projectPaths = slugExists
      ? slugPaths
      : [...await discoverProjectRootsByRecordedCwd(scope), ...slugPaths];
    const roots = [
      {
        id: "claude-projects",
        kind: "claude-project-jsonl",
        role: "session-transcript",
        path: projectPaths[0],
        paths: projectPaths,
        optional: false,
        enabled: true,
        workspaceScoped: true,
        coverage: "primary",
      },
      {
        id: "claude-audit",
        kind: "claude-audit-jsonl",
        role: "tool-permission-audit",
        path: path.join(scope.home, "audit", "audit.jsonl"),
        optional: true,
        enabled: true,
        workspaceScoped: false,
        coverage: "optional",
      },
      {
        id: "claude-audit-logs",
        kind: "claude-audit-log-jsonl",
        role: "tool-permission-audit",
        path: path.join(scope.home, "audit-logs", "audit.jsonl"),
        optional: true,
        enabled: true,
        workspaceScoped: false,
        coverage: "optional",
      },
    ];
    return Promise.all(roots.map(async (root) => ({
      ...root,
      exists: root.paths
        ? (await Promise.all(root.paths.map(pathExists))).some(Boolean)
        : await pathExists(root.path),
    })));
  }

  async discoverSessions(scope, roots) {
    const sessions = new Map();
    const transcriptRoot = roots.find((root) => root.kind === "claude-project-jsonl");
    for (const rootPath of transcriptRoot?.paths ?? []) {
      if (!await pathExists(rootPath)) continue;
      const files = await walkFiles(rootPath, { maxDepth: 2, limit: 20_000, match: (file) => file.endsWith(".jsonl") });
      for (const filePath of files) {
        const probe = await probeTranscript(filePath, scope);
        if (!probe.workspaceMatch || !withinTimeRange(probe.lastSeen ?? probe.firstSeen, scope)) continue;
        addRef(sessions, probe.sessionId, scope.workspace, {
          kind: transcriptRoot.kind,
          role: transcriptRoot.role,
          path: filePath,
          firstSeen: probe.firstSeen,
          lastSeen: probe.lastSeen,
        });
        addWorkspaceCwdCandidates(sessions.get(probe.sessionId), probe.cwds, 3);
      }
    }
    const knownIds = new Set(sessions.keys());
    for (const root of roots.filter((item) => item.kind.includes("audit") && item.exists && item.enabled)) {
      const joined = new Map();
      await forEachJsonLine(root.path, (raw) => {
        const sessionId = inferSessionId(raw);
        if (!knownIds.has(sessionId)) return;
        const timestamp = inferTimestamp(raw);
        if (!withinTimeRange(timestamp, scope)) return;
        const range = joined.get(sessionId) ?? { firstSeen: null, lastSeen: null };
        mergeTimeRange(range, timestamp);
        joined.set(sessionId, range);
      });
      for (const [sessionId, range] of joined) {
        addRef(sessions, sessionId, scope.workspace, {
          kind: root.kind,
          role: root.role,
          path: root.path,
          firstSeen: range.firstSeen,
          lastSeen: range.lastSeen,
        });
      }
    }
    return [...sessions.values()].map(finalizeSession)
      .sort((left, right) => (timestampMillis(right.lastSeen) ?? 0) - (timestampMillis(left.lastSeen) ?? 0));
  }

  normalizeEvent(raw, sourceRef, options = {}) {
    return this.normalizeEvents(raw, sourceRef, options)[0] ?? null;
  }

  normalizeEvents(raw, sourceRef, options = {}) {
    return sourceRef.kind.includes("audit")
      ? auditEvents(raw, sourceRef, options)
      : transcriptEvents(raw, sourceRef, options);
  }

  async readSession(session, scope, options = {}) {
    const events = [];
    const requestedMaxLines = Number(options.workspacePreflightMaxLines);
    const preflight = Number.isFinite(requestedMaxLines) && requestedMaxLines > 0;
    let remainingLines = preflight ? Math.trunc(requestedMaxLines) : null;
    let truncated = false;
    const refs = preflight
      ? (session.sourceRefs ?? []).filter((ref) => !ref.kind.includes("audit"))
      : session.sourceRefs ?? [];
    const identityCwd = scope._workspaceMatchScope
      ? sessionWorkspaceCwd(session, scope._workspaceMatchScope)
      : null;
    const rootCandidate = scope._workspaceMatchScope
      && classifyWorkspaceCwd(identityCwd, scope._workspaceMatchScope) === WORKSPACE_CWD_MATCH.ROOT_CANDIDATE;
    for (const ref of refs) {
      if (remainingLines !== null && remainingLines <= 0) {
        truncated = true;
        break;
      }
      if (!ref.path.endsWith(".jsonl")) continue;
      const readCoverage = await forEachJsonLine(ref.path, (raw, line) => {
        if (inferSessionId(raw, session.sessionId) !== session.sessionId) return;
        if (!ref.kind.includes("audit")
          && !rootCandidate
          && raw?.cwd
          && !isScopedWorkspaceMatch(raw.cwd, scope)) return;
        for (const event of this.normalizeEvents(raw, { ...ref, sessionId: session.sessionId, line }, options)) {
          if (withinTimeRange(event.timestamp, scope)) events.push(event);
        }
      }, remainingLines === null ? {} : { maxLines: remainingLines });
      if (readCoverage.invalidLines > 0) truncated = true;
      if (remainingLines !== null) {
        if (readCoverage.lineCount > remainingLines) truncated = true;
        remainingLines -= Math.min(readCoverage.lineCount, remainingLines);
      }
    }
    const sorted = dedupeEvents(events)
      .map((event) => event.cwd || !identityCwd ? event : { ...event, cwd: identityCwd })
      .sort((left, right) =>
      (timestampMillis(left.timestamp) ?? 0) - (timestampMillis(right.timestamp) ?? 0)
      || Number(left.evidenceRef?.line ?? 0) - Number(right.evidenceRef?.line ?? 0)
      || Number(left.evidenceRef?.seq ?? 0) - Number(right.evidenceRef?.seq ?? 0));
    return markSessionReadCoverage(sorted, { truncated });
  }

  async analysisWarnings(_scope, roots, sessions) {
    const auditsExist = roots.some((root) => root.kind.includes("audit") && root.exists);
    const joined = sessions.filter((session) => session.sourceKinds.some((kind) => kind.includes("audit"))).length;
    return auditsExist && sessions.length > 0 && joined === 0
      ? [{
          code: "claude-audit-no-session-overlap",
          message: "Claude audit sources do not overlap the discovered workspace transcripts; transcript evidence remains primary.",
        }]
      : [];
  }

  async analyze(options = {}) {
    return runProviderAnalysis(this, options, { platform: "claude", adapterVersion: "claude-v1" });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { command = "sessions", options } = parseArgs(argv);
  const analyzer = new ClaudeSessionAnalyzer();
  const result = await runProviderCommand(analyzer, command, options);
  await emitProviderResult({ provider: "Claude", command, options, result });
  return result;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`claude session-analysis failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}

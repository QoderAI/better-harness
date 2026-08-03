#!/usr/bin/env node
/**
 * Grok CLI session evidence adapter.
 * Sessions live at $GROK_HOME/sessions/<url-encoded-cwd>/<session-id>/
 * with summary.json + updates.jsonl + optional signals.json.
 */
import { realpathSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
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

/** Grok groups sessions under encodeURIComponent(absoluteCwd). */
export function workspaceToGrokSessionDirName(workspace) {
  // Always use path.resolve semantics so Unix absolute paths stay "/...".
  // path.win32.isAbsolute treats leading "/" as absolute and would flip separators.
  return encodeURIComponent(normalizeWorkspace(workspace ?? process.cwd()));
}

export function defaultGrokHome() {
  return process.env.GROK_HOME ?? path.join(expandHome("~"), ".grok");
}

function evidenceRef(sourceRef, type, itemIndex = null) {
  return {
    kind: sourceRef.kind,
    path: sourceRef.path,
    line: sourceRef.line ?? null,
    seq: itemIndex,
    type,
  };
}

function finiteNumber(...values) {
  return values.find((value) => typeof value === "number" && Number.isFinite(value));
}

/**
 * signals.json holds session counters and context-window occupancy, not
 * per-turn accounting. Never treat contextTokensUsed as totalTokens.
 * Prefer turn_completed.usage from updates.jsonl for model usage.
 */
function normalizeUsageFromSignals(signals) {
  if (!signals || typeof signals !== "object") return null;
  const observed = {};
  for (const [key, value] of [
    ["inputTokens", finiteNumber(signals.inputTokens, signals.input_tokens, signals.promptTokens)],
    ["outputTokens", finiteNumber(signals.outputTokens, signals.output_tokens, signals.completionTokens)],
    // Explicit totals only — contextTokensUsed is window occupancy, not spend.
    ["totalTokens", finiteNumber(signals.totalTokens, signals.total_tokens)],
  ]) {
    if (value !== undefined) observed[key] = value;
  }
  return Object.keys(observed).length > 0 ? observed : null;
}

function addUsageField(observed, key, value) {
  if (value === undefined) return;
  observed[key] = (observed[key] ?? 0) + value;
}

/**
 * Accept flat turn usage and/or nested usage.modelUsage.<modelId> objects.
 * Nested modelUsage values are summed across models and fill only the fields
 * flat usage did not report, so partial flat records stay complete.
 */
function normalizeUsageFromTurn(usage) {
  if (!usage || typeof usage !== "object") return null;
  const observed = {};
  for (const [key, value] of [
    ["inputTokens", finiteNumber(usage.inputTokens, usage.input_tokens, usage.promptTokens)],
    ["outputTokens", finiteNumber(usage.outputTokens, usage.output_tokens, usage.completionTokens)],
    ["totalTokens", finiteNumber(usage.totalTokens, usage.total_tokens)],
    ["cacheReadInputTokens", finiteNumber(usage.cachedReadTokens, usage.cacheReadInputTokens, usage.cache_read_input_tokens)],
  ]) {
    if (value !== undefined) observed[key] = value;
  }

  const modelUsage = usage.modelUsage && typeof usage.modelUsage === "object" ? usage.modelUsage : null;
  if (modelUsage) {
    const nested = {};
    for (const perModel of Object.values(modelUsage)) {
      if (!perModel || typeof perModel !== "object") continue;
      addUsageField(nested, "inputTokens", finiteNumber(perModel.inputTokens, perModel.input_tokens));
      addUsageField(nested, "outputTokens", finiteNumber(perModel.outputTokens, perModel.output_tokens));
      addUsageField(nested, "totalTokens", finiteNumber(perModel.totalTokens, perModel.total_tokens));
      addUsageField(
        nested,
        "cacheReadInputTokens",
        finiteNumber(perModel.cachedReadTokens, perModel.cacheReadInputTokens, perModel.cache_read_input_tokens),
      );
    }
    for (const [key, value] of Object.entries(nested)) {
      if (observed[key] === undefined) observed[key] = value;
    }
  }

  return Object.keys(observed).length > 0 ? observed : null;
}

function primaryModelFromUsage(usage) {
  const modelUsage = usage?.modelUsage;
  if (!modelUsage || typeof modelUsage !== "object") return null;
  const names = Object.keys(modelUsage);
  return names.length > 0 ? names[0] : null;
}

function toolStatusOf(raw, update) {
  const candidates = [
    update?.status,
    update?.state,
    raw?.params?._meta?.updateParams?.status,
    update?._meta?.status,
  ];
  for (const value of candidates) {
    if (value == null || value === "") continue;
    return String(value).toLowerCase();
  }
  return "";
}

const TERMINAL_TOOL_STATUSES = new Set(["completed", "failed", "error", "cancelled", "canceled"]);

function inferTimestamp(raw) {
  const ts = raw?.timestamp ?? raw?.params?.update?._meta?.agentTimestampMs ?? null;
  if (typeof ts === "number" && ts > 1e12) {
    // Grok sometimes stores agent timestamps in a non-unix epoch scale; prefer ISO when present.
    return normalizeTimestamp(raw?.params?.update?._meta?.isoTimestamp ?? raw?.time ?? null)
      ?? normalizeTimestamp(ts);
  }
  return normalizeTimestamp(ts);
}

/**
 * Normalize one ACP-style updates.jsonl record into session events.
 */
function updatesRecordToEvents(raw, sourceRef, options = {}) {
  const base = {
    sessionId: sourceRef.sessionId,
    timestamp: inferTimestamp(raw) ?? normalizeTimestamp(null),
    sourceKind: sourceRef.kind,
    planningScope: "workspace",
    cwd: sourceRef.cwd ?? null,
    isSubagent: null,
  };
  const method = raw?.method ?? null;
  const update = raw?.params?.update ?? raw?.update ?? null;
  const sessionUpdate = update?.sessionUpdate ?? update?.type ?? null;
  const events = [];
  const isSessionUpdate = method === "session/update" || method === "_x.ai/session/update";

  if (isSessionUpdate && sessionUpdate) {
    if (sessionUpdate === "user_message_chunk" || sessionUpdate === "user_message") {
      const text = update?.content?.text ?? update?.text ?? "";
      const content = typeof text === "string" ? text : "";
      events.push({
        ...base,
        type: "user",
        category: "user",
        evidenceRef: evidenceRef(sourceRef, "user"),
        summary: content ? `user message (${content.length} chars)` : "user",
        contentLength: content.length,
        userPrompt: content.length > 0,
        ...(options.includeUserText && content ? { userText: content } : {}),
        ...(options.includeContent && content ? { content } : {}),
      });
      return events;
    }
    if (sessionUpdate === "agent_message_chunk" || sessionUpdate === "agent_message" || sessionUpdate === "assistant_message") {
      const text = update?.content?.text ?? update?.text ?? "";
      const content = typeof text === "string" ? text : "";
      events.push({
        ...base,
        type: "assistant",
        category: "assistant",
        evidenceRef: evidenceRef(sourceRef, "assistant"),
        summary: content ? `assistant message (${content.length} chars)` : "assistant",
        contentLength: content.length,
        ...(content ? { userVisibleAssistantMessage: true } : {}),
        ...(options.includeContent && content ? { content } : {}),
        model: update?._meta?.modelId ?? null,
      });
      return events;
    }
    if (sessionUpdate === "tool_call") {
      const toolName = update?.toolName
        ?? update?.name
        ?? update?._meta?.["x.ai/tool"]?.name
        ?? update?.title
        ?? "unknown-tool";
      events.push({
        ...base,
        type: "tool.call",
        category: "tool",
        lifecyclePhase: "request",
        toolName,
        toolInvocationId: update?.toolCallId ?? update?.id ?? null,
        evidenceRef: evidenceRef(sourceRef, "tool.call"),
        summary: `${toolName} request`,
      });
      return events;
    }
    if (sessionUpdate === "tool_call_update") {
      const toolName = update?.toolName
        ?? update?.name
        ?? update?._meta?.["x.ai/tool"]?.name
        ?? update?.title
        ?? "unknown-tool";
      const status = toolStatusOf(raw, update);
      // Progress / status-less updates are not terminal results (Grok 0.2.x).
      if (!TERMINAL_TOOL_STATUSES.has(status)) {
        events.push({
          ...base,
          type: "metadata.tool_call_update",
          category: "metadata",
          toolName,
          toolInvocationId: update?.toolCallId ?? update?.id ?? null,
          evidenceRef: evidenceRef(sourceRef, "metadata.tool_call_update"),
          summary: status ? `tool update ${status}` : "tool update progress",
        });
        return events;
      }
      const success = !["failed", "error", "cancelled", "canceled"].includes(status);
      const event = {
        ...base,
        type: "tool.result",
        category: "tool",
        lifecyclePhase: "result",
        toolName,
        toolInvocationId: update?.toolCallId ?? update?.id ?? null,
        success,
        hasError: !success,
        evidenceRef: evidenceRef(sourceRef, "tool.result"),
        summary: success ? "tool result" : `tool result ${status}`,
      };
      const rawResult = update?.content ?? update?.result ?? update?.output ?? null;
      if (rawResult != null) {
        const facts = parseResultFacts(String(typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult)).slice(-8_192));
        if (facts) event.resultFacts = facts;
      }
      events.push(event);
      return events;
    }
    if (sessionUpdate === "turn_completed") {
      const usage = normalizeUsageFromTurn(update?.usage);
      if (usage) {
        events.push({
          ...base,
          type: "model.response.completed",
          category: "model",
          modelUsage: usage,
          usageFieldsObserved: true,
          evidenceRef: evidenceRef(sourceRef, "model.response.completed"),
          summary: "Grok turn_completed usage",
          model: primaryModelFromUsage(update?.usage),
        });
      } else {
        events.push({
          ...base,
          type: "metadata.turn_completed",
          category: "metadata",
          evidenceRef: evidenceRef(sourceRef, "metadata.turn_completed"),
          summary: update?.stop_reason || "turn_completed",
        });
      }
      return events;
    }
    events.push({
      ...base,
      type: `metadata.${sessionUpdate}`,
      category: "metadata",
      evidenceRef: evidenceRef(sourceRef, `metadata.${sessionUpdate}`),
      summary: sessionUpdate,
    });
    return events;
  }

  // Unknown or non-session records stay explicit metadata (do not drop).
  events.push({
    ...base,
    type: `metadata.${method || raw?.type || "record"}`,
    category: "metadata",
    evidenceRef: evidenceRef(sourceRef, `metadata.${method || raw?.type || "record"}`),
    summary: method || raw?.type || "record",
  });
  return events;
}

function chatHistoryToEvents(raw, sourceRef, options = {}) {
  const role = raw?.role ?? raw?.type ?? null;
  const content = typeof raw?.content === "string"
    ? raw.content
    : (Array.isArray(raw?.content)
      ? raw.content.map((part) => part?.text ?? "").join("")
      : "");
  const base = {
    sessionId: sourceRef.sessionId,
    timestamp: normalizeTimestamp(raw?.timestamp ?? null),
    sourceKind: sourceRef.kind,
    planningScope: "workspace",
    cwd: sourceRef.cwd ?? null,
    isSubagent: null,
  };
  if (role === "user" || role === "human") {
    return [{
      ...base,
      type: "user",
      category: "user",
      evidenceRef: evidenceRef(sourceRef, "user"),
      summary: content ? `user message (${content.length} chars)` : "user",
      contentLength: content.length,
      userPrompt: content.length > 0,
      ...(options.includeUserText && content ? { userText: content } : {}),
    }];
  }
  if (role === "assistant" || role === "model") {
    return [{
      ...base,
      type: "assistant",
      category: "assistant",
      evidenceRef: evidenceRef(sourceRef, "assistant"),
      summary: content ? `assistant message (${content.length} chars)` : "assistant",
      contentLength: content.length,
      ...(content ? { userVisibleAssistantMessage: true } : {}),
    }];
  }
  return [{
    ...base,
    type: `metadata.${role || "chat"}`,
    category: "metadata",
    evidenceRef: evidenceRef(sourceRef, `metadata.${role || "chat"}`),
    summary: role || "chat",
  }];
}

async function readJsonSafe(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
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
    workspaceCwds: new Set(),
  };
  if (typeof ref.cwd === "string" && ref.cwd.length > 0) session.workspaceCwds.add(ref.cwd);
  session.sourceKinds.add(ref.kind);
  session.sourceRefs.push(ref);
  mergeTimeRange(session, ref.firstSeen ?? ref.timestamp);
  mergeTimeRange(session, ref.lastSeen ?? ref.timestamp);
  sessions.set(sessionId, session);
}

function finalizeSession(session) {
  const { workspaceCwds, ...publicSession } = session;
  return bindSessionWorkspaceCwds(
    { ...publicSession, sourceKinds: [...session.sourceKinds].sort() },
    [...workspaceCwds],
  );
}

async function listEncodedSessionGroups(sessionsRoot, encodedNames) {
  let entries;
  try {
    entries = await readdir(sessionsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const wanted = new Set(encodedNames);
  return entries
    .filter((entry) => entry.isDirectory() && wanted.has(entry.name))
    .map((entry) => path.join(sessionsRoot, entry.name));
}

/**
 * Match session groups by exact encodeURIComponent(cwd) name, or by the
 * long-path form: slug+hash group with a `.cwd` file holding the original path
 * when encodeURIComponent(cwd) exceeds 255 bytes (Grok 0.2.x docs).
 */
async function listMatchingSessionGroups(sessionsRoot, scope) {
  const encodedWanted = new Set(scope._encodedGroupNames ?? []);
  let entries;
  try {
    entries = await readdir(sessionsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const groups = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const groupPath = path.join(sessionsRoot, entry.name);
    if (encodedWanted.has(entry.name)) {
      groups.push(groupPath);
      continue;
    }
    const cwdMarker = path.join(groupPath, ".cwd");
    if (!(await pathExists(cwdMarker))) continue;
    try {
      const recorded = (await readFile(cwdMarker, "utf8")).trim();
      if (recorded && isScopedWorkspaceMatch(recorded, scope)) {
        groups.push(groupPath);
      }
    } catch {
      // ignore unreadable markers
    }
  }
  return groups;
}

export class GrokSessionAnalyzer extends SessionAnalyzer {
  currentSessionId() {
    return process.env.GROK_SESSION_ID ?? null;
  }

  async resolveScope(options = {}) {
    const since = normalizeCliDate(options.since, false);
    const until = normalizeCliDate(options.until, true);
    const workspace = normalizeWorkspace(options.workspace);
    const workspaceMatchScope = workspaceMatchScopeFromOptions(options);
    const home = path.resolve(expandHome(
      options.home ?? options.grokHome ?? options["grok-home"] ?? defaultGrokHome(),
    ));
    const identities = [...new Set([
      workspace,
      workspaceMatchScope?.requestedWorkspace,
      workspaceMatchScope?.target?.kind === "workspace-member" ? workspaceMatchScope.gitRoot : null,
    ].filter(Boolean))];
    return {
      platform: "grok",
      workspace,
      home,
      sessionsDir: path.join(home, "sessions"),
      _encodedGroupNames: identities.map((id) => workspaceToGrokSessionDirName(id)),
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
    const matching = await listMatchingSessionGroups(scope.sessionsDir, scope);
    return [{
      id: "grok-sessions",
      kind: "grok-session-dir",
      role: "session-transcript",
      path: matching[0] ?? path.join(scope.sessionsDir, scope._encodedGroupNames[0] ?? ""),
      paths: [scope.sessionsDir],
      optional: false,
      enabled: true,
      workspaceScoped: true,
      coverage: "primary",
      exists: matching.length > 0,
    }];
  }

  async discoverSessions(scope, roots) {
    const sessions = new Map();
    const root = roots.find((item) => item.kind === "grok-session-dir");
    if (!root) return [];
    const groups = await listMatchingSessionGroups(scope.sessionsDir, scope);
    const seen = new Set();
    for (const groupPath of groups) {
      let realGroup;
      try { realGroup = realpathSync.native(groupPath); } catch { realGroup = path.resolve(groupPath); }
      if (seen.has(realGroup)) continue;
      seen.add(realGroup);
      let groupCwdFromMarker = null;
      try {
        const marker = path.join(groupPath, ".cwd");
        if (await pathExists(marker)) {
          groupCwdFromMarker = (await readFile(marker, "utf8")).trim() || null;
        }
      } catch {
        groupCwdFromMarker = null;
      }
      let sessionDirs;
      try {
        sessionDirs = await readdir(groupPath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of sessionDirs) {
        if (!entry.isDirectory()) continue;
        const sessionId = entry.name;
        if (scope.sessionId && sessionId !== scope.sessionId) continue;
        const sessionPath = path.join(groupPath, sessionId);
        const summary = await readJsonSafe(path.join(sessionPath, "summary.json"));
        const cwd = summary?.info?.cwd
          ?? summary?.cwd
          ?? (typeof summary?.info === "object" ? summary.info.cwd : null)
          ?? null;
        // Prefer summary cwd; then .cwd marker (long-path groups); then decode group name.
        let qualifiedCwd = cwd ?? groupCwdFromMarker;
        if (!qualifiedCwd) {
          try {
            qualifiedCwd = decodeURIComponent(path.basename(groupPath));
          } catch {
            qualifiedCwd = null;
          }
        }
        if (!isScopedWorkspaceMatch(qualifiedCwd, scope)) continue;
        const firstSeen = normalizeTimestamp(summary?.created_at ?? summary?.createdAt ?? null);
        const lastSeen = normalizeTimestamp(summary?.updated_at ?? summary?.updatedAt ?? null);
        if (!withinTimeRange(lastSeen ?? firstSeen, scope)) continue;

        const updatesPath = path.join(sessionPath, "updates.jsonl");
        const historyPath = path.join(sessionPath, "chat_history.jsonl");
        const signalsPath = path.join(sessionPath, "signals.json");
        const hasUpdates = await pathExists(updatesPath);
        if (hasUpdates) {
          addRef(sessions, sessionId, scope.workspace, {
            kind: "grok-updates-jsonl",
            role: "session-transcript",
            path: updatesPath,
            firstSeen,
            lastSeen,
            cwd: qualifiedCwd,
          });
        } else if (await pathExists(historyPath)) {
          // updates.jsonl is authoritative; only fall back to chat_history when missing.
          addRef(sessions, sessionId, scope.workspace, {
            kind: "grok-chat-history-jsonl",
            role: "session-transcript",
            path: historyPath,
            firstSeen,
            lastSeen,
            cwd: qualifiedCwd,
          });
        }
        if (await pathExists(signalsPath)) {
          addRef(sessions, sessionId, scope.workspace, {
            kind: "grok-signals-json",
            role: "session-metadata",
            path: signalsPath,
            firstSeen,
            lastSeen,
            cwd: qualifiedCwd,
          });
        }
        // Ensure session appears even if only summary exists (metadata-only coverage).
        if (!sessions.has(sessionId) && await pathExists(path.join(sessionPath, "summary.json"))) {
          addRef(sessions, sessionId, scope.workspace, {
            kind: "grok-summary-json",
            role: "session-metadata",
            path: path.join(sessionPath, "summary.json"),
            firstSeen,
            lastSeen,
            cwd: qualifiedCwd,
          });
        }
      }
    }
    return [...sessions.values()].map(finalizeSession)
      .sort((left, right) => (timestampMillis(right.lastSeen) ?? 0) - (timestampMillis(left.lastSeen) ?? 0));
  }

  normalizeEvent(raw, sourceRef, options = {}) {
    return this.normalizeEvents(raw, sourceRef, options)[0] ?? null;
  }

  normalizeEvents(raw, sourceRef, options = {}) {
    if (sourceRef.kind === "grok-chat-history-jsonl") {
      return chatHistoryToEvents(raw, sourceRef, options);
    }
    if (sourceRef.kind === "grok-signals-json") {
      // Handled in readSession as a whole-file object, not line events.
      return [];
    }
    return updatesRecordToEvents(raw, sourceRef, options);
  }

  async readSession(session, scope, options = {}) {
    const events = [];
    const requestedMaxLines = Number(options.workspacePreflightMaxLines);
    const preflight = Number.isFinite(requestedMaxLines) && requestedMaxLines > 0;
    let remainingLines = preflight ? Math.trunc(requestedMaxLines) : null;
    let truncated = false;
    const identityCwd = sessionWorkspaceCwd(session, scope._workspaceMatchScope);
    let usageEmitted = false;

    for (const ref of session.sourceRefs ?? []) {
      if (remainingLines !== null && remainingLines <= 0) {
        truncated = true;
        break;
      }
      if (ref.kind === "grok-signals-json") {
        const signals = await readJsonSafe(ref.path);
        // Prefer turn_completed usage from updates.jsonl. signals.json is
        // counters/context occupancy; only emit usage when explicit token
        // accounting fields exist (never contextTokensUsed as total).
        const usage = normalizeUsageFromSignals(signals);
        if (usage && !usageEmitted) {
          usageEmitted = true;
          events.push({
            sessionId: session.sessionId,
            timestamp: normalizeTimestamp(session.lastSeen),
            sourceKind: ref.kind,
            planningScope: "workspace",
            cwd: identityCwd ?? ref.cwd ?? null,
            type: "model.response.completed",
            category: "model",
            modelUsage: usage,
            usageFieldsObserved: true,
            evidenceRef: evidenceRef({ ...ref, sessionId: session.sessionId }, "model.response.completed"),
            summary: "Grok session signals usage",
          });
        } else if (signals && typeof signals.contextTokensUsed === "number") {
          events.push({
            sessionId: session.sessionId,
            timestamp: normalizeTimestamp(session.lastSeen),
            sourceKind: ref.kind,
            planningScope: "workspace",
            cwd: identityCwd ?? ref.cwd ?? null,
            type: "metadata.context_window",
            category: "metadata",
            evidenceRef: evidenceRef({ ...ref, sessionId: session.sessionId }, "metadata.context_window"),
            summary: `context tokens used ${signals.contextTokensUsed}`,
          });
        }
        continue;
      }
      if (ref.kind === "grok-summary-json") {
        const summary = await readJsonSafe(ref.path);
        events.push({
          sessionId: session.sessionId,
          timestamp: normalizeTimestamp(summary?.created_at ?? session.firstSeen),
          sourceKind: ref.kind,
          planningScope: "workspace",
          cwd: identityCwd ?? ref.cwd ?? null,
          type: "metadata.session",
          category: "metadata",
          evidenceRef: evidenceRef({ ...ref, sessionId: session.sessionId }, "metadata.session"),
          summary: summary?.session_summary || summary?.title || "session summary",
          model: summary?.current_model_id ?? null,
        });
        continue;
      }
      if (!ref.path.endsWith(".jsonl")) continue;
      const readCoverage = await forEachJsonLine(ref.path, (raw, line) => {
        for (const event of this.normalizeEvents(raw, { ...ref, sessionId: session.sessionId, line, cwd: ref.cwd }, options)) {
          if (withinTimeRange(event.timestamp, scope)) events.push(event);
        }
      }, remainingLines === null ? {} : { maxLines: remainingLines });
      if (readCoverage.invalidLines > 0) truncated = true;
      if (remainingLines !== null) {
        if (readCoverage.lineCount > remainingLines) truncated = true;
        remainingLines -= Math.min(readCoverage.lineCount, remainingLines);
      }
    }

    const sorted = events
      .map((event) => (event.cwd || !identityCwd ? event : { ...event, cwd: identityCwd }))
      .sort((left, right) =>
        (timestampMillis(left.timestamp) ?? 0) - (timestampMillis(right.timestamp) ?? 0)
        || Number(left.evidenceRef?.line ?? 0) - Number(right.evidenceRef?.line ?? 0)
        || Number(left.evidenceRef?.seq ?? 0) - Number(right.evidenceRef?.seq ?? 0));
    return markSessionReadCoverage(sorted, { truncated });
  }

  async analyze(options = {}) {
    return runProviderAnalysis(this, options, { platform: "grok", adapterVersion: "grok-v1" });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { command = "sessions", options } = parseArgs(argv);
  const analyzer = new GrokSessionAnalyzer();
  const result = await runProviderCommand(analyzer, command, options);
  await emitProviderResult({ provider: "Grok", command, options, result });
  return result;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`grok session-analysis failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}

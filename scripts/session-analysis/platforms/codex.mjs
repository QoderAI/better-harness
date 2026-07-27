#!/usr/bin/env node

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { SessionAnalyzer } from "../../session-analysis.mjs";
import { parseArgs, parseBooleanFlag } from "../cli.mjs";
import { forEachJsonLine, pathExists, walkFiles } from "../fs.mjs";
import { mapToSortedObject, stableId } from "../ids.mjs";
import { expandHome, normalizeWorkspace } from "../paths.mjs";
import {
  mergeTimeRange,
  normalizeCliDate,
  normalizeTimestamp,
  timestampMillis,
  withinTimeRange,
} from "../time.mjs";
import { buildFileReadDiagnostics } from "../file-reads.mjs";
import { buildInsightPack } from "../insights.mjs";
import { buildLongSessionFacet } from "../long-sessions.mjs";
import { topLifecycleDemandSignals } from "../lifecycle-demand-signals.mjs";
import { topPlanningSignals } from "../planning-signals.mjs";
import { parseResultFacts } from "../result-facts.mjs";
import { selectSessions, selectionSummary } from "../selection.mjs";
import { collectSessionSelectionEntries, selectSessionEntriesWithPlan } from "../selection-plan.mjs";
import {
  buildSessionCoreFacts,
  createFactsRunContext,
  factsHydrationLimit,
  prepareFactsSessionInventory,
} from "../session-core-facts.mjs";

const DEFAULT_LIMIT = 50;

function inferSessionId(raw, fallback) {
  const sessionMetaId = raw?.type === "session_meta" || raw?.event === "session_meta"
    ? raw?.payload?.id ?? raw?.payload?.session_id
    : null;
  return (
    raw?.sessionId ??
    raw?.session_id ??
    raw?.session_meta?.id ??
    raw?.session_meta?.session_id ??
    raw?.session_meta?.payload?.id ??
    raw?.payload?.session_id ??
    sessionMetaId ??
    fallback ??
    null
  );
}

function inferTimestamp(raw) {
  return normalizeTimestamp(
    raw?.timestamp ??
      raw?.ts ??
      raw?._timestamp ??
      raw?.created_at ??
      raw?.payload?.timestamp ??
      raw?.session_meta?.payload?.timestamp ??
      null,
  );
}

function inferCwd(raw) {
  return raw?.cwd ?? raw?.payload?.cwd ?? raw?.session_meta?.payload?.cwd ?? null;
}

function inferType(raw, fallback = "record") {
  const outer = raw?.type ?? raw?.event ?? raw?._event ?? null;
  const payload = raw?.payload ?? {};
  if (outer === "event_msg") {
    if (payload.type === "user_message") return "user";
    if (payload.type === "agent_message" || payload.type === "agent_reasoning") return "assistant";
    return payload.type ? `event.${payload.type}` : outer;
  }
  if (outer === "response_item") {
    if (payload.type === "message") return payload.role === "user" ? "user" : "assistant";
    if (payload.type === "agent_message") return "assistant";
    if (payload.type === "custom_tool_call" || payload.type === "function_call") return "tool.call";
    if (payload.type === "custom_tool_call_output" || payload.type === "function_call_output") return "tool.result";
    return payload.type ? `response.${payload.type}` : outer;
  }
  return outer ?? payload?.type ?? fallback;
}

function userVisibleAssistantText(raw) {
  const message = raw?.message ?? raw?.content ?? raw?.payload?.message ?? raw?.payload?.content ?? null;
  const extract = (value) => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(extract).join("\n");
    if (!value || typeof value !== "object") return "";
    if (value.type && !["text", "output_text"].includes(value.type)) return "";
    if (typeof value.text === "string") return value.text;
    if (typeof value.content === "string") return value.content;
    return extract(value.content);
  };
  return extract(message).trim();
}

function isUserVisibleAssistantMessage(raw) {
  const outer = raw?.type ?? raw?.event ?? raw?._event ?? null;
  const payload = raw?.payload ?? {};
  const isAssistantRecord = outer === "assistant"
    || (outer === "event_msg" && payload.type === "agent_message")
    || (outer === "response_item"
    && payload.type === "message"
    && payload.role === "assistant");
  return isAssistantRecord && userVisibleAssistantText(raw).length > 0;
}

function hasExplicitTrue(raw, names) {
  const payload = raw?.payload ?? {};
  return names.some((name) => raw?.[name] === true || payload?.[name] === true);
}

function inferToolInvocationId(raw) {
  return raw?.tool_use_id ?? raw?.toolUseId ?? raw?.tool_call_id ?? raw?.toolCallId
    ?? raw?.call_id ?? raw?.payload?.tool_use_id ?? raw?.payload?.toolUseId
    ?? raw?.payload?.tool_call_id ?? raw?.payload?.toolCallId
    ?? raw?.payload?.call_id ?? raw?.payload?.id ?? raw?.id ?? null;
}

function lifecyclePhase(raw) {
  const auditType = raw?._event ?? raw?.event;
  if (auditType === "PreToolUse") return "pre";
  if (auditType === "PostToolUse" || auditType === "PostToolUseFailure") return "post";
  const type = raw?.payload?.type;
  if (type === "custom_tool_call" || type === "function_call") return "request";
  if (type === "custom_tool_call_output" || type === "function_call_output") return "result";
  return null;
}

function inferToolName(raw) {
  return (
    raw?.tool_name ??
    raw?.toolName ??
    raw?.payload?.tool_name ??
    raw?.payload?.toolName ??
    raw?.payload?.name ??
    raw?.item?.name ??
    raw?.payload?.item?.name ??
    null
  );
}

function inferFunctionCallName(raw) {
  const payload = raw?.payload ?? {};
  const item = payload?.item ?? raw?.item ?? payload;
  const type = item?.type ?? payload?.type;
  if (type !== "function_call" && !item?.name && !payload?.name) {
    return null;
  }
  return item?.name ?? payload?.name ?? null;
}

function parseArgumentsObject(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "object") {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function inferCommandText(raw) {
  const payload = raw?.payload ?? {};
  const item = payload?.item ?? raw?.item ?? payload;
  const directInput = item?.input ?? payload?.input;
  const parsedArguments = parseArgumentsObject(item?.arguments ?? payload?.arguments ?? directInput);
  const toolName = String(inferToolName(raw) ?? inferFunctionCallName(raw) ?? "").toLowerCase();
  return (
    raw?.command ??
    raw?.cmd ??
    raw?.args?.command ??
    raw?.input?.command ??
    raw?.tool_input?.command ??
    raw?.payload?.command ??
    raw?.payload?.cmd ??
    raw?.payload?.args?.command ??
    raw?.payload?.input?.command ??
    raw?.payload?.tool_input?.command ??
    parsedArguments?.command ??
    parsedArguments?.cmd ??
    (["exec", "exec_command", "shell", "bash"].includes(toolName) && typeof directInput === "string"
      ? directInput
      : null) ??
    item?.arguments?.command ??
    payload?.item?.arguments?.command ??
    null
  );
}

function inferFilePath(raw) {
  const payload = raw?.payload ?? {};
  const item = payload?.item ?? raw?.item ?? payload;
  const parsedArguments = parseArgumentsObject(item?.arguments ?? payload?.arguments ?? item?.input ?? payload?.input);
  return (
    raw?.file_path ??
    raw?.filePath ??
    raw?.args?.file_path ??
    raw?.args?.filePath ??
    raw?.args?.path ??
    raw?.input?.file_path ??
    raw?.input?.filePath ??
    raw?.input?.path ??
    raw?.tool_input?.file_path ??
    raw?.tool_input?.filePath ??
    raw?.tool_input?.path ??
    payload?.file_path ??
    payload?.filePath ??
    payload?.args?.file_path ??
    payload?.args?.filePath ??
    payload?.args?.path ??
    payload?.input?.file_path ??
    payload?.input?.filePath ??
    payload?.input?.path ??
    payload?.tool_input?.file_path ??
    payload?.tool_input?.filePath ??
    payload?.tool_input?.path ??
    parsedArguments?.file_path ??
    parsedArguments?.filePath ??
    parsedArguments?.path ??
    item?.arguments?.file_path ??
    item?.arguments?.filePath ??
    item?.arguments?.path ??
    null
  );
}

function hasFilePathSemantics(toolName) {
  const canonical = String(toolName ?? "").replace(/[^A-Za-z0-9_]/g, "").toLowerCase();
  return (
    ["read", "readfile", "read_file", "edit", "multiedit", "notebookedit", "notebookread", "write"].includes(canonical) ||
    /(?:read|edit|write).*file|file(?:read|edit|write)/.test(canonical)
  );
}

function inferSkillReadName(raw) {
  const command = inferCommandText(raw);
  if (!command) {
    return null;
  }

  const match = String(command).match(/(?:^|[\s'"])([A-Za-z]:[\\/][^\s'"]+|\/[^\s'"]+)[\\/]skills[\\/]([^\s'"]+)[\\/]SKILL\.md\b/i);
  if (!match) {
    return null;
  }
  const parts = match[2].split(/[\\/]/);
  const candidate = parts[0];
  if (candidate === ".system") {
    return parts[1] ?? null;
  }
  return candidate ?? null;
}

function inferLoadedSkillNames(raw) {
  const text = messageText(raw);
  if (!text || !text.includes("<skill>")) {
    return [];
  }

  const names = [];
  const pattern = /<skill>[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<\/skill>/g;
  for (const match of text.matchAll(pattern)) {
    const name = match[1]?.trim();
    if (name) {
      names.push(name);
    }
  }
  return names;
}

function messageText(raw) {
  const message = raw?.message ?? raw?.content ?? raw?.payload?.message ?? raw?.payload?.content ?? null;
  if (typeof message === "string") {
    return message;
  }
  if (Array.isArray(message)) {
    return message.map((item) => (typeof item === "string" ? item : item?.text ?? item?.content ?? "")).join("\n");
  }
  if (message && typeof message === "object") {
    return message.text ?? message.content ?? JSON.stringify(message);
  }
  return "";
}

function toolOutputText(raw) {
  const output = raw?.output ?? raw?.payload?.output;
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    return output.map((item) => typeof item === "string" ? item : item?.text ?? item?.content ?? "").join("\n");
  }
  return "";
}

function userText(raw) {
  const prompt = raw?.prompt ?? raw?.user_prompt ?? raw?.userPrompt
    ?? raw?.payload?.prompt ?? raw?.payload?.user_prompt ?? raw?.payload?.userPrompt;
  if (typeof prompt === "string") return prompt;
  const message = raw?.message ?? raw?.content ?? raw?.payload?.message ?? raw?.payload?.content ?? null;
  if (typeof message === "string") {
    return message;
  }
  if (Array.isArray(message)) {
    return message
      .filter((item) => typeof item === "string" || !item?.type || item.type === "text" || item.type === "input_text")
      .map((item) => (typeof item === "string" ? item : item?.text ?? item?.content ?? ""))
      .join("\n");
  }
  if (message && typeof message === "object") {
    return message.text ?? message.content ?? "";
  }
  return "";
}

function isWorkspaceMatch(candidate, workspace) {
  if (!candidate) {
    return false;
  }
  const resolved = normalizeWorkspace(candidate);
  return resolved === workspace || resolved.startsWith(`${workspace}${path.sep}`);
}

function createSessionRecord(sessionId, workspace) {
  return {
    sessionId,
    workspace,
    sourceKinds: new Set(),
    sourceRefMap: new Map(),
    firstSeen: null,
    lastSeen: null,
    indexedEventCounts: new Map(),
  };
}

function addSessionRef(sessions, sessionId, workspace, ref) {
  const id = sessionId || `fallback:${stableId([ref.path, ref.timestamp, ref.kind])}`;
  let session = sessions.get(id);
  if (!session) {
    session = createSessionRecord(id, workspace);
    sessions.set(id, session);
  }

  session.sourceKinds.add(ref.kind);
  session.indexedEventCounts.set(ref.eventType, (session.indexedEventCounts.get(ref.eventType) ?? 0) + 1);
  mergeTimeRange(session, ref.timestamp);

  const key = `${ref.kind}:${ref.path}`;
  const existing = session.sourceRefMap.get(key) ?? {
    kind: ref.kind,
    role: ref.role,
    path: ref.path,
    sessionId: id,
    count: 0,
    lines: [],
    eventTypes: new Set(),
    firstSeen: null,
    lastSeen: null,
    planningScope: ref.planningScope ?? "workspace",
  };
  if (ref.planningScope === "user-global") {
    existing.planningScope = "user-global";
  }
  existing.count += 1;
  if (ref.line && existing.lines.length < 8) {
    existing.lines.push(ref.line);
  }
  existing.eventTypes.add(ref.eventType);
  mergeTimeRange(existing, ref.timestamp);
  session.sourceRefMap.set(key, existing);
}

function finalizeSession(session) {
  const sourceKinds = [...session.sourceKinds].sort();
  return {
    sessionId: session.sessionId,
    workspace: session.workspace,
    sourceKinds,
    coverage: {
      audit: sourceKinds.includes("codex-audit-jsonl") || sourceKinds.includes("codex-legacy-audit-jsonl"),
      runMetadata: false,
      executionEvents: sourceKinds.includes("codex-session-jsonl"),
      conversation: sourceKinds.includes("codex-session-jsonl") || sourceKinds.includes("codex-history-jsonl"),
      state: sourceKinds.includes("codex-session-index"),
      cache: sourceKinds.includes("codex-archived-session"),
    },
    firstSeen: session.firstSeen,
    lastSeen: session.lastSeen,
    indexedEventCounts: mapToSortedObject(session.indexedEventCounts),
    sourceRefs: [...session.sourceRefMap.values()].map((ref) => ({
      kind: ref.kind,
      role: ref.role,
      path: ref.path,
      sessionId: ref.sessionId,
      count: ref.count,
      lines: ref.lines,
      seqs: [],
      planningScope: ref.planningScope ?? "workspace",
      eventTypes: [...ref.eventTypes].sort(),
      firstSeen: ref.firstSeen,
      lastSeen: ref.lastSeen,
    })),
  };
}

function summarizeEvents(events) {
  const eventCounts = new Map();
  const messageCounts = new Map();
  const sourceCounts = new Map();
  const timeRange = { firstSeen: null, lastSeen: null };

  for (const event of events) {
    eventCounts.set(event.type, (eventCounts.get(event.type) ?? 0) + 1);
    sourceCounts.set(event.sourceKind, (sourceCounts.get(event.sourceKind) ?? 0) + 1);
    if (event.type === "user" || event.type === "assistant" || event.type === "message") {
      messageCounts.set(event.type, (messageCounts.get(event.type) ?? 0) + 1);
    }
    mergeTimeRange(timeRange, event.timestamp);
  }

  return {
    eventCounts: mapToSortedObject(eventCounts),
    messageCounts: mapToSortedObject(messageCounts),
    sourceCounts: mapToSortedObject(sourceCounts),
    timeRange,
  };
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
  return counts;
}

function topCountEntries(items, keyFn, limit = 20) {
  const samples = new Map();
  const counts = countBy(items, keyFn);
  for (const item of items) {
    const key = keyFn(item);
    if (!key || samples.has(key)) {
      continue;
    }
    samples.set(key, item.evidenceRef ? [item.evidenceRef] : []);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count, evidenceRefs: samples.get(name) ?? [] }));
}

function topMultiCountEntries(items, keysFn, limit = 20) {
  const counts = new Map();
  const samples = new Map();
  for (const item of items) {
    for (const key of keysFn(item) ?? []) {
      if (!key) {
        continue;
      }
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!samples.has(key)) {
        samples.set(key, item.evidenceRef ? [item.evidenceRef] : []);
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count, evidenceRefs: samples.get(name) ?? [] }));
}

function publicScope(scope) {
  return {
    platform: scope.platform,
    workspace: scope.workspace,
    home: scope.home,
    since: scope.since,
    until: scope.until,
    sessionId: scope.sessionId,
    includeArchive: scope.includeArchive,
    includeGlobalCapabilities: scope.includeGlobalCapabilities,
  };
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

function sourceWarnings(roots) {
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
        message: `${root.kind} root is disabled; pass --include-archive to enable it`,
        source: root.id,
      })),
  ];
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

function buildFacets(indexedSessions, detailedSessions, events) {
  const sourceCoverage = {};
  for (const session of indexedSessions) {
    for (const kind of session.sourceKinds) {
      sourceCoverage[kind] = (sourceCoverage[kind] ?? 0) + 1;
    }
  }

  const summary = summarizeEvents(events);
  return {
    sessionCount: indexedSessions.length,
    analyzedSessionCount: detailedSessions.length,
    sourceCoverage,
    timeRange: summary.timeRange,
    messageCounts: summary.messageCounts,
    topEventTypes: Object.entries(summary.eventCounts)
      .slice(0, 20)
      .map(([name, count]) => ({ name, count, evidenceRefs: [] })),
    topTools: topCountEntries(events, (event) => event.toolName),
    topHooks: [],
    topHookCommands: [],
    topSkills: topMultiCountEntries(events, (event) => event.skillNames),
    topFunctionCalls: topCountEntries(events, (event) => event.functionCallName),
    inferredSkillReads: topCountEntries(events, (event) => event.skillReadName),
    topModels: [],
    planningSignals: topPlanningSignals(events, { platform: "codex" }),
    lifecycleDemandSignals: topLifecycleDemandSignals(events, { platform: "codex" }),
    longSessions: buildLongSessionFacet(detailedSessions, events),
  };
}

async function firstJsonlRecord(filePath) {
  let first = null;
  await forEachJsonLine(
    filePath,
    (raw) => {
      first = raw;
      return false;
    },
    { maxLines: 1 },
  );
  return first;
}

export class CodexSessionAnalyzer extends SessionAnalyzer {
  async resolveScope(options = {}) {
    const workspace = normalizeWorkspace(options.workspace);
    const since = normalizeCliDate(options.since, false);
    const until = normalizeCliDate(options.until, true);
    return {
      platform: "codex",
      workspace,
      home: path.resolve(expandHome(options.home ?? options["codex-home"] ?? "~/.codex")),
      since: since.label,
      sinceTime: since.time,
      until: until.label,
      untilTime: until.time,
      sessionId: options["session-id"] ?? options.sessionId ?? options._?.[0] ?? null,
      includeArchive: parseBooleanFlag(options["include-archive"] ?? options.includeArchive ?? false),
      includeGlobalCapabilities: parseBooleanFlag(
        options["include-global-capabilities"] ?? options.includeGlobalCapabilities ?? false,
      ),
    };
  }

  async discoverSourceRoots(scope) {
    const roots = [
      {
        id: "codex-audit-logs",
        kind: "codex-audit-jsonl",
        role: "tool-permission-audit",
        path: path.join(scope.home, "audit-logs", "audit.jsonl"),
        optional: true,
        enabled: true,
        workspaceScoped: false,
      },
      {
        id: "codex-legacy-audit",
        kind: "codex-legacy-audit-jsonl",
        role: "tool-permission-audit",
        path: path.join(scope.home, "audit", "audit.jsonl"),
        optional: true,
        enabled: true,
        workspaceScoped: false,
      },
      {
        id: "codex-sessions",
        kind: "codex-session-jsonl",
        role: "session-transcript",
        path: path.join(scope.home, "sessions"),
        optional: true,
        enabled: true,
        workspaceScoped: false,
      },
      {
        id: "codex-session-index",
        kind: "codex-session-index",
        role: "session-index",
        path: path.join(scope.home, "session_index.jsonl"),
        optional: true,
        enabled: true,
        workspaceScoped: false,
      },
      {
        id: "codex-history",
        kind: "codex-history-jsonl",
        role: "prompt-history",
        path: path.join(scope.home, "history.jsonl"),
        optional: true,
        enabled: true,
        workspaceScoped: false,
      },
      {
        id: "codex-archived-sessions",
        kind: "codex-archived-session",
        role: "archived-session-transcript",
        path: path.join(scope.home, "archived_sessions"),
        optional: true,
        enabled: scope.includeArchive,
        workspaceScoped: false,
      },
    ];

    return Promise.all(roots.map(async (root) => ({ ...root, exists: await pathExists(root.path) })));
  }

  async discoverSessions(scope, roots) {
    const sessions = new Map();
    await this.discoverAuditSessions(scope, roots, sessions);
    await this.discoverSessionIndex(scope, roots, sessions);
    await this.discoverSessionFiles(scope, roots, sessions, "codex-session-jsonl");
    await this.discoverSessionFiles(scope, roots, sessions, "codex-archived-session");
    return [...sessions.values()]
      .map(finalizeSession)
      .sort((a, b) => (timestampMillis(b.lastSeen) ?? 0) - (timestampMillis(a.lastSeen) ?? 0));
  }

  async discoverAuditSessions(scope, roots, sessions) {
    const auditRoots = roots.filter((root) => root.kind === "codex-audit-jsonl" || root.kind === "codex-legacy-audit-jsonl");
    for (const root of auditRoots) {
      if (!root.exists || !root.enabled) {
        continue;
      }
      await forEachJsonLine(root.path, (raw, line) => {
        if (!isWorkspaceMatch(inferCwd(raw), scope.workspace)) {
          return;
        }
        const sessionId = inferSessionId(raw);
        const timestamp = inferTimestamp(raw);
        if (!sessionId || !withinTimeRange(timestamp, scope)) {
          return;
        }
        addSessionRef(sessions, sessionId, scope.workspace, {
          kind: root.kind,
          role: root.role,
          path: root.path,
          line,
          eventType: inferType(raw, "audit"),
          timestamp,
        });
      });
    }
  }

  async discoverSessionIndex(scope, roots, sessions) {
    const root = roots.find((item) => item.kind === "codex-session-index");
    if (!root?.exists || !root.enabled) {
      return;
    }
    await forEachJsonLine(root.path, (raw, line) => {
      const cwd = inferCwd(raw);
      const planningScope = isWorkspaceMatch(cwd, scope.workspace) ? "workspace" : "user-global";
      if (planningScope === "user-global" && !scope.includeGlobalCapabilities) {
        return;
      }
      const sessionId = inferSessionId(raw);
      const timestamp = inferTimestamp(raw);
      if (!sessionId || !withinTimeRange(timestamp, scope)) {
        return;
      }
      addSessionRef(sessions, sessionId, scope.workspace, {
        kind: root.kind,
        role: root.role,
        path: root.path,
        line,
        eventType: "session-index",
        timestamp,
        planningScope,
      });
    });
  }

  async discoverSessionFiles(scope, roots, sessions, kind) {
    const root = roots.find((item) => item.kind === kind);
    if (!root?.exists || !root.enabled) {
      return;
    }
    const files = await walkFiles(root.path, {
      maxDepth: kind === "codex-session-jsonl" ? 4 : 1,
      limit: 20_000,
      match: (filePath) => filePath.endsWith(".jsonl"),
    });

    for (const filePath of files) {
      const first = await firstJsonlRecord(filePath);
      const timestamp = inferTimestamp(first);
      const cwd = inferCwd(first);
      const planningScope = cwd && !isWorkspaceMatch(cwd, scope.workspace) ? "user-global" : "workspace";
      if (planningScope === "user-global" && !scope.includeGlobalCapabilities) {
        continue;
      }
      if (!withinTimeRange(timestamp, scope)) {
        continue;
      }
      const fallback = path.basename(filePath, ".jsonl").replace(/^rollout-\d{4}-\d{2}-\d{2}T[^-]+-/, "");
      addSessionRef(sessions, inferSessionId(first, fallback), scope.workspace, {
        kind,
        role: root.role,
        path: filePath,
        eventType: "session-jsonl",
        timestamp,
        planningScope,
      });
    }
  }

  normalizeEvent(raw, sourceRef, options = {}) {
    const type = inferType(raw);
    const text = messageText(raw);
    const event = {
      sessionId: inferSessionId(raw, sourceRef.sessionId),
      type,
      category: type.includes(".") ? type.split(".")[0] : type,
      timestamp: inferTimestamp(raw),
      sourceKind: sourceRef.kind,
      planningScope: sourceRef.planningScope ?? "workspace",
      evidenceRef: {
        kind: sourceRef.kind,
        path: sourceRef.path,
        line: sourceRef.line ?? null,
        seq: raw?.seq ?? null,
        type,
      },
      summary: text ? `${type} message (${text.length} chars)` : type,
    };
    const cwd = inferCwd(raw);
    if (cwd) event.cwd = cwd;
    if (type === "user" || type === "last-prompt" || type === "UserPromptSubmit") {
      event.userPrompt = type === "UserPromptSubmit" || userText(raw).trim().length > 0;
    }
    if (isUserVisibleAssistantMessage(raw)) {
      event.userVisibleAssistantMessage = true;
    }
    if (hasExplicitTrue(raw, ["taskCompleted", "task_completed"])) {
      event.taskCompleted = true;
    }
    if (hasExplicitTrue(raw, ["userCorrection", "user_correction"])) {
      event.userCorrection = true;
    }

    const toolName = inferToolName(raw);
    if (toolName) {
      event.toolName = toolName;
    }
    const functionCallName = inferFunctionCallName(raw);
    if (functionCallName) {
      event.functionCallName = functionCallName;
    }
    const phase = lifecyclePhase(raw);
    if (phase) {
      event.lifecyclePhase = phase;
      const toolInvocationId = inferToolInvocationId(raw);
      if (toolInvocationId) {
        event.toolInvocationId = toolInvocationId;
      }
    }
    const skillReadName = inferSkillReadName(raw);
    if (skillReadName) {
      event.skillReadName = skillReadName;
    }
    const skillNames = inferLoadedSkillNames(raw);
    if (skillNames.length > 0) {
      event.skillNames = skillNames;
    }
    if (typeof raw?.success === "boolean") {
      event.success = raw.success;
    } else if (typeof raw?.payload?.success === "boolean") {
      event.success = raw.payload.success;
    }
    if (raw?.error || raw?.payload?.error) {
      event.hasError = true;
    }
    if (raw?.payload?.status === "failed") {
      event.success = false;
    }
    const resultText = toolOutputText(raw);
    if (event.lifecyclePhase === "result" || event.lifecyclePhase === "post") {
      if (/^Script completed(?:\r?\n|$)/u.test(resultText)) event.success = true;
      if (/^Script failed(?:\r?\n|$)/u.test(resultText)) {
        event.success = false;
        event.hasError = true;
      }
    }
    const action = String(raw?._action ?? raw?.action ?? "").trim().toUpperCase();
    if (type === "PostToolUse" && ["SUCCESS", "SUCCEEDED", "OK"].includes(action)) event.success = true;
    if (type === "PostToolUseFailure" || ["FAILURE", "FAILED", "ERROR"].includes(action)) {
      event.success = false;
      event.hasError = true;
    }
    if (event.lifecyclePhase === "result" || event.lifecyclePhase === "post") {
      const resultFacts = parseResultFacts(resultText.slice(-8_192));
      if (resultFacts) {
        event.resultFacts = resultFacts;
        if (event.success === undefined) {
          if (Number(resultFacts.errors ?? 0) > 0 || Number(resultFacts.testsFailed ?? 0) > 0) {
            event.success = false;
          } else if (resultFacts.errors === 0 || resultFacts.testsFailed === 0) {
            event.success = true;
          }
        }
      }
    }
    if (raw?.permission_mode) event.permissionMode = String(raw.permission_mode);
    if (event.lifecyclePhase === "pre" && ["ALLOWED", "BLOCKED", "DENIED", "ASKED"].includes(action)) {
      event.permissionDecision = action.toLowerCase();
    }
    if (event.lifecyclePhase === "pre") {
      const permissionBoundary = String(
        raw?.permission_boundary ?? raw?.permissionBoundary
        ?? raw?.payload?.permission_boundary ?? raw?.payload?.permissionBoundary ?? "",
      ).trim().toLowerCase();
      if (["protected-action", "external-side-effect"].includes(permissionBoundary)) {
        event.permissionBoundary = permissionBoundary;
      }
      if (raw?.protected_action === true || raw?.protectedAction === true
        || raw?.payload?.protected_action === true || raw?.payload?.protectedAction === true) event.protectedAction = true;
      if (raw?.external_side_effect === true || raw?.externalSideEffect === true
        || raw?.payload?.external_side_effect === true || raw?.payload?.externalSideEffect === true) event.externalSideEffect = true;
      if (raw?.permission_escalated === true || raw?.permissionEscalated === true
        || raw?.payload?.permission_escalated === true || raw?.payload?.permissionEscalated === true) event.permissionEscalated = true;
    }
    if (text) {
      event.contentLength = text.length;
    }
    if (options.includeContent && text) {
      event.content = text;
    }
    if (options.includeUserText && (type === "user" || type === "last-prompt" || type === "response_item" || type === "UserPromptSubmit")) {
      const promptText = userText(raw);
      if (promptText) {
        event.userText = promptText;
      }
    }
    if (options.includeCommandText) {
      const commandText = inferCommandText(raw);
      if (commandText) {
        event.commandText = commandText;
      }
    }
    const filePath = hasFilePathSemantics(toolName ?? functionCallName) ? inferFilePath(raw) : null;
    if (filePath) {
      event.filePath = filePath;
    }
    return event;
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

  async readSession(session, scope, options = {}) {
    const events = [];
    const includeContent = parseBooleanFlag(options["include-content"] ?? options.includeContent ?? false);
    const includeCommandText = parseBooleanFlag(options["include-command-text"] ?? options.includeCommandText ?? false);
    const includeUserText = parseBooleanFlag(options["include-user-text"] ?? options.includeUserText ?? false);
    for (const ref of session.sourceRefs ?? []) {
      if (!ref.path.endsWith(".jsonl")) {
        continue;
      }
      await forEachJsonLine(ref.path, (raw, line) => {
        const sessionId = inferSessionId(raw, session.sessionId);
        if (sessionId !== session.sessionId) {
          return;
        }
        if (!scope.includeGlobalCapabilities && inferCwd(raw) && !isWorkspaceMatch(inferCwd(raw), scope.workspace)) {
          return;
        }
        const event = this.normalizeEvent(raw, { ...ref, line }, { includeContent, includeCommandText, includeUserText });
        if (withinTimeRange(event.timestamp, scope)) {
          events.push(event);
        }
      });
    }
    return events.sort((a, b) => (timestampMillis(a.timestamp) ?? 0) - (timestampMillis(b.timestamp) ?? 0));
  }

  async analyze(options = {}) {
    const factsMode = options.command === "facts";
    const factsContext = factsMode ? createFactsRunContext(options, "codex") : null;
    if (factsContext) options = factsContext.options;
    const scope = await this.resolveScope(options);
    const roots = await this.discoverSourceRoots(scope);
    const discoveredSessions = Array.isArray(options.sessionInventory)
      ? filterSessionsByScope(options.sessionInventory, scope)
      : filterSessionsByScope(await this.discoverSessions(scope, roots), scope);
    const factsInventory = factsMode
      ? prepareFactsSessionInventory(discoveredSessions, factsContext)
      : { sessions: discoveredSessions, omitted: {} };
    const sessions = factsInventory.sessions;
    const warnings = sourceWarnings(roots);

    if (options.command === "sources") {
      return {
        scope: publicScope(scope),
        sources: roots.map(toPublicSource),
        sessions,
        facets: null,
        warnings,
      };
    }
    if (options.command === "sessions") {
      const limit = options.limit === undefined ? null : Number(options.limit);
      return {
        scope: publicScope(scope),
        sources: roots.map(toPublicSource),
        sessions: Number.isFinite(limit) ? sessions.slice(0, limit) : sessions,
        facets: null,
        warnings,
      };
    }

    const detailedSessions = [];
    const events = [];
    const insightMode = options.command === "insights";
    const fileReadMode = options.command === "file-reads";
    const eventOptions = factsMode
      ? { ...options, includeCommandText: true, includeUserText: true, includeContent: false }
      : options.command === "facets" || insightMode || fileReadMode
        ? { ...options, includeCommandText: true, includeUserText: true, includeContent: true }
        : options;
    const selectionEntries = !factsMode && (options.selectionEntries ?? (
      options.selectionPlan
        ? await collectSessionSelectionEntries({
            analyzer: this,
            sessions,
            scope,
            concurrency: options.selectionConcurrency ?? options["selection-concurrency"] ?? 4,
          })
        : null
    ));
    const selection = !factsMode && options.selectionPlan
      ? selectSessionEntriesWithPlan(selectionEntries, options.selectionPlan)
      : selectSessions(sessions, {
          limit: factsMode ? factsHydrationLimit(options.limit) : options.limit,
          strategy: factsMode ? options.selection ?? "stratified" : options.selection,
          defaultLimit: factsMode ? 5 : DEFAULT_LIMIT,
        });
    for (const session of selection.sessions) {
      const sessionEvents = await this.readSession(session, scope, eventOptions);
      events.push(...sessionEvents);
      detailedSessions.push(this.mergeSession(sessionEvents, session));
    }

    if (factsMode) {
      return buildSessionCoreFacts({
        scope,
        events,
        selection,
        warnings,
        omitted: factsInventory.omitted,
        episodeLimit: options["episode-limit"] ?? options.episodeLimit ?? options.limit,
        debug: parseBooleanFlag(options.debug ?? false),
      });
    }

    if (fileReadMode) {
      return {
        scope: publicScope(scope),
        sources: roots.map(toPublicSource),
        sessions: detailedSessions,
        selection: selectionSummary(selection),
        fileReads: buildFileReadDiagnostics({
          scope: publicScope(scope),
          indexedSessions: sessions,
          sessions: detailedSessions,
          warnings,
          events,
          selectionStrategy: selection.strategy,
          selectionStrata: selection.strata,
          adapterVersion: "codex-v2",
        }),
        warnings,
      };
    }

    const facets = buildFacets(sessions, detailedSessions, events);
    if (insightMode) {
      return {
        scope: publicScope(scope),
        sources: roots.map(toPublicSource),
        sessions: detailedSessions,
        selection: selectionSummary(selection),
        facets,
        insights: buildInsightPack({
          scope: publicScope(scope),
          sources: roots.map(toPublicSource),
          sessions: detailedSessions,
          facets,
          warnings,
          events,
          selectionStrategy: selection.strategy,
          selectionStrata: selection.strata,
          adapterVersion: "codex-v2",
        }),
        warnings,
      };
    }

    return {
      scope: publicScope(scope),
      sources: roots.map(toPublicSource),
      sessions: detailedSessions,
      selection: selectionSummary(selection),
      facets,
      warnings,
    };
  }
}

function formatMarkdown(command, result) {
  if (result?.kind === "session-core-facts") {
    const lines = ["# Session Core Facts", "", `Candidates: ${result.candidates.length}`];
    for (const candidate of result.candidates) {
      lines.push(`- ${candidate.ref}: ${candidate.request.summary}`);
    }
    return `${lines.join("\n")}\n`;
  }
  const lines = [`# Codex Session Analysis: ${command}`, "", `Workspace: ${result.scope.workspace}`, ""];
  lines.push(`Sources: ${result.sources.length}`);
  lines.push(`Sessions: ${result.sessions.length}`);
  if (result.insights) {
    lines.push(`Insight cards: ${result.insights.cards.length}`);
    lines.push(`Sample confidence: ${result.insights.sample.confidence}`);
    if (result.insights.keySignals.topFunctionCalls?.length > 0) {
      lines.push(
        `Top function calls: ${result.insights.keySignals.topFunctionCalls.map((item) => `${item.name}=${item.count}`).join(", ")}`,
      );
    }
    if (result.insights.keySignals.inferredSkillReads?.length > 0) {
      lines.push(
        `Inferred skill reads: ${result.insights.keySignals.inferredSkillReads.map((item) => `${item.name}=${item.count}`).join(", ")}`,
      );
    }
    if (result.insights.keySignals.planningSignals?.length > 0) {
      lines.push(
        `Planning insight signals: ${result.insights.keySignals.planningSignals
          .map((item) => `${item.host}:${item.kind}:${item.name}:${item.scope}=${item.count}`)
          .join(", ")}`,
      );
    }
    lines.push(
      `Validation command signals: ${result.insights.keySignals.validation.commandMatches.map((item) => `${item.name}=${item.count}`).join(", ")}`,
    );
    lines.push(
      `Validation mention signals: ${result.insights.keySignals.validation.userMentions.map((item) => `${item.name}=${item.count}`).join(", ")}`,
    );
  }
  if (result.fileReads) {
    lines.push(`File access events: ${result.fileReads.sample.fileAccessCount}`);
    lines.push(`Read-after-write failures: ${result.fileReads.diagnostics.readAfterWriteFailureCount}`);
    lines.push(`Wrong relative doc paths: ${result.fileReads.diagnostics.wrongRelativePathCount}`);
    if (result.fileReads.topFiles.length > 0) {
      lines.push(
        `Top file reads: ${result.fileReads.topFiles
          .slice(0, 10)
          .map((item) => `${item.path}=${item.accessCount}`)
          .join(", ")}`,
      );
    }
    if (result.fileReads.issueCandidates.length > 0) {
      lines.push(
        `Issue candidates: ${result.fileReads.issueCandidates
          .slice(0, 10)
          .map((item) => `${item.path}=${item.issueScore}`)
          .join(", ")}`,
      );
    }
    if (result.fileReads.readAfterWriteFailures.length > 0) {
      lines.push(
        `Read-after-write failures: ${result.fileReads.readAfterWriteFailures
          .slice(0, 10)
          .map((item) => `${item.path}=${item.readAfterWriteFailureCount}`)
          .join(", ")}`,
      );
    }
    if (result.fileReads.wrongRelativePathCandidates.length > 0) {
      lines.push(
        `Wrong relative doc paths: ${result.fileReads.wrongRelativePathCandidates
          .slice(0, 10)
          .map((item) => `${item.path}=${item.wrongRelativePathRules.join("+")}`)
          .join(", ")}`,
      );
    }
  }
  if (result.warnings.length > 0) {
    lines.push("", "## Warnings");
    for (const warning of result.warnings) {
      lines.push(`- ${warning.code}: ${warning.message}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function filterEvents(result, type) {
  if (!type) {
    return result;
  }
  return {
    ...result,
    sessions: result.sessions.map((session) => ({
      ...session,
      events: (session.events ?? []).filter((event) => event.type === type),
    })),
  };
}

async function runCommand(command, options) {
  const analyzer = new CodexSessionAnalyzer();
  const commandOptions = { ...options, command };
  if (command === "show" || command === "events") {
    commandOptions["session-id"] = options["session-id"] ?? options._?.[0] ?? null;
    if (!commandOptions["session-id"]) {
      throw new Error(`${command} requires --session-id <id>`);
    }
  }

  if (command === "sources" || command === "sessions" || command === "facets" || command === "insights" || command === "facts" || command === "file-reads") {
    return analyzer.analyze(commandOptions);
  }
  if (command === "show" || command === "events") {
    const index = await analyzer.analyze({ ...commandOptions, command: "sessions" });
    const scope = await analyzer.resolveScope(commandOptions);
    const sessions = [];
    for (const session of index.sessions) {
      const events = await analyzer.readSession(session, scope, commandOptions);
      sessions.push({
        ...analyzer.mergeSession(events, session),
        events: command === "show" && !parseBooleanFlag(options["include-events"] ?? false) ? undefined : events,
      });
    }
    return command === "events" ? filterEvents({ ...index, sessions }, options.type) : { ...index, sessions };
  }
  throw new Error(`Unknown command: ${command}`);
}

export async function main(argv = process.argv.slice(2)) {
  const { command = "sessions", options } = parseArgs(argv);
  const result = await runCommand(command, options);
  const format = options.format ?? "json";
  let output;
  if (format === "markdown" || format === "md") {
    output = formatMarkdown(command, result);
  } else if (format === "json") {
    output = command === "facts"
      ? `${JSON.stringify(result)}\n`
      : `${JSON.stringify(result, null, 2)}\n`;
  } else {
    throw new Error(`Unsupported format: ${format}`);
  }
  if (typeof options.output === "string" && options.output.trim()) {
    const outputPath = path.resolve(options.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output);
    process.stdout.write(`${JSON.stringify({ ok: true, output: outputPath, format })}\n`);
    return;
  }
  process.stdout.write(output);
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`codex session-analysis failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}

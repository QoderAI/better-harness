#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
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
import { collectSkillUsageObservations } from "../daily-usage.mjs";
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

const DEFAULT_PLATFORM = "qoder";
const DEFAULT_LIMIT = 50;
const JSONL_EXT = ".jsonl";

const SOURCE_ROLES = Object.freeze({
  "audit-jsonl": "tool-permission-audit",
  "run-manifest": "run-metadata",
  "logs-session": "execution-events",
  "project-jsonl": "conversation",
  "project-state": "session-state",
  "execution-transcript": "execution-transcript",
  "home-session": "session-compat",
  "cache-project-session": "cache-conversation",
  "global-project-jsonl": "user-global-project-session-store",
});

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export function workspaceToQoderSlug(workspace) {
  return workspaceToQoderSlugVariants(workspace)[0];
}

export function workspaceToQoderSlugVariants(workspace) {
  const expanded = expandHome(workspace ?? process.cwd());
  const normalized = path.win32.isAbsolute(expanded)
    ? path.win32.normalize(expanded)
    : normalizeWorkspace(expanded);
  // Qoder's Windows log and project stores sanitize the drive colon differently.
  return [...new Set([
    normalized.replace(/:/g, "-").replace(/[\\/]+/g, "-"),
    normalized.replace(/:/g, "").replace(/[\\/]+/g, "-"),
  ])];
}

function sourceRootPaths(root) {
  return root.paths ?? [root.path];
}

function parseSegmentTimestamp(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  const match = base.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})([+-]\d{2})-(\d{2})/,
  );
  if (!match) {
    return null;
  }
  return normalizeTimestamp(
    `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}${match[6]}:${match[7]}`,
  );
}

function isWorkspaceMatch(candidate, workspace) {
  if (!candidate) {
    return false;
  }
  const resolved = normalizeWorkspace(candidate);
  return resolved === workspace || resolved.startsWith(`${workspace}${path.sep}`);
}

function inferSessionId(raw, sourceRef) {
  return (
    raw?.sessionId ??
    raw?.session_id ??
    raw?.data?.sessionId ??
    raw?.data?.session_id ??
    raw?.data?.session?.id ??
    sourceRef?.sessionId ??
    null
  );
}

function inferEventType(raw, fallback = "record") {
  return raw?.type ?? raw?._event ?? raw?._action ?? raw?.event ?? fallback;
}

function userVisibleAssistantText(raw) {
  const message = raw?.message ?? raw?.content ?? raw?.data?.message ?? raw?.data?.content ?? null;
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

function isUserVisibleAssistantMessage(raw, type) {
  const role = raw?.role ?? raw?.message?.role ?? raw?.data?.role ?? raw?.data?.message?.role;
  const isAssistantRecord = type === "assistant" || (type === "message" && role === "assistant");
  return isAssistantRecord && userVisibleAssistantText(raw).length > 0;
}

function hasExplicitTrue(raw, names) {
  const data = raw?.data ?? {};
  return names.some((name) => raw?.[name] === true || data?.[name] === true);
}

function inferTimestamp(raw, sourceRef) {
  return normalizeTimestamp(
    raw?.ts ??
      raw?.timestamp ??
      raw?._timestamp ??
      raw?.createdAt ??
      raw?.updatedAt ??
      raw?.data?.timestamp ??
      sourceRef?.timestamp ??
      null,
  );
}

function inferToolName(raw) {
  return (
    raw?.tool_name ??
    raw?.toolName ??
    raw?.tool?.name ??
    raw?.data?.tool_name ??
    raw?.data?.toolName ??
    raw?.data?.tool?.name ??
    raw?.data?.name ??
    null
  );
}

function inferSkillName(raw) {
  return (
    raw?.args?.skill ??
    raw?.args?.skillName ??
    raw?.args?.skill_name ??
    raw?.input?.skill ??
    raw?.tool_input?.skill ??
    raw?.data?.args?.skill ??
    raw?.data?.args?.skillName ??
    raw?.data?.args?.skill_name ??
    raw?.data?.input?.skill ??
    raw?.data?.tool_input?.skill ??
    raw?.data?.skill ??
    raw?.data?.skillName ??
    raw?.data?.skill_name ??
    null
  );
}

function messageContentItems(raw) {
  const content = raw?.message?.content ?? raw?.data?.message?.content ?? null;
  return Array.isArray(content) ? content : [];
}

function inferSkillInvocations(raw, type) {
  const invocations = [];
  const directToolName = inferToolName(raw);
  if (directToolName === "Skill" && type === "tool.requested") {
    const name = canonicalSkillName(inferSkillName(raw));
    if (name) invocations.push({ name, id: inferToolInvocationId(raw) });
  }
  for (const item of messageContentItems(raw)) {
    if (item?.type !== "tool_use" || item?.name !== "Skill") continue;
    const name = canonicalSkillName(item?.input?.skill);
    if (name) invocations.push({ name, id: item?.id ?? null });
  }
  const seen = new Set();
  return invocations.filter((invocation) => {
    const key = `${invocation.id ?? ""}:${invocation.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function canonicalSkillName(name) {
  if (!name) {
    return null;
  }
  const value = String(name).trim();
  const separator = value.indexOf(":");
  return separator === -1 ? value : value.slice(separator + 1);
}

function inferHookName(raw) {
  return raw?.hook_event_name ?? raw?.hookEventName ?? raw?.data?.hook_event_name ?? raw?.data?.hookEventName ?? null;
}

function inferHookSource(raw) {
  return raw?.source ?? raw?.hook_source ?? raw?.hookSource ?? raw?.data?.source ?? raw?.data?.hook_source ?? raw?.data?.hookSource ?? null;
}

function inferHookIndex(raw) {
  const value = raw?.index ?? raw?.hook_index ?? raw?.hookIndex ?? raw?.data?.index ?? raw?.data?.hook_index ?? raw?.data?.hookIndex;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function inferHookDuration(raw) {
  const value = raw?.duration_ms ?? raw?.durationMs ?? raw?.data?.duration_ms ?? raw?.data?.durationMs;
  return Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
}

function lifecyclePhase(type) {
  if (type === "PreToolUse") return "pre";
  if (type === "PostToolUse" || type === "PostToolUseFailure") return "post";
  if (type === "tool.requested") return "request";
  if (type === "tool.execution.finished") return "result";
  return null;
}

function isAuditLifecycle(sourceKind) {
  return sourceKind === "audit-jsonl";
}

function inferToolInvocationId(raw) {
  return raw?.tool_use_id ?? raw?.toolUseId ?? raw?.tool_call_id ?? raw?.toolCallId
    ?? raw?.data?.tool_use_id ?? raw?.data?.toolUseId ?? raw?.data?.tool_call_id ?? raw?.data?.toolCallId ?? null;
}

function inferModel(raw) {
  return raw?.model ?? raw?.data?.model ?? raw?.message?.model ?? null;
}

function inferRequestId(raw) {
  return raw?.request_id ?? raw?.requestId ?? raw?.data?.request_id ?? raw?.data?.requestId ?? null;
}

function inferResponseId(raw) {
  return raw?.response_id ?? raw?.responseId ?? raw?.data?.response_id ?? raw?.data?.responseId
    ?? raw?.message?.id ?? raw?.data?.message?.id
    ?? (inferEventType(raw) === "assistant" ? raw?.uuid ?? null : null);
}

function inferRequestIndex(raw) {
  const value = raw?.request_index ?? raw?.requestIndex ?? raw?.data?.request_index ?? raw?.data?.requestIndex;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function inferStopReason(raw) {
  return raw?.stop_reason ?? raw?.stopReason ?? raw?.data?.stop_reason ?? raw?.data?.stopReason
    ?? raw?.message?.stop_reason ?? raw?.message?.stopReason
    ?? raw?.data?.message?.stop_reason ?? raw?.data?.message?.stopReason ?? null;
}

function inferIsSubagent(raw) {
  const value = raw?.is_subagent ?? raw?.isSubagent ?? raw?.data?.is_subagent ?? raw?.data?.isSubagent;
  return typeof value === "boolean" ? value : null;
}

function inferModelUsage(raw) {
  const sources = [
    raw,
    raw?.data,
    raw?.usage,
    raw?.data?.usage,
    raw?.message?.usage,
    raw?.data?.message?.usage,
  ].filter((value) => value && typeof value === "object");
  const fields = [
    ["inputTokens", ["input_tokens", "inputTokens"]],
    ["outputTokens", ["output_tokens", "outputTokens"]],
    ["cacheReadInputTokens", ["cache_read_input_tokens", "cacheReadInputTokens"]],
    ["cacheCreationInputTokens", ["cache_creation_input_tokens", "cacheCreationInputTokens"]],
  ];
  let observed = false;
  const usage = {};
  for (const [target, keys] of fields) {
    let value;
    for (const source of sources) {
      const key = keys.find((candidate) => Object.prototype.hasOwnProperty.call(source, candidate));
      if (key) {
        value = source[key];
        observed = true;
        break;
      }
    }
    usage[target] = Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
  }
  return observed ? usage : null;
}

function inferCwd(raw) {
  return raw?.cwd ?? raw?.data?.cwd ?? raw?.workspace ?? raw?.data?.workspace ?? null;
}

function inferCommandText(raw) {
  return (
    raw?.command ??
    raw?.cmd ??
    raw?.args?.command ??
    raw?.input?.command ??
    raw?.tool_input?.command ??
    raw?.data?.command ??
    raw?.data?.cmd ??
    raw?.data?.args?.command ??
    raw?.data?.input?.command ??
    raw?.data?.tool_input?.command ??
    null
  );
}

function inferFilePath(raw) {
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
    raw?.data?.file_path ??
    raw?.data?.filePath ??
    raw?.data?.args?.file_path ??
    raw?.data?.args?.filePath ??
    raw?.data?.args?.path ??
    raw?.data?.input?.file_path ??
    raw?.data?.input?.filePath ??
    raw?.data?.input?.path ??
    raw?.data?.tool_input?.file_path ??
    raw?.data?.tool_input?.filePath ??
    raw?.data?.tool_input?.path ??
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

function tokenizeCommand(command) {
  const tokens = [];
  let current = "";
  let quote = null;

  const chars = [...String(command)];
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    const next = chars[index + 1];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === "\\" && quote === '"' && ["\\", '"', "$", "`"].includes(next)) {
        current += next;
        index += 1;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "\\" && next && (/\s/.test(next) || next === "'" || next === '"' || next === "\\")) {
      current += next;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function commandBase(token) {
  return path.win32.basename(String(token).toLowerCase()).replace(/\.exe$/, "");
}

function isUrlToken(token) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(String(token));
}

function looksLikeScriptToken(token) {
  return (
    !isUrlToken(token) &&
    (/[\\/]/.test(token) || /\.(?:mjs|cjs|js|jsx|ts|tsx|py|sh|bash|zsh|rb|pl|ps1)$/i.test(token))
  );
}

function firstScriptToken(tokens) {
  return tokens.find((token) => token && !token.startsWith("-") && looksLikeScriptToken(token)) ?? null;
}

function summarizeHookCommand(command, depth = 0) {
  if (!command || depth > 2) {
    return null;
  }

  const tokens = tokenizeCommand(String(command).trim());
  if (tokens.length === 0) {
    return null;
  }

  const base = commandBase(tokens[0]);
  if (["bash", "sh", "zsh", "fish", "cmd", "powershell", "pwsh"].includes(base)) {
    const inlineIndex = tokens.findIndex((token) => /^-.*c$|^\/c$/i.test(token) || /^-command$/i.test(token));
    if (inlineIndex !== -1 && tokens[inlineIndex + 1]) {
      return summarizeHookCommand(tokens.slice(inlineIndex + 1).join(" "), depth + 1) ?? `${base} ${tokens[inlineIndex]}`;
    }
    const target = firstScriptToken(tokens.slice(1));
    return target ? `${base} ${target}` : base;
  }

  if (["node", "python", "python3", "ruby", "perl", "deno"].includes(base)) {
    const target = firstScriptToken(tokens.slice(1));
    return target ? `${base} ${target}` : base;
  }

  if (base === "bun") {
    if (tokens[1] === "run" && tokens[2]) {
      return `${base} run ${tokens[2]}`;
    }
    const target = firstScriptToken(tokens.slice(1));
    return target ? `${base} ${target}` : base;
  }

  if (["npm", "pnpm", "yarn"].includes(base) && tokens[1] === "run" && tokens[2]) {
    return `${base} run ${tokens[2]}`;
  }

  if (base === "npx" && tokens[1]) {
    return `${base} ${tokens[1]}`;
  }

  if (looksLikeScriptToken(tokens[0])) {
    return tokens[0];
  }

  const target = firstScriptToken(tokens.slice(1));
  return target ? `${base} ${target}` : base;
}

function messageText(raw) {
  const message = raw?.message ?? raw?.content ?? raw?.data?.message ?? raw?.data?.content ?? null;
  if (typeof message === "string") {
    return message;
  }
  if (Array.isArray(message)) {
    return message
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        return item?.text ?? item?.content ?? "";
      })
      .join("\n");
  }
  if (message && typeof message === "object") {
    if (typeof message.content === "string") {
      return message.content;
    }
    if (typeof message.text === "string") {
      return message.text;
    }
    return JSON.stringify(message);
  }
  return "";
}

function toolOutputText(raw) {
  const output = raw?.output ?? raw?.result ?? raw?.stdout
    ?? raw?.data?.output ?? raw?.data?.result ?? raw?.data?.stdout;
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    return output.map((item) => typeof item === "string" ? item : item?.text ?? item?.content ?? "").join("\n");
  }
  if (output && typeof output === "object") {
    return typeof output.text === "string" ? output.text
      : typeof output.content === "string" ? output.content
        : "";
  }
  return messageText(raw);
}

function userText(raw) {
  const prompt = raw?.prompt ?? raw?.user_prompt ?? raw?.userPrompt
    ?? raw?.data?.prompt ?? raw?.data?.user_prompt ?? raw?.data?.userPrompt;
  if (typeof prompt === "string") return prompt;
  const message = raw?.message ?? raw?.content ?? raw?.data?.message ?? raw?.data?.content ?? null;
  if (typeof message === "string") {
    return message;
  }
  if (Array.isArray(message)) {
    return message
      .filter((item) => typeof item === "string" || !item?.type || item.type === "text")
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        return item?.text ?? item?.content ?? "";
      })
      .join("\n");
  }
  if (message && typeof message === "object") {
    if (typeof message.content === "string") {
      return message.content;
    }
    if (Array.isArray(message.content)) {
      return message.content
        .filter((item) => typeof item === "string" || !item?.type || item.type === "text")
        .map((item) => typeof item === "string" ? item : item?.text ?? item?.content ?? "")
        .join("\n");
    }
    if (typeof message.text === "string") {
      return message.text;
    }
  }
  return "";
}

function summarizeEvent(raw, sourceRef) {
  const type = inferEventType(raw);
  const sourceKind = sourceRef?.kind;
  const toolName = inferToolName(raw);
  const hookName = inferHookName(raw);
  const model = inferModel(raw);
  const text = messageText(raw);

  if (toolName) {
    return `${type} for tool ${toolName}`;
  }
  if (hookName) {
    return `${type} for hook ${hookName}`;
  }
  if (model) {
    return `${type} using model ${model}`;
  }
  if (type === "user" || type === "assistant" || type === "last-prompt") {
    return `${type} message (${text.length} chars)`;
  }
  if (sourceKind === "project-state") {
    return "session state snapshot";
  }
  return type;
}

function makeEvidenceRef(raw, sourceRef, lineNumber) {
  const seq = raw?.seq ?? sourceRef?.seq ?? null;
  return {
    kind: sourceRef.kind,
    path: sourceRef.path,
    line: lineNumber ?? sourceRef.line ?? null,
    seq,
    type: inferEventType(raw, sourceRef.eventType ?? "record"),
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

async function readSessionIdFromJsonl(filePath, fallbackRef) {
  let found = null;
  let firstTimestamp = null;
  await forEachJsonLine(
    filePath,
    (raw) => {
      found = inferSessionId(raw, fallbackRef);
      firstTimestamp = inferTimestamp(raw, fallbackRef);
      return found ? false : undefined;
    },
    { maxLines: 25 },
  );
  return { sessionId: found, timestamp: firstTimestamp };
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

function sourceKey(ref) {
  return `${ref.kind}:${ref.path}`;
}

function addIndexedCount(session, type) {
  if (!type) {
    return;
  }
  session.indexedEventCounts.set(type, (session.indexedEventCounts.get(type) ?? 0) + 1);
}

function addSessionRef(sessions, sessionId, workspace, ref) {
  const id = sessionId || `fallback:${stableId([ref.path, ref.timestamp, ref.kind])}`;
  let session = sessions.get(id);
  if (!session) {
    session = createSessionRecord(id, workspace);
    sessions.set(id, session);
  }

  session.sourceKinds.add(ref.kind);
  addIndexedCount(session, ref.eventType);
  mergeTimeRange(session, ref.timestamp);

  const key = sourceKey(ref);
  const existing = session.sourceRefMap.get(key) ?? {
    kind: ref.kind,
    role: SOURCE_ROLES[ref.kind] ?? "evidence",
    path: ref.path,
    sessionId: id,
    count: 0,
    lines: [],
    seqs: [],
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
  if (ref.seq !== null && ref.seq !== undefined && existing.seqs.length < 8) {
    existing.seqs.push(ref.seq);
  }
  if (ref.eventType) {
    existing.eventTypes.add(ref.eventType);
  }
  mergeTimeRange(existing, ref.timestamp);
  session.sourceRefMap.set(key, existing);
}

function finalizeSession(session) {
  const sourceKinds = [...session.sourceKinds].sort();
  const coverage = {
    audit: sourceKinds.includes("audit-jsonl"),
    runMetadata: sourceKinds.includes("run-manifest"),
    executionEvents: sourceKinds.includes("logs-session") || sourceKinds.includes("home-session"),
    conversation:
      sourceKinds.includes("project-jsonl") ||
      sourceKinds.includes("global-project-jsonl") ||
      sourceKinds.includes("execution-transcript") ||
      sourceKinds.includes("home-session") ||
      sourceKinds.includes("cache-project-session"),
    state: sourceKinds.includes("project-state"),
    cache: sourceKinds.includes("cache-project-session"),
  };

  const sourceRefs = [...session.sourceRefMap.values()]
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path))
    .map((ref) => ({
      kind: ref.kind,
      role: ref.role,
      path: ref.path,
      sessionId: ref.sessionId,
      count: ref.count,
      lines: ref.lines,
      seqs: ref.seqs,
      planningScope: ref.planningScope ?? "workspace",
      eventTypes: [...ref.eventTypes].sort(),
      firstSeen: ref.firstSeen,
      lastSeen: ref.lastSeen,
    }));

  return {
    sessionId: session.sessionId,
    workspace: session.workspace,
    sourceKinds,
    coverage,
    firstSeen: session.firstSeen,
    lastSeen: session.lastSeen,
    indexedEventCounts: mapToSortedObject(session.indexedEventCounts),
    sourceRefs,
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

function topSkillEntries(events, limit = 20) {
  const observations = collectSkillUsageObservations(events);
  const counts = new Map();
  const samples = new Map();
  for (const observation of observations) {
    counts.set(observation.name, (counts.get(observation.name) ?? 0) + 1);
    if (!samples.has(observation.name)) {
      samples.set(observation.name, observation.evidenceRef ? [observation.evidenceRef] : []);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count, evidenceRefs: samples.get(name) ?? [] }));
}

function summarizeEvents(events) {
  const eventCounts = countBy(events, (event) => event.type);
  const messageCounts = countBy(events, (event) =>
    event.type === "user" || event.type === "assistant" || event.type === "last-prompt" ? event.type : null,
  );
  const sourceCounts = countBy(events, (event) => event.sourceKind);
  const timeRange = { firstSeen: null, lastSeen: null };
  for (const event of events) {
    mergeTimeRange(timeRange, event.timestamp);
  }

  return {
    eventCounts: mapToSortedObject(eventCounts),
    messageCounts: mapToSortedObject(messageCounts),
    sourceCounts: mapToSortedObject(sourceCounts),
    timeRange,
  };
}

function publicScope(scope) {
  return {
    platform: scope.platform,
    workspace: scope.workspace,
    workspaceSlug: scope.workspaceSlug,
    home: scope.home,
    since: scope.since ?? null,
    until: scope.until ?? null,
    sessionId: scope.sessionId ?? null,
    includeCache: scope.includeCache,
    includeGlobalCapabilities: scope.includeGlobalCapabilities,
  };
}

function missingRootWarnings(roots) {
  return roots
    .filter((root) => root.enabled && root.optional && !root.exists)
    .map((root) => ({
      code: "missing-optional-root",
      message: `${root.kind} root does not exist: ${root.path}`,
      source: root.id,
    }));
}

function disabledRootWarnings(roots) {
  return roots
    .filter((root) => !root.enabled)
    .map((root) => ({
      code: "disabled-source-root",
      message: root.disabledHint
        ? `${root.kind} root is disabled; ${root.disabledHint}`
        : `${root.kind} root is disabled; pass --include-cache to enable it`,
      source: root.id,
    }));
}

export class QoderSessionAnalyzer extends SessionAnalyzer {
  async resolveScope(options = {}) {
    const workspace = normalizeWorkspace(options.workspace);
    const since = normalizeCliDate(options.since, false);
    const until = normalizeCliDate(options.until, true);
    const home = path.resolve(expandHome(options.home ?? options["qoder-home"] ?? "~/.qoder"));
    const workspaceSlugVariants = workspaceToQoderSlugVariants(workspace);

    return {
      platform: "qoder",
      workspace,
      workspaceSlug: workspaceSlugVariants[0],
      _workspaceSlugVariants: workspaceSlugVariants,
      home,
      since: since.label,
      sinceTime: since.time,
      until: until.label,
      untilTime: until.time,
      sessionId: options["session-id"] ?? options.sessionId ?? options._?.[0] ?? null,
      includeCache: parseBooleanFlag(options["include-cache"] ?? options.includeCache ?? false),
      includeGlobalCapabilities: parseBooleanFlag(
        options["include-global-capabilities"] ?? options.includeGlobalCapabilities ?? false,
      ),
    };
  }

  async discoverSourceRoots(scope) {
    const workspaceSlugVariants = scope._workspaceSlugVariants ?? [scope.workspaceSlug];
    const roots = [
      {
        id: "qoder-audit",
        kind: "audit-jsonl",
        role: SOURCE_ROLES["audit-jsonl"],
        path: path.join(scope.home, "audit", "audit.jsonl"),
        optional: true,
        enabled: true,
        workspaceScoped: false,
      },
      {
        id: "qoder-run-manifests",
        kind: "run-manifest",
        role: SOURCE_ROLES["run-manifest"],
        path: path.join(scope.home, "logs", "runs"),
        optional: true,
        enabled: true,
        workspaceScoped: false,
      },
      {
        id: "qoder-log-sessions",
        kind: "logs-session",
        role: SOURCE_ROLES["logs-session"],
        path: path.join(scope.home, "logs", "sessions", scope.workspaceSlug),
        paths: workspaceSlugVariants.map((slug) => path.join(scope.home, "logs", "sessions", slug)),
        optional: true,
        enabled: true,
        workspaceScoped: true,
      },
      {
        id: "qoder-projects",
        kind: "project-jsonl",
        role: "project-session-store",
        path: path.join(scope.home, "projects", scope.workspaceSlug),
        paths: workspaceSlugVariants.map((slug) => path.join(scope.home, "projects", slug)),
        optional: true,
        enabled: true,
        workspaceScoped: true,
      },
      {
        id: "qoder-home-sessions",
        kind: "home-session",
        role: SOURCE_ROLES["home-session"],
        path: path.join(scope.home, "sessions"),
        optional: true,
        enabled: true,
        workspaceScoped: false,
      },
      {
        id: "qoder-cache-projects",
        kind: "cache-project-session",
        role: SOURCE_ROLES["cache-project-session"],
        path: path.join(scope.home, "cache", "projects"),
        optional: true,
        enabled: scope.includeCache,
        disabledHint: "pass --include-cache to enable it",
        workspaceScoped: false,
      },
      {
        id: "qoder-global-projects",
        kind: "global-project-jsonl",
        role: SOURCE_ROLES["global-project-jsonl"],
        path: path.join(scope.home, "projects"),
        optional: true,
        enabled: scope.includeGlobalCapabilities,
        disabledHint: "pass --include-global-capabilities to enable it",
        workspaceScoped: false,
      },
    ];

    return Promise.all(
      roots.map(async (root) => {
        const paths = sourceRootPaths(root);
        const existing = await Promise.all(paths.map((candidate) => pathExists(candidate)));
        const firstExistingPath = paths.find((_candidate, index) => existing[index]);
        return {
          ...root,
          path: firstExistingPath ?? root.path,
          exists: existing.some(Boolean),
        };
      }),
    );
  }

  async discoverSessions(scope, roots) {
    const sessions = new Map();
    await this.discoverAuditSessions(scope, roots, sessions);
    await this.discoverLogSessions(scope, roots, sessions);
    await this.discoverProjectSessions(scope, roots, sessions);
    await this.discoverHomeSessions(scope, roots, sessions);
    await this.discoverCacheSessions(scope, roots, sessions);

    return [...sessions.values()]
      .map(finalizeSession)
      .sort((a, b) => {
        const left = timestampMillis(b.lastSeen) ?? 0;
        const right = timestampMillis(a.lastSeen) ?? 0;
        return left - right || a.sessionId.localeCompare(b.sessionId);
      });
  }

  async discoverAuditSessions(scope, roots, sessions) {
    const root = roots.find((item) => item.kind === "audit-jsonl");
    if (!root?.exists || !root.enabled) {
      return;
    }

    await forEachJsonLine(root.path, (raw, line) => {
      const sessionId = inferSessionId(raw);
      if (!sessionId || !isWorkspaceMatch(inferCwd(raw), scope.workspace)) {
        return;
      }
      const timestamp = inferTimestamp(raw);
      if (!withinTimeRange(timestamp, scope)) {
        return;
      }
      addSessionRef(sessions, sessionId, scope.workspace, {
        kind: "audit-jsonl",
        path: root.path,
        line,
        eventType: inferEventType(raw, "audit"),
        timestamp,
      });
    });
  }

  async discoverLogSessions(scope, roots, sessions) {
    const root = roots.find((item) => item.kind === "logs-session");
    if (!root?.exists || !root.enabled) {
      return;
    }

    for (const sourceRoot of sourceRootPaths(root)) {
      const files = await walkFiles(sourceRoot, {
        maxDepth: 3,
        limit: 20_000,
        match: (filePath) => filePath.endsWith(JSONL_EXT),
      });
      for (const filePath of files) {
        const relative = path.relative(sourceRoot, filePath).split(path.sep);
        const sessionId = relative[0];
        if (!sessionId || relative[1] !== "segments") {
          continue;
        }
        const timestamp = parseSegmentTimestamp(filePath);
        if (!withinTimeRange(timestamp, scope)) {
          continue;
        }
        addSessionRef(sessions, sessionId, scope.workspace, {
          kind: "logs-session",
          path: filePath,
          eventType: "segment",
          timestamp,
        });
      }
    }
  }

  async discoverProjectSessions(scope, roots, sessions) {
    const root = roots.find((item) => item.id === "qoder-projects");
    if (root?.exists && root.enabled) {
      for (const sourceRoot of sourceRootPaths(root)) {
        await this.discoverProjectRootSessions(scope, sessions, sourceRoot, {
          kind: "project-jsonl",
          transcriptKind: "execution-transcript",
          planningScope: "workspace",
        });
      }
    }

    const globalRoot = roots.find((item) => item.id === "qoder-global-projects");
    if (!globalRoot?.exists || !globalRoot.enabled) {
      return;
    }

    let projectDirs;
    try {
      projectDirs = await readdir(globalRoot.path, { withFileTypes: true });
    } catch {
      return;
    }

    const workspaceSlugVariants = new Set(scope._workspaceSlugVariants ?? [scope.workspaceSlug]);
    for (const entry of projectDirs) {
      if (!entry.isDirectory() || workspaceSlugVariants.has(entry.name)) {
        continue;
      }
      await this.discoverProjectRootSessions(scope, sessions, path.join(globalRoot.path, entry.name), {
        kind: "global-project-jsonl",
        transcriptKind: "global-project-jsonl",
        planningScope: "user-global",
      });
    }
  }

  async discoverProjectRootSessions(scope, sessions, projectRoot, { kind, transcriptKind, planningScope }) {
    let entries;
    try {
      entries = await readdir(projectRoot, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(projectRoot, entry.name);
      if (entry.isFile() && entry.name.endsWith(JSONL_EXT)) {
        const sessionId = path.basename(entry.name, JSONL_EXT);
        const probe = await readSessionIdFromJsonl(fullPath, { sessionId, kind, path: fullPath });
        const timestamp = probe.timestamp;
        if (!withinTimeRange(timestamp, scope)) {
          continue;
        }
        addSessionRef(sessions, probe.sessionId ?? sessionId, scope.workspace, {
          kind,
          path: fullPath,
          eventType: "conversation-jsonl",
          timestamp,
          planningScope,
        });
      }

      if (entry.isDirectory()) {
        const statePath = path.join(fullPath, "state.json");
        if (!(await pathExists(statePath))) {
          continue;
        }
        const state = await readJson(statePath).catch(() => null);
        const sessionId = state?.sessionId ?? entry.name;
        const timestamp = normalizeTimestamp(state?.updatedAt ?? state?.createdAt);
        if (!withinTimeRange(timestamp, scope)) {
          continue;
        }
        addSessionRef(sessions, sessionId, scope.workspace, {
          kind: "project-state",
          path: statePath,
          eventType: "session.state",
          timestamp,
          planningScope,
        });
      }
    }

    const transcriptRoot = path.join(projectRoot, "transcript");
    const transcriptFiles = await walkFiles(transcriptRoot, {
      maxDepth: 1,
      limit: 10_000,
      match: (filePath) => filePath.endsWith(JSONL_EXT),
    });
    for (const filePath of transcriptFiles) {
      const fallbackId = path.basename(filePath, JSONL_EXT);
      const probe = await readSessionIdFromJsonl(filePath, {
        sessionId: fallbackId,
        kind: "execution-transcript",
        path: filePath,
      });
      const timestamp = probe.timestamp;
      if (!withinTimeRange(timestamp, scope)) {
        continue;
      }
      addSessionRef(sessions, probe.sessionId ?? fallbackId, scope.workspace, {
        kind: transcriptKind,
        path: filePath,
        eventType: "execution-transcript",
        timestamp,
        planningScope,
      });
    }
  }

  async discoverHomeSessions(scope, roots, sessions) {
    const root = roots.find((item) => item.kind === "home-session");
    if (!root?.exists || !root.enabled) {
      return;
    }

    const files = await walkFiles(root.path, {
      maxDepth: 6,
      limit: 20_000,
      match: (filePath) => filePath.endsWith(JSONL_EXT) || filePath.endsWith(".json"),
    });
    for (const filePath of files) {
      const fallbackId = path.basename(filePath).replace(/\.(jsonl|json)$/u, "");
      const probe = filePath.endsWith(JSONL_EXT)
        ? await readSessionIdFromJsonl(filePath, { sessionId: fallbackId, kind: "home-session", path: filePath })
        : { sessionId: fallbackId, timestamp: null };
      if (!withinTimeRange(probe.timestamp, scope)) {
        continue;
      }
      addSessionRef(sessions, probe.sessionId ?? fallbackId, scope.workspace, {
        kind: "home-session",
        path: filePath,
        eventType: "home-session",
        timestamp: probe.timestamp,
      });
    }
  }

  async discoverCacheSessions(scope, roots, sessions) {
    const root = roots.find((item) => item.kind === "cache-project-session");
    if (!root?.exists || !root.enabled) {
      return;
    }

    const workspaceBase = path.basename(scope.workspace).toLowerCase();
    const files = await walkFiles(root.path, {
      maxDepth: 5,
      limit: 20_000,
      match: (filePath) => {
        const normalized = filePath.toLowerCase();
        return (
          filePath.endsWith(JSONL_EXT) &&
          normalized.includes(`${path.sep}conversation-history${path.sep}`) &&
          normalized.includes(workspaceBase)
        );
      },
    });
    for (const filePath of files) {
      const fallbackId = path.basename(filePath, JSONL_EXT);
      const probe = await readSessionIdFromJsonl(filePath, {
        sessionId: fallbackId,
        kind: "cache-project-session",
        path: filePath,
      });
      if (!withinTimeRange(probe.timestamp, scope)) {
        continue;
      }
      addSessionRef(sessions, probe.sessionId ?? fallbackId, scope.workspace, {
        kind: "cache-project-session",
        path: filePath,
        eventType: "cache-conversation",
        timestamp: probe.timestamp,
      });
    }
  }

  normalizeEvent(raw, sourceRef, options = {}) {
    const type = inferEventType(raw, sourceRef.eventType ?? "record");
    const timestamp = inferTimestamp(raw, sourceRef);
    const text = messageText(raw);
    const promptText = type === "user" || type === "last-prompt" || type === "UserPromptSubmit"
      ? userText(raw).trim()
      : "";
    const event = {
      sessionId: inferSessionId(raw, sourceRef),
      type,
      category: type.includes(".") ? type.split(".")[0] : type,
      timestamp,
      sourceKind: sourceRef.kind,
      planningScope: sourceRef.planningScope ?? "workspace",
      evidenceRef: makeEvidenceRef(raw, sourceRef, sourceRef.line),
      summary: summarizeEvent(raw, sourceRef),
    };

    if (type === "user" || type === "last-prompt" || type === "UserPromptSubmit") {
      event.userPrompt = type === "UserPromptSubmit" || promptText.length > 0;
      if (raw?.isMeta === true) {
        event.userInputMeta = true;
      }
    }
    if (isUserVisibleAssistantMessage(raw, type)) {
      event.userVisibleAssistantMessage = true;
    }
    if (hasExplicitTrue(raw, ["taskCompleted", "task_completed"])) {
      event.taskCompleted = true;
    }
    if (hasExplicitTrue(raw, ["userCorrection", "user_correction"])) {
      event.userCorrection = true;
    }

    const toolName = inferToolName(raw);
    const hookName = inferHookName(raw);
    const model = inferModel(raw);
    const requestId = inferRequestId(raw);
    const responseId = inferResponseId(raw);
    const requestIndex = inferRequestIndex(raw);
    const stopReason = inferStopReason(raw);
    const isSubagent = inferIsSubagent(raw);
    const modelUsage = inferModelUsage(raw);
    const cwd = inferCwd(raw);
    const phase = lifecyclePhase(type);
    const auditLifecycle = isAuditLifecycle(sourceRef.kind);
    const skillInvocations = inferSkillInvocations(raw, type);

    if (toolName) {
      event.toolName = toolName;
    }
    if (skillInvocations.length > 0) {
      event.skillInvocations = skillInvocations;
      event.skillNames = [...new Set(skillInvocations.map((invocation) => invocation.name))];
      event.skillName = event.skillNames[0];
    }
    if (phase) {
      event.lifecyclePhase = phase;
    }
    const toolInvocationId = inferToolInvocationId(raw);
    if (toolInvocationId) {
      event.toolInvocationId = toolInvocationId;
    }
    if (auditLifecycle) {
      event.lifecycleEvent = type;
    } else if (hookName) {
      event.hookName = hookName;
      const hookScript = summarizeHookCommand(inferCommandText(raw));
      if (hookScript) {
        event.hookScript = hookScript;
        event.hookCommand = hookScript;
      }
      const hookSource = inferHookSource(raw);
      const hookIndex = inferHookIndex(raw);
      const hookDurationMs = inferHookDuration(raw);
      if (hookSource) {
        event.hookSource = String(hookSource);
      }
      if (hookIndex !== null) {
        event.hookIndex = hookIndex;
      }
      if (hookDurationMs !== null) {
        event.hookDurationMs = hookDurationMs;
      }
      if (type === "hook.started" || type === "hook.finished") {
        event.hookLifecyclePhase = type === "hook.started" ? "started" : "finished";
      }
    }
    if (model) {
      event.model = model;
    }
    if (requestId) {
      event.requestId = requestId;
    }
    if (responseId) {
      event.responseId = responseId;
    }
    if (requestIndex !== null) {
      event.requestIndex = requestIndex;
    }
    if (stopReason) {
      event.stopReason = stopReason;
    }
    if (isSubagent !== null) {
      event.isSubagent = isSubagent;
    }
    if (modelUsage) {
      event.modelUsage = modelUsage;
      event.usageFieldsObserved = true;
    }
    if (cwd) {
      event.cwd = cwd;
    }
    if (raw?.level) {
      event.level = raw.level;
    }
    if (raw?.permission_mode) {
      event.permissionMode = raw.permission_mode;
    }
    const permissionAction = String(raw?._action ?? raw?.action ?? raw?.decision ?? "").trim().toUpperCase();
    if (event.lifecyclePhase === "pre" && ["ALLOWED", "BLOCKED", "DENIED", "ASKED"].includes(permissionAction)) {
      event.permissionDecision = permissionAction.toLowerCase();
    }
    if (event.lifecyclePhase === "pre") {
      const permissionBoundary = String(
        raw?.permission_boundary ?? raw?.permissionBoundary
        ?? raw?.data?.permission_boundary ?? raw?.data?.permissionBoundary ?? "",
      ).trim().toLowerCase();
      if (["protected-action", "external-side-effect"].includes(permissionBoundary)) {
        event.permissionBoundary = permissionBoundary;
      }
      if (raw?.protected_action === true || raw?.protectedAction === true
        || raw?.data?.protected_action === true || raw?.data?.protectedAction === true) event.protectedAction = true;
      if (raw?.external_side_effect === true || raw?.externalSideEffect === true
        || raw?.data?.external_side_effect === true || raw?.data?.externalSideEffect === true) event.externalSideEffect = true;
      if (raw?.permission_escalated === true || raw?.permissionEscalated === true
        || raw?.data?.permission_escalated === true || raw?.data?.permissionEscalated === true) event.permissionEscalated = true;
    }
    if (typeof raw?.success === "boolean") {
      event.success = raw.success;
    } else if (typeof raw?.data?.success === "boolean") {
      event.success = raw.data.success;
    } else if (["success", "succeeded", "ok"].includes(String(raw?.status ?? raw?.data?.status ?? "").toLowerCase())) {
      event.success = true;
    } else if (["failure", "failed", "error", "timeout"].includes(String(raw?.status ?? raw?.data?.status ?? "").toLowerCase())) {
      event.success = false;
    } else if (event.lifecyclePhase === "post" && ["SUCCESS", "SUCCEEDED", "OK"].includes(permissionAction)) {
      event.success = true;
    } else if (event.lifecyclePhase === "post" && ["FAILURE", "FAILED", "ERROR", "TIMEOUT"].includes(permissionAction)) {
      event.success = false;
    }
    if (raw?.error || raw?.data?.error) {
      event.hasError = true;
    }
    if (type === "PostToolUseFailure") {
      event.success = false;
    }
    if (event.lifecyclePhase === "result" || event.lifecyclePhase === "post") {
      const output = toolOutputText(raw);
      const resultFacts = parseResultFacts(output.slice(-8_192));
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
    if (text) {
      event.contentLength = text.length;
    }
    if (options.includeContent && text) {
      event.content = text;
    }
    if (options.includeUserText && (type === "user" || type === "last-prompt" || type === "UserPromptSubmit")) {
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
    const filePath = hasFilePathSemantics(toolName) ? inferFilePath(raw) : null;
    if (filePath) {
      event.filePath = filePath;
    }

    return event;
  }

  async readSession(session, scope, options = {}) {
    const events = [];
    const includeContent = parseBooleanFlag(options["include-content"] ?? options.includeContent ?? false);
    const includeCommandText = parseBooleanFlag(options["include-command-text"] ?? options.includeCommandText ?? false);
    const includeUserText = parseBooleanFlag(options["include-user-text"] ?? options.includeUserText ?? false);
    const refs = session.sourceRefs ?? [];

    for (const ref of refs) {
      if (ref.kind === "audit-jsonl") {
        await this.readAuditEvents(session.sessionId, scope, ref, events, { includeContent, includeCommandText, includeUserText });
      } else if (ref.kind === "project-state") {
        await this.readStateEvent(session.sessionId, ref, events, { includeContent, includeCommandText, includeUserText });
      } else if (ref.path.endsWith(JSONL_EXT)) {
        await this.readJsonlEvents(session.sessionId, ref, events, { includeContent, includeCommandText, includeUserText });
      }
    }

    return events
      .map((event) => event.cwd ? event : { ...event, cwd: scope.workspace })
      .filter((event) => withinTimeRange(event.timestamp, scope))
      .sort((a, b) => {
        const left = timestampMillis(a.timestamp) ?? 0;
        const right = timestampMillis(b.timestamp) ?? 0;
        if (left !== right) {
          return left - right;
        }
        return (a.evidenceRef.line ?? a.evidenceRef.seq ?? 0) - (b.evidenceRef.line ?? b.evidenceRef.seq ?? 0);
      });
  }

  async readJsonlEvents(sessionId, ref, events, options) {
    await forEachJsonLine(ref.path, (raw, line) => {
      const sourceRef = { ...ref, line, sessionId };
      const rawSessionId = inferSessionId(raw, sourceRef);
      if (rawSessionId && rawSessionId !== sessionId && ref.kind !== "logs-session") {
        return;
      }
      events.push(this.normalizeEvent(raw, sourceRef, options));
    });
  }

  async readAuditEvents(sessionId, scope, ref, events, options) {
    await forEachJsonLine(ref.path, (raw, line) => {
      if (inferSessionId(raw) !== sessionId || !isWorkspaceMatch(inferCwd(raw), scope.workspace)) {
        return;
      }
      const sourceRef = { ...ref, line, sessionId };
      events.push(this.normalizeEvent(raw, sourceRef, options));
    });
  }

  async readStateEvent(sessionId, ref, events, options) {
    const raw = await readJson(ref.path).catch(() => null);
    if (!raw) {
      return;
    }
    const sourceRef = {
      ...ref,
      sessionId,
      eventType: "session.state",
      timestamp: normalizeTimestamp(raw.updatedAt ?? raw.createdAt),
    };
    events.push(this.normalizeEvent({ ...raw, type: "session.state" }, sourceRef, options));
  }

  async analyze(options = {}) {
    const factsMode = options.command === "facts";
    const factsContext = factsMode ? createFactsRunContext(options, "qoder") : null;
    if (factsContext) options = factsContext.options;
    const result = await super.analyze(options);
    if (options.command === "sources") {
      return result;
    }
    if (options.command === "sessions") {
      const limit = options.limit === undefined ? null : Number(options.limit);
      return {
        ...result,
        sessions: Number.isFinite(limit) ? result.sessions.slice(0, limit) : result.sessions,
      };
    }

    const scope = await this.resolveScope(options);
    const factsInventory = factsMode
      ? prepareFactsSessionInventory(result.sessions, factsContext)
      : { sessions: result.sessions, omitted: {} };
    const selectableSessions = factsInventory.sessions;
    const selectionEntries = !factsMode && (options.selectionEntries ?? (
      options.selectionPlan
        ? await collectSessionSelectionEntries({
            analyzer: this,
            sessions: selectableSessions,
            scope,
            concurrency: options.selectionConcurrency ?? options["selection-concurrency"] ?? 4,
          })
        : null
    ));
    const selection = !factsMode && options.selectionPlan
      ? selectSessionEntriesWithPlan(selectionEntries, options.selectionPlan)
      : selectSessions(selectableSessions, {
          limit: factsMode ? factsHydrationLimit(options.limit) : options.limit,
          strategy: factsMode ? options.selection ?? "stratified" : options.selection,
          defaultLimit: factsMode ? 5 : DEFAULT_LIMIT,
        });
    const sessions = selection.sessions;
    const detailedSessions = [];
    const allEvents = [];

    const insightMode = options.command === "insights";
    const fileReadMode = options.command === "file-reads";
    const eventOptions =
      options.command === "facets" || insightMode || fileReadMode || factsMode
        ? { ...options, includeCommandText: true, includeUserText: true }
        : options;

    for (const session of sessions) {
      const events = await this.readSession(session, scope, eventOptions);
      allEvents.push(...events);
      detailedSessions.push(this.mergeSession(events, session));
    }

    if (factsMode) {
      return buildSessionCoreFacts({
        scope,
        events: allEvents,
        selection,
        warnings: result.warnings,
        omitted: factsInventory.omitted,
        episodeLimit: options["episode-limit"] ?? options.episodeLimit ?? options.limit,
        debug: parseBooleanFlag(options.debug ?? false),
      });
    }

    if (fileReadMode) {
      const { facets: _unusedFacets, ...baseResult } = result;
      return {
        ...baseResult,
        sessions: detailedSessions,
        fileReads: buildFileReadDiagnostics({
          scope: result.scope,
          indexedSessions: result.sessions,
          sessions: detailedSessions,
          warnings: result.warnings,
          events: allEvents,
        }),
      };
    }

    const facets = buildFacets(result.sessions, detailedSessions, allEvents);
    if (insightMode) {
      const pricingTable = options["pricing-table"] ? await readJson(path.resolve(options["pricing-table"])) : undefined;
      return {
        ...result,
        sessions: detailedSessions,
        selection: selectionSummary(selection),
        facets,
        insights: buildInsightPack({
          scope: result.scope,
          sources: result.sources,
          sessions: detailedSessions,
          facets,
          warnings: result.warnings,
          events: allEvents,
          selectionStrategy: selection.strategy,
          selectionStrata: selection.strata,
          adapterVersion: "qoder-v2",
          usageOptions: { pricingTable },
        }),
      };
    }

    return {
      ...result,
      sessions: detailedSessions,
      selection: selectionSummary(selection),
      facets,
    };
  }
}

function buildFacets(indexedSessions, detailedSessions, events) {
  const sourceCoverage = {};
  for (const session of indexedSessions) {
    for (const kind of session.sourceKinds) {
      sourceCoverage[kind] = (sourceCoverage[kind] ?? 0) + 1;
    }
  }

  const messageCounts = summarizeEvents(events).messageCounts;
  const invocationEvents = events.filter((event) => event.lifecyclePhase !== "pre");
  const hookRuntime = buildHookRuntime(events);
  const timeRange = { firstSeen: null, lastSeen: null };
  for (const session of detailedSessions.length > 0 ? detailedSessions : indexedSessions) {
    mergeTimeRange(timeRange, session.firstSeen);
    mergeTimeRange(timeRange, session.lastSeen);
  }

  return {
    sessionCount: indexedSessions.length,
    analyzedSessionCount: detailedSessions.length,
    sourceCoverage,
    timeRange,
    messageCounts,
    topEventTypes: topCountEntries(invocationEvents, (event) => event.type),
    topTools: topCountEntries(invocationEvents, (event) => event.toolName),
    topHooks: topCountEntries(hookRuntime.executionEvents, (event) => event.hookName),
    topHookCommands: topCountEntries(hookRuntime.executionEvents, (event) =>
      event.hookName && event.hookCommand ? `${event.hookName} -> ${event.hookCommand}` : null,
    ),
    hookRuntime: hookRuntime.summary,
    topSkills: topSkillEntries(events),
    topModels: topCountEntries(events, (event) => event.model),
    planningSignals: topPlanningSignals(events, { platform: "qoder" }),
    lifecycleDemandSignals: topLifecycleDemandSignals(events, { platform: "qoder" }),
    longSessions: buildLongSessionFacet(detailedSessions, events),
  };
}

function hookEventOrder(left, right) {
  const leftTime = timestampMillis(left.timestamp) ?? 0;
  const rightTime = timestampMillis(right.timestamp) ?? 0;
  return leftTime - rightTime || Number(left.evidenceRef?.seq ?? left.evidenceRef?.line ?? 0) - Number(right.evidenceRef?.seq ?? right.evidenceRef?.line ?? 0);
}

function hookIdentityMatches(started, finished) {
  if (finished.hookSource && finished.hookIndex !== undefined) {
    return started.hookSource === finished.hookSource && started.hookIndex === finished.hookIndex;
  }
  return false;
}

function percentile(values, percentileValue) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[index];
}

function aggregateHookRecords(records, keyFn) {
  const groups = new Map();
  for (const record of records) {
    const key = keyFn(record);
    if (!key) continue;
    const group = groups.get(key) ?? { key, records: [] };
    group.records.push(record);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => {
      const durations = group.records.map((item) => item.durationMs).filter(Number.isFinite);
      return {
        name: group.key,
        executions: group.records.length,
        successes: group.records.filter((item) => item.success === true).length,
        failures: group.records.filter((item) => item.success === false).length,
        durationSamples: durations.length,
        p50Ms: percentile(durations, 0.5),
        p95Ms: percentile(durations, 0.95),
        maxMs: durations.length > 0 ? Math.max(...durations) : null,
        evidenceRefs: group.records.flatMap((item) => item.evidenceRef ? [item.evidenceRef] : []).slice(0, 5),
      };
    })
    .sort((left, right) => right.executions - left.executions || left.name.localeCompare(right.name));
}

function buildHookRuntime(events) {
  const hookEvents = events
    .filter((event) => event.type === "hook.started" || event.type === "hook.finished")
    .sort(hookEventOrder);
  const pending = new Map();
  const ambiguousRemaining = new Map();
  const finishedRecords = [];
  let ambiguousCompletions = 0;

  for (const event of hookEvents) {
    const hookName = event.hookName ?? "unknown-hook";
    if (event.type === "hook.started") {
      const starts = pending.get(hookName) ?? [];
      starts.push(event);
      pending.set(hookName, starts);
      continue;
    }

    const starts = pending.get(hookName) ?? [];
    let matched = null;
    let attribution = "group";
    let remaining = ambiguousRemaining.get(hookName) ?? 0;
    if (remaining > 0) {
      ambiguousRemaining.set(hookName, remaining - 1);
      ambiguousCompletions += 1;
    } else if (event.hookCommand) {
      const directIndex = starts.findIndex((started) =>
        hookIdentityMatches(started, event) || started.hookCommand === event.hookCommand
      );
      if (directIndex !== -1) {
        starts.splice(directIndex, 1);
      }
      attribution = "command";
    } else {
      const stableIndex = starts.findIndex((started) => hookIdentityMatches(started, event));
      if (stableIndex !== -1) {
        matched = starts.splice(stableIndex, 1)[0];
        attribution = "command";
      } else if (starts.length === 1) {
        matched = starts.shift();
        attribution = "command";
      } else if (starts.length > 1) {
        ambiguousRemaining.set(hookName, starts.length - 1);
        starts.splice(0, starts.length);
        ambiguousCompletions += 1;
      }
    }
    pending.set(hookName, starts);
    finishedRecords.push({
      hookName,
      hookCommand: event.hookCommand ?? matched?.hookCommand ?? null,
      attribution,
      durationMs: event.hookDurationMs,
      success: event.success,
      evidenceRef: event.evidenceRef,
    });
  }

  const startedWithoutFinish = [...pending.values()].flat();
  const executionEvents = [
    ...finishedRecords.map((record) => ({
      hookName: record.hookName,
      hookCommand: record.attribution === "command" ? record.hookCommand : null,
      evidenceRef: record.evidenceRef,
    })),
    ...startedWithoutFinish.map((event) => ({
      hookName: event.hookName,
      hookCommand: event.hookCommand ?? null,
      evidenceRef: event.evidenceRef,
    })),
  ];
  const commandRecords = finishedRecords.filter((record) => record.attribution === "command" && record.hookCommand);
  return {
    executionEvents,
    summary: {
      finishedExecutions: finishedRecords.length,
      startedWithoutFinish: startedWithoutFinish.length,
      ambiguousCompletions,
      groups: aggregateHookRecords(finishedRecords, (record) => record.hookName),
      commands: aggregateHookRecords(commandRecords, (record) => `${record.hookName} -> ${record.hookCommand}`),
    },
  };
}

function createAnalyzer(platform) {
  if ((platform ?? DEFAULT_PLATFORM) === "qoder") {
    return new QoderSessionAnalyzer();
  }
  throw new Error(`Unsupported platform: ${platform}. Only qoder is implemented in this version.`);
}

function markdownTable(rows, columns) {
  const header = `| ${columns.map((column) => column.label).join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${columns.map((column) => String(column.value(row) ?? "")).join(" | ")} |`);
  return [header, divider, ...body].join("\n");
}

function formatMarkdown(command, result) {
  if (result?.kind === "session-core-facts") {
    const lines = ["# Session Core Facts", "", `Candidates: ${result.candidates.length}`];
    for (const candidate of result.candidates) {
      lines.push(`- ${candidate.ref}: ${candidate.request.summary}`);
    }
    return `${lines.join("\n")}\n`;
  }
  const lines = [`# Session Analysis: ${command}`, ""];
  lines.push(`Workspace: ${result.scope.workspace}`);
  lines.push(`Platform: ${result.scope.platform}`);
  lines.push("");

  if (command === "sources") {
    lines.push(
      markdownTable(result.sources, [
        { label: "Source", value: (row) => row.id },
        { label: "Kind", value: (row) => row.kind },
        { label: "Exists", value: (row) => row.exists },
        { label: "Enabled", value: (row) => row.enabled },
        { label: "Path", value: (row) => row.path },
      ]),
    );
  } else {
    lines.push(`Sessions: ${result.sessions.length}`);
    if (command !== "file-reads") {
      lines.push("");
      lines.push(
        markdownTable(result.sessions.slice(0, 50), [
          { label: "Session", value: (row) => row.sessionId },
          { label: "First", value: (row) => row.firstSeen ?? "" },
          { label: "Last", value: (row) => row.lastSeen ?? "" },
          { label: "Sources", value: (row) => row.sourceKinds.join(",") },
        ]),
      );
    }
  }

  if (result.facets) {
    lines.push("");
    lines.push("## Facets");
    lines.push("");
    lines.push(`Analyzed sessions: ${result.facets.analyzedSessionCount}`);
    lines.push(`Message counts: ${JSON.stringify(result.facets.messageCounts)}`);
    lines.push(`Top event types: ${result.facets.topEventTypes.map((item) => `${item.name}=${item.count}`).join(", ")}`);
    if (result.facets.topTools?.length > 0) {
      lines.push(`Top tools: ${result.facets.topTools.map((item) => `${item.name}=${item.count}`).join(", ")}`);
    }
    if (result.facets.topHooks?.length > 0) {
      lines.push(`Top hooks: ${result.facets.topHooks.map((item) => `${item.name}=${item.count}`).join(", ")}`);
    }
    if (result.facets.topSkills?.length > 0) {
      lines.push(`Top skills: ${result.facets.topSkills.map((item) => `${item.name}=${item.count}`).join(", ")}`);
    }
    if (result.facets.topHookCommands?.length > 0) {
      lines.push(`Top hook commands: ${result.facets.topHookCommands.map((item) => `${item.name}=${item.count}`).join(", ")}`);
    }
    if (result.facets.topModels?.length > 0) {
      lines.push(`Top models: ${result.facets.topModels.map((item) => `${item.name}=${item.count}`).join(", ")}`);
    }
    if (result.facets.planningSignals?.length > 0) {
      lines.push(
        `Planning signals: ${result.facets.planningSignals
          .map((item) => `${item.host}:${item.kind}:${item.name}:${item.scope}=${item.count}`)
          .join(", ")}`,
      );
    }
  }

  if (result.insights) {
    lines.push("");
    lines.push("## Insights");
    lines.push("");
    lines.push(`Insight cards: ${result.insights.cards.length}`);
    lines.push(`Sample confidence: ${result.insights.sample.confidence}`);
    lines.push(
      `Validation command signals: ${result.insights.keySignals.validation.commandMatches.map((item) => `${item.name}=${item.count}`).join(", ")}`,
    );
    lines.push(
      `Validation mention signals: ${result.insights.keySignals.validation.userMentions.map((item) => `${item.name}=${item.count}`).join(", ")}`,
    );
    if (result.insights.keySignals.planningSignals?.length > 0) {
      lines.push(
        `Planning insight signals: ${result.insights.keySignals.planningSignals
          .map((item) => `${item.host}:${item.kind}:${item.name}:${item.scope}=${item.count}`)
          .join(", ")}`,
      );
    }
  }

  if (result.fileReads) {
    lines.push("");
    lines.push("## File Reads");
    lines.push("");
    lines.push(`Analyzed sessions: ${result.fileReads.sample.analyzedSessionCount}`);
    lines.push(`File access events: ${result.fileReads.sample.fileAccessCount}`);
    lines.push(`Read-after-write failures: ${result.fileReads.diagnostics.readAfterWriteFailureCount}`);
    lines.push(`Wrong relative doc paths: ${result.fileReads.diagnostics.wrongRelativePathCount}`);
    if (result.fileReads.topFiles.length > 0) {
      lines.push("");
      lines.push(
        markdownTable(result.fileReads.topFiles.slice(0, 20), [
          { label: "Path", value: (row) => row.path },
          { label: "Reads", value: (row) => row.readCount },
          { label: "Edits", value: (row) => row.editCount },
          { label: "Issue score", value: (row) => row.issueScore },
          { label: "Reasons", value: (row) => row.reasons.join(",") },
        ]),
      );
    }
    if (result.fileReads.issueCandidates.length > 0) {
      lines.push("");
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
    lines.push("");
    lines.push("## Warnings");
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
  const platform = options.platform ?? DEFAULT_PLATFORM;
  const analyzer = createAnalyzer(platform);
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
    const result = await analyzer.analyze({ ...commandOptions, limit: 1 });
    const scope = await analyzer.resolveScope(commandOptions);
    const sessions = [];
    for (const session of result.sessions) {
      const events = await analyzer.readSession(session, scope, commandOptions);
      const merged = analyzer.mergeSession(events, session);
      sessions.push({
        ...merged,
        events: command === "show" && !parseBooleanFlag(options["include-events"] ?? false) ? undefined : events,
      });
    }
    return command === "events" ? filterEvents({ ...result, sessions }, options.type) : { ...result, sessions };
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
    process.stderr.write(`session-analysis failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}

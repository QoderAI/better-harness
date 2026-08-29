#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { SessionAnalyzer } from "../analyzer.mjs";
import { parseArgs, parseBooleanFlag } from "../cli.mjs";
import { pathExists, pathStat, readJson, walkFiles } from "../fs.mjs";
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
import {
  additiveUsageAccounting,
  collapseDuplicateResponseRecords,
  promptContextTokens,
} from "../usage-records.mjs";
import { WORKSPACE_CWD_MATCH, classifyWorkspaceCwd } from "../workspace-match.mjs";

const MAX_SESSION_FILES = 20_000;
const MAX_SESSION_FILE_BYTES = 64 * 1024 * 1024;
const WINDOWS_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/u;

function pathFlavor(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) return null;
  if (WINDOWS_ABSOLUTE.test(value)) return "win32";
  if (path.posix.isAbsolute(value)) return "posix";
  return null;
}

function normalizeAbsolutePath(value, flavor) {
  if (pathFlavor(value) !== flavor) return null;
  const api = flavor === "win32" ? path.win32 : path.posix;
  const normalized = api.normalize(value);
  const root = api.parse(normalized).root;
  const withoutTrailing = normalized === root
    ? normalized
    : normalized.replace(flavor === "win32" ? /[\\/]+$/u : /\/+$/u, "");
  return flavor === "win32" ? withoutTrailing.toLowerCase() : withoutTrailing;
}

function pathIsWithin(workspace, candidate) {
  const flavor = pathFlavor(workspace);
  if (!flavor || pathFlavor(candidate) !== flavor) return false;
  const api = flavor === "win32" ? path.win32 : path.posix;
  const normalizedWorkspace = normalizeAbsolutePath(workspace, flavor);
  const normalizedCandidate = normalizeAbsolutePath(candidate, flavor);
  if (!normalizedWorkspace || !normalizedCandidate) return false;
  const relative = api.relative(normalizedWorkspace, normalizedCandidate);
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${api.sep}`) && !api.isAbsolute(relative));
}

function isScopedWorkspaceMatch(candidate, scope) {
  if (scope?._workspaceMatchScope) {
    return classifyWorkspaceCwd(candidate, scope._workspaceMatchScope) !== WORKSPACE_CWD_MATCH.UNMATCHED;
  }
  return pathIsWithin(scope.workspace, candidate);
}

function finiteNonNegative(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return undefined;
}

function normalizedWorkspaceOption(value) {
  const expanded = expandHome(value ?? process.cwd());
  return WINDOWS_ABSOLUTE.test(expanded) ? path.win32.normalize(expanded) : normalizeWorkspace(expanded);
}

function normalizedUsage(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const observed = {};
  for (const [field, value] of [
    ["inputTokens", finiteNonNegative(raw.input_tokens, raw.inputTokens)],
    ["outputTokens", finiteNonNegative(raw.output_tokens, raw.outputTokens, raw.assistant_response_tokens)],
    ["cacheReadInputTokens", finiteNonNegative(raw.cache_read_input_tokens, raw.cacheReadInputTokens)],
    ["cacheCreationInputTokens", finiteNonNegative(raw.cache_creation_input_tokens, raw.cacheCreationInputTokens)],
  ]) {
    if (value !== undefined) observed[field] = value;
  }
  return Object.keys(observed).length > 0 ? observed : null;
}

function textNodeContent(node) {
  return typeof node?.text_node?.content === "string" ? node.text_node.content : "";
}

function exchangeRequestText(exchange) {
  const nodes = Array.isArray(exchange?.request_nodes) ? exchange.request_nodes : [];
  const parts = nodes.map(textNodeContent).filter(Boolean);
  if (parts.length > 0) return parts.join("\n").trim();
  return typeof exchange?.request_message === "string" ? exchange.request_message.trim() : "";
}

function exchangeResponseText(exchange) {
  const nodes = Array.isArray(exchange?.response_nodes) ? exchange.response_nodes : [];
  const parts = nodes
    .filter((node) => node?.type === 0 && typeof node?.content === "string")
    .map((node) => node.content)
    .filter(Boolean);
  if (parts.length > 0) return parts.join("\n").trim();
  return typeof exchange?.response_text === "string" ? exchange.response_text.trim() : "";
}

function nodeTimestamp(node) {
  return normalizeTimestamp(
    node?.timestamp_ms
      ?? node?.tool_use?.started_at_ms
      ?? node?.tool_use?.completed_at_ms
      ?? null,
  );
}

function exchangeTimestamp(entry, { end = false } = {}) {
  const exchange = entry?.exchange ?? {};
  const nodes = [
    ...(Array.isArray(exchange.request_nodes) ? exchange.request_nodes : []),
    ...(Array.isArray(exchange.response_nodes) ? exchange.response_nodes : []),
  ];
  const times = nodes.map((node) => timestampMillis(nodeTimestamp(node))).filter(Number.isFinite);
  if (times.length > 0) return new Date(end ? Math.max(...times) : Math.min(...times)).toISOString();
  return normalizeTimestamp(entry?.finishedAt ?? entry?.finished_at ?? null);
}

function workspaceEvidence(record) {
  const workspaceRoots = new Set();
  const terminalCwds = new Set();
  for (const entry of Array.isArray(record?.chatHistory) ? record.chatHistory : []) {
    const requestNodes = Array.isArray(entry?.exchange?.request_nodes) ? entry.exchange.request_nodes : [];
    for (const node of requestNodes) {
      const ideState = node?.ide_state_node;
      if (!ideState || typeof ideState !== "object") continue;
      for (const folder of Array.isArray(ideState.workspace_folders) ? ideState.workspace_folders : []) {
        for (const candidate of [folder?.folder_root, folder?.repository_root]) {
          if (typeof candidate === "string" && pathFlavor(candidate)) workspaceRoots.add(candidate);
        }
      }
      const cwd = ideState?.current_terminal?.current_working_directory;
      if (typeof cwd === "string" && pathFlavor(cwd)) terminalCwds.add(cwd);
    }
  }
  return { workspaceRoots: [...workspaceRoots], terminalCwds: [...terminalCwds] };
}

function qualifiedWorkspaceCandidates(record, scope) {
  const evidence = workspaceEvidence(record);
  const candidates = evidence.workspaceRoots.length > 0 ? evidence.workspaceRoots : evidence.terminalCwds;
  if (candidates.length === 0) return [];
  const matching = candidates.filter((candidate) => isScopedWorkspaceMatch(candidate, scope));
  return matching.length === candidates.length ? matching : [];
}

function evidenceRef(sourceRef, type, exchangeIndex, seq = null) {
  return {
    kind: sourceRef.kind,
    path: sourceRef.path,
    line: exchangeIndex + 1,
    seq,
    type,
  };
}

function parseToolInput(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string" || value.length === 0) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function inferFilePath(toolName, input = {}) {
  if (!/(?:read|edit|write|file|notebook|patch)/iu.test(String(toolName ?? ""))) return null;
  return input.file_path ?? input.filePath ?? input.path ?? input.target_path ?? input.targetPath ?? null;
}

function inferCommandText(toolName, input = {}) {
  if (!/(?:bash|shell|exec|terminal|run|command)/iu.test(String(toolName ?? ""))) return null;
  return input.command ?? input.cmd ?? input.script ?? null;
}

function metadataEvent(base, sourceRef, exchangeIndex, node, lane) {
  const rawType = Number.isFinite(Number(node?.type)) ? String(Number(node.type)) : "unknown";
  return {
    ...base,
    type: `metadata.augment.${lane}-node-${rawType}`,
    category: "metadata",
    evidenceRef: evidenceRef(sourceRef, `metadata.augment.${lane}-node-${rawType}`, exchangeIndex, node?.id ?? null),
    summary: `Augment ${lane} node ${rawType}`,
  };
}

function usageEvent(node, base, sourceRef, exchangeIndex, requestId) {
  const usage = normalizedUsage(node?.token_usage);
  if (!usage) return null;
  const promptTokens = promptContextTokens(usage);
  const windowTokens = finiteNonNegative(node?.token_usage?.max_context_tokens, node?.token_usage?.maxContextTokens);
  return {
    ...base,
    timestamp: nodeTimestamp(node) ?? base.timestamp,
    type: "model.response.completed",
    category: "model",
    modelUsage: usage,
    modelInvocationUsage: usage,
    usageFieldsObserved: true,
    usageBasis: "model-inference",
    usageSource: "augment-session-json",
    ...additiveUsageAccounting(usage),
    ...(promptTokens !== null ? {
      currentContextUsage: {
        usedTokens: promptTokens,
        ...(windowTokens !== undefined && windowTokens > 0 ? { windowTokens } : {}),
        basis: "prompt-tokens",
        source: "augment-session-json",
        rawTextOmitted: true,
      },
    } : {}),
    responseId: `${requestId ?? `exchange-${exchangeIndex + 1}`}:usage-${node?.id ?? "unknown"}`,
    evidenceRef: evidenceRef(sourceRef, "model.response.completed", exchangeIndex, node?.id ?? null),
    summary: "Augment model response completed",
  };
}

function compactionEvent(node, base, sourceRef, exchangeIndex) {
  return {
    ...base,
    timestamp: nodeTimestamp(node) ?? base.timestamp,
    type: "compacted",
    category: "metadata",
    compactionBoundary: true,
    usageProgressionExcluded: true,
    evidenceRef: evidenceRef(sourceRef, "compacted", exchangeIndex, node?.id ?? null),
    summary: "Augment history summary observed",
  };
}

function toolCallEvent(node, base, sourceRef, exchangeIndex, options) {
  const tool = node?.tool_use;
  if (!tool || typeof tool !== "object") return null;
  const toolName = tool.tool_name ?? "unknown-tool";
  const input = parseToolInput(tool.input_json);
  const timestamp = normalizeTimestamp(tool.started_at_ms) ?? nodeTimestamp(node) ?? base.timestamp;
  const event = {
    ...base,
    timestamp,
    type: "tool.call",
    category: "tool",
    lifecyclePhase: "request",
    toolName,
    toolInvocationId: tool.tool_use_id ?? null,
    evidenceRef: evidenceRef(sourceRef, "tool.call", exchangeIndex, node?.id ?? null),
    summary: `${toolName} request`,
  };
  const filePath = inferFilePath(toolName, input);
  const commandText = inferCommandText(toolName, input);
  if (filePath) event.filePath = filePath;
  if (options.includeCommandText && commandText) event.commandText = commandText;
  return event;
}

function toolResultEvent(node, base, sourceRef, exchangeIndex) {
  const result = node?.tool_result_node;
  if (!result || typeof result !== "object") return null;
  const success = result.is_error !== true;
  const event = {
    ...base,
    type: "tool.result",
    category: "tool",
    lifecyclePhase: "result",
    toolInvocationId: result.tool_use_id ?? null,
    success,
    hasError: !success,
    evidenceRef: evidenceRef(sourceRef, "tool.result", exchangeIndex, node?.id ?? null),
    summary: success ? "tool result" : "tool result failed",
  };
  const facts = parseResultFacts(String(result.content ?? "").slice(-8_192));
  if (facts) event.resultFacts = facts;
  return event;
}

function transcriptEvents(record, sourceRef, options = {}) {
  const events = [];
  const history = Array.isArray(record?.chatHistory) ? record.chatHistory : [];
  const sessionId = typeof record?.sessionId === "string" ? record.sessionId : sourceRef.sessionId;
  for (const [exchangeIndex, entry] of history.entries()) {
    const exchange = entry?.exchange ?? {};
    const requestNodes = Array.isArray(exchange.request_nodes) ? exchange.request_nodes : [];
    const responseNodes = Array.isArray(exchange.response_nodes) ? exchange.response_nodes : [];
    const startTimestamp = exchangeTimestamp(entry);
    const endTimestamp = exchangeTimestamp(entry, { end: true }) ?? startTimestamp;
    const base = {
      sessionId,
      timestamp: startTimestamp,
      sourceKind: sourceRef.kind,
      planningScope: "workspace",
      cwd: sourceRef.cwd ?? null,
      isSubagent: null,
    };

    const requestText = exchangeRequestText(exchange);
    if (requestText) {
      events.push({
        ...base,
        type: "user",
        category: "user",
        userPrompt: true,
        contentLength: requestText.length,
        ...(options.includeUserText ? { userText: requestText } : {}),
        ...(options.includeContent ? { content: requestText } : {}),
        evidenceRef: evidenceRef(sourceRef, "user", exchangeIndex),
        summary: `user message (${requestText.length} chars)`,
      });
    }

    const responseText = exchangeResponseText(exchange);
    if (responseText) {
      events.push({
        ...base,
        timestamp: endTimestamp,
        type: "assistant",
        category: "assistant",
        userVisibleAssistantMessage: true,
        contentLength: responseText.length,
        ...(options.includeContent ? { content: responseText } : {}),
        evidenceRef: evidenceRef(sourceRef, "assistant", exchangeIndex),
        summary: `assistant message (${responseText.length} chars)`,
      });
    }

    for (const node of requestNodes) {
      if (node?.history_summary_node && typeof node.history_summary_node === "object") {
        events.push(compactionEvent(node, base, sourceRef, exchangeIndex));
        continue;
      }
      const resultEvent = toolResultEvent(node, base, sourceRef, exchangeIndex);
      if (resultEvent) {
        events.push(resultEvent);
      } else if (node?.text_node || node?.ide_state_node || node?.image_node) {
        // The aggregate user event and workspace probe own these known nodes.
      } else {
        events.push(metadataEvent(base, sourceRef, exchangeIndex, node, "request"));
      }
    }

    for (const node of responseNodes) {
      if (node?.history_summary_node && typeof node.history_summary_node === "object") {
        events.push(compactionEvent(node, { ...base, timestamp: endTimestamp }, sourceRef, exchangeIndex));
        continue;
      }
      const usage = usageEvent(node, base, sourceRef, exchangeIndex, exchange.request_id);
      if (usage) {
        events.push(usage);
        continue;
      }
      const call = toolCallEvent(node, base, sourceRef, exchangeIndex, options);
      if (call) {
        events.push(call);
        continue;
      }
      if (node?.type === 0 && typeof node?.content === "string") continue;
      if (node?.thinking) {
        events.push({
          ...metadataEvent(base, sourceRef, exchangeIndex, node, "response"),
          type: "metadata.augment.thinking",
          evidenceRef: evidenceRef(sourceRef, "metadata.augment.thinking", exchangeIndex, node?.id ?? null),
          summary: "Augment thinking observed",
        });
        continue;
      }
      events.push(metadataEvent(base, sourceRef, exchangeIndex, node, "response"));
    }
  }
  return events;
}

function diagnostics(scope) {
  scope._augmentDiagnostics ??= { malformedFiles: 0, oversizedFiles: 0, identityDriftFiles: 0 };
  return scope._augmentDiagnostics;
}

async function readBoundedSession(filePath, scope) {
  const stat = await pathStat(filePath);
  if (!stat?.isFile()) return null;
  if (stat.size > MAX_SESSION_FILE_BYTES) {
    diagnostics(scope).oversizedFiles += 1;
    return null;
  }
  try {
    return await readJson(filePath);
  } catch {
    diagnostics(scope).malformedFiles += 1;
    return null;
  }
}

async function probeSession(filePath, scope) {
  const record = await readBoundedSession(filePath, scope);
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  const filenameId = path.basename(filePath, ".json");
  const sessionId = typeof record.sessionId === "string" && record.sessionId.length > 0
    ? record.sessionId
    : filenameId;
  if (record.sessionId && record.sessionId !== filenameId) diagnostics(scope).identityDriftFiles += 1;
  const candidates = qualifiedWorkspaceCandidates(record, scope);
  if (candidates.length === 0) return null;
  const range = { firstSeen: null, lastSeen: null };
  mergeTimeRange(range, normalizeTimestamp(record.created));
  mergeTimeRange(range, normalizeTimestamp(record.modified));
  for (const entry of Array.isArray(record.chatHistory) ? record.chatHistory : []) {
    mergeTimeRange(range, exchangeTimestamp(entry));
    mergeTimeRange(range, exchangeTimestamp(entry, { end: true }));
  }
  return { sessionId, ...range, candidates };
}

function finalizedSession(probe, workspace, sourceRef) {
  return bindSessionWorkspaceCwds({
    sessionId: probe.sessionId,
    workspace,
    firstSeen: probe.firstSeen,
    lastSeen: probe.lastSeen,
    sourceKinds: [sourceRef.kind],
    sourceRefs: [sourceRef],
  }, probe.candidates);
}

function dedupeEvents(events) {
  return collapseDuplicateResponseRecords(events, {
    canonical: "first",
    dropSyntheticRecords: true,
    countDiagnostics: true,
  });
}

export class AugmentSessionAnalyzer extends SessionAnalyzer {
  currentSessionId() {
    return null;
  }

  async resolveScope(options = {}) {
    const since = normalizeCliDate(options.since, false);
    const until = normalizeCliDate(options.until, true);
    const workspace = normalizedWorkspaceOption(options.workspace);
    const home = path.resolve(expandHome(
      options.home ?? options.augmentHome ?? options["augment-home"] ?? "~/.augment",
    ));
    return {
      platform: "augment",
      workspace,
      home,
      sessionsDir: path.join(home, "sessions"),
      since: since.label,
      sinceTime: since.time,
      until: until.label,
      untilTime: until.time,
      sessionId: options["session-id"] ?? options.sessionId ?? options._?.[0] ?? null,
      includeGlobalCapabilities: parseBooleanFlag(options["include-global-capabilities"] ?? false),
      _workspaceMatchScope: workspaceMatchScopeFromOptions(options),
      _augmentDiagnostics: { malformedFiles: 0, oversizedFiles: 0, identityDriftFiles: 0 },
    };
  }

  async discoverSourceRoots(scope) {
    return [{
      id: "augment-sessions",
      kind: "augment-session-json",
      role: "session-transcript",
      path: scope.sessionsDir,
      optional: false,
      enabled: true,
      workspaceScoped: true,
      coverage: "primary",
      exists: await pathExists(scope.sessionsDir),
    }];
  }

  async discoverSessions(scope, roots) {
    const root = roots.find((candidate) => candidate.kind === "augment-session-json");
    if (!root?.exists) return [];
    const files = await walkFiles(root.path, {
      maxDepth: 0,
      limit: MAX_SESSION_FILES,
      match: (file) => file.endsWith(".json") && !file.endsWith(".tmp"),
    });
    const sessions = [];
    for (const filePath of files) {
      const probe = await probeSession(filePath, scope);
      if (!probe || !withinTimeRange(probe.lastSeen ?? probe.firstSeen, scope)) continue;
      sessions.push(finalizedSession(probe, scope.workspace, {
        kind: root.kind,
        role: root.role,
        path: filePath,
        firstSeen: probe.firstSeen,
        lastSeen: probe.lastSeen,
        cwd: probe.candidates[0] ?? null,
      }));
    }
    return sessions.sort((left, right) =>
      (timestampMillis(right.lastSeen) ?? 0) - (timestampMillis(left.lastSeen) ?? 0));
  }

  normalizeEvent(raw, sourceRef, options = {}) {
    return this.normalizeEvents(raw, sourceRef, options)[0] ?? null;
  }

  normalizeEvents(raw, sourceRef, options = {}) {
    return transcriptEvents(raw, sourceRef, options);
  }

  async readSession(session, scope, options = {}) {
    const events = [];
    let truncated = false;
    const identityCwd = sessionWorkspaceCwd(session, scope._workspaceMatchScope);
    for (const ref of session.sourceRefs ?? []) {
      const record = await readBoundedSession(ref.path, scope);
      if (!record) {
        truncated = true;
        continue;
      }
      const recordSessionId = typeof record.sessionId === "string" ? record.sessionId : path.basename(ref.path, ".json");
      if (recordSessionId !== session.sessionId) {
        truncated = true;
        continue;
      }
      const currentCandidates = qualifiedWorkspaceCandidates(record, scope);
      if (currentCandidates.length === 0) {
        truncated = true;
        continue;
      }
      for (const event of this.normalizeEvents(record, {
        ...ref,
        sessionId: session.sessionId,
        cwd: identityCwd ?? currentCandidates[0] ?? ref.cwd ?? null,
      }, options)) {
        if (withinTimeRange(event.timestamp, scope)) events.push(event);
      }
    }
    const sorted = dedupeEvents(events).sort((left, right) =>
      (timestampMillis(left.timestamp) ?? 0) - (timestampMillis(right.timestamp) ?? 0)
      || Number(left.evidenceRef?.line ?? 0) - Number(right.evidenceRef?.line ?? 0)
      || Number(left.evidenceRef?.seq ?? 0) - Number(right.evidenceRef?.seq ?? 0));
    return markSessionReadCoverage(sorted, { truncated });
  }

  async analysisWarnings(scope) {
    const observed = diagnostics(scope);
    return [
      ...(observed.malformedFiles > 0 ? [{
        code: "augment-session-malformed-json",
        message: `${observed.malformedFiles} Augment session file(s) were malformed and omitted.`,
        source: "augment-sessions",
      }] : []),
      ...(observed.oversizedFiles > 0 ? [{
        code: "augment-session-file-too-large",
        message: `${observed.oversizedFiles} Augment session file(s) exceeded the bounded read limit and were omitted.`,
        source: "augment-sessions",
      }] : []),
      ...(observed.identityDriftFiles > 0 ? [{
        code: "augment-session-identity-drift",
        message: `${observed.identityDriftFiles} Augment session file(s) used a sessionId that differed from the filename.`,
        source: "augment-sessions",
      }] : []),
    ];
  }

  async analyze(options = {}) {
    return runProviderAnalysis(this, options, { platform: "augment", adapterVersion: "augment-v1" });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { command = "sessions", options } = parseArgs(argv);
  const analyzer = new AugmentSessionAnalyzer();
  const result = await runProviderCommand(analyzer, command, options);
  await emitProviderResult({ provider: "Augment", command, options, result });
  return result;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`augment session-analysis failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}

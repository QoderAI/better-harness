#!/usr/bin/env node

import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { SessionAnalyzer } from "../../session-analysis.mjs";
import { parseArgs, parseBooleanFlag } from "../cli.mjs";
import { forEachJsonLine, pathExists, walkFiles } from "../fs.mjs";
import { expandHome, normalizeWorkspace } from "../paths.mjs";
import { emitProviderResult, runProviderAnalysis, runProviderCommand } from "../provider-runner.mjs";
import { parseResultFacts } from "../result-facts.mjs";
import { mergeTimeRange, normalizeCliDate, normalizeTimestamp, timestampMillis, withinTimeRange } from "../time.mjs";

function isWorkspaceMatch(candidate, workspace) {
  if (!candidate) return false;
  const resolved = normalizeWorkspace(candidate);
  return resolved === workspace || resolved.startsWith(`${workspace}${path.sep}`);
}

export function workspaceToCursorSlugVariants(workspace) {
  const expanded = expandHome(workspace ?? process.cwd());
  const normalized = path.win32.isAbsolute(expanded) ? path.win32.normalize(expanded) : normalizeWorkspace(expanded);
  const hyphenated = normalized.replace(/:/g, "-").replace(/[\\/]+/g, "-");
  const colonless = normalized.replace(/:/g, "").replace(/[\\/]+/g, "-");
  return [...new Set([hyphenated.replace(/^-+/, ""), colonless.replace(/^-+/, ""), hyphenated, colonless])];
}

function transcriptSessionId(filePath) {
  return path.basename(filePath, ".jsonl");
}

function inferAuditSessionId(raw) {
  return raw?.session_id ?? raw?.conversation_id
    ?? (raw?.transcript_path ? path.basename(String(raw.transcript_path), ".jsonl") : null);
}

function inferTimestamp(raw) {
  return normalizeTimestamp(raw?._timestamp ?? raw?.timestamp ?? raw?.ts ?? null);
}

function textItems(raw) {
  const content = raw?.message?.content ?? raw?.content ?? null;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content : [];
}

function textFromItems(items) {
  return items.filter((item) => typeof item === "string" || item?.type === "text")
    .map((item) => typeof item === "string" ? item : item?.text ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();
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

function inferCommandText(toolName, input = {}, raw = {}) {
  if (!/(?:bash|shell|exec|terminal)/i.test(String(toolName ?? ""))
    && !raw?.command && !raw?.cmd) return null;
  return input.command ?? input.cmd ?? raw?.command ?? raw?.cmd ?? null;
}

function inferFilePath(toolName, input = {}, raw = {}) {
  if (!/(?:read|edit|write|file|notebook|search|grep)/i.test(String(toolName ?? ""))
    && !raw?.file_path && !raw?.filePath) return null;
  return input.file_path ?? input.filePath ?? input.path ?? raw?.file_path ?? raw?.filePath ?? null;
}

function inferUsage(raw) {
  const values = {
    inputTokens: raw?.input_tokens ?? raw?.inputTokens,
    outputTokens: raw?.output_tokens ?? raw?.outputTokens,
    cacheReadInputTokens: raw?.cache_read_tokens ?? raw?.cacheReadTokens,
    cacheCreationInputTokens: raw?.cache_write_tokens ?? raw?.cacheWriteTokens,
  };
  return Object.values(values).some((value) => value !== undefined)
    ? Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Number.isFinite(Number(value)) ? Number(value) : 0]))
    : null;
}

function transcriptEvents(raw, sourceRef, options) {
  const rowType = raw?.role ?? raw?.type ?? "record";
  const items = textItems(raw);
  const text = textFromItems(items);
  const events = [];
  const base = {
    sessionId: sourceRef.sessionId,
    timestamp: null,
    sourceKind: sourceRef.kind,
    planningScope: "workspace",
  };
  if (rowType === "user" || rowType === "assistant") {
    const event = {
      ...base,
      type: rowType,
      category: rowType,
      evidenceRef: evidenceRef(sourceRef, rowType),
      summary: text ? `${rowType} message (${text.length} chars)` : rowType,
      contentLength: text.length,
    };
    if (rowType === "user") {
      event.userPrompt = text.length > 0;
      if (options.includeUserText && text) event.userText = text;
    }
    if (rowType === "assistant" && text) event.userVisibleAssistantMessage = true;
    if (options.includeContent && text) event.content = text;
    events.push(event);
  } else if (rowType === "turn_ended") {
    const failed = Boolean(raw?.error) || ["failed", "error"].includes(String(raw?.status ?? "").toLowerCase());
    events.push({
      ...base,
      type: "turn.end",
      category: "turn",
      success: failed ? false : undefined,
      hasError: failed || undefined,
      evidenceRef: evidenceRef(sourceRef, "turn.end"),
      summary: failed ? "turn ended with error" : "turn ended",
    });
  }
  items.forEach((item, index) => {
    if (item?.type !== "tool_use") return;
    const input = item.input && typeof item.input === "object" ? item.input : {};
    const event = {
      ...base,
      type: "tool.call",
      category: "tool",
      lifecyclePhase: "request",
      toolName: item.name ?? "unknown-tool",
      toolInvocationId: item.id ?? null,
      evidenceRef: evidenceRef(sourceRef, "tool.call", index),
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
  });
  return events;
}

function metaEvents(raw, sourceRef) {
  const created = normalizeTimestamp(raw?.createdAtMs);
  const updated = normalizeTimestamp(raw?.updatedAtMs);
  return [
    {
      sessionId: sourceRef.sessionId,
      type: "session.meta.start",
      category: "session",
      timestamp: created,
      sourceKind: sourceRef.kind,
      planningScope: "workspace",
      activityTimestamp: false,
      cwd: raw?.cwd ?? null,
      evidenceRef: evidenceRef(sourceRef, "session.meta.start"),
      summary: "cursor session metadata start",
    },
    ...(updated && updated !== created ? [{
      sessionId: sourceRef.sessionId,
      type: "session.meta.update",
      category: "session",
      timestamp: updated,
      sourceKind: sourceRef.kind,
      planningScope: "workspace",
      activityTimestamp: false,
      cwd: raw?.cwd ?? null,
      evidenceRef: evidenceRef(sourceRef, "session.meta.update"),
      summary: "cursor session metadata update",
    }] : []),
  ];
}

function cursorLifecycle(raw) {
  const value = String(raw?._event ?? raw?.event ?? "audit");
  const lower = value.toLowerCase();
  if (["pretooluse", "beforereadfile", "beforeshellexecution", "beforemcpexecution"].includes(lower)) return "pre";
  if (["posttooluse", "posttoolusefailure", "afterfileedit", "aftershellexecution", "aftermcpexecution"].includes(lower)) return "result";
  return null;
}

function auditEvents(raw, sourceRef, options) {
  const auditType = String(raw?._event ?? raw?.event ?? "audit");
  const phase = cursorLifecycle(raw);
  const failed = auditType.toLowerCase().includes("failure")
    || Boolean(raw?.error_message)
    || ["failed", "failure", "error"].includes(String(raw?.status ?? raw?._action ?? "").toLowerCase());
  const toolName = raw?.tool_name ?? (/shell/i.test(auditType) ? "Shell" : /readfile/i.test(auditType) ? "Read" : null);
  const input = raw?.tool_input && typeof raw.tool_input === "object" ? raw.tool_input : {};
  const output = raw?.tool_output ?? raw?.output ?? "";
  const event = {
    sessionId: sourceRef.sessionId ?? inferAuditSessionId(raw),
    type: phase === "pre" ? "tool.pre" : phase === "result" ? "tool.result" : `audit.${auditType}`,
    category: phase ? "tool" : "audit",
    timestamp: inferTimestamp(raw),
    sourceKind: sourceRef.kind,
    planningScope: "workspace",
    evidenceRef: evidenceRef(sourceRef, auditType),
    summary: auditType,
  };
  if (phase) event.lifecyclePhase = phase;
  if (toolName) event.toolName = toolName;
  if (raw?.tool_use_id) event.toolInvocationId = raw.tool_use_id;
  if (phase === "result") {
    event.success = failed ? false : true;
    if (failed) event.hasError = true;
    const facts = parseResultFacts(String(output).slice(-8_192));
    if (facts) event.resultFacts = facts;
  }
  if (phase === "pre") {
    const action = String(raw?._action ?? raw?.guard?.decision ?? "").toLowerCase();
    if (["allowed", "allow", "blocked", "denied", "asked"].includes(action)) {
      event.permissionDecision = action === "allow" ? "allowed" : action;
    }
  }
  const commandText = inferCommandText(toolName, input, raw);
  const filePath = inferFilePath(toolName, input, raw);
  if (options.includeCommandText && commandText) event.commandText = commandText;
  if (filePath) event.filePath = filePath;
  if (raw?.cwd) event.cwd = raw.cwd;
  if (raw?.hook_event_name) {
    event.hookName = raw.hook_event_name;
    event.lifecycleEvent = auditType;
  }
  if (raw?.model) event.model = raw.model;
  const usage = inferUsage(raw);
  if (usage) {
    event.modelUsage = usage;
    event.usageFieldsObserved = true;
  }
  if (/subagentstart/i.test(auditType)) event.isSubagent = true;
  if (/afteragentresponse/i.test(auditType)) event.userVisibleAssistantMessage = true;
  return [event];
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
    eventTimestampCoverage: "unobserved",
  };
  if (!session.sourceRefs.some((existing) => existing.kind === ref.kind && existing.path === ref.path)) {
    session.sourceRefs.push(ref);
  }
  session.sourceKinds.add(ref.kind);
  mergeTimeRange(session, ref.firstSeen ?? ref.timestamp);
  mergeTimeRange(session, ref.lastSeen ?? ref.timestamp);
  if (ref.kind.includes("audit")) session.eventTimestampCoverage = "partial";
  sessions.set(sessionId, session);
}

function finalizeSession(session) {
  return { ...session, sourceKinds: [...session.sourceKinds].sort() };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function inspectTranscriptCoverage(filePath) {
  const summary = {
    records: 0,
    conversationRecords: 0,
    requestRecords: 0,
    terminalRecords: 0,
    invalidLines: 0,
  };
  const scan = await forEachJsonLine(filePath, (raw) => {
    summary.records += 1;
    const rowType = raw?.role ?? raw?.type ?? "record";
    if (rowType === "user" || rowType === "assistant") {
      summary.conversationRecords += 1;
    }
    if (rowType === "user" && textFromItems(textItems(raw))) {
      summary.requestRecords += 1;
    }
    if (rowType === "turn_ended") summary.terminalRecords += 1;
  });
  summary.invalidLines = scan.invalidLines;
  return summary;
}

function mergeTranscriptCoverage(left = {}, right = {}) {
  return {
    records: Number(left.records ?? 0) + Number(right.records ?? 0),
    conversationRecords: Number(left.conversationRecords ?? 0) + Number(right.conversationRecords ?? 0),
    requestRecords: Number(left.requestRecords ?? 0) + Number(right.requestRecords ?? 0),
    terminalRecords: Number(left.terminalRecords ?? 0) + Number(right.terminalRecords ?? 0),
    invalidLines: Number(left.invalidLines ?? 0) + Number(right.invalidLines ?? 0),
  };
}

function sourceJoinCoverage(roots, sessions, relevantIds, predicate) {
  const sourceAvailable = roots.some((root) => predicate(root.kind) && root.exists);
  const matchedWorkspaceSessions = sessions.filter((session) =>
    session.sourceKinds.some(predicate)).length;
  const matchedRelevantSessions = sessions.filter((session) =>
    relevantIds.has(session.sessionId) && session.sourceKinds.some(predicate)).length;
  return { sourceAvailable, matchedWorkspaceSessions, matchedRelevantSessions };
}

function buildCursorSourceCoverage({ scope, roots, sessions, inWindowSessions, transcriptCoverage }) {
  const workspaceSessions = sessions.length;
  const timeObservedSessions = sessions.filter((session) => session.firstSeen || session.lastSeen);
  const timeUnobservedSessions = workspaceSessions - timeObservedSessions.length;
  const inWindowIds = new Set(inWindowSessions.map((session) => session.sessionId));
  const unknownTimeIds = new Set(sessions
    .filter((session) => !session.firstSeen && !session.lastSeen)
    .map((session) => session.sessionId));
  const requestedWindow = scope.sinceTime !== null || scope.untilTime !== null;
  const relevantIds = inWindowIds.size > 0
    ? inWindowIds
    : requestedWindow
      ? unknownTimeIds
      : new Set(sessions.map((session) => session.sessionId));
  const relevantSummaries = [...relevantIds]
    .map((sessionId) => transcriptCoverage.get(sessionId))
    .filter(Boolean);
  const withConversation = relevantSummaries.filter((summary) => summary.conversationRecords > 0).length;
  const withRequest = relevantSummaries.filter((summary) => summary.requestRecords > 0).length;
  const terminalOnly = relevantSummaries.filter((summary) =>
    summary.conversationRecords === 0 && summary.terminalRecords > 0).length;
  const unreadable = relevantSummaries.filter((summary) =>
    summary.records === 0 || summary.invalidLines > 0).length;
  const chatMetadata = sourceJoinCoverage(
    roots,
    sessions,
    relevantIds,
    (kind) => kind === "cursor-chat-meta",
  );
  const audit = sourceJoinCoverage(
    roots,
    sessions,
    relevantIds,
    (kind) => kind.includes("audit"),
  );

  let status = "observed";
  if (workspaceSessions === 0) {
    status = "absent";
  } else if (inWindowSessions.length === 0 && requestedWindow && timeUnobservedSessions === 0) {
    status = "out-of-window";
  } else if (relevantIds.size === 0 || withRequest === 0) {
    status = "unobserved";
  } else if (timeUnobservedSessions > 0
    || withRequest < relevantIds.size
    || withConversation < relevantIds.size
    || unreadable > 0
    || !chatMetadata.sourceAvailable
    || chatMetadata.matchedRelevantSessions < relevantIds.size
    || !audit.sourceAvailable
    || audit.matchedRelevantSessions < relevantIds.size) {
    status = "partial";
  }

  return {
    status,
    transcript: {
      workspaceSessions,
      inWindowSessions: inWindowSessions.length,
      outOfWindowSessions: Math.max(0, timeObservedSessions.length - inWindowSessions.length),
      timeUnobservedSessions,
      relevantSessions: relevantIds.size,
      withConversation,
      withRequest,
      terminalOnly,
      unreadable,
    },
    joins: { chatMetadata, audit },
  };
}

export class CursorSessionAnalyzer extends SessionAnalyzer {
  currentSessionId() {
    return process.env.CURSOR_SESSION_ID ?? null;
  }

  async resolveScope(options = {}) {
    const since = normalizeCliDate(options.since, false);
    const until = normalizeCliDate(options.until, true);
    const workspace = normalizeWorkspace(options.workspace);
    return {
      platform: "cursor",
      workspace,
      home: path.resolve(expandHome(options.home ?? options.cursorHome ?? options["cursor-home"] ?? "~/.cursor")),
      _workspaceSlugVariants: workspaceToCursorSlugVariants(workspace),
      since: since.label,
      sinceTime: since.time,
      until: until.label,
      untilTime: until.time,
      sessionId: options["session-id"] ?? options.sessionId ?? options._?.[0] ?? null,
      includeGlobalCapabilities: parseBooleanFlag(options["include-global-capabilities"] ?? false),
      _command: options.command ?? null,
    };
  }

  async discoverSourceRoots(scope) {
    const transcriptPaths = scope._workspaceSlugVariants
      .map((slug) => path.join(scope.home, "projects", slug, "agent-transcripts"));
    const roots = [
      {
        id: "cursor-agent-transcripts",
        kind: "cursor-agent-transcript",
        role: "session-transcript",
        path: transcriptPaths[0],
        paths: transcriptPaths,
        optional: false,
        enabled: true,
        workspaceScoped: true,
        coverage: "primary-content",
      },
      {
        id: "cursor-chat-meta",
        kind: "cursor-chat-meta",
        role: "session-metadata",
        path: path.join(scope.home, "chats"),
        optional: true,
        enabled: true,
        workspaceScoped: false,
        coverage: "session-time",
      },
      {
        id: "cursor-audit",
        kind: "cursor-audit-jsonl",
        role: "tool-lifecycle-audit",
        path: path.join(scope.home, "audit", "audit.jsonl"),
        optional: true,
        enabled: true,
        workspaceScoped: false,
        coverage: "optional-execution",
      },
      {
        id: "cursor-audit-logs",
        kind: "cursor-audit-log-jsonl",
        role: "tool-lifecycle-audit",
        path: path.join(scope.home, "audit-logs", "audit.jsonl"),
        optional: true,
        enabled: true,
        workspaceScoped: false,
        coverage: "optional-execution",
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
    const transcriptCoverage = new Map();
    const transcriptRoot = roots.find((root) => root.kind === "cursor-agent-transcript");
    for (const rootPath of transcriptRoot?.paths ?? []) {
      if (!await pathExists(rootPath)) continue;
      const files = await walkFiles(rootPath, { maxDepth: 2, limit: 20_000, match: (file) => file.endsWith(".jsonl") });
      for (const filePath of files) {
        const sessionId = transcriptSessionId(filePath);
        addRef(sessions, sessionId, scope.workspace, {
          kind: transcriptRoot.kind,
          role: transcriptRoot.role,
          path: filePath,
        });
        if (scope._command === "facts") {
          const inspected = await inspectTranscriptCoverage(filePath);
          transcriptCoverage.set(
            sessionId,
            mergeTranscriptCoverage(transcriptCoverage.get(sessionId), inspected),
          );
        }
      }
    }
    const knownIds = new Set(sessions.keys());
    const metaRoot = roots.find((root) => root.kind === "cursor-chat-meta");
    if (metaRoot?.exists) {
      const metaFiles = await walkFiles(metaRoot.path, { maxDepth: 3, limit: 20_000, match: (file) => path.basename(file) === "meta.json" });
      for (const filePath of metaFiles) {
        const sessionId = path.basename(path.dirname(filePath));
        if (!knownIds.has(sessionId)) continue;
        let meta;
        try { meta = await readJson(filePath); } catch { continue; }
        if (meta.cwd && !isWorkspaceMatch(meta.cwd, scope.workspace)) continue;
        const firstSeen = normalizeTimestamp(meta.createdAtMs);
        const lastSeen = normalizeTimestamp(meta.updatedAtMs);
        addRef(sessions, sessionId, scope.workspace, {
          kind: metaRoot.kind,
          role: metaRoot.role,
          path: filePath,
          firstSeen,
          lastSeen,
        });
      }
    }
    for (const root of roots.filter((item) => item.kind.includes("audit") && item.exists && item.enabled)) {
      const joined = new Map();
      await forEachJsonLine(root.path, (raw) => {
        const identities = [raw?.session_id, raw?.conversation_id,
          raw?.transcript_path ? path.basename(String(raw.transcript_path), ".jsonl") : null].filter(Boolean);
        const sessionId = identities.find((identity) => knownIds.has(identity));
        if (!sessionId) return;
        const timestamp = inferTimestamp(raw);
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
    const workspaceSessions = [...sessions.values()].map(finalizeSession);
    const inWindowSessions = workspaceSessions
      .filter((session) => {
        const timestamp = session.lastSeen ?? session.firstSeen;
        if ((scope.sinceTime !== null || scope.untilTime !== null) && !timestamp) return false;
        return withinTimeRange(timestamp, scope);
      })
      .sort((left, right) => (timestampMillis(right.lastSeen) ?? 0) - (timestampMillis(left.lastSeen) ?? 0));
    if (scope._command === "facts") {
      scope._cursorSourceCoverage = buildCursorSourceCoverage({
        scope,
        roots,
        sessions: workspaceSessions,
        inWindowSessions,
        transcriptCoverage,
      });
    }
    return inWindowSessions;
  }

  normalizeEvent(raw, sourceRef, options = {}) {
    return this.normalizeEvents(raw, sourceRef, options)[0] ?? null;
  }

  normalizeEvents(raw, sourceRef, options = {}) {
    if (sourceRef.kind === "cursor-chat-meta") return metaEvents(raw, sourceRef);
    if (sourceRef.kind.includes("audit")) return auditEvents(raw, sourceRef, options);
    return transcriptEvents(raw, sourceRef, options);
  }

  async readSession(session, scope, options = {}) {
    const events = [];
    for (const ref of session.sourceRefs ?? []) {
      if (ref.kind === "cursor-chat-meta") {
        let raw;
        try { raw = await readJson(ref.path); } catch { continue; }
        events.push(...this.normalizeEvents(raw, { ...ref, sessionId: session.sessionId }, options)
          .filter((event) => withinTimeRange(event.timestamp, scope)));
        continue;
      }
      await forEachJsonLine(ref.path, (raw, line) => {
        if (ref.kind.includes("audit")) {
          const identities = [raw?.session_id, raw?.conversation_id,
            raw?.transcript_path ? path.basename(String(raw.transcript_path), ".jsonl") : null].filter(Boolean);
          if (!identities.includes(session.sessionId)) return;
        }
        for (const event of this.normalizeEvents(raw, { ...ref, sessionId: session.sessionId, line }, options)) {
          if (event.sessionId === session.sessionId && withinTimeRange(event.timestamp, scope)) events.push(event);
        }
      });
    }
    return events.sort((left, right) =>
      (timestampMillis(left.timestamp) ?? 0) - (timestampMillis(right.timestamp) ?? 0)
      || Number(left.evidenceRef?.line ?? 0) - Number(right.evidenceRef?.line ?? 0)
      || Number(left.evidenceRef?.seq ?? 0) - Number(right.evidenceRef?.seq ?? 0));
  }

  async analysisWarnings(scope, roots, sessions) {
    const coverage = scope._cursorSourceCoverage;
    const warnings = coverage?.status === "absent" ? [] : [{
      code: "cursor-transcript-event-timestamps-unobserved",
      message: "Cursor transcript messages do not expose event timestamps; active-time evidence requires a matching audit source.",
    }];
    if (coverage?.status === "absent") {
      warnings.push({
        code: "cursor-workspace-transcripts-absent",
        message: "No Cursor agent transcript matched the selected workspace.",
      });
    }
    if (["unobserved", "partial"].includes(coverage?.status)
      && coverage.transcript.withRequest < coverage.transcript.relevantSessions) {
      warnings.push({
        code: coverage.transcript.withRequest === 0
          ? "cursor-transcript-content-unobserved"
          : "cursor-transcript-content-partial",
        message: `Cursor request content was observed in ${coverage.transcript.withRequest} of ${coverage.transcript.relevantSessions} relevant transcripts.`,
      });
    }
    const coverageUsesRelevantSessions = !coverage
      || ["unobserved", "partial", "observed"].includes(coverage.status);
    const relevantSessions = coverageUsesRelevantSessions
      ? coverage?.transcript?.relevantSessions ?? sessions.length
      : 0;
    const metaCount = coverage?.joins?.chatMetadata?.matchedRelevantSessions
      ?? sessions.filter((session) => session.sourceKinds.includes("cursor-chat-meta")).length;
    if (relevantSessions > 0 && metaCount < relevantSessions) {
      warnings.push({
        code: "cursor-chat-meta-partial",
        message: `Cursor chat metadata matched ${metaCount} of ${relevantSessions} relevant workspace transcripts.`,
      });
    }
    const auditsExist = coverage?.joins?.audit?.sourceAvailable
      ?? roots.some((root) => root.kind.includes("audit") && root.exists);
    const auditCount = coverage?.joins?.audit?.matchedRelevantSessions
      ?? sessions.filter((session) => session.sourceKinds.some((kind) => kind.includes("audit"))).length;
    if (relevantSessions > 0 && (!auditsExist || auditCount < relevantSessions)) {
      warnings.push({
        code: "cursor-audit-partial",
        message: `Cursor audit evidence matched ${auditCount} of ${relevantSessions} relevant workspace transcripts.`,
      });
    }
    return warnings;
  }

  factsSourceCoverage(scope) {
    return scope._cursorSourceCoverage ?? null;
  }

  async analyze(options = {}) {
    return runProviderAnalysis(this, options, { platform: "cursor", adapterVersion: "cursor-v1" });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { command = "sessions", options } = parseArgs(argv);
  const analyzer = new CursorSessionAnalyzer();
  const result = await runProviderCommand(analyzer, command, options);
  await emitProviderResult({ provider: "Cursor", command, options, result });
  return result;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`cursor session-analysis failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SessionAnalyzer } from "../../session-analysis.mjs";
import { parseArgs, parseBooleanFlag } from "../cli.mjs";
import { forEachJsonLine, pathExists, pathStat, walkFiles } from "../fs.mjs";
import { expandHome, normalizeWorkspace } from "../paths.mjs";
import {
  emitProviderResult,
  runProviderAnalysis,
  runProviderCommand,
} from "../provider-runner.mjs";
import { parseResultFacts } from "../result-facts.mjs";
import { mergeTimeRange, normalizeCliDate, normalizeTimestamp, timestampMillis, withinTimeRange } from "../time.mjs";

const SESSION_DIR_RE = /^(?:ses|session)_[0-9a-f-]+$/iu;
const WORKSPACE_DIR_RE = /^wd_.+_[0-9a-f]+$/iu;
const CONTROL_RECORD_TYPES = new Set([
  "config.update",
  "tools.set_active_tools",
  "tools.update_store",
  "llm.tools_snapshot",
  "mcp.tools_discovered",
]);

function comparePath(value) {
  if (!value) return "";
  let resolved = path.resolve(expandHome(String(value))).replace(/\\/gu, "/");
  if (process.platform === "win32") resolved = resolved.toLowerCase();
  return resolved.replace(/\/+$/u, "");
}

function isWorkspaceMatch(candidate, workspace) {
  if (!candidate) return false;
  const resolved = comparePath(candidate);
  const target = comparePath(workspace);
  return resolved === target || resolved.startsWith(`${target}/`);
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

async function listDirectories(root, match) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && (!match || match.test(entry.name)))
    .map((entry) => path.join(root, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

async function loadWorkspacesIndex(kimiHome) {
  const filePath = path.join(kimiHome, "workspaces.json");
  const data = await readJson(filePath);
  const roots = new Map();
  for (const [workspaceId, record] of Object.entries(data?.workspaces ?? {})) {
    if (typeof record?.root === "string" && record.root.trim()) {
      roots.set(workspaceId, record.root);
    }
  }
  return { filePath, roots, exists: roots.size > 0 || await pathExists(filePath) };
}

async function loadSessionIndex(kimiHome) {
  const filePath = path.join(kimiHome, "session_index.jsonl");
  const workDirs = new Map();
  if (await pathExists(filePath)) {
    await forEachJsonLine(filePath, (raw) => {
      if (typeof raw?.sessionDir === "string" && typeof raw?.workDir === "string") {
        workDirs.set(comparePath(raw.sessionDir), raw.workDir);
      }
    });
  }
  return { filePath, workDirs, exists: workDirs.size > 0 || await pathExists(filePath) };
}

function inferTimestamp(raw) {
  return normalizeTimestamp(raw?.time ?? raw?.timestamp ?? raw?.created_at ?? null);
}

function textFromParts(parts) {
  if (typeof parts === "string") return parts.trim();
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((part) => typeof part === "string" || part?.type === "text")
    .map((part) => (typeof part === "string" ? part : part?.text ?? ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function inferFilePath(toolName, input = {}) {
  if (!/(?:read|edit|write|file|notebook|glob)/iu.test(String(toolName ?? ""))) return null;
  return input.file_path ?? input.filePath ?? input.path ?? null;
}

function inferCommandText(toolName, input = {}) {
  if (!/(?:bash|shell|exec|terminal)/iu.test(String(toolName ?? ""))) return null;
  return input.command ?? input.cmd ?? null;
}

function evidenceRef(sourceRef, type, seq = null) {
  return {
    kind: sourceRef.kind,
    path: sourceRef.path,
    line: sourceRef.line ?? null,
    seq,
    type,
  };
}

function toolCallEvent(base, sourceRef, name, toolCallId, args, options, seq = null) {
  const toolName = name ?? "unknown-tool";
  const input = args && typeof args === "object" ? args : {};
  const event = {
    ...base,
    type: "tool.call",
    category: "tool",
    lifecyclePhase: "request",
    toolName,
    toolInvocationId: toolCallId ?? null,
    evidenceRef: evidenceRef(sourceRef, "tool.call", seq),
    summary: `${toolName} request`,
  };
  const commandText = inferCommandText(toolName, input);
  const filePath = inferFilePath(toolName, input);
  if (options.includeCommandText && commandText) event.commandText = commandText;
  if (filePath) event.filePath = filePath;
  if (toolName === "Skill") {
    const skillName = input.skill ?? input.name;
    if (skillName) {
      event.skillName = String(skillName).split(":").at(-1);
      event.skillNames = [event.skillName];
    }
  }
  return event;
}

function toolResultEvent(base, sourceRef, toolCallId, result, options) {
  const record = result && typeof result === "object" ? result : { output: result };
  const failed = record.isError === true || record.error != null;
  const event = {
    ...base,
    type: "tool.result",
    category: "tool",
    lifecyclePhase: "result",
    toolInvocationId: toolCallId ?? null,
    success: !failed,
    hasError: failed,
    evidenceRef: evidenceRef(sourceRef, "tool.result"),
    summary: failed ? "tool result failed" : "tool result",
  };
  const output = typeof record.output === "string" ? record.output : JSON.stringify(record.output ?? "");
  const resultFacts = parseResultFacts(output.slice(-8_192));
  if (resultFacts) event.resultFacts = resultFacts;
  return event;
}

function messageEvents(base, sourceRef, role, text, options) {
  const type = role === "user" ? "user" : "assistant";
  const event = {
    ...base,
    type,
    category: type,
    evidenceRef: evidenceRef(sourceRef, type),
    summary: text ? `${type} message (${text.length} chars)` : type,
    contentLength: text.length,
  };
  if (type === "user") {
    event.userPrompt = text.length > 0;
    if (options.includeUserText && text) event.userText = text;
  } else if (text) {
    event.userVisibleAssistantMessage = true;
  }
  if (options.includeContent && text) event.content = text;
  return [event];
}

function loopEvents(raw, base, sourceRef, options) {
  const loop = raw?.event && typeof raw.event === "object" ? raw.event : {};
  const loopType = loop.type ?? "unknown";
  if (loopType === "tool.call") {
    return [toolCallEvent(base, sourceRef, loop.name, loop.toolCallId ?? loop.uuid, loop.args, options)];
  }
  if (loopType === "tool.result") {
    return [toolResultEvent(base, sourceRef, loop.toolCallId ?? loop.parentUuid, loop.result, options)];
  }
  if (loopType === "content.part") {
    const part = loop.part && typeof loop.part === "object" ? loop.part : {};
    if (part.type === "text") {
      const text = String(part.text ?? "").trim();
      return messageEvents(base, sourceRef, "assistant", text, options);
    }
    const think = String(part.think ?? part.text ?? "");
    return [{
      ...base,
      type: `metadata.${part.type ?? "content.part"}`,
      category: "metadata",
      evidenceRef: evidenceRef(sourceRef, "content.part"),
      summary: part.type === "think" ? "thinking" : String(part.type ?? "content.part"),
      contentLength: think.length,
      ...(options.includeContent && think ? { content: think } : {}),
    }];
  }
  if (loopType === "step.begin" || loopType === "step.end") {
    return [{
      ...base,
      type: `metadata.${loopType}`,
      category: "metadata",
      evidenceRef: evidenceRef(sourceRef, loopType),
      summary: loopType === "step.end" && loop.finishReason ? `step end (${loop.finishReason})` : loopType,
    }];
  }
  return [{
    ...base,
    type: `metadata.${loopType}`,
    category: "metadata",
    evidenceRef: evidenceRef(sourceRef, `metadata.${loopType}`),
    summary: loopType,
  }];
}

function wireEvents(raw, sourceRef, options) {
  const rawType = raw?.type ?? "record";
  const base = {
    sessionId: sourceRef.sessionId,
    timestamp: inferTimestamp(raw),
    sourceKind: sourceRef.kind,
    planningScope: "workspace",
    agentId: sourceRef.agentId ?? null,
    isSubagent: sourceRef.agentId ? sourceRef.agentId !== "main" : null,
  };

  if (rawType === "metadata") {
    return [{
      ...base,
      type: "metadata.wire",
      category: "metadata",
      evidenceRef: evidenceRef(sourceRef, "metadata.wire"),
      summary: `kimi wire protocol ${raw.protocol_version ?? "unknown"}`,
    }];
  }
  if (rawType === "turn.prompt" || rawType === "turn.steer") {
    return messageEvents(base, sourceRef, "user", textFromParts(raw?.input), options);
  }
  if (rawType === "context.append_message") {
    const message = raw?.message && typeof raw.message === "object" ? raw.message : {};
    const role = message.role === "user" ? "user" : message.role === "assistant" ? "assistant" : null;
    const events = role ? messageEvents(base, sourceRef, role, textFromParts(message.content), options) : [];
    const toolCalls = Array.isArray(message.toolCalls) ? message.toolCalls : [];
    toolCalls.forEach((toolCall, index) => {
      if (!toolCall || typeof toolCall !== "object") return;
      events.push(toolCallEvent(
        base,
        sourceRef,
        toolCall.name,
        toolCall.id ?? toolCall.toolCallId,
        toolCall.args ?? toolCall.input,
        options,
        index,
      ));
    });
    return events;
  }
  if (rawType === "context.append_loop_event") {
    return loopEvents(raw, base, sourceRef, options);
  }
  if (rawType === "usage.record") {
    const usage = raw?.usage && typeof raw.usage === "object" ? raw.usage : {};
    // Keep partial usage explicit: carry only finite fields the record
    // actually observed and never coerce a missing or malformed sibling field
    // to zero. Without one finite field there is no usage event at all.
    const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
    const inputOther = finite(usage.inputOther ?? usage.input);
    const cacheRead = finite(usage.inputCacheRead);
    const cacheCreation = finite(usage.inputCacheCreation);
    const output = finite(usage.output);
    const modelUsage = {};
    const inputParts = [inputOther, cacheRead, cacheCreation].filter((value) => value !== undefined);
    if (inputParts.length > 0) modelUsage.inputTokens = inputParts.reduce((sum, value) => sum + value, 0);
    if (output !== undefined) modelUsage.outputTokens = output;
    if (cacheRead !== undefined) modelUsage.cacheReadInputTokens = cacheRead;
    if (cacheCreation !== undefined) modelUsage.cacheCreationInputTokens = cacheCreation;
    if (Object.keys(modelUsage).length === 0) return [];
    return [{
      ...base,
      type: "model.response.completed",
      category: "model",
      model: raw?.model ?? null,
      modelUsage,
      usageFieldsObserved: true,
      evidenceRef: evidenceRef(sourceRef, "model.response.completed"),
      summary: "Kimi model usage recorded",
    }];
  }
  if (CONTROL_RECORD_TYPES.has(rawType)) {
    return [];
  }
  if (rawType === "permission.record_approval_result") {
    return [{
      ...base,
      type: "metadata.permission",
      category: "metadata",
      evidenceRef: evidenceRef(sourceRef, "metadata.permission"),
      summary: `permission ${raw?.result?.decision ?? "recorded"}`,
    }];
  }
  return [{
    ...base,
    type: `metadata.${rawType}`,
    category: "metadata",
    evidenceRef: evidenceRef(sourceRef, `metadata.${rawType}`),
    summary: rawType,
  }];
}

function addRef(sessions, sessionId, workspace, ref, title = null) {
  if (!sessionId) return;
  const session = sessions.get(sessionId) ?? {
    sessionId,
    workspace,
    title,
    firstSeen: null,
    lastSeen: null,
    sourceKinds: new Set(),
    sourceRefs: [],
  };
  session.sourceKinds.add(ref.kind);
  session.sourceRefs.push(ref);
  mergeTimeRange(session, ref.firstSeen ?? ref.timestamp);
  mergeTimeRange(session, ref.lastSeen ?? ref.timestamp);
  sessions.set(sessionId, session);
}

function finalizeSession(session) {
  return { ...session, sourceKinds: [...session.sourceKinds].sort() };
}

function dedupeEvents(events) {
  const seen = new Set();
  return events.filter((event) => {
    // Tool call ids are only unique per agent: the main wire and a subagent
    // wire of the same session may reuse the same id, so the dedupe key must
    // include the agent identity to avoid dropping distinct events.
    const key = event.toolInvocationId && event.lifecyclePhase
      ? `${event.sessionId}:${event.agentId ?? "main"}:${event.lifecyclePhase}:${event.toolInvocationId}`
      : null;
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export class KimiSessionAnalyzer extends SessionAnalyzer {
  // Kimi Code does not document a session-id environment variable; follow the
  // <HOST>_SESSION_ID convention and return null when it is unset.
  currentSessionId() {
    return process.env.KIMI_SESSION_ID ?? null;
  }

  async resolveScope(options = {}) {
    const since = normalizeCliDate(options.since, false);
    const until = normalizeCliDate(options.until, true);
    const workspace = normalizeWorkspace(options.workspace);
    const kimiHome = path.resolve(expandHome(
      options.home ?? options.kimiHome ?? options["kimi-home"] ?? "~/.kimi-code",
    ));
    return {
      platform: "kimi",
      workspace,
      home: kimiHome,
      since: since.label,
      sinceTime: since.time,
      until: until.label,
      untilTime: until.time,
      sessionId: options["session-id"] ?? options.sessionId ?? options._?.[0] ?? null,
      includeGlobalCapabilities: parseBooleanFlag(options["include-global-capabilities"] ?? false),
    };
  }

  async resolveWorkspaceDirs(scope) {
    const sessionsRoot = path.join(scope.home, "sessions");
    const [workspaceIndex, sessionIndex, candidates] = await Promise.all([
      loadWorkspacesIndex(scope.home),
      loadSessionIndex(scope.home),
      listDirectories(sessionsRoot, WORKSPACE_DIR_RE),
    ]);
    const fallbackPrefix = `wd_${path.basename(scope.workspace).toLowerCase()}_`;
    const dirs = [];
    for (const dir of candidates) {
      const workspaceId = path.basename(dir);
      const indexedRoot = workspaceIndex.roots.get(workspaceId);
      if (indexedRoot !== undefined) {
        if (isWorkspaceMatch(indexedRoot, scope.workspace)) dirs.push(dir);
        continue;
      }
      const sessionRoot = [...sessionIndex.workDirs.entries()]
        .find(([sessionDir]) => comparePath(path.dirname(sessionDir)) === comparePath(dir));
      if (sessionRoot) {
        if (isWorkspaceMatch(sessionRoot[1], scope.workspace)) dirs.push(dir);
        continue;
      }
      if (workspaceIndex.roots.size === 0 && sessionIndex.workDirs.size === 0
        && workspaceId.toLowerCase().startsWith(fallbackPrefix)) {
        dirs.push(dir);
      }
    }
    return { sessionsRoot, dirs, workspaceIndex, sessionIndex };
  }

  async discoverSourceRoots(scope) {
    const resolved = await this.resolveWorkspaceDirs(scope);
    scope._workspaceDirs = resolved.dirs;
    scope._indexAbsent = !resolved.workspaceIndex.exists && !resolved.sessionIndex.exists;
    scope._sessionWorkDirs = resolved.sessionIndex.workDirs;
    const roots = [
      {
        id: "kimi-sessions",
        kind: "kimi-wire-jsonl",
        role: "session-transcript",
        path: resolved.sessionsRoot,
        optional: false,
        enabled: true,
        workspaceScoped: true,
        coverage: "primary",
      },
      {
        id: "kimi-session-index",
        kind: "kimi-session-index-jsonl",
        role: "workspace-session-index",
        path: resolved.sessionIndex.filePath,
        optional: true,
        enabled: true,
        workspaceScoped: false,
        coverage: "optional",
      },
      {
        id: "kimi-workspaces",
        kind: "kimi-workspaces-json",
        role: "workspace-index",
        path: resolved.workspaceIndex.filePath,
        optional: true,
        enabled: true,
        workspaceScoped: false,
        coverage: "optional",
      },
    ];
    return Promise.all(roots.map(async (root) => ({ ...root, exists: await pathExists(root.path) })));
  }

  async discoverSessions(scope, _roots) {
    const sessions = new Map();
    for (const workspaceDir of scope._workspaceDirs ?? []) {
      for (const sessionDir of await listDirectories(workspaceDir, SESSION_DIR_RE)) {
        const sessionId = path.basename(sessionDir);
        const indexedWorkDir = scope._sessionWorkDirs?.get(comparePath(sessionDir));
        if (indexedWorkDir && !isWorkspaceMatch(indexedWorkDir, scope.workspace)) continue;
        const state = await readJson(path.join(sessionDir, "state.json"));
        const wireFiles = await walkFiles(path.join(sessionDir, "agents"), {
          maxDepth: 2,
          limit: 200,
          match: (filePath) => path.basename(filePath) === "wire.jsonl",
        });
        if (wireFiles.length === 0) continue;
        let firstSeen = normalizeTimestamp(state?.createdAt) ?? null;
        let lastSeen = normalizeTimestamp(state?.updatedAt) ?? null;
        if (!firstSeen && !lastSeen) {
          const mtimes = await Promise.all(wireFiles.map(async (filePath) => (await pathStat(filePath))?.mtimeMs ?? null));
          const newest = mtimes.filter((value) => value !== null).sort((left, right) => right - left)[0] ?? null;
          lastSeen = newest ? normalizeTimestamp(newest) : null;
          if (!withinTimeRange(lastSeen, scope)) continue;
        } else if (!withinTimeRange(lastSeen ?? firstSeen, scope)) {
          continue;
        }
        for (const wirePath of wireFiles) {
          const agentId = path.basename(path.dirname(wirePath));
          addRef(sessions, sessionId, scope.workspace, {
            kind: "kimi-wire-jsonl",
            role: agentId === "main" ? "session-transcript" : "subagent-transcript",
            agentId,
            path: wirePath,
            firstSeen,
            lastSeen,
          }, typeof state?.title === "string" ? state.title.slice(0, 200) : null);
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
    return wireEvents(raw, sourceRef, options);
  }

  async readSession(session, scope, options = {}) {
    const events = [];
    for (const ref of session.sourceRefs ?? []) {
      if (!ref.path.endsWith(".jsonl")) continue;
      await forEachJsonLine(ref.path, (raw, line) => {
        for (const event of this.normalizeEvents(raw, { ...ref, sessionId: session.sessionId, line }, options)) {
          if (withinTimeRange(event.timestamp, scope)) events.push(event);
        }
      });
    }
    return dedupeEvents(events).sort((left, right) =>
      (timestampMillis(left.timestamp) ?? 0) - (timestampMillis(right.timestamp) ?? 0)
      || Number(left.evidenceRef?.line ?? 0) - Number(right.evidenceRef?.line ?? 0)
      || Number(left.evidenceRef?.seq ?? 0) - Number(right.evidenceRef?.seq ?? 0));
  }

  async analysisWarnings(scope, roots, sessions) {
    const warnings = [];
    if (scope._indexAbsent) {
      warnings.push({
        code: "kimi-workspace-index-absent",
        message: "Neither workspaces.json nor session_index.jsonl is available; workspace matching fell back to wd_<name>_* directory prefixes.",
      });
    }
    const sessionsRoot = roots.find((root) => root.kind === "kimi-wire-jsonl");
    if (sessionsRoot?.exists && sessions.length === 0) {
      warnings.push({
        code: "kimi-no-workspace-sessions",
        message: "No Kimi Code sessions matched this workspace in the selected time window.",
      });
    }
    return warnings;
  }

  async analyze(options = {}) {
    return runProviderAnalysis(this, options, { platform: "kimi", adapterVersion: "kimi-v1" });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { command = "sessions", options } = parseArgs(argv);
  const analyzer = new KimiSessionAnalyzer();
  const result = await runProviderCommand(analyzer, command, options);
  await emitProviderResult({ provider: "Kimi", command, options, result });
  return result;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`kimi session-analysis failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}

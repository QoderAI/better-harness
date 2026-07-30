#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SessionAnalyzer } from "../../session-analysis.mjs";
import { parseArgs, parseBooleanFlag } from "../cli.mjs";
import { forEachJsonLine, pathExists, walkFiles } from "../fs.mjs";
import { expandHome, normalizeWorkspace } from "../paths.mjs";
import {
  emitProviderResult,
  runProviderAnalysis,
  runProviderCommand,
} from "../provider-runner.mjs";
import { parseResultFacts } from "../result-facts.mjs";
import { mergeTimeRange, normalizeCliDate, normalizeTimestamp, timestampMillis, withinTimeRange } from "../time.mjs";

function isWorkspaceMatch(candidate, workspace) {
  if (!candidate) return false;
  const resolved = normalizeWorkspace(candidate);
  return resolved === workspace || resolved.startsWith(`${workspace}${path.sep}`);
}

export function workspaceToWorkbuddySlugVariants(workspace) {
  const expanded = expandHome(workspace ?? process.cwd());
  const normalized = path.win32.isAbsolute(expanded) ? path.win32.normalize(expanded) : normalizeWorkspace(expanded);
  // Match WorkBuddy's project directory naming: strip one leading separator,
  // then replace every "/", "\", and ":" with "-" (spaces and case preserved).
  const body = normalized.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-");
  return {
    exact: body,
    // Sessions started in a subdirectory of the workspace live in their own
    // cwd-keyed directory; its name starts with the workspace slug body.
    prefix: `${body}-`,
  };
}

function inferTimestamp(raw) {
  const value = raw?.timestamp ?? null;
  // WorkBuddy writes epoch milliseconds; tolerate digit strings as well.
  if (typeof value === "string" && /^\d{10,}$/.test(value)) {
    return normalizeTimestamp(Number(value));
  }
  return normalizeTimestamp(value);
}

function contentBlocks(raw) {
  const content = raw?.content;
  if (Array.isArray(content)) return content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return [];
}

function textFromBlocks(blocks) {
  return blocks
    .filter((block) => typeof block === "string"
      || (block && typeof block === "object" && ["text", "input_text", "output_text"].includes(block.type)))
    .map((block) => (typeof block === "string" ? block : block.text))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function inferUsage(raw) {
  const provider = raw?.providerData?.usage;
  if (provider && typeof provider === "object") {
    const cacheRead = Array.isArray(provider.inputTokensDetails)
      ? provider.inputTokensDetails.reduce((sum, item) => sum + (Number(item?.cached_tokens) || 0), 0)
      : 0;
    return {
      inputTokens: Number(provider.inputTokens) || 0,
      outputTokens: Number(provider.outputTokens) || 0,
      cacheReadInputTokens: cacheRead,
      cacheCreationInputTokens: 0,
    };
  }
  const message = raw?.message?.usage;
  if (message && typeof message === "object") {
    return {
      inputTokens: Number(message.input_tokens) || 0,
      outputTokens: Number(message.output_tokens) || 0,
      cacheReadInputTokens: Number(message.cache_read_input_tokens) || 0,
      cacheCreationInputTokens: Number(message.cache_creation_input_tokens) || 0,
    };
  }
  return null;
}

function inferModel(raw) {
  return raw?.providerData?.model ?? raw?.providerData?.requestModelId ?? null;
}

function parseCallArguments(raw) {
  if (raw?.arguments && typeof raw.arguments === "object") return raw.arguments;
  if (typeof raw?.arguments === "string") {
    try {
      const parsed = JSON.parse(raw.arguments);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function inferFilePath(toolName, input = {}) {
  if (!/(?:read|edit|write|file|notebook)/i.test(String(toolName ?? ""))) return null;
  return input.file_path ?? input.filePath ?? input.path ?? null;
}

function inferCommandText(toolName, input = {}) {
  if (!/(?:bash|shell|exec|terminal|run)/i.test(String(toolName ?? ""))) return null;
  return input.command ?? input.cmd ?? null;
}

function resultOutputText(raw) {
  const output = raw?.output;
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return textFromBlocks(output);
  if (output && typeof output === "object") return textFromBlocks([output]);
  return "";
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

function usageEvent(raw, base, sourceRef, usage) {
  return {
    ...base,
    type: "model.response.completed",
    category: "model",
    model: inferModel(raw),
    modelUsage: usage,
    usageFieldsObserved: true,
    responseId: raw?.providerData?.messageId ?? raw?.id ?? null,
    evidenceRef: evidenceRef(sourceRef, "model.response.completed"),
    summary: "WorkBuddy model response completed",
  };
}

function transcriptEvents(raw, sourceRef, options) {
  const rawType = raw?.type ?? "record";
  const role = raw?.role ?? null;
  const timestamp = inferTimestamp(raw);
  const events = [];
  const base = {
    sessionId: sourceRef.sessionId,
    timestamp,
    sourceKind: sourceRef.kind,
    planningScope: "workspace",
    cwd: raw?.cwd ?? null,
    isSubagent: null,
  };

  if (rawType === "message" && role === "user") {
    const text = textFromBlocks(contentBlocks(raw));
    events.push({
      ...base,
      type: "user",
      category: "user",
      evidenceRef: evidenceRef(sourceRef, "user"),
      summary: text ? `user message (${text.length} chars)` : "user",
      contentLength: text.length,
      userPrompt: text.length > 0,
      ...(options.includeUserText && text ? { userText: text } : {}),
      ...(options.includeContent && text ? { content: text } : {}),
    });
  } else if (rawType === "message" && role === "assistant") {
    const model = inferModel(raw);
    const usage = inferUsage(raw);
    const visibleText = textFromBlocks(contentBlocks(raw));
    const event = {
      ...base,
      type: "assistant",
      category: "assistant",
      evidenceRef: evidenceRef(sourceRef, "assistant"),
      summary: visibleText ? `assistant message (${visibleText.length} chars)` : "assistant",
      contentLength: visibleText.length,
    };
    if (visibleText) event.userVisibleAssistantMessage = true;
    if (options.includeContent && visibleText) event.content = visibleText;
    if (model && !usage) event.model = model;
    events.push(event);
    if (usage) events.push(usageEvent(raw, base, sourceRef, usage));
  } else if (rawType === "function_call") {
    const input = parseCallArguments(raw);
    const toolEvent = {
      ...base,
      type: "tool.call",
      category: "tool",
      lifecyclePhase: "request",
      toolName: raw?.name ?? "unknown-tool",
      toolInvocationId: raw?.callId ?? null,
      evidenceRef: evidenceRef(sourceRef, "tool.call"),
      summary: `${raw?.name ?? "unknown-tool"} request`,
    };
    const commandText = inferCommandText(raw?.name, input);
    const filePath = inferFilePath(raw?.name, input);
    if (options.includeCommandText && commandText) toolEvent.commandText = commandText;
    if (filePath) toolEvent.filePath = filePath;
    events.push(toolEvent);
    // WorkBuddy attaches per-request usage snapshots to function_call records.
    const usage = inferUsage(raw);
    if (usage) events.push(usageEvent(raw, base, sourceRef, usage));
  } else if (rawType === "function_call_result") {
    const status = raw?.status ?? null;
    const success = status ? status === "completed" : true;
    const output = resultOutputText(raw);
    const event = {
      ...base,
      type: "tool.result",
      category: "tool",
      lifecyclePhase: "result",
      toolInvocationId: raw?.callId ?? null,
      success,
      hasError: !success,
      evidenceRef: evidenceRef(sourceRef, "tool.result"),
      summary: !success ? "tool result failed" : "tool result",
    };
    if (raw?.name) event.toolName = raw.name;
    const resultFacts = parseResultFacts(String(output).slice(-8_192));
    if (resultFacts) event.resultFacts = resultFacts;
    events.push(event);
  } else {
    // reasoning, file-history-snapshot, ai-title, and other lifecycle
    // records stay metadata.
    events.push({
      ...base,
      type: `metadata.${rawType}`,
      category: "metadata",
      evidenceRef: evidenceRef(sourceRef, `metadata.${rawType}`),
      summary: rawType,
    });
  }

  return events;
}

function dedupeUsageEvents(events) {
  // Parallel tool calls from one model response repeat the same usage
  // snapshot; keep only the first event per response id.
  const seen = new Set();
  return events.filter((event) => {
    if (event.type !== "model.response.completed" || !event.responseId) return true;
    if (seen.has(event.responseId)) return false;
    seen.add(event.responseId);
    return true;
  });
}

async function probeTranscript(filePath, workspace) {
  const summary = {
    sessionId: path.basename(filePath, ".jsonl"),
    firstSeen: null,
    lastSeen: null,
    workspaceMatch: false,
  };
  await forEachJsonLine(filePath, (raw) => {
    if (raw?.sessionId) summary.sessionId = raw.sessionId;
    if (raw?.cwd && isWorkspaceMatch(raw.cwd, workspace)) summary.workspaceMatch = true;
    mergeTimeRange(summary, inferTimestamp(raw));
  });
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

async function listProjectDirectories(projectsRoot, variants) {
  let entries;
  try {
    entries = await readdir(projectsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name === variants.exact || name.startsWith(variants.prefix))
    .map((name) => path.join(projectsRoot, name));
}

export class WorkbuddySessionAnalyzer extends SessionAnalyzer {
  currentSessionId() {
    return process.env.WORKBUDDY_SESSION_ID ?? null;
  }

  async resolveScope(options = {}) {
    const since = normalizeCliDate(options.since, false);
    const until = normalizeCliDate(options.until, true);
    const workspace = normalizeWorkspace(options.workspace);
    // WorkBuddy keeps its data root at ~/.workbuddy; WORKBUDDY_DIR overrides.
    const home = path.resolve(expandHome(
      options.home ?? options.workbuddyHome ?? options["workbuddy-home"] ?? process.env.WORKBUDDY_DIR ?? "~/.workbuddy",
    ));
    const projectsDir = path.resolve(expandHome(
      options.projectsDir ?? options["projects-dir"] ?? path.join(home, "projects"),
    ));
    return {
      platform: "workbuddy",
      workspace,
      home,
      projectsDir,
      _workspaceSlugVariants: workspaceToWorkbuddySlugVariants(workspace),
      since: since.label,
      sinceTime: since.time,
      until: until.label,
      untilTime: until.time,
      sessionId: options["session-id"] ?? options.sessionId ?? options._?.[0] ?? null,
      includeGlobalCapabilities: parseBooleanFlag(options["include-global-capabilities"] ?? false),
    };
  }

  async discoverSourceRoots(scope) {
    const roots = [
      {
        id: "workbuddy-projects",
        kind: "workbuddy-session-jsonl",
        role: "session-transcript",
        path: path.join(scope.projectsDir, scope._workspaceSlugVariants.exact),
        paths: [scope.projectsDir],
        optional: false,
        enabled: true,
        workspaceScoped: true,
        coverage: "primary",
      },
    ];
    return Promise.all(roots.map(async (root) => ({
      ...root,
      exists: await pathExists(root.path) || await pathExists(root.paths[0]),
    })));
  }

  async discoverSessions(scope, roots) {
    const sessions = new Map();
    const transcriptRoot = roots.find((root) => root.kind === "workbuddy-session-jsonl");
    if (!transcriptRoot) return [];
    const seenDirs = new Set();
    for (const projectsRoot of transcriptRoot.paths ?? []) {
      if (!await pathExists(projectsRoot)) continue;
      for (const dirPath of await listProjectDirectories(projectsRoot, scope._workspaceSlugVariants)) {
        let realDir;
        try { realDir = realpathSync.native(dirPath); } catch { realDir = path.resolve(dirPath); }
        if (seenDirs.has(realDir)) continue;
        seenDirs.add(realDir);
        const files = await walkFiles(dirPath, { maxDepth: 1, limit: 20_000, match: (file) => file.endsWith(".jsonl") });
        for (const filePath of files) {
          const probe = await probeTranscript(filePath, scope.workspace);
          if (!probe.workspaceMatch || !withinTimeRange(probe.lastSeen ?? probe.firstSeen, scope)) continue;
          addRef(sessions, probe.sessionId, scope.workspace, {
            kind: transcriptRoot.kind,
            role: transcriptRoot.role,
            path: filePath,
            firstSeen: probe.firstSeen,
            lastSeen: probe.lastSeen,
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
    return transcriptEvents(raw, sourceRef, options);
  }

  async readSession(session, scope, options = {}) {
    const events = [];
    for (const ref of session.sourceRefs ?? []) {
      if (!ref.path.endsWith(".jsonl")) continue;
      await forEachJsonLine(ref.path, (raw, line) => {
        if (raw?.cwd && !isWorkspaceMatch(raw.cwd, scope.workspace)) return;
        for (const event of this.normalizeEvents(raw, { ...ref, sessionId: session.sessionId, line }, options)) {
          if (withinTimeRange(event.timestamp, scope)) events.push(event);
        }
      });
    }
    return dedupeUsageEvents(events.sort((left, right) =>
      (timestampMillis(left.timestamp) ?? 0) - (timestampMillis(right.timestamp) ?? 0)
      || Number(left.evidenceRef?.line ?? 0) - Number(right.evidenceRef?.line ?? 0)
      || Number(left.evidenceRef?.seq ?? 0) - Number(right.evidenceRef?.seq ?? 0)));
  }

  async analyze(options = {}) {
    return runProviderAnalysis(this, options, { platform: "workbuddy", adapterVersion: "workbuddy-v1" });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { command = "sessions", options } = parseArgs(argv);
  const analyzer = new WorkbuddySessionAnalyzer();
  const result = await runProviderCommand(analyzer, command, options);
  await emitProviderResult({ provider: "WorkBuddy", command, options, result });
  return result;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`workbuddy session-analysis failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}

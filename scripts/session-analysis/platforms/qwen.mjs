#!/usr/bin/env node

import { realpathSync } from "node:fs";
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

export function workspaceToQwenSlugVariants(workspace) {
  const expanded = expandHome(workspace ?? process.cwd());
  const normalized = path.win32.isAbsolute(expanded) ? path.win32.normalize(expanded) : normalizeWorkspace(expanded);
  // Match Qwen's sanitizeCwd: replace every non-alphanumeric char with "-".
  // On Windows Qwen lowercases first; emit both variants for cross-platform discovery.
  const slug = normalized.replace(/[^a-zA-Z0-9]/g, "-");
  const slugLower = slug.toLowerCase();
  return [...new Set([slug, slugLower])];
}

function inferSessionId(raw, fallback = null) {
  return raw?.sessionId ?? raw?.session_id ?? fallback;
}

function inferTimestamp(raw) {
  return normalizeTimestamp(raw?.timestamp ?? raw?.ts ?? raw?._timestamp ?? null);
}

function messageParts(raw) {
  const parts = raw?.message?.parts ?? raw?.message?.content ?? raw?.parts;
  return Array.isArray(parts) ? parts : [];
}

function textFromParts(parts) {
  return parts
    .filter((part) => typeof part === "string" || (part && typeof part === "object" && part.text !== undefined && !part.thought))
    .map((part) => (typeof part === "string" ? part : part.text))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function inferUsage(raw) {
  const usage = raw?.usageMetadata ?? raw?.message?.usageMetadata ?? raw?.usage;
  if (!usage || typeof usage !== "object") return null;
  const fields = {
    inputTokens: usage.promptTokenCount ?? usage.input_tokens ?? usage.inputTokens,
    outputTokens: usage.candidatesTokenCount ?? usage.output_tokens ?? usage.outputTokens,
    cacheReadInputTokens: usage.cachedContentTokenCount ?? usage.cache_read_input_tokens ?? usage.cacheReadInputTokens,
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
  if (!/(?:bash|shell|exec|terminal|run)/i.test(String(toolName ?? ""))) return null;
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
  const parts = messageParts(raw);
  const events = [];
  const base = {
    sessionId,
    timestamp,
    sourceKind: sourceRef.kind,
    planningScope: "workspace",
    cwd,
    isSubagent: null,
  };

  if (rawType === "user") {
    const text = textFromParts(parts);
    events.push({
      ...base,
      type: "user",
      category: "user",
      evidenceRef: evidenceRef(raw, sourceRef, "user"),
      summary: text ? `user message (${text.length} chars)` : "user",
      contentLength: text.length,
      userPrompt: text.length > 0,
      ...(options.includeUserText && text ? { userText: text } : {}),
      ...(options.includeContent && text ? { content: text } : {}),
    });
  } else if (rawType === "assistant") {
    const model = raw?.model ?? raw?.message?.model;
    const usage = inferUsage(raw);
    const visibleText = textFromParts(parts);
    const event = {
      ...base,
      type: "assistant",
      category: "assistant",
      evidenceRef: evidenceRef(raw, sourceRef, "assistant"),
      summary: visibleText ? `assistant message (${visibleText.length} chars)` : "assistant",
      contentLength: visibleText.length,
    };
    if (visibleText) event.userVisibleAssistantMessage = true;
    if (options.includeContent && visibleText) event.content = visibleText;
    if (model && !usage) event.model = model;
    events.push(event);
    if (usage) {
      events.push({
        ...base,
        type: "model.response.completed",
        category: "model",
        model: model ?? null,
        modelUsage: usage,
        usageFieldsObserved: true,
        responseId: raw?.uuid ?? null,
        evidenceRef: evidenceRef(raw, sourceRef, "model.response.completed"),
        summary: "Qwen model response completed",
      });
    }
    parts.forEach((part, index) => {
      if (!part || typeof part !== "object" || !part.functionCall) return;
      const fc = part.functionCall;
      const input = fc.args && typeof fc.args === "object" ? fc.args : {};
      const toolEvent = {
        ...base,
        type: "tool.call",
        category: "tool",
        lifecyclePhase: "request",
        toolName: fc.name ?? "unknown-tool",
        toolInvocationId: fc.id ?? null,
        evidenceRef: evidenceRef(raw, sourceRef, "tool.call", index),
        summary: `${fc.name ?? "unknown-tool"} request`,
      };
      const commandText = inferCommandText(fc.name, input);
      const filePath = inferFilePath(fc.name, input);
      if (options.includeCommandText && commandText) toolEvent.commandText = commandText;
      if (filePath) toolEvent.filePath = filePath;
      if (fc.name === "Skill") {
        const skillName = input.skill ?? input.name;
        if (skillName) {
          toolEvent.skillName = String(skillName).split(":").at(-1);
          toolEvent.skillNames = [toolEvent.skillName];
        }
      }
      events.push(toolEvent);
    });
  } else if (rawType === "tool_result") {
    const tcr = raw?.toolCallResult ?? {};
    const fr = parts.find((part) => part?.functionResponse)?.functionResponse;
    const callId = tcr.callId ?? fr?.id ?? null;
    const hasError = Boolean(tcr.errorType) || (tcr.error && Object.keys(tcr.error).length > 0);
    const success = !hasError && tcr.status !== "error" && tcr.status !== "failed" && tcr.status !== "cancelled";
    const output = tcr.resultDisplay ?? fr?.response?.output ?? "";
    const event = {
      ...base,
      type: "tool.result",
      category: "tool",
      lifecyclePhase: "result",
      toolInvocationId: callId,
      success,
      hasError: !success,
      evidenceRef: evidenceRef(raw, sourceRef, "tool.result"),
      summary: !success ? "tool result failed" : "tool result",
    };
    if (fr?.name) event.toolName = fr.name;
    const resultFacts = parseResultFacts(String(output).slice(-8_192));
    if (resultFacts) event.resultFacts = resultFacts;
    events.push(event);
  } else if (rawType === "system") {
    events.push({
      ...base,
      type: "metadata.system",
      category: "metadata",
      evidenceRef: evidenceRef(raw, sourceRef, "metadata.system"),
      summary: raw?.subtype ? `system:${raw.subtype}` : "system",
    });
  } else {
    events.push({
      ...base,
      type: `metadata.${rawType}`,
      category: "metadata",
      evidenceRef: evidenceRef(raw, sourceRef, `metadata.${rawType}`),
      summary: rawType,
    });
  }

  return events;
}

async function probeTranscript(filePath, workspace) {
  const summary = { sessionId: path.basename(filePath, ".jsonl"), firstSeen: null, lastSeen: null, workspaceMatch: false };
  await forEachJsonLine(filePath, (raw) => {
    summary.sessionId = inferSessionId(raw, summary.sessionId);
    if (isWorkspaceMatch(raw?.cwd, workspace)) summary.workspaceMatch = true;
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

export class QwenSessionAnalyzer extends SessionAnalyzer {
  currentSessionId() {
    return process.env.QWEN_SESSION_ID ?? process.env.QWENCODE_SESSION_ID ?? null;
  }

  async resolveScope(options = {}) {
    const since = normalizeCliDate(options.since, false);
    const until = normalizeCliDate(options.until, true);
    const workspace = normalizeWorkspace(options.workspace);
    const home = path.resolve(expandHome(options.home ?? options.qwenHome ?? options["qwen-home"] ?? process.env.QWEN_HOME ?? "~/.qwen"));
    // Qwen separates config home (QWEN_HOME / ~/.qwen) from runtime data
    // (QWEN_RUNTIME_DIR). Session transcripts live under the runtime dir.
    const runtimeDir = path.resolve(expandHome(
      options.runtimeDir ?? options["runtime-dir"] ?? process.env.QWEN_RUNTIME_DIR ?? home,
    ));
    return {
      platform: "qwen",
      workspace,
      home,
      runtimeDir,
      _workspaceSlugVariants: workspaceToQwenSlugVariants(workspace),
      since: since.label,
      sinceTime: since.time,
      until: until.label,
      untilTime: until.time,
      sessionId: options["session-id"] ?? options.sessionId ?? options._?.[0] ?? null,
      includeGlobalCapabilities: parseBooleanFlag(options["include-global-capabilities"] ?? false),
    };
  }

  async discoverSourceRoots(scope) {
    const projectPaths = scope._workspaceSlugVariants.map((slug) => path.join(scope.runtimeDir, "projects", slug, "chats"));
    const roots = [
      {
        id: "qwen-projects",
        kind: "qwen-project-jsonl",
        role: "session-transcript",
        path: projectPaths[0],
        paths: projectPaths,
        optional: false,
        enabled: true,
        workspaceScoped: true,
        coverage: "primary",
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
    const transcriptRoot = roots.find((root) => root.kind === "qwen-project-jsonl");
    const seenRoots = new Set();
    for (const rootPath of transcriptRoot?.paths ?? []) {
      if (!await pathExists(rootPath)) continue;
      let realRoot;
      try { realRoot = realpathSync.native(rootPath); } catch { realRoot = path.resolve(rootPath); }
      if (seenRoots.has(realRoot)) continue;
      seenRoots.add(realRoot);
      const files = await walkFiles(rootPath, { maxDepth: 2, limit: 20_000, match: (file) => file.endsWith(".jsonl") });
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
        if (inferSessionId(raw, session.sessionId) !== session.sessionId) return;
        if (raw?.cwd && !isWorkspaceMatch(raw.cwd, scope.workspace)) return;
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

  async analyze(options = {}) {
    return runProviderAnalysis(this, options, { platform: "qwen", adapterVersion: "qwen-v1" });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { command = "sessions", options } = parseArgs(argv);
  const analyzer = new QwenSessionAnalyzer();
  const result = await runProviderCommand(analyzer, command, options);
  await emitProviderResult({ provider: "Qwen", command, options, result });
  return result;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`qwen session-analysis failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}

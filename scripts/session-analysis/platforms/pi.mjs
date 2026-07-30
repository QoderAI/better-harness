#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SessionAnalyzer } from "../../session-analysis.mjs";
import { parseArgs, parseBooleanFlag } from "../cli.mjs";
import { forEachJsonLine, isDirectory, pathExists, walkFiles } from "../fs.mjs";
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

export function workspaceToPiSessionDirVariants(workspace) {
  const expanded = expandHome(workspace ?? process.cwd());
  const normalized = path.win32.isAbsolute(expanded) ? path.win32.normalize(expanded) : normalizeWorkspace(expanded);
  // Match pi's session directory naming: strip one leading separator, then
  // replace every "/", "\", and ":" with "-", wrapped as --<slug>--.
  const body = normalized.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-");
  return {
    exact: `--${body}--`,
    // Sessions started in a subdirectory of the workspace live in their own
    // cwd-keyed directory; its name starts with the workspace slug body.
    prefix: `--${body}-`,
  };
}

function sessionIdFromFileName(filePath) {
  // Pi session files are named <timestamp>_<uuid>.jsonl.
  const base = path.basename(filePath, ".jsonl");
  const separator = base.indexOf("_");
  return separator >= 0 ? base.slice(separator + 1) : base;
}

function inferTimestamp(raw) {
  return normalizeTimestamp(raw?.timestamp ?? raw?.message?.timestamp ?? null);
}

function contentBlocks(raw) {
  const content = raw?.message?.content;
  if (Array.isArray(content)) return content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return [];
}

function textFromBlocks(blocks) {
  return blocks
    .filter((block) => typeof block === "string" || (block && typeof block === "object" && block.type === "text"))
    .map((block) => (typeof block === "string" ? block : block.text))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function inferUsage(raw) {
  const usage = raw?.message?.usage;
  if (!usage || typeof usage !== "object") return null;
  // Pi records usage as finite numbers. Keep partial usage explicit: carry
  // only the fields the transcript actually observed and never coerce a
  // missing or malformed sibling field to zero.
  const observed = {};
  for (const [key, value] of [
    ["inputTokens", usage.input],
    ["outputTokens", usage.output],
    ["cacheReadInputTokens", usage.cacheRead],
    ["cacheCreationInputTokens", usage.cacheWrite],
  ]) {
    if (typeof value === "number" && Number.isFinite(value)) observed[key] = value;
  }
  return Object.keys(observed).length > 0 ? observed : null;
}

function inferFilePath(toolName, input = {}) {
  if (!/(?:read|edit|write|file|notebook)/i.test(String(toolName ?? ""))) return null;
  return input.file_path ?? input.filePath ?? input.path ?? null;
}

function inferCommandText(toolName, input = {}) {
  if (!/(?:bash|shell|exec|terminal|run)/i.test(String(toolName ?? ""))) return null;
  return input.command ?? input.cmd ?? null;
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

function transcriptEvents(raw, sourceRef, options) {
  const rawType = raw?.type ?? "record";
  const role = raw?.message?.role ?? null;
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
    const blocks = contentBlocks(raw);
    const model = raw?.message?.model ?? null;
    const usage = inferUsage(raw);
    const visibleText = textFromBlocks(blocks);
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
    if (usage) {
      events.push({
        ...base,
        type: "model.response.completed",
        category: "model",
        model,
        modelUsage: usage,
        usageFieldsObserved: true,
        responseId: raw?.id ?? null,
        evidenceRef: evidenceRef(sourceRef, "model.response.completed"),
        summary: "Pi model response completed",
      });
    }
    blocks.forEach((block, index) => {
      if (!block || typeof block !== "object" || block.type !== "toolCall") return;
      const input = block.arguments && typeof block.arguments === "object" ? block.arguments : {};
      const toolEvent = {
        ...base,
        type: "tool.call",
        category: "tool",
        lifecyclePhase: "request",
        toolName: block.name ?? "unknown-tool",
        toolInvocationId: block.id ?? null,
        evidenceRef: evidenceRef(sourceRef, "tool.call", index),
        summary: `${block.name ?? "unknown-tool"} request`,
      };
      const commandText = inferCommandText(block.name, input);
      const filePath = inferFilePath(block.name, input);
      if (options.includeCommandText && commandText) toolEvent.commandText = commandText;
      if (filePath) toolEvent.filePath = filePath;
      events.push(toolEvent);
    });
  } else if (rawType === "message" && role === "toolResult") {
    const message = raw.message ?? {};
    const success = message.isError !== true;
    const output = textFromBlocks(contentBlocks(raw));
    const event = {
      ...base,
      type: "tool.result",
      category: "tool",
      lifecyclePhase: "result",
      toolInvocationId: message.toolCallId ?? null,
      success,
      hasError: !success,
      evidenceRef: evidenceRef(sourceRef, "tool.result"),
      summary: !success ? "tool result failed" : "tool result",
    };
    if (message.toolName) event.toolName = message.toolName;
    const resultFacts = parseResultFacts(String(output).slice(-8_192));
    if (resultFacts) event.resultFacts = resultFacts;
    events.push(event);
  } else if (rawType === "session") {
    events.push({
      ...base,
      type: "metadata.session",
      category: "metadata",
      evidenceRef: evidenceRef(sourceRef, "metadata.session"),
      summary: raw?.version ? `session header (v${raw.version})` : "session header",
    });
  } else {
    // model_change, thinking_level_change, compaction, session_info,
    // custom, custom_message, and other lifecycle records stay metadata.
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

async function probeTranscript(filePath, workspace) {
  const summary = {
    sessionId: sessionIdFromFileName(filePath),
    firstSeen: null,
    lastSeen: null,
    workspaceMatch: false,
    validHeader: false,
  };
  let firstRecord = true;
  await forEachJsonLine(filePath, (raw) => {
    if (firstRecord) {
      firstRecord = false;
      // Pi requires the first parsed record to be the session header. Do not
      // let a later injected header qualify an otherwise foreign transcript.
      if (raw?.type !== "session" || typeof raw.id !== "string" || !isWorkspaceMatch(raw.cwd, workspace)) {
        return false;
      }
      summary.validHeader = true;
      summary.workspaceMatch = true;
      summary.sessionId = raw.id;
    } else if (raw?.type === "session") {
      // Multiple headers are not a valid Pi session and can splice content
      // from different workspaces, so reject the whole file fail-closed.
      summary.validHeader = false;
      summary.workspaceMatch = false;
      return false;
    }
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

async function listSessionDirectories(sessionsRoot, variants) {
  let entries;
  try {
    entries = await readdir(sessionsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name === variants.exact || name.startsWith(variants.prefix))
    .map((name) => path.join(sessionsRoot, name));
}

async function readSettingsSessionDir(settingsPath) {
  try {
    const raw = await readFile(settingsPath, "utf8");
    const settings = JSON.parse(raw);
    return typeof settings?.sessionDir === "string" && settings.sessionDir.trim() !== "" ? settings.sessionDir : null;
  } catch {
    return null;
  }
}

function resolvePiSessionDir(value, workspace) {
  const expanded = expandHome(value);
  return path.resolve(path.isAbsolute(expanded) ? expanded : path.join(workspace, expanded));
}

// Pi treats --session-dir, PI_CODING_AGENT_SESSION_DIR, and the settings
// `sessionDir` key as the exact directory that contains session JSONL files.
// Only the built-in default is a cwd-keyed tree of --<cwd-slug>-- children
// under <agent-dir>/sessions. Resolution order matches Pi: CLI option, then
// environment, then project settings over global settings, then the default.
async function resolveSessionDirContract(options, home, workspace) {
  const cliDir = options.sessionsDir ?? options["sessions-dir"] ?? options["session-dir"] ?? options.sessionDir;
  if (cliDir) {
    return { mode: "custom", dir: resolvePiSessionDir(cliDir, workspace) };
  }
  if (process.env.PI_CODING_AGENT_SESSION_DIR) {
    return { mode: "custom", dir: resolvePiSessionDir(process.env.PI_CODING_AGENT_SESSION_DIR, workspace) };
  }
  const settingsDir = (await readSettingsSessionDir(path.join(workspace, ".pi", "settings.json")))
    ?? (await readSettingsSessionDir(path.join(home, "settings.json")));
  if (settingsDir) {
    return { mode: "custom", dir: resolvePiSessionDir(settingsDir, workspace) };
  }
  return { mode: "default", dir: path.join(home, "sessions") };
}

export class PiSessionAnalyzer extends SessionAnalyzer {
  currentSessionId() {
    return process.env.PI_SESSION_ID ?? null;
  }

  async resolveScope(options = {}) {
    const since = normalizeCliDate(options.since, false);
    const until = normalizeCliDate(options.until, true);
    const workspace = normalizeWorkspace(options.workspace);
    // Pi resolves its agent dir from PI_CODING_AGENT_DIR (default ~/.pi/agent).
    const home = path.resolve(expandHome(
      options.home ?? options.piHome ?? options["pi-home"] ?? process.env.PI_CODING_AGENT_DIR ?? "~/.pi/agent",
    ));
    const sessionDirContract = await resolveSessionDirContract(options, home, workspace);
    return {
      platform: "pi",
      workspace,
      home,
      sessionsDir: sessionDirContract.dir,
      sessionDirMode: sessionDirContract.mode,
      _workspaceDirVariants: workspaceToPiSessionDirVariants(workspace),
      since: since.label,
      sinceTime: since.time,
      until: until.label,
      untilTime: until.time,
      sessionId: options["session-id"] ?? options.sessionId ?? options._?.[0] ?? null,
      includeGlobalCapabilities: parseBooleanFlag(options["include-global-capabilities"] ?? false),
    };
  }

  async discoverSourceRoots(scope) {
    const custom = scope.sessionDirMode === "custom";
    const matchingDirs = custom
      ? []
      : await listSessionDirectories(scope.sessionsDir, scope._workspaceDirVariants);
    const root = {
      id: "pi-sessions",
      kind: "pi-session-jsonl",
      role: "session-transcript",
      path: custom
        ? scope.sessionsDir
        : (matchingDirs[0] ?? path.join(scope.sessionsDir, scope._workspaceDirVariants.exact)),
      paths: [scope.sessionsDir],
      optional: false,
      enabled: true,
      workspaceScoped: true,
      coverage: "primary",
      sessionDirMode: scope.sessionDirMode,
    };
    // A parent directory alone is not proof of a workspace evidence root:
    // in the default tree, existence requires at least one workspace-keyed
    // session directory; a custom flat directory must itself exist.
    const exists = custom
      ? await isDirectory(scope.sessionsDir)
      : matchingDirs.length > 0;
    return [{ ...root, exists }];
  }

  async discoverSessions(scope, roots) {
    const sessions = new Map();
    const transcriptRoot = roots.find((root) => root.kind === "pi-session-jsonl");
    if (!transcriptRoot) return [];
    const custom = scope.sessionDirMode === "custom";
    const seenDirs = new Set();
    for (const sessionsRoot of transcriptRoot.paths ?? []) {
      if (!await pathExists(sessionsRoot)) continue;
      // Custom session directories contain JSONL files directly; the default
      // tree nests them under workspace-keyed --<cwd-slug>-- directories.
      const candidateDirs = custom
        ? [sessionsRoot]
        : await listSessionDirectories(sessionsRoot, scope._workspaceDirVariants);
      for (const dirPath of candidateDirs) {
        let realDir;
        try { realDir = realpathSync.native(dirPath); } catch { realDir = path.resolve(dirPath); }
        if (seenDirs.has(realDir)) continue;
        seenDirs.add(realDir);
        const files = await walkFiles(dirPath, { maxDepth: 1, limit: 20_000, match: (file) => file.endsWith(".jsonl") });
        for (const filePath of files) {
          // Both modes qualify each transcript by the session-header cwd, so a
          // shared custom directory never leaks foreign-workspace sessions.
          const probe = await probeTranscript(filePath, scope.workspace);
          if (!probe.validHeader || !probe.workspaceMatch || !withinTimeRange(probe.lastSeen ?? probe.firstSeen, scope)) continue;
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
        if (raw?.type === "session" && raw?.cwd && !isWorkspaceMatch(raw.cwd, scope.workspace)) return;
        for (const event of this.normalizeEvents(raw, { ...ref, sessionId: session.sessionId, line }, options)) {
          if (withinTimeRange(event.timestamp, scope)) events.push(event);
        }
      });
    }
    return events.sort((left, right) =>
      (timestampMillis(left.timestamp) ?? 0) - (timestampMillis(right.timestamp) ?? 0)
      || Number(left.evidenceRef?.line ?? 0) - Number(right.evidenceRef?.line ?? 0)
      || Number(left.evidenceRef?.seq ?? 0) - Number(right.evidenceRef?.seq ?? 0));
  }

  async analyze(options = {}) {
    return runProviderAnalysis(this, options, { platform: "pi", adapterVersion: "pi-v1" });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { command = "sessions", options } = parseArgs(argv);
  const analyzer = new PiSessionAnalyzer();
  const result = await runProviderCommand(analyzer, command, options);
  await emitProviderResult({ provider: "Pi", command, options, result });
  return result;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`pi session-analysis failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}

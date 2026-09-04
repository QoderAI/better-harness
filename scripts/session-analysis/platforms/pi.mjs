#!/usr/bin/env node

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

// A Windows-shaped workspace string stays a Windows path on every host, so the
// slug keeps its drive letter instead of being resolved against the POSIX cwd.
function normalizeWorkspaceForSlug(workspace) {
  const expanded = expandHome(workspace ?? process.cwd());
  return path.win32.isAbsolute(expanded) ? path.win32.normalize(expanded) : normalizeWorkspace(expanded);
}

// OMP (Oh My Pi) names session directories relative to the home directory: one
// leading "-" plus the home-relative path with separators folded to "-", e.g.
// ~/src/dotai → "-src-dotai" instead of pi's "--Users-ooxx-src-dotai--".
// This reads the host-native path rather than the slug form, because only a
// host-native absolute path can be home-relative at all: a foreign-platform
// workspace string would resolve against the host cwd and invent a false body.
function homeRelativeSlugBody(workspace) {
  const expanded = expandHome(workspace ?? process.cwd());
  const home = expandHome("~");
  if (typeof home !== "string" || !path.isAbsolute(home) || !path.isAbsolute(expanded)) return null;
  const relative = path.relative(home, path.resolve(expanded));
  // Compare whole segments: a directory legitimately named "..cache" is inside
  // the home directory, while ".." and "../<rest>" escape it.
  const outsideHome = relative === ".." || relative.startsWith(`..${path.sep}`);
  if (!relative || outsideHome || path.isAbsolute(relative)) return null;
  return relative.replace(/[/\\:]/g, "-");
}

export function workspaceToPiSessionDirVariants(workspace) {
  const normalized = normalizeWorkspaceForSlug(workspace);
  // Match pi's session directory naming: strip one leading separator, then
  // replace every "/", "\", and ":" with "-", wrapped as --<slug>--.
  const body = normalized.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-");
  const result = {
    exact: `--${body}--`,
    // Sessions started in a subdirectory of the workspace live in their own
    // cwd-keyed directory; its name starts with the workspace slug body.
    prefix: `--${body}-`,
  };
  const homeBody = homeRelativeSlugBody(workspace);
  if (homeBody) {
    result.homeExact = `-${homeBody}`;
    // Keep the trailing separator: without it a sibling workspace whose name
    // merely starts with this one (~/src/dotai vs ~/src/dotai-next) would
    // qualify as a subdirectory session directory.
    result.homePrefix = `-${homeBody}-`;
  }
  return result;
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

// OMP `/fork` copies every parent entry into the new session file. The header
// timestamp is the fork point, so records stamped before it were produced by the
// parent session. Discovery and reading share this predicate so the session time
// range can never disagree with the events the session actually yields.
function isInheritedForkEntry(raw, forkCutoff) {
  if (forkCutoff === null || raw?.type === "session") return false;
  const millis = timestampMillis(inferTimestamp(raw));
  return millis !== null && millis < forkCutoff;
}

async function probeTranscript(filePath, scope) {
  const summary = {
    sessionId: sessionIdFromFileName(filePath),
    firstSeen: null,
    lastSeen: null,
    workspaceMatch: false,
    validHeader: false,
    cwd: null,
    parentSessionId: null,
    forkTimestamp: null,
    // Time range excluding entries inherited from the parent session. Used only
    // when the parent is discovered too, so inherited entries stay counted once.
    ownedFirstSeen: null,
    ownedLastSeen: null,
  };
  const ownedRange = { firstSeen: null, lastSeen: null };
  let headerSeen = false;
  let forkCutoff = null;
  await forEachJsonLine(filePath, (raw) => {
    if (!headerSeen) {
      // OMP emits a "title" record before the session header; skip it.
      // Any other non-session record before the header indicates a foreign
      // or corrupted transcript — reject fail-closed.
      if (raw?.type === "title") return undefined;
      if (raw?.type !== "session") return false;
      headerSeen = true;
      if (typeof raw.id !== "string" || !isScopedWorkspaceMatch(raw.cwd, scope)) {
        return false;
      }
      summary.validHeader = true;
      summary.workspaceMatch = true;
      summary.sessionId = raw.id;
      summary.cwd = raw.cwd;
      if (typeof raw.parentSession === "string" && raw.parentSession.length > 0) {
        summary.parentSessionId = raw.parentSession;
        summary.forkTimestamp = normalizeTimestamp(raw.timestamp) ?? null;
        forkCutoff = timestampMillis(summary.forkTimestamp);
      }
    } else if (raw?.type === "session") {
      // Multiple headers are not a valid Pi session and can splice content
      // from different workspaces, so reject the whole file fail-closed.
      summary.validHeader = false;
      summary.workspaceMatch = false;
      return false;
    }
    const timestamp = inferTimestamp(raw);
    mergeTimeRange(summary, timestamp);
    if (!isInheritedForkEntry(raw, forkCutoff)) mergeTimeRange(ownedRange, timestamp);
  });
  summary.ownedFirstSeen = ownedRange.firstSeen;
  summary.ownedLastSeen = ownedRange.lastSeen;
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
    workspaceCwds: new Set(),
    parentSessionId: null,
    forkTimestamp: null,
  };
  // Provenance is per file; the effective fork cutoff is applied per source ref
  // so a second transcript for the same id never inherits a foreign cutoff.
  session.parentSessionId ??= ref.parentSessionId ?? null;
  session.forkTimestamp ??= ref.forkTimestamp ?? null;
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

function matchesSessionDirVariants(name, variants) {
  if (name === variants.exact || name.startsWith(variants.prefix)) return true;
  if (variants.homeExact == null) return false;
  return name === variants.homeExact || name.startsWith(variants.homePrefix);
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
    .filter((name) => matchesSessionDirVariants(name, variants))
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
    const workspaceMatchScope = workspaceMatchScopeFromOptions(options);
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
      _workspaceDirVariantSets: [...new Set([
        workspace,
        workspaceMatchScope?.requestedWorkspace,
        workspaceMatchScope?.target.kind === "workspace-member" ? workspaceMatchScope.gitRoot : null,
      ].filter(Boolean))].map((candidate) => workspaceToPiSessionDirVariants(candidate)),
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
    const custom = scope.sessionDirMode === "custom";
    const matchingDirs = custom
      ? []
      : [...new Set((await Promise.all(
          scope._workspaceDirVariantSets.map((variants) => listSessionDirectories(scope.sessionsDir, variants)),
        )).flat())];
    const primaryVariants = scope._workspaceDirVariantSets[0];
    const root = {
      id: "pi-sessions",
      kind: "pi-session-jsonl",
      role: "session-transcript",
      path: custom
        ? scope.sessionsDir
        : (matchingDirs[0] ?? path.join(scope.sessionsDir, primaryVariants.exact)),
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
    const transcriptRoot = roots.find((root) => root.kind === "pi-session-jsonl");
    if (!transcriptRoot) return [];
    const custom = scope.sessionDirMode === "custom";
    const seenDirs = new Set();
    const probes = [];
    for (const sessionsRoot of transcriptRoot.paths ?? []) {
      if (!await pathExists(sessionsRoot)) continue;
      // Custom session directories contain JSONL files directly; the default
      // tree nests them under workspace-keyed --<cwd-slug>-- directories.
      const candidateDirs = custom
        ? [sessionsRoot]
        : [...new Set((await Promise.all(
            scope._workspaceDirVariantSets.map((variants) => listSessionDirectories(sessionsRoot, variants)),
          )).flat())];
      for (const dirPath of candidateDirs) {
        let realDir;
        try { realDir = realpathSync.native(dirPath); } catch { realDir = path.resolve(dirPath); }
        if (seenDirs.has(realDir)) continue;
        seenDirs.add(realDir);
        const files = await walkFiles(dirPath, { maxDepth: 1, limit: 20_000, match: (file) => file.endsWith(".jsonl") });
        for (const filePath of files) {
          // Both modes qualify each transcript by the session-header cwd, so a
          // shared custom directory never leaks foreign-workspace sessions.
          const probe = await probeTranscript(filePath, scope);
          if (!probe.validHeader || !probe.workspaceMatch || !withinTimeRange(probe.lastSeen ?? probe.firstSeen, scope)) continue;
          probes.push({ filePath, probe });
        }
      }
    }
    // A fork cutoff only deduplicates evidence the parent session also carries.
    // When the parent is absent from this result the inherited entries have no
    // other owner, so they stay with the fork rather than vanishing untracked.
    const discoveredIds = new Set(probes.map(({ probe }) => probe.sessionId));
    const sessions = new Map();
    for (const { filePath, probe } of probes) {
      const dedupeFork = probe.forkTimestamp !== null
        && probe.parentSessionId !== null
        && discoveredIds.has(probe.parentSessionId);
      addRef(sessions, probe.sessionId, scope.workspace, {
        kind: transcriptRoot.kind,
        role: transcriptRoot.role,
        path: filePath,
        firstSeen: dedupeFork ? probe.ownedFirstSeen ?? probe.firstSeen : probe.firstSeen,
        lastSeen: dedupeFork ? probe.ownedLastSeen ?? probe.lastSeen : probe.lastSeen,
        cwd: probe.cwd,
        parentSessionId: probe.parentSessionId,
        forkTimestamp: dedupeFork ? probe.forkTimestamp : null,
      });
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
    const requestedMaxLines = Number(options.workspacePreflightMaxLines);
    const preflight = Number.isFinite(requestedMaxLines) && requestedMaxLines > 0;
    let remainingLines = preflight ? Math.trunc(requestedMaxLines) : null;
    let truncated = false;
    const identityCwd = scope._workspaceMatchScope
      ? sessionWorkspaceCwd(session, scope._workspaceMatchScope)
      : null;
    for (const ref of session.sourceRefs ?? []) {
      if (remainingLines !== null && remainingLines <= 0) {
        truncated = true;
        break;
      }
      if (!ref.path.endsWith(".jsonl")) continue;
      // Per source ref: discovery decided whether this file's inherited entries
      // are already owned by a discovered parent session.
      const forkCutoff = ref.forkTimestamp ? timestampMillis(ref.forkTimestamp) : null;
      const readCoverage = await forEachJsonLine(ref.path, (raw, line) => {
        if (raw?.type === "session" && raw?.cwd && !isScopedWorkspaceMatch(raw.cwd, scope)) return;
        if (isInheritedForkEntry(raw, forkCutoff)) return;
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
    const sorted = events
      .map((event) => event.cwd || !identityCwd ? event : { ...event, cwd: identityCwd })
      .sort((left, right) =>
      (timestampMillis(left.timestamp) ?? 0) - (timestampMillis(right.timestamp) ?? 0)
      || Number(left.evidenceRef?.line ?? 0) - Number(right.evidenceRef?.line ?? 0)
      || Number(left.evidenceRef?.seq ?? 0) - Number(right.evidenceRef?.seq ?? 0));
    return markSessionReadCoverage(sorted, { truncated });
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

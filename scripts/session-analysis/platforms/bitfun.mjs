#!/usr/bin/env node
/**
 * OpenBitFun (BitFun) session evidence adapter.
 *
 * Sessions live below the product home (~/.openbitfun, $OPENBITFUN_HOME):
 *   projects/<runtime-key>/sessions/<session-id>/
 *     metadata.json            { schema_version, metadata }
 *     turns/turn-0000.json     { schema_version, turn }
 *
 * The runtime project key is a host-owned hash, so discovery scans metadata.json
 * and trusts its workspace fields instead of reimplementing the derivation.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SessionAnalyzer } from "../analyzer.mjs";
import { parseArgs } from "../cli.mjs";
import { pathExists, readJson } from "../fs.mjs";
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

const LOCAL_WORKSPACE_HOSTNAME = "localhost";

export function defaultBitfunHome() {
  return process.env.OPENBITFUN_HOME ?? path.join(expandHome("~"), ".openbitfun");
}

function isWorkspaceMatch(candidate, workspace) {
  if (!candidate) return false;
  const resolved = normalizeWorkspace(candidate);
  return resolved === workspace || resolved.startsWith(`${workspace}${path.sep}`);
}

function isScopedWorkspaceMatch(candidate, scope) {
  if (!scope?._workspaceMatchScope) return isWorkspaceMatch(candidate, scope.workspace);
  return classifyWorkspaceCwd(candidate, scope._workspaceMatchScope) !== WORKSPACE_CWD_MATCH.UNMATCHED;
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

async function readJsonSafe(filePath) {
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

function finiteNumber(...values) {
  return values.find((value) => typeof value === "number" && Number.isFinite(value));
}

function textItemContent(item) {
  return typeof item?.content === "string" ? item.content : "";
}

function firstString(...values) {
  return values.find((value) => typeof value === "string" && value.length > 0) ?? null;
}

const BASH_TOOL_RE = /(?:bash|shell|exec|terminal|command|runcode|run_code|code_execute)/iu;
const FILE_TOOL_RE = /(?:read|edit|write|file|notebook|delete|view|create)/iu;

function toolInput(toolItem) {
  const input = toolItem?.toolCall?.input;
  return input && typeof input === "object" && !Array.isArray(input) ? input : {};
}

function toolNameOf(toolItem) {
  const input = toolInput(toolItem);
  return firstString(
    toolItem?.toolName,
    input.tool,
    input.toolName,
    input.tool_name,
    input.name,
    toolItem?.aiIntent,
  ) ?? "unknown-tool";
}

function inferCommandText(toolName, input) {
  if (!BASH_TOOL_RE.test(String(toolName ?? ""))) return null;
  return firstString(input.command, input.cmd);
}

function inferFilePath(toolName, input) {
  if (!FILE_TOOL_RE.test(String(toolName ?? ""))) return null;
  return firstString(
    input.file_path,
    input.filePath,
    input.target_file,
    input.targetFile,
    input.path,
    input.filename,
  );
}

export function bitfunTokenUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const observed = {};
  for (const [key, value] of [
    ["inputTokens", finiteNumber(usage.inputTokens, usage.input_tokens, usage.promptTokens)],
    ["outputTokens", finiteNumber(usage.outputTokens, usage.output_tokens, usage.completionTokens)],
    ["totalTokens", finiteNumber(usage.totalTokens, usage.total_tokens)],
    ["cacheReadInputTokens", finiteNumber(usage.cachedTokens, usage.cached_tokens)],
  ]) {
    if (value !== undefined) observed[key] = value;
  }
  return Object.keys(observed).length > 0 ? observed : null;
}

function roundModel(round) {
  return firstString(round?.effectiveModelName, round?.effective_model_name, round?.modelConfigId);
}

function textSummary(role, length) {
  return length > 0 ? `${role} message (${length} chars)` : role;
}

/**
 * Map one persisted DialogTurnData into normalized events.
 * Unknown item kinds stay explicit metadata so a schema addition is visible
 * instead of disappearing.
 */
export function bitfunTurnToEvents(turn, sourceRef, options = {}) {
  if (!turn || typeof turn !== "object") return [];
  const kind = String(turn.kind ?? turn.turn_kind ?? "user_dialog");
  const status = String(turn.status ?? "");
  const base = {
    sessionId: sourceRef.sessionId,
    timestamp: normalizeTimestamp(turn.timestamp ?? turn.startTime ?? turn.start_time ?? null),
    sourceKind: sourceRef.kind,
    planningScope: "workspace",
    cwd: sourceRef.cwd ?? null,
    isSubagent: sourceRef.isSubagent ?? null,
  };
  const events = [];
  const turnLabel = `turn ${Number.isInteger(turn.turnIndex) ? turn.turnIndex : (turn.turnIndex ?? "?")}`;
  let model = null;

  if (kind !== "user_dialog") {
    events.push({
      ...base,
      type: "metadata.turn_kind",
      category: "metadata",
      evidenceRef: evidenceRef(sourceRef, "metadata.turn_kind"),
      summary: `${turnLabel} ${kind}`,
      turnKind: kind,
    });
  } else {
    const userContent = typeof turn.userMessage?.content === "string" ? turn.userMessage.content : "";
    events.push({
      ...base,
      type: "user",
      category: "user",
      evidenceRef: evidenceRef(sourceRef, "user"),
      summary: textSummary("user", userContent.length),
      contentLength: userContent.length,
      userPrompt: userContent.length > 0,
      ...(options.includeUserText && userContent ? { userText: userContent } : {}),
      ...(options.includeContent && userContent ? { content: userContent } : {}),
    });

    const rounds = Array.isArray(turn.modelRounds) ? turn.modelRounds : [];
    rounds.forEach((round, roundIndex) => {
      const observedModel = roundModel(round);
      if (!model && observedModel) model = observedModel;
      const roundTimestamp = normalizeTimestamp(round?.timestamp ?? round?.startTime ?? base.timestamp);
      const roundBase = { ...base, timestamp: roundTimestamp };

      const textItems = Array.isArray(round?.textItems) ? round.textItems : [];
      const assistantText = textItems.map((item) => textItemContent(item)).join("");
      if (assistantText.length > 0) {
        events.push({
          ...roundBase,
          type: "assistant",
          category: "assistant",
          evidenceRef: evidenceRef(sourceRef, "assistant", roundIndex),
          summary: textSummary("assistant", assistantText.length),
          contentLength: assistantText.length,
          userVisibleAssistantMessage: true,
          model: observedModel,
          ...(options.includeContent ? { content: assistantText } : {}),
        });
      }

      const thinkingItems = Array.isArray(round?.thinkingItems) ? round.thinkingItems : [];
      const thinkingLength = thinkingItems.reduce(
        (total, item) => total + (typeof item?.content === "string" ? item.content.length : 0),
        0,
      );
      if (thinkingItems.length > 0) {
        events.push({
          ...roundBase,
          type: "metadata.thinking",
          category: "metadata",
          evidenceRef: evidenceRef(sourceRef, "metadata.thinking", roundIndex),
          summary: `thinking (${thinkingItems.length} item${thinkingItems.length === 1 ? "" : "s"}, ${thinkingLength} chars)`,
          model: observedModel,
        });
      }

      const toolItems = Array.isArray(round?.toolItems) ? round.toolItems : [];
      toolItems.forEach((toolItem, toolIndex) => {
        const input = toolInput(toolItem);
        const toolName = toolNameOf(toolItem);
        const toolInvocationId = firstString(toolItem?.toolCall?.id, toolItem?.id);
        const toolBase = {
          ...roundBase,
          timestamp: normalizeTimestamp(toolItem?.startTime ?? toolItem?.start_time ?? roundBase.timestamp),
        };
        const callEvent = {
          ...toolBase,
          type: "tool.call",
          category: "tool",
          lifecyclePhase: "request",
          toolName,
          toolInvocationId,
          evidenceRef: evidenceRef(sourceRef, "tool.call", roundIndex * 1000 + toolIndex),
          summary: `${toolName} request`,
        };
        const commandText = inferCommandText(toolName, input);
        const filePath = inferFilePath(toolName, input);
        if (options.includeCommandText && commandText) callEvent.commandText = commandText;
        if (filePath) callEvent.filePath = filePath;
        events.push(callEvent);

        const result = toolItem?.toolResult;
        if (!result || typeof result !== "object") return;
        const success = result.success !== false && !result.error;
        const resultEvent = {
          ...toolBase,
          timestamp: normalizeTimestamp(toolItem?.endTime ?? toolItem?.end_time ?? toolBase.timestamp),
          type: "tool.result",
          category: "tool",
          lifecyclePhase: "result",
          toolName,
          toolInvocationId,
          success,
          hasError: !success,
          evidenceRef: evidenceRef(sourceRef, "tool.result", roundIndex * 1000 + toolIndex),
          summary: success ? "tool result" : "tool result error",
        };
        const rawResult = result.resultForAssistant
          ?? result.result_for_assistant
          ?? result.result
          ?? null;
        if (rawResult != null) {
          const text = typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult);
          const facts = parseResultFacts(text.slice(-8_192));
          if (facts) resultEvent.resultFacts = facts;
        }
        events.push(resultEvent);
      });
    });
  }

  // Compaction and command turns also consume model tokens, so usage is read
  // from the turn envelope regardless of its kind.
  const usage = bitfunTokenUsage(turn.tokenUsage ?? turn.token_usage);
  if (usage) {
    events.push({
      ...base,
      type: "model.response.completed",
      category: "model",
      modelUsage: usage,
      usageFieldsObserved: true,
      model,
      evidenceRef: evidenceRef(sourceRef, "model.response.completed"),
      summary: "BitFun turn token usage",
    });
  } else if (turn.tokenUsage || turn.token_usage) {
    events.push({
      ...base,
      type: "metadata.token_usage",
      category: "metadata",
      evidenceRef: evidenceRef(sourceRef, "metadata.token_usage"),
      summary: "token usage without observed fields",
    });
  }

  if (status === "error" || turn.error) {
    events.push({
      ...base,
      type: "metadata.turn_error",
      category: "metadata",
      evidenceRef: evidenceRef(sourceRef, "metadata.turn_error"),
      summary: `${turnLabel} error`,
      turnStatus: status || "error",
    });
  } else if (turn.finishReason || turn.finish_reason) {
    events.push({
      ...base,
      type: "metadata.finish_reason",
      category: "metadata",
      evidenceRef: evidenceRef(sourceRef, "metadata.finish_reason"),
      summary: String(turn.finishReason ?? turn.finish_reason),
    });
  }

  return events;
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

/**
 * Sorted `turn-*.json` paths inside a turns directory.
 * The zero-padded name is the host's own persistence order.
 */
export async function listBitfunTurnFiles(turnsDir) {
  let entries;
  try {
    entries = await readdir(turnsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && /^turn-\d+\.json$/u.test(entry.name))
    .map((entry) => path.join(turnsDir, entry.name))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
}

/**
 * Read every session directory below `<home>/projects/*\/sessions`, keeping the
 * parsed metadata so discovery does not stat the same session twice.
 */
async function scanBitfunSessionDirs(projectsDir) {
  const results = [];
  let projectEntries;
  try {
    projectEntries = await readdir(projectsDir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const projectEntry of projectEntries) {
    if (!projectEntry.isDirectory()) continue;
    const sessionsDir = path.join(projectsDir, projectEntry.name, "sessions");
    let sessionEntries;
    try {
      sessionEntries = await readdir(sessionsDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const sessionEntry of sessionEntries) {
      if (!sessionEntry.isDirectory()) continue;
      const sessionDir = path.join(sessionsDir, sessionEntry.name);
      const metadataPath = path.join(sessionDir, "metadata.json");
      if (!(await pathExists(metadataPath))) continue;
      const stored = await readJsonSafe(metadataPath);
      const metadata = stored?.metadata ?? stored;
      if (!metadata || typeof metadata !== "object") continue;
      results.push({ sessionDir, metadataPath, metadata });
    }
  }
  return results;
}

function sessionWorkspaceCandidates(metadata) {
  const target = metadata?.executionTarget ?? metadata?.execution_target;
  return [...new Set([
    metadata?.workspacePath,
    metadata?.workspace_path,
    metadata?.projectWorkspacePath,
    metadata?.project_workspace_path,
    target?.rootPath,
    target?.root_path,
  ].filter((value) => typeof value === "string" && value.length > 0))];
}

function isRemoteWorkspace(metadata) {
  const hostname = metadata?.workspaceHostname ?? metadata?.workspace_hostname;
  if (typeof hostname !== "string" || hostname.length === 0) return false;
  return hostname !== LOCAL_WORKSPACE_HOSTNAME;
}

export class BitfunSessionAnalyzer extends SessionAnalyzer {
  currentSessionId() {
    // BitFun exposes no session-id environment variable to a host process.
    return null;
  }

  async resolveScope(options = {}) {
    const since = normalizeCliDate(options.since, false);
    const until = normalizeCliDate(options.until, true);
    const workspace = normalizeWorkspace(options.workspace);
    const home = path.resolve(expandHome(
      options.home ?? options.bitfunHome ?? options["bitfun-home"] ?? defaultBitfunHome(),
    ));
    return {
      platform: "bitfun",
      workspace,
      home,
      projectsDir: path.join(home, "projects"),
      since: since.label,
      sinceTime: since.time,
      until: until.label,
      untilTime: until.time,
      sessionId: options["session-id"] ?? options.sessionId ?? options._?.[0] ?? null,
      includeGlobalCapabilities: false,
      _workspaceMatchScope: workspaceMatchScopeFromOptions(options),
    };
  }

  async sessionDirs(scope) {
    if (!scope._bitfunSessionDirs) {
      scope._bitfunSessionDirs = await scanBitfunSessionDirs(scope.projectsDir);
    }
    return scope._bitfunSessionDirs;
  }

  async discoverSourceRoots(scope) {
    const dirs = await this.sessionDirs(scope);
    return [{
      id: "bitfun-sessions",
      kind: "bitfun-session-store",
      role: "session-transcript",
      path: scope.projectsDir,
      paths: [scope.projectsDir],
      optional: false,
      enabled: true,
      workspaceScoped: true,
      coverage: "primary",
      exists: dirs.length > 0,
    }];
  }

  async discoverSessions(scope) {
    const sessions = new Map();
    for (const { sessionDir, metadataPath, metadata } of await this.sessionDirs(scope)) {
      if (isRemoteWorkspace(metadata)) continue;
      const candidates = sessionWorkspaceCandidates(metadata);
      const qualifiedCwd = candidates.find((candidate) => isScopedWorkspaceMatch(candidate, scope));
      if (!qualifiedCwd) continue;
      const sessionId = firstString(metadata.sessionId, metadata.session_id, path.basename(sessionDir));
      if (!sessionId) continue;
      if (scope.sessionId && sessionId !== scope.sessionId) continue;

      const firstSeen = normalizeTimestamp(metadata.createdAt ?? metadata.created_at ?? null);
      const lastSeen = normalizeTimestamp(
        metadata.lastActiveAt ?? metadata.last_active_at ?? metadata.lastFinishedAt ?? null,
      );
      if (!withinTimeRange(lastSeen ?? firstSeen, scope)) continue;

      const sessionKind = String(metadata.sessionKind ?? metadata.session_kind ?? "standard");
      const isSubagent = sessionKind === "subagent" || sessionKind === "ephemeral_child";
      const turnsDir = path.join(sessionDir, "turns");
      const hasTurns = await pathExists(turnsDir);
      addRef(sessions, sessionId, scope.workspace, {
        kind: hasTurns ? "bitfun-session-turns" : "bitfun-session-metadata",
        role: hasTurns ? "session-transcript" : "session-metadata",
        path: hasTurns ? turnsDir : metadataPath,
        firstSeen,
        lastSeen,
        cwd: qualifiedCwd,
      });
      // Metadata stays its own source so a session with no readable turns is
      // still visible with explicit coverage instead of vanishing.
      if (hasTurns) {
        addRef(sessions, sessionId, scope.workspace, {
          kind: "bitfun-session-metadata",
          role: "session-metadata",
          path: metadataPath,
          firstSeen,
          lastSeen,
          cwd: qualifiedCwd,
        });
      }
      const session = sessions.get(sessionId);
      session.sessionKind = sessionKind;
      session.isSubagent = isSubagent;
      session.model = firstString(metadata.modelName, metadata.model_name);
      for (const ref of session.sourceRefs) ref.isSubagent = isSubagent;
    }
    return [...sessions.values()].map(finalizeSession)
      .sort((left, right) => (timestampMillis(right.lastSeen) ?? 0) - (timestampMillis(left.lastSeen) ?? 0));
  }

  normalizeEvent(raw, sourceRef, options = {}) {
    return this.normalizeEvents(raw, sourceRef, options)[0] ?? null;
  }

  normalizeEvents(raw, sourceRef, options = {}) {
    if (sourceRef.kind !== "bitfun-session-turns") return [];
    return bitfunTurnToEvents(raw?.turn ?? raw, sourceRef, options);
  }

  async readSession(session, scope, options = {}) {
    const events = [];
    const requestedMaxLines = Number(options.workspacePreflightMaxLines);
    const preflight = Number.isFinite(requestedMaxLines) && requestedMaxLines > 0;
    let remainingTurns = preflight ? Math.trunc(requestedMaxLines) : null;
    let truncated = false;
    const identityCwd = sessionWorkspaceCwd(session, scope._workspaceMatchScope);

    for (const ref of session.sourceRefs ?? []) {
      if (remainingTurns !== null && remainingTurns <= 0) {
        truncated = true;
        break;
      }
      if (ref.kind === "bitfun-session-metadata") {
        events.push({
          sessionId: session.sessionId,
          timestamp: normalizeTimestamp(session.firstSeen),
          sourceKind: ref.kind,
          planningScope: "workspace",
          cwd: identityCwd ?? ref.cwd ?? null,
          isSubagent: ref.isSubagent ?? null,
          type: "metadata.session",
          category: "metadata",
          evidenceRef: evidenceRef({ ...ref, sessionId: session.sessionId }, "metadata.session"),
          // Session titles are user-visible text; keep only structural facts.
          summary: `${session.sessionKind ?? "standard"} session`,
          sessionKind: session.sessionKind,
          model: session.model ?? null,
        });
        continue;
      }
      if (ref.kind !== "bitfun-session-turns") continue;

      const turnFiles = await listBitfunTurnFiles(ref.path);
      let consumed = 0;
      for (const [index, turnFile] of turnFiles.entries()) {
        if (remainingTurns !== null && consumed >= remainingTurns) {
          truncated = true;
          break;
        }
        consumed += 1;
        const stored = await readJsonSafe(turnFile);
        const turn = stored?.turn ?? stored;
        if (!turn || typeof turn !== "object") {
          truncated = true;
          continue;
        }
        const sourceRef = {
          ...ref,
          path: turnFile,
          sessionId: session.sessionId,
          seq: index,
          cwd: ref.cwd,
        };
        for (const event of this.normalizeEvents(turn, sourceRef, options)) {
          if (withinTimeRange(event.timestamp, scope)) events.push(event);
        }
      }
      if (remainingTurns !== null) {
        remainingTurns -= Math.min(consumed, remainingTurns);
        if (consumed < turnFiles.length) truncated = true;
      }
    }

    const sorted = events
      .map((event) => (event.cwd || !identityCwd ? event : { ...event, cwd: identityCwd }))
      .sort((left, right) =>
        (timestampMillis(left.timestamp) ?? 0) - (timestampMillis(right.timestamp) ?? 0)
        || Number(left.evidenceRef?.seq ?? 0) - Number(right.evidenceRef?.seq ?? 0));
    return markSessionReadCoverage(sorted, { truncated });
  }

  async analyze(options = {}) {
    return runProviderAnalysis(this, options, { platform: "bitfun", adapterVersion: "bitfun-v1" });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { command = "sessions", options } = parseArgs(argv);
  const analyzer = new BitfunSessionAnalyzer();
  const result = await runProviderCommand(analyzer, command, options);
  await emitProviderResult({ provider: "BitFun", command, options, result });
  return result;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`bitfun session-analysis failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}

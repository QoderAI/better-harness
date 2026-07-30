#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SessionAnalyzer } from "../../session-analysis.mjs";
import { parseArgs, parseBooleanFlag } from "../cli.mjs";
import { forEachJsonLine, isDirectory, pathExists } from "../fs.mjs";
import { expandHome, normalizeWorkspace } from "../paths.mjs";
import {
  emitProviderResult,
  runProviderAnalysis,
  runProviderCommand,
} from "../provider-runner.mjs";
import { parseResultFacts } from "../result-facts.mjs";
import { mergeTimeRange, normalizeCliDate, normalizeTimestamp, timestampMillis, withinTimeRange } from "../time.mjs";

const TRANSCRIPT_FILE = "events.jsonl";
const WORKSPACE_FILE = "workspace.yaml";

function isWorkspaceMatch(candidate, workspace) {
  if (!candidate) return false;
  const resolved = normalizeWorkspace(candidate);
  return resolved === workspace || resolved.startsWith(`${workspace}${path.sep}`);
}

/**
 * Read the `cwd` binding from a Copilot session's `workspace.yaml`.
 *
 * The file is a flat `key: value` list, so only the two keys this adapter needs
 * are parsed. No YAML dependency is introduced and unknown keys are ignored.
 */
export function parseWorkspaceDescriptor(text) {
  const descriptor = { id: null, cwd: null };
  for (const line of String(text ?? "").split(/\r?\n/u)) {
    const match = /^(id|cwd):\s*(.+?)\s*$/u.exec(line);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/gu, "");
    descriptor[match[1]] = value.length > 0 ? value : null;
  }
  return descriptor;
}

function inferTimestamp(raw) {
  return normalizeTimestamp(raw?.timestamp ?? null);
}

function toolArguments(raw) {
  const args = raw?.data?.arguments;
  return args && typeof args === "object" && !Array.isArray(args) ? args : {};
}

function inferFilePath(toolName, input = {}) {
  if (!/(?:read|edit|write|file|notebook|view|create|patch)/iu.test(String(toolName ?? ""))) return null;
  return input.file_path ?? input.filePath ?? input.path ?? null;
}

function inferCommandText(toolName, input = {}) {
  if (!/(?:bash|shell|exec|terminal|run|powershell)/iu.test(String(toolName ?? ""))) return null;
  return input.command ?? input.cmd ?? null;
}

function evidenceRef(sourceRef, type) {
  return {
    kind: sourceRef.kind,
    path: sourceRef.path,
    line: sourceRef.line ?? null,
    seq: null,
    type,
  };
}

function resultText(data) {
  const result = data?.result;
  if (typeof result === "string") return result;
  return result?.content ?? result?.detailedContent ?? "";
}

/**
 * Normalize one Copilot `events.jsonl` record.
 *
 * Copilot records a typed lifecycle stream. Event names are taken from observed
 * transcripts rather than a published schema, so unrecognized types stay
 * explicit `metadata.*` events instead of being dropped or reinterpreted.
 */
function transcriptEvents(raw, sourceRef, options) {
  const rawType = String(raw?.type ?? "record");
  const data = raw?.data ?? {};
  const sessionId = data.sessionId ?? sourceRef.sessionId ?? null;
  const base = {
    sessionId,
    timestamp: inferTimestamp(raw),
    sourceKind: sourceRef.kind,
    planningScope: "workspace",
    cwd: data?.context?.cwd ?? sourceRef.cwd ?? null,
    isSubagent: raw?.agentId ? true : null,
  };
  const events = [];

  if (rawType === "user.message") {
    const text = typeof data.content === "string" ? data.content : "";
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
    return events;
  }

  if (rawType === "assistant.message") {
    const text = typeof data.content === "string" ? data.content : "";
    const event = {
      ...base,
      type: "assistant",
      category: "assistant",
      evidenceRef: evidenceRef(sourceRef, "assistant"),
      summary: text ? `assistant message (${text.length} chars)` : "assistant",
      contentLength: text.length,
    };
    if (text) event.userVisibleAssistantMessage = true;
    if (options.includeContent && text) event.content = text;
    if (data.model) event.model = data.model;
    events.push(event);
    return events;
  }

  if (rawType === "tool.execution_start") {
    const input = toolArguments(raw);
    const toolName = data.toolName ?? "unknown-tool";
    const event = {
      ...base,
      type: "tool.call",
      category: "tool",
      lifecyclePhase: "request",
      toolName,
      toolInvocationId: data.toolCallId ?? null,
      evidenceRef: evidenceRef(sourceRef, "tool.call"),
      summary: `${toolName} request`,
    };
    const commandText = inferCommandText(toolName, input);
    const filePath = inferFilePath(toolName, input);
    if (options.includeCommandText && commandText) event.commandText = commandText;
    if (filePath) event.filePath = filePath;
    if (/^(?:skill|task)$/iu.test(String(toolName))) {
      const skillName = input.skill ?? input.name ?? input.agent_type;
      if (skillName) {
        event.skillName = String(skillName).split(":").at(-1);
        event.skillNames = [event.skillName];
      }
    }
    events.push(event);
    return events;
  }

  if (rawType === "tool.execution_complete") {
    const success = data.success !== false;
    const event = {
      ...base,
      type: "tool.result",
      category: "tool",
      lifecyclePhase: "result",
      toolInvocationId: data.toolCallId ?? null,
      success,
      hasError: !success,
      evidenceRef: evidenceRef(sourceRef, "tool.result"),
      summary: success ? "tool result" : "tool result failed",
    };
    const facts = parseResultFacts(String(resultText(data)).slice(-8_192));
    if (facts) event.resultFacts = facts;
    events.push(event);
    return events;
  }

  if (rawType === "hook.start" || rawType === "hook.end") {
    const event = {
      ...base,
      type: rawType === "hook.start" ? "hook.call" : "hook.result",
      category: "hook",
      lifecyclePhase: rawType === "hook.start" ? "request" : "result",
      hookEvent: data.hookType ?? null,
      toolInvocationId: data.hookInvocationId ?? null,
      evidenceRef: evidenceRef(sourceRef, rawType),
      summary: `${data.hookType ?? "hook"} ${rawType === "hook.start" ? "request" : "result"}`,
    };
    if (rawType === "hook.end") {
      const success = data.success !== false;
      event.success = success;
      event.hasError = !success;
    }
    events.push(event);
    return events;
  }

  if (rawType === "subagent.started" || rawType === "subagent.completed") {
    const event = {
      ...base,
      type: rawType === "subagent.started" ? "subagent.start" : "subagent.stop",
      category: "delegation",
      lifecyclePhase: rawType === "subagent.started" ? "request" : "result",
      toolInvocationId: data.toolCallId ?? null,
      subagentName: data.agentName ?? null,
      evidenceRef: evidenceRef(sourceRef, rawType),
      summary: `${data.agentName ?? "subagent"} ${rawType === "subagent.started" ? "started" : "completed"}`,
    };
    if (data.model) event.model = data.model;
    if (rawType === "subagent.completed") {
      // Copilot reports subagent aggregates only. These are not per-response
      // model usage and must not be projected as such.
      if (Number.isFinite(Number(data.totalToolCalls))) event.subagentToolCalls = Number(data.totalToolCalls);
      if (Number.isFinite(Number(data.totalTokens))) event.subagentTotalTokens = Number(data.totalTokens);
      if (Number.isFinite(Number(data.durationMs))) event.subagentDurationMs = Number(data.durationMs);
    }
    events.push(event);
    return events;
  }

  if (rawType === "session.plan_changed") {
    events.push({
      ...base,
      type: "plan.update",
      category: "planning",
      evidenceRef: evidenceRef(sourceRef, "plan.update"),
      summary: "session plan changed",
    });
    return events;
  }

  if (rawType === "session.compaction_start" || rawType === "session.compaction_complete") {
    const event = {
      ...base,
      type: "context.compaction",
      category: "context",
      lifecyclePhase: rawType === "session.compaction_start" ? "request" : "result",
      evidenceRef: evidenceRef(sourceRef, rawType),
      summary: rawType === "session.compaction_start" ? "context compaction started" : "context compaction completed",
    };
    if (Number.isFinite(Number(data.preCompactionTokens))) {
      event.preCompactionTokens = Number(data.preCompactionTokens);
    }
    events.push(event);
    return events;
  }

  if (rawType === "session.permissions_changed" || rawType === "session.mode_changed") {
    events.push({
      ...base,
      type: "control.change",
      category: "control",
      evidenceRef: evidenceRef(sourceRef, rawType),
      summary: rawType === "session.permissions_changed" ? "session permissions changed" : "session mode changed",
    });
    return events;
  }

  if (rawType === "external_tool.requested" || rawType === "external_tool.completed") {
    events.push({
      ...base,
      type: rawType === "external_tool.requested" ? "tool.call" : "tool.result",
      category: "tool",
      lifecyclePhase: rawType === "external_tool.requested" ? "request" : "result",
      toolName: data.toolName ?? "external-tool",
      toolInvocationId: data.toolCallId ?? null,
      external: true,
      evidenceRef: evidenceRef(sourceRef, rawType),
      summary: `external tool ${rawType === "external_tool.requested" ? "request" : "result"}`,
    });
    return events;
  }

  if (rawType === "session.start") {
    events.push({
      ...base,
      type: "metadata.session-start",
      category: "metadata",
      model: data.selectedModel ?? null,
      evidenceRef: evidenceRef(sourceRef, "metadata.session-start"),
      summary: "Copilot session started",
    });
    return events;
  }

  events.push({
    ...base,
    type: `metadata.${rawType}`,
    category: "metadata",
    evidenceRef: evidenceRef(sourceRef, `metadata.${rawType}`),
    summary: rawType,
  });
  return events;
}

async function probeSessionDirectory(sessionDir, workspace) {
  const transcriptPath = path.join(sessionDir, TRANSCRIPT_FILE);
  const descriptor = parseWorkspaceDescriptor(await readWorkspaceDescriptor(sessionDir));
  const summary = {
    sessionId: descriptor.id || path.basename(sessionDir),
    transcriptPath,
    transcriptAvailable: await pathExists(transcriptPath),
    cwd: descriptor.cwd,
    records: 0,
    firstSeen: null,
    lastSeen: null,
    workspaceMatch: isWorkspaceMatch(descriptor.cwd, workspace),
  };
  if (!summary.transcriptAvailable) {
    return summary;
  }

  await forEachJsonLine(transcriptPath, (raw) => {
    summary.records += 1;
    if (raw?.type === "session.start") {
      const data = raw?.data ?? {};
      if (data.sessionId) summary.sessionId = data.sessionId;
      const cwd = data?.context?.cwd;
      if (cwd) {
        summary.cwd = summary.cwd ?? cwd;
        if (isWorkspaceMatch(cwd, workspace)) summary.workspaceMatch = true;
      }
    }
    mergeTimeRange(summary, inferTimestamp(raw));
  });
  return summary;
}

/**
 * Classify Copilot workspace coverage.
 *
 * A Copilot session directory can exist and match the workspace while carrying
 * no `events.jsonl`. That state stays explicit instead of collapsing into zero
 * activity or a clean result.
 */
function buildCopilotSourceCoverage({ scope, roots, matched, inWindow }) {
  const root = roots.find((entry) => entry.kind === "copilot-session-jsonl");
  const workspaceSessions = matched.length;
  const withTranscript = matched.filter((probe) => probe.transcriptAvailable);
  const withoutTranscript = workspaceSessions - withTranscript.length;
  const timeUnobserved = withTranscript.filter((probe) => !probe.firstSeen && !probe.lastSeen).length;
  const emptyTranscripts = withTranscript.filter((probe) => probe.records === 0).length;
  const requestedWindow = scope.sinceTime !== null || scope.untilTime !== null;

  let status = "observed";
  if (!root?.exists || workspaceSessions === 0) {
    status = "absent";
  } else if (inWindow.length === 0 && requestedWindow && timeUnobserved === 0 && withTranscript.length > 0) {
    status = "out-of-window";
  } else if (withTranscript.length === 0 || inWindow.length === 0) {
    status = "unobserved";
  } else if (withoutTranscript > 0 || timeUnobserved > 0 || emptyTranscripts > 0) {
    status = "partial";
  }

  return {
    status,
    transcript: {
      sourceAvailable: Boolean(root?.exists),
      workspaceSessions,
      withTranscript: withTranscript.length,
      withoutTranscript,
      emptyTranscripts,
      timeUnobservedSessions: timeUnobserved,
      inWindowSessions: inWindow.length,
    },
    usage: {
      // Copilot transcripts carry no per-response model usage. Subagent and
      // compaction totals are aggregates and are never projected as per-response
      // usage.
      perResponseUsageObserved: false,
    },
  };
}

async function readWorkspaceDescriptor(sessionDir) {
  const descriptorPath = path.join(sessionDir, WORKSPACE_FILE);
  try {
    return await readFile(descriptorPath, "utf8");
  } catch {
    return "";
  }
}

function dedupeEvents(events) {
  const seen = new Set();
  return events.filter((event) => {
    const key = event.toolInvocationId && event.lifecyclePhase
      ? `${event.sessionId}:${event.type}:${event.lifecyclePhase}:${event.toolInvocationId}`
      : null;
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export class CopilotSessionAnalyzer extends SessionAnalyzer {
  currentSessionId() {
    return process.env.COPILOT_SESSION_ID ?? null;
  }

  async resolveScope(options = {}) {
    const since = normalizeCliDate(options.since, false);
    const until = normalizeCliDate(options.until, true);
    const workspace = normalizeWorkspace(options.workspace);
    const home = path.resolve(expandHome(
      options.home ?? options.copilotHome ?? options["copilot-home"] ?? process.env.COPILOT_HOME ?? "~/.copilot",
    ));
    return {
      platform: "copilot",
      workspace,
      home,
      since: since.label,
      sinceTime: since.time,
      until: until.label,
      untilTime: until.time,
      sessionId: options["session-id"] ?? options.sessionId ?? options._?.[0] ?? null,
      includeGlobalCapabilities: parseBooleanFlag(options["include-global-capabilities"] ?? false),
    };
  }

  async discoverSourceRoots(scope) {
    const sessionStateRoot = path.join(scope.home, "session-state");
    return [
      {
        id: "copilot-session-state",
        kind: "copilot-session-jsonl",
        role: "session-transcript",
        path: sessionStateRoot,
        optional: false,
        enabled: true,
        workspaceScoped: false,
        coverage: "primary",
        exists: await pathExists(sessionStateRoot),
      },
    ];
  }

  async discoverSessions(scope, roots) {
    const transcriptRoot = roots.find((root) => root.kind === "copilot-session-jsonl");
    let entries = [];
    if (transcriptRoot?.exists) {
      try {
        entries = await readdir(transcriptRoot.path, { withFileTypes: true });
      } catch {
        entries = [];
      }
    }

    const matched = [];
    for (const entry of entries) {
      const sessionDir = path.join(transcriptRoot.path, entry.name);
      if (!entry.isDirectory() && !(await isDirectory(sessionDir))) continue;
      const probe = await probeSessionDirectory(sessionDir, scope.workspace);
      if (probe?.workspaceMatch) matched.push(probe);
    }

    const inWindow = matched
      .filter((probe) => probe.transcriptAvailable)
      .filter((probe) => {
        const timestamp = probe.lastSeen ?? probe.firstSeen;
        if ((scope.sinceTime !== null || scope.untilTime !== null) && !timestamp) return false;
        return withinTimeRange(timestamp, scope);
      })
      .map((probe) => ({
        sessionId: probe.sessionId,
        workspace: scope.workspace,
        firstSeen: probe.firstSeen,
        lastSeen: probe.lastSeen,
        sourceKinds: [transcriptRoot.kind],
        sourceRefs: [
          {
            kind: transcriptRoot.kind,
            role: transcriptRoot.role,
            path: probe.transcriptPath,
            cwd: probe.cwd,
            firstSeen: probe.firstSeen,
            lastSeen: probe.lastSeen,
          },
        ],
      }))
      .sort((left, right) => (timestampMillis(right.lastSeen) ?? 0) - (timestampMillis(left.lastSeen) ?? 0));

    scope._copilotSourceCoverage = buildCopilotSourceCoverage({ scope, roots, matched, inWindow });
    return inWindow;
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
        for (const event of this.normalizeEvents(
          raw,
          { ...ref, sessionId: session.sessionId, line },
          options,
        )) {
          if (withinTimeRange(event.timestamp, scope)) events.push(event);
        }
      });
    }
    return dedupeEvents(events).sort((left, right) =>
      (timestampMillis(left.timestamp) ?? 0) - (timestampMillis(right.timestamp) ?? 0)
      || Number(left.evidenceRef?.line ?? 0) - Number(right.evidenceRef?.line ?? 0));
  }

  async analysisWarnings(scope, _roots, _sessions) {
    const coverage = scope._copilotSourceCoverage;
    const warnings = [{
      code: "copilot-per-response-usage-unobserved",
      message: "Copilot transcripts do not record per-response model token usage; usage evidence requires the opt-in OpenTelemetry export.",
    }];
    if (!coverage || coverage.status === "absent") {
      warnings.push({
        code: "copilot-workspace-transcripts-absent",
        message: "No Copilot session transcript matched the selected workspace.",
      });
      return warnings;
    }
    if (coverage.transcript.withoutTranscript > 0) {
      warnings.push({
        code: "copilot-session-transcript-partial",
        message: `Copilot session state matched ${coverage.transcript.workspaceSessions} workspace sessions, and ${coverage.transcript.withoutTranscript} carry no ${TRANSCRIPT_FILE}.`,
      });
    }
    if (coverage.transcript.timeUnobservedSessions > 0) {
      warnings.push({
        code: "copilot-session-timestamps-unobserved",
        message: `Copilot event timestamps were unobserved in ${coverage.transcript.timeUnobservedSessions} matched transcripts.`,
      });
    }
    return warnings;
  }

  factsSourceCoverage(scope) {
    return scope._copilotSourceCoverage ?? null;
  }

  async analyze(options = {}) {
    return runProviderAnalysis(this, options, { platform: "copilot", adapterVersion: "copilot-v1" });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { command = "sessions", options } = parseArgs(argv);
  const analyzer = new CopilotSessionAnalyzer();
  const result = await runProviderCommand(analyzer, command, options);
  await emitProviderResult({ provider: "Copilot", command, options, result });
  return result;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`copilot session-analysis failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}

import path from "node:path";

import {
  MAX_COMPACTION_EVENTS_PER_SESSION,
  redactTranscriptText,
} from "../commit-session-link/index.mjs";
import {
  deriveCacheReuse,
  observedCacheAccountingMode,
  observedContextUsage,
  observedProcessingAccounting,
  observedTokenUsage,
  projectCacheReuse,
  projectUsageReport,
} from "../session-analysis/index.mjs";
import { emptyFeatureTree } from "./feature-tree.mjs";

export const HARNESS_INSPECTOR_REPORT_KIND = "HarnessInspectorReportV1";
export const HARNESS_INSPECTOR_REPORT_SCHEMA_VERSION = 1;
export const DEFAULT_COMPACT_COMMIT_EVIDENCE_KINDS = Object.freeze(["contextual", "file-context"]);

export function commitStartsCompact(evidenceKind) {
  return DEFAULT_COMPACT_COMMIT_EVIDENCE_KINDS.includes(evidenceKind);
}

const SAFE_LOCATOR_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const TOOL_FAMILIES = new Set(["inspect", "change", "execute", "verify", "coordinate", "deliver", "other"]);
const TOOL_OPERATIONS = new Set([
  "build-project", "check-runtime", "continue-process", "coordinate-work", "create-commit",
  "create-pull-request", "edit-files", "find-tool", "inspect-browser", "inspect-git", "inspect-image",
  "publish-package", "push-branch", "read-files", "research-web", "run-command", "run-tests",
  "search-repository", "use-tool", "verify-project", "wait-process",
]);

function safeText(value, limit = 240, fallback = null) {
  const redacted = redactTranscriptText(value, { limit });
  if (!redacted) return fallback;
  return redacted
    .replace(/(?:^|[\s("'`])(?:\/[A-Za-z0-9._~ -]+){2,}/gu, (match) => `${match[0].match(/\s|\(|"|'|`/u) ?? ""}<absolute-path>`)
    .replace(/(?:^|[\s("'`])(?:[A-Za-z]:[\\/]|\\\\)[^\s"'`)]+/gu, (match) => `${match[0].match(/\s|\(|"|'|`/u) ?? ""}<absolute-path>`);
}

function safeLocator(value) {
  const text = String(value ?? "").trim();
  return SAFE_LOCATOR_RE.test(text) ? text : null;
}

function safeRelativeFile(value) {
  const text = String(value ?? "").replaceAll("\\", "/").normalize("NFC").trim();
  if (!text
    || text.length > 500
    || text.startsWith("/")
    || /^[A-Za-z]:\//u.test(text)
    || text.split("/").some((part) => part === "..")
    || /[\u0000-\u001f\u007f]/u.test(text)) return null;
  return text;
}

function isoDay(value) {
  const time = new Date(value ?? "");
  return Number.isNaN(time.getTime()) ? null : time.toISOString().slice(0, 10);
}

function sessionRefMatches(ref, session) {
  const locator = `${session.platform ?? "unknown"}/${session.sessionId}`;
  return ref === session.sessionId || ref === locator;
}

function commitRefMatches(ref, commit) {
  return /^[0-9a-f]{7,40}$/u.test(ref) && commit.hash.startsWith(ref);
}

function relativeFeatureSource(source, repoRoot) {
  if (!source || !repoRoot) return source ?? null;
  const absolute = path.resolve(source);
  const relative = path.relative(repoRoot, absolute);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative.split(path.sep).join("/");
  return path.basename(source);
}

function safeTree(tree, repoRoot) {
  const input = tree ?? emptyFeatureTree();
  return {
    kind: input.kind,
    schemaVersion: input.schemaVersion,
    source: relativeFeatureSource(input.source, repoRoot),
    roots: [...(input.roots ?? [])],
    nodes: (input.nodes ?? []).map((node) => ({
      id: node.id,
      type: node.type,
      title: safeText(node.title, 160, node.id),
      parentId: node.parentId,
      children: [...node.children],
      status: safeText(node.status, 64),
      stage: safeText(node.stage, 64),
      date: node.date,
      evidence: ["declared", "candidate", "unmapped"].includes(node.evidence) ? node.evidence : "declared",
      refs: {
        specs: node.refs.specs.map((item) => safeText(item, 240)).filter(Boolean),
        issues: node.refs.issues.map((item) => safeText(item, 240)).filter(Boolean),
        prompts: node.refs.prompts.map((item) => safeText(item, 500)).filter(Boolean),
        sessions: node.refs.sessions.map(safeLocator).filter(Boolean),
        commits: node.refs.commits.map(safeLocator).filter(Boolean),
      },
    })),
  };
}

function projectCommit(commit) {
  const files = (commit.files ?? []).map((file) => {
    const filePath = safeRelativeFile(file?.path);
    if (!filePath) return null;
    return {
      path: filePath,
      added: Number.isFinite(file.added) ? file.added : null,
      removed: Number.isFinite(file.removed) ? file.removed : null,
    };
  }).filter(Boolean).slice(0, 800);
  return {
    hash: commit.hash,
    shortHash: commit.shortHash,
    subject: safeText(commit.subject, 500, "untitled commit"),
    authorName: safeText(commit.authorName, 120),
    authoredAt: commit.authoredAt ?? null,
    committedAt: commit.committedAt ?? commit.authoredAt ?? null,
    day: isoDay(commit.committedAt ?? commit.authoredAt),
    fileCount: commit.fileCount ?? files.length,
    files,
    linesAdded: Number(commit.linesAdded) || 0,
    linesRemoved: Number(commit.linesRemoved) || 0,
    matches: (commit.matches ?? []).map((match) => ({
      sessionId: match.sessionId,
      confidence: match.confidence,
      evidence: {
        linkType: match.evidence?.linkType ?? null,
        commitObservedInCall: safeText(match.evidence?.commitObservedInCall, 64),
        timeOverlap: match.evidence?.timeOverlap === true,
        overlappingFileCount: Number(match.evidence?.overlappingFileCount) || 0,
        overlappingFiles: (match.evidence?.overlappingFiles ?? []).map(safeRelativeFile).filter(Boolean),
        cwdWithinRepo: match.evidence?.cwdWithinRepo === true,
      },
    })),
  };
}

function projectToolActivity(activity) {
  const calls = (activity?.calls ?? []).map((call, index) => {
    const step = Number.isInteger(Number(call?.step)) && Number(call.step) > 0 ? Number(call.step) : index + 1;
    const family = TOOL_FAMILIES.has(call?.family) ? call.family : "other";
    const filePaths = [...new Set((call?.filePaths ?? [call?.filePath]).map(safeRelativeFile).filter(Boolean))];
    const filePath = filePaths[0] ?? null;
    const observedDuration = call?.durationStatus === "observed" && Number.isFinite(call?.durationMs) && call.durationMs >= 0;
    const startedAt = Number.isFinite(call?.startedAt) ? Math.round(call.startedAt) : null;
    const toolName = safeText(call?.toolName, 64, "Unknown tool");
    const operation = TOOL_OPERATIONS.has(call?.operation) ? call.operation : "use-tool";
    const fallbackLabel = /read/iu.test(toolName) ? "Read files"
      : /(?:edit|write|patch)/iu.test(toolName) ? "Edit files"
        : /(?:test|validate|lint)/iu.test(toolName) ? "Verify project"
          : "Use tool";
    const actionLabel = safeText(call?.actionLabel, 80, fallbackLabel);
    const detail = safeText(call?.detail, 240);
    return {
      id: `A${step}`,
      step,
      toolName,
      operation,
      actionLabel,
      family,
      status: call?.status === "failed" ? "failed" : "observed",
      durationStatus: observedDuration ? "observed" : "unobserved",
      ...(startedAt === null ? {} : { startedAt }),
      ...(observedDuration ? { durationMs: Math.round(call.durationMs) } : {}),
      ...(detail ? { detail, detailKind: call?.detailKind === "redacted-input-summary" ? "redacted-input-summary" : "normalized-summary" } : {}),
      ...(filePath ? { filePath } : {}),
      ...(filePaths.length > 0 ? { filePaths } : {}),
    };
  }).sort((left, right) => left.step - right.step);
  const familyCounts = Object.fromEntries([...TOOL_FAMILIES].map((family) => [family, 0]));
  const files = new Map();
  for (const call of calls) {
    familyCounts[call.family] += 1;
    for (const filePath of call.filePaths ?? (call.filePath ? [call.filePath] : [])) {
      const file = files.get(filePath) ?? { path: filePath, callCount: 0, callIds: [], families: [] };
      file.callCount += 1;
      file.callIds.push(call.id);
      if (!file.families.includes(call.family)) file.families.push(call.family);
      files.set(filePath, file);
    }
  }
  const segments = [];
  for (const call of calls) {
    const current = segments.at(-1);
    if (!current || current.family !== call.family) {
      segments.push({ id: `S${segments.length + 1}`, family: call.family, startStep: call.step, endStep: call.step, callCount: 1 });
    } else {
      current.endStep = call.step;
      current.callCount += 1;
    }
  }
  return {
    kind: "NormalizedToolActivityV1",
    schemaVersion: 1,
    totalCalls: calls.length,
    failedCalls: calls.filter((call) => call.status === "failed").length,
    familyCounts,
    segments,
    timeline: activityTimeline(calls),
    files: [...files.values()].sort((left, right) => left.path.localeCompare(right.path)),
    calls,
  };
}

// The Inspector plots calls on wall-clock time when the host retained enough
// distinct stamps to define a span. Anything less stays on sequence order so a
// chart never implies timing evidence the transcript did not observe.
function activityTimeline(calls) {
  const stamps = calls.map((call) => call.startedAt).filter((value) => Number.isFinite(value));
  const ends = calls
    .map((call) => (Number.isFinite(call.startedAt) && Number.isFinite(call.durationMs)
      ? call.startedAt + call.durationMs
      : call.startedAt))
    .filter((value) => Number.isFinite(value));
  const startMs = stamps.length > 0 ? Math.min(...stamps) : null;
  const endMs = ends.length > 0 ? Math.max(...ends) : null;
  const distinct = new Set(stamps).size;
  return {
    basis: distinct >= 2 && endMs > startMs ? "observed-time" : "call-sequence",
    startMs,
    endMs,
    spanMs: startMs === null || endMs === null ? null : Math.max(0, endMs - startMs),
    timedCallCount: stamps.length,
    distinctStampCount: distinct,
  };
}

function projectToolTrace(trace) {
  const calls = (trace?.calls ?? []).map((call) => {
    const step = Number(call?.step);
    if (!Number.isInteger(step) || step <= 0) return null;
    const toolName = safeText(call.toolName, 64, "Unknown tool");
    const observedDuration = call.durationStatus === "observed"
      && Number.isFinite(call.durationMs)
      && call.durationMs >= 0;
    return {
      id: `T${step}`,
      step,
      toolName,
      status: call.status === "failed" ? "failed" : "observed",
      durationStatus: observedDuration ? "observed" : "unobserved",
      ...(observedDuration ? {
        durationMs: Math.round(call.durationMs),
        timingSource: call.timingSource === "lifecycle-pair" ? "lifecycle-pair" : "transcript-pair",
      } : {}),
    };
  }).filter(Boolean).sort((left, right) => left.step - right.step);
  const totalCalls = Math.max(Number(trace?.totalCalls) || 0, ...calls.map((call) => call.step), 0);
  return {
    schemaVersion: 2,
    totalCalls,
    shownCalls: calls.length,
    truncated: calls.length < totalCalls,
    calls,
  };
}

function projectDialogue(dialogue, toolActivity) {
  const callsByStep = new Map(toolActivity.calls.map((call) => [call.step, call]));
  const turns = (dialogue?.turns ?? []).map((turn, index) => {
    const steps = (turn?.steps ?? []).map((step) => {
      if (step?.kind === "note") {
        const text = safeText(step.text, 400);
        return text ? { kind: "note", text } : null;
      }
      if (step?.kind === "usage") {
        const tokenUsage = observedTokenUsage(step.tokenUsage);
        const contextUsage = projectContextWindowUsage(step.contextUsage);
        const processing = observedProcessingAccounting(step, { boundText: safeText });
        const cacheReuse = projectCacheReuse(step.cacheReuse);
        if (!tokenUsage && !contextUsage && !processing.processedTokens) return null;
        return {
          kind: "usage",
          ...(tokenUsage ? { tokenUsage } : {}),
          ...(contextUsage ? { contextUsage } : {}),
          ...(cacheReuse ? { cacheReuse } : {}),
          ...(step.basis ? { basis: safeText(step.basis, 40) } : {}),
          ...(step.source ? { source: safeText(step.source, 80) } : {}),
          ...(step.model ? { model: safeText(step.model, 80) } : {}),
          ...processing,
          timestamp: step.timestamp ?? null,
        };
      }
      if (step?.kind !== "tool") return null;
      const callStep = Number(step.callStep);
      const call = callsByStep.get(callStep);
      return {
        kind: "tool",
        callId: call?.id ?? `A${Number.isInteger(callStep) && callStep > 0 ? callStep : index + 1}`,
        toolName: safeText(call?.toolName ?? step.toolName, 64, "Unknown tool"),
        operation: call?.operation ?? "use-tool",
        actionLabel: call?.actionLabel ?? "Use tool",
        ...(call?.detail ? { detail: call.detail, detailKind: call.detailKind } : {}),
        status: call?.status === "failed" ? "failed" : "observed",
        durationStatus: call?.durationStatus === "observed" ? "observed" : "unobserved",
        ...(call?.durationStatus === "observed" && Number.isFinite(call.durationMs) ? { durationMs: call.durationMs } : {}),
        ...(call?.filePaths?.length ? { filePaths: [...call.filePaths] } : {}),
      };
    }).filter(Boolean);
    const promptText = safeText(turn?.prompt?.text, 1_500, "Prompt unavailable after privacy filtering");
    const response = safeText(turn?.response, 6_000);
    const responseStatus = ["retained", "incomplete", "unavailable"].includes(turn?.responseStatus)
      ? turn.responseStatus
      : (response ? "retained" : "unavailable");
    const intermediateCount = Number.isInteger(turn?.intermediateCount)
      ? turn.intermediateCount
      : steps.filter((step) => step.kind === "note").length;
    const usageEventCount = Number.isInteger(turn?.usageEventCount)
      ? turn.usageEventCount
      : steps.filter((step) => step.kind === "usage").length;
    const derivedEventCount = intermediateCount
      + steps.filter((step) => step.kind === "tool").length
      + usageEventCount;
    return {
      index: Number(turn?.index) || index + 1,
      anchorId: `turn-${Number(turn?.index) || index + 1}`,
      prompt: { text: promptText, timestamp: turn?.prompt?.timestamp ?? null },
      steps,
      toolCallCount: Number(turn?.toolCallCount) || steps.filter((step) => step.kind === "tool").length,
      messageCount: Number(turn?.messageCount) || 0,
      intermediateCount,
      usageEventCount,
      eventCount: Number.isInteger(turn?.eventCount)
        ? Math.max(turn.eventCount, derivedEventCount)
        : derivedEventCount,
      shownEventCount: Number.isInteger(turn?.shownEventCount) ? turn.shownEventCount : steps.length,
      processTruncated: turn?.processTruncated === true,
      response,
      responseStatus,
      durationMs: Number.isFinite(turn?.durationMs) ? turn.durationMs : null,
      startMs: Number.isFinite(turn?.startMs) ? turn.startMs : null,
      endMs: Number.isFinite(turn?.endMs) ? turn.endMs : null,
    };
  });
  return {
    truncated: dialogue?.truncated === true,
    turns,
    responseCount: turns.filter((turn) => turn.response).length,
    noteCount: turns.reduce((sum, turn) => sum + turn.steps.filter((step) => step.kind === "note").length, 0),
    shownToolCallCount: turns.reduce((sum, turn) => sum + turn.steps.filter((step) => step.kind === "tool").length, 0),
  };
}

// Retained prompts are capped and de-duplicated upstream, so their array
// position is not a Turn number. Resolving each prompt to the Turn it actually
// came from keeps prompt cards, cross-highlighting, and Session View jumps
// pointing at the same dialogue event.
function bindPromptsToTurns(prompts, turns) {
  const claimed = new Set();
  const key = (value) => String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, 24);
  const resolve = (prompt, index) => {
    const byStamp = turns.find((turn) => turn.prompt.timestamp
      && turn.prompt.timestamp === prompt.timestamp
      && !claimed.has(turn.index));
    if (byStamp) return byStamp.index;
    const promptKey = key(prompt.text);
    const byText = promptKey
      ? turns.find((turn) => !claimed.has(turn.index) && key(turn.prompt.text) === promptKey)
      : null;
    if (byText) return byText.index;
    const ordinal = turns[index];
    return ordinal && !claimed.has(ordinal.index) ? ordinal.index : null;
  };
  return prompts.map((prompt, index) => {
    const turnIndex = resolve(prompt, index);
    if (turnIndex !== null) claimed.add(turnIndex);
    return { ...prompt, turnIndex };
  });
}

function timestampMs(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function projectUsageSnapshot(usageReport, generatedAt) {
  const progression = Array.isArray(usageReport?.progression) ? usageReport.progression : [];
  const observedAt = [...progression].reverse().find((point) => timestampMs(point?.timestamp) !== null)?.timestamp;
  if (observedAt) return { status: "observed-through", timestamp: new Date(observedAt).toISOString() };
  if (timestampMs(generatedAt) !== null) return { status: "generated-at", timestamp: new Date(generatedAt).toISOString() };
  return { status: "unavailable" };
}

// Usage points and Turns are independent projections of the same transcript.
// Join them only through observed time containment; response ordinal and array
// position are intentionally not fallbacks because compaction and sampling can
// make those sequences diverge.
function bindUsageProgressionToTurns(usageReport, dialogue) {
  const turns = dialogue?.turns ?? [];
  const windows = turns.map((turn, index) => {
    const promptMs = timestampMs(turn.prompt?.timestamp);
    const startCandidates = [turn.startMs, promptMs].filter(Number.isFinite);
    const startMs = startCandidates.length ? Math.min(...startCandidates) : null;
    const nextPromptMs = timestampMs(turns[index + 1]?.prompt?.timestamp);
    const nextStartMs = Number.isFinite(turns[index + 1]?.startMs) ? turns[index + 1].startMs : nextPromptMs;
    const endCandidates = [turn.endMs, nextStartMs].filter((value) => Number.isFinite(value) && (startMs === null || value >= startMs));
    return {
      turn,
      startMs,
      endMs: endCandidates.length ? Math.min(...endCandidates) : null,
    };
  }).filter((window) => window.startMs !== null && window.endMs !== null);
  const firstPointByTurn = new Set();
  const progression = usageReport.progression.map((point) => {
    const pointMs = timestampMs(point.timestamp);
    if (pointMs === null) return point;
    // Prefer the latest matching start at a shared boundary, so an event at the
    // next prompt timestamp belongs to the new Turn rather than the prior one.
    const window = [...windows].reverse().find((candidate) => pointMs >= candidate.startMs && pointMs <= candidate.endMs);
    if (!window) return point;
    const prompt = safeText(window.turn.prompt?.text, 240);
    const promptBoundary = !firstPointByTurn.has(window.turn.index);
    firstPointByTurn.add(window.turn.index);
    return {
      ...point,
      turnIndex: window.turn.index,
      ...(promptBoundary && prompt ? { userPrompt: prompt } : {}),
      ...(promptBoundary ? { promptBoundary: true } : {}),
    };
  });
  return { ...usageReport, progression };
}

// One turn vocabulary for every surface. `turnCount` is the number of dialogue
// Turns a reviewer can actually open; the other counts explain why fewer prompt
// cards are shown, so no two views can quote different totals.
function turnCoverage(session, prompts, dialogue) {
  const turnCount = dialogue.turns.length > 0
    ? dialogue.turns.length
    : Number(session.userTurnCount) || prompts.length;
  return {
    basis: dialogue.turns.length > 0 ? "dialogue-turns" : "normalized-user-turns",
    turnCount,
    shownPromptCount: prompts.length,
    normalizedUserTurnCount: Number(session.userTurnCount) || prompts.length,
    observationCount: Number(session.promptObservationCount) || Number(session.promptCount) || prompts.length,
    truncated: prompts.length < turnCount,
  };
}

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function projectTokenUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const projected = {};
  for (const field of ["inputTokens", "outputTokens", "cacheReadInputTokens", "cacheCreationInputTokens", "reasoningOutputTokens", "totalTokens"]) {
    if (Object.hasOwn(usage, field)) projected[field] = nonNegativeNumber(usage[field]);
  }
  projected.basis = safeText(usage.basis, 40, "model-inference");
  projected.source = safeText(usage.source, 80, "normalized-session-events");
  projected.coverage = ["observed", "partial", "unobserved"].includes(usage.coverage)
    ? usage.coverage
    : "observed";
  const cacheAccountingMode = observedCacheAccountingMode(usage.cacheAccountingMode);
  if (cacheAccountingMode) projected.cacheAccountingMode = cacheAccountingMode;
  return projected;
}

// Binds this surface's redactor to the shared occupancy normalizer.
function projectContextWindowUsage(usage) {
  return observedContextUsage(usage, { boundText: safeText });
}

function projectRuntime(runtime) {
  if (!runtime || typeof runtime !== "object") return null;
  const projected = Object.fromEntries(["modelProvider", "cliVersion", "effort"]
    .map((field) => [field, safeText(runtime[field], 80)])
    .filter(([_field, value]) => value));
  return Object.keys(projected).length > 0 ? projected : null;
}

function projectContextManifest(manifest) {
  if (!manifest || typeof manifest !== "object") return null;
  const sourceEvents = Array.isArray(manifest.compactionEvents) ? manifest.compactionEvents : [];
  const compactionCount = Math.max(
    Math.round(nonNegativeNumber(manifest.compactionCount)),
    sourceEvents.length,
  );
  const compactionEvents = [];
  for (const event of sourceEvents.slice(0, MAX_COMPACTION_EVENTS_PER_SESSION)) {
    const timestamp = new Date(event?.timestamp ?? "");
    if (Number.isNaN(timestamp.getTime())) continue;
    const contextTokens = Number(event?.contextTokens);
    const contextSnapshotTimestamp = new Date(event?.contextSnapshotTimestamp ?? "");
    const hasContextSnapshot = Number.isFinite(contextTokens)
      && contextTokens >= 0
      && !Number.isNaN(contextSnapshotTimestamp.getTime())
      && contextSnapshotTimestamp.getTime() <= timestamp.getTime();
    compactionEvents.push({
      timestamp: timestamp.toISOString(),
      ...(hasContextSnapshot ? {
        contextTokens: Math.round(contextTokens),
        contextSnapshotTimestamp: contextSnapshotTimestamp.toISOString(),
      } : {}),
    });
  }
  const projected = {
    status: ["observed", "partial", "unobserved"].includes(manifest.status) ? manifest.status : "partial",
    source: safeText(manifest.source, 80, "normalized-context-events"),
    rawTextOmitted: true,
    compactionCount,
    ...(compactionEvents.length > 0 ? { compactionEvents } : {}),
    layers: (Array.isArray(manifest.layers) ? manifest.layers : []).slice(0, 16).map((layer) => ({
      kind: safeText(layer?.kind, 80, "other"),
      itemCount: Math.round(nonNegativeNumber(layer?.itemCount)),
    })),
    categories: (Array.isArray(manifest.categories) ? manifest.categories : []).slice(0, 20).map((category) => ({
      kind: safeText(category?.kind, 80, "other"),
      label: safeText(category?.label, 120, "Other"),
      estimatedTokens: Math.round(nonNegativeNumber(category?.estimatedTokens)),
    })),
  };
  if (manifest.usedTokens !== null && manifest.usedTokens !== undefined && Number.isFinite(Number(manifest.usedTokens))) projected.usedTokens = Math.round(nonNegativeNumber(manifest.usedTokens));
  if (manifest.windowTokens !== null && manifest.windowTokens !== undefined && Number.isFinite(Number(manifest.windowTokens))) projected.windowTokens = Math.round(nonNegativeNumber(manifest.windowTokens));
  if (manifest.percentFull !== null && manifest.percentFull !== undefined && Number.isFinite(Number(manifest.percentFull))) projected.percentFull = Math.min(100, Math.round(nonNegativeNumber(manifest.percentFull) * 10) / 10);
  if (manifest.basis) projected.basis = safeText(manifest.basis, 40);
  return projected;
}

function projectSession(session) {
  const sessionId = safeLocator(session.sessionId);
  if (!sessionId) return null;
  const platform = safeText(session.platform, 40, "unknown");
  const locator = safeLocator(`${platform}/${sessionId}`) ?? sessionId;
  const toolTrace = projectToolTrace(session.toolTrace);
  const toolActivity = projectToolActivity(session.toolActivity ?? {
    calls: toolTrace.calls.map((call) => ({ ...call, family: "other" })),
  });
  const dialogue = projectDialogue(session.dialogue, toolActivity);
  const tokenUsage = projectTokenUsage(session.tokenUsage);
  const cacheReuse = deriveCacheReuse(tokenUsage, tokenUsage?.cacheAccountingMode);
  const prompts = bindPromptsToTurns((session.prompts ?? []).map((prompt, index) => ({
    id: `${sessionId}:prompt:${index + 1}`,
    text: safeText(prompt.text, 500, "Prompt unavailable after privacy filtering"),
    timestamp: prompt.timestamp ?? null,
    day: isoDay(prompt.timestamp ?? session.firstSeen),
  })), dialogue.turns);
  const usageReport = bindUsageProgressionToTurns(projectUsageReport(session.usageReport, {
    providerTotalTokens: tokenUsage?.totalTokens ?? null,
    boundText: safeText,
  }), dialogue);
  return {
    sessionId,
    locator,
    platform,
    firstSeen: session.firstSeen ?? null,
    lastSeen: session.lastSeen ?? null,
    day: isoDay(session.firstSeen ?? session.lastSeen),
    durationMs: Number.isFinite(session.durationMs) ? session.durationMs : null,
    files: [...new Set((session.files ?? []).map(safeRelativeFile).filter(Boolean))].slice(0, 400),
    prompts,
    promptCount: Number(session.promptCount) || prompts.length,
    promptObservationCount: Number(session.promptObservationCount) || Number(session.promptCount) || prompts.length,
    userTurnCount: Number(session.userTurnCount) || prompts.length,
    retainedUserTurnCount: Number(session.retainedUserTurnCount) || prompts.length,
    turnCoverage: turnCoverage(session, prompts, dialogue),
    toolCallCount: Number(session.toolCallCount) || 0,
    assistantMessageCount: Number(session.assistantMessageCount) || 0,
    fileEditCount: Number(session.fileEditCount) || 0,
    models: (session.models ?? []).map((model) => safeText(model, 80)).filter(Boolean),
    tokenUsage,
    ...(cacheReuse ? { cacheReuse } : {}),
    // Bounded projection only. The Session that produced this report already
    // counted every inference; recomputing here from the capped dialogue would
    // quote a display artefact under the same field names.
    usageReport,
    runtime: projectRuntime(session.runtime),
    contextManifest: projectContextManifest(session.contextManifest),
    timestampBasis: ["native-event", "native-metadata", "source-file-mtime", "unobserved"].includes(session.timestampBasis)
      ? session.timestampBasis
      : "unobserved",
    toolTrace,
    toolActivity,
    dialogue,
    source: safeText(session.source, 80, "native-session"),
    sourceCheckpointId: safeLocator(session.sourceCheckpointId),
    storyLinks: [],
    commitLinks: [],
  };
}

const STORY_MATCH_STOP_WORDS = new Set([
  "across", "agent", "better", "build", "coding", "complete", "current", "delivery",
  "evidence", "feature", "harness", "history", "inspect", "project", "review", "session",
  "sessions", "with", "without",
]);

function matchTokens(value) {
  return new Set((String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .match(/[\p{L}\p{N}_-]{4,}/gu) ?? [])
    .filter((token) => !STORY_MATCH_STOP_WORDS.has(token)));
}

function candidateSessionForStory(story, sessions) {
  const storyTokens = matchTokens(story.title);
  if (storyTokens.size === 0) return null;
  const ranked = sessions.map((session) => {
    const sessionTokens = matchTokens(session.prompts.map((prompt) => prompt.text).join(" "));
    const shared = [...storyTokens].filter((token) => sessionTokens.has(token));
    return { session, score: shared.length };
  }).filter((item) => item.score >= 2).sort((left, right) =>
    right.score - left.score
      || String(right.session.lastSeen ?? "").localeCompare(String(left.session.lastSeen ?? "")));
  if (ranked.length === 0) return null;
  if (ranked[1]?.score === ranked[0].score) return null;
  return ranked[0];
}

const EDGE_LIMITATIONS = Object.freeze({
  declared: "A reviewed declaration identifies intended scope; it does not prove that every session action contributed to the delivery.",
  explicit: "Explicit metadata links the objects; it does not attribute every changed line to a specific tool call.",
  "observed-commit": "The session created this Git commit, but its files may have been changed before the observed session began.",
  observed: "Exact shared repository paths are direct same-path evidence, not proof that the session authored the commit.",
  candidate: "Heuristic evidence suggests a relationship but requires reviewer confirmation.",
  contextual: "Shared path or date context keeps the objects nearby; it is not a correlated delivery claim.",
});

function edgeEvidence({ kind, source, facts = [], limitation }) {
  const strength = ["declared", "explicit"].includes(kind) ? "direct"
    : ["observed-commit", "observed-overlap"].includes(kind) ? "observed"
      : kind === "candidate" ? "candidate"
        : "contextual";
  const limitationKind = kind === "observed-overlap" ? "observed"
    : ["file-context", "contextual"].includes(kind) ? "contextual"
      : kind;
  return {
    strength,
    source,
    facts: facts.map((fact) => safeText(fact, 240)).filter(Boolean).slice(0, 8),
    limitations: [safeText(limitation ?? EDGE_LIMITATIONS[limitationKind], 320)].filter(Boolean),
  };
}

function sessionCommitEdge(match, overlappingFiles, editEvidence) {
  const explicit = Boolean(match.evidence.linkType);
  const observedCommit = Boolean(match.evidence.commitObservedInCall);
  const direct = explicit || observedCommit;
  const kind = explicit ? "explicit" : observedCommit ? "observed-commit" : overlappingFiles.length > 0 ? "observed-overlap" : "candidate";
  const facts = [];
  if (explicit) facts.push(`Commit metadata declares ${match.evidence.linkType}.`);
  if (observedCommit) facts.push(`Observed Create commit call ${match.evidence.commitObservedInCall} contains this commit time.`);
  if (editEvidence.callIds.length > 0) {
    facts.push(`${editEvidence.callIds.length} observed Edit/Write call(s) share ${editEvidence.files.length} exact changed path(s) before this commit.`);
  } else if (direct) {
    facts.push("No observed Edit/Write path in this session links to this commit.");
  }
  if (match.evidence.timeOverlap) facts.push("Session activity and commit time windows overlap.");
  if (overlappingFiles.length > 0) facts.push(`${overlappingFiles.length} exact repository path(s) occur in both objects.`);
  if (match.evidence.cwdWithinRepo) facts.push("The observed session working directory is within this repository.");
  return {
    evidenceKind: kind,
    ...edgeEvidence({
      kind,
      source: "commit-session-link",
      facts,
      limitation: editEvidence.callIds.length > 0
        ? "Exact path overlap and event order link the observed edits to this commit; they do not prove the final committed contents came exclusively from those calls."
        : undefined,
    }),
  };
}

function commitTimeMs(commit) {
  const value = Date.parse(commit.committedAt ?? commit.authoredAt ?? "");
  return Number.isFinite(value) ? value : null;
}

function directCommitMatch(commit, sessionId) {
  return commit.matches.find((match) => match.sessionId === sessionId
    && Boolean(match.evidence.linkType || match.evidence.commitObservedInCall)) ?? null;
}

// An Edit/Write call is linked to a Commit only when its observed start sits
// after the preceding directly linked Commit, before this Commit, and at least
// one of its exact repository paths occurs in the Commit. This keeps a single
// edit from leaking forward into every later Commit in the same session.
function linkedEditEvidence(session, commit, match, commits) {
  const direct = Boolean(match.evidence.linkType || match.evidence.commitObservedInCall);
  const currentTime = commitTimeMs(commit);
  if (!direct || currentTime === null) return { callIds: [], files: [] };

  const previousCommitTime = commits
    .filter((candidate) => candidate.hash !== commit.hash && directCommitMatch(candidate, session.sessionId))
    .map(commitTimeMs)
    .filter((time) => time !== null && time < currentTime)
    .sort((left, right) => right - left)[0] ?? Date.parse(session.firstSeen ?? "");
  const lowerBound = Number.isFinite(previousCommitTime) ? previousCommitTime : Number.NEGATIVE_INFINITY;
  const changedPaths = new Set(commit.files.map((file) => file.path));
  const calls = session.toolActivity.calls.filter((call) => call.operation === "edit-files"
    && Number.isFinite(call.startedAt)
    && call.startedAt > lowerBound
    && call.startedAt <= currentTime
    && (call.filePaths ?? (call.filePath ? [call.filePath] : [])).some((filePath) => changedPaths.has(filePath)));
  const files = [...new Set(calls.flatMap((call) => call.filePaths ?? (call.filePath ? [call.filePath] : []))
    .filter((filePath) => changedPaths.has(filePath)))];
  return { callIds: calls.map((call) => call.id), files };
}

function buildStoryLinks(tree, sessions, commits, diagnostics) {
  const stories = tree.nodes.filter((node) => node.type === "story").map((story) => {
    const explicitSessions = sessions.filter((session) => story.refs.sessions.some((ref) => sessionRefMatches(ref, session)));
    const declaredCommits = [];
    for (const ref of story.refs.commits) {
      const matched = commits.filter((commit) => commitRefMatches(ref, commit));
      if (matched.length === 1) declaredCommits.push(matched[0]);
      else if (matched.length > 1) diagnostics.push(`Story ${story.id} commit ref ${ref} is ambiguous and was not linked.`);
      else if (!/^[0-9a-f]{7,40}$/u.test(ref)) diagnostics.push(`Story ${story.id} commit ref is not a 7-40 character hexadecimal prefix.`);
    }
    const treeEvidenceKind = story.evidence === "declared" ? "declared" : story.evidence;
    const linkedSessions = new Map(explicitSessions.map((session) => [session.sessionId, {
      sessionId: session.sessionId,
      evidenceKind: treeEvidenceKind,
      confidence: "explicit",
      ...edgeEvidence({
        kind: treeEvidenceKind,
        source: "feature-tree",
        facts: [`Feature Tree declares session ${session.locator}.`],
      }),
    }]));
    for (const commit of declaredCommits) {
      for (const match of commit.matches) {
        if (!sessions.some((session) => session.sessionId === match.sessionId)) continue;
        if (!linkedSessions.has(match.sessionId)) {
          linkedSessions.set(match.sessionId, {
            sessionId: match.sessionId,
            evidenceKind: match.confidence === "explicit" ? "explicit" : "candidate",
            confidence: match.confidence,
            ...edgeEvidence({
              kind: match.confidence === "explicit" ? "explicit" : "candidate",
              source: "declared-commit-correlation",
              facts: [
                `Feature Tree declares commit ${commit.shortHash}.`,
                `Commit correlation resolves to session ${match.sessionId}.`,
              ],
            }),
          });
        }
      }
    }
    if (linkedSessions.size === 0 && story.refs.sessions.length === 0 && story.refs.commits.length === 0) {
      const candidate = candidateSessionForStory(story, sessions);
      if (candidate) {
        linkedSessions.set(candidate.session.sessionId, {
          sessionId: candidate.session.sessionId,
          evidenceKind: "candidate",
          confidence: "text-overlap",
          ...edgeEvidence({
            kind: "candidate",
            source: "retained-text-overlap",
            facts: [`Story title and retained prompts share ${candidate.score} significant term(s).`],
          }),
        });
      }
    }
    const feature = tree.nodes.find((node) => node.id === story.parentId) ?? null;
    return {
      ...story,
      featureTitle: feature?.title ?? null,
      sessionLinks: [...linkedSessions.values()],
      commitHashes: declaredCommits.map((commit) => commit.hash),
    };
  });

  for (const story of stories) {
    for (const link of story.sessionLinks) {
      const session = sessions.find((item) => item.sessionId === link.sessionId);
      if (session) session.storyLinks.push({ storyId: story.id, ...link });
    }
  }
  for (const commit of commits) {
    for (const match of commit.matches) {
      const session = sessions.find((item) => item.sessionId === match.sessionId);
      if (!session) continue;
      const activityFiles = new Set(session.toolActivity.files.map((file) => file.path));
      const overlappingFiles = commit.files.map((file) => file.path).filter((file) => activityFiles.has(file));
      const editEvidence = linkedEditEvidence(session, commit, match, commits);
      session.commitLinks.push({
        hash: commit.hash,
        confidence: match.confidence,
        overlappingFiles,
        commitCallId: match.evidence.commitObservedInCall ?? null,
        linkedEditCallIds: editEvidence.callIds,
        linkedEditFiles: editEvidence.files,
        ...sessionCommitEdge(match, overlappingFiles, editEvidence),
      });
    }
  }
  for (const session of sessions) {
    const linkedHashes = new Set(session.commitLinks.map((link) => link.hash));
    const activityFiles = new Set(session.toolActivity.files.map((file) => file.path));
    const contextual = commits.map((commit) => ({
      commit,
      overlappingFiles: commit.files.map((file) => file.path).filter((file) => activityFiles.has(file)),
    })).filter(({ commit, overlappingFiles }) => !linkedHashes.has(commit.hash) && overlappingFiles.length > 0).slice(0, 5);
    for (const { commit, overlappingFiles } of contextual) {
      session.commitLinks.push({
        hash: commit.hash,
        confidence: "contextual",
        evidenceKind: "file-context",
        overlappingFiles,
        commitCallId: null,
        linkedEditCallIds: [],
        linkedEditFiles: [],
        ...edgeEvidence({
          kind: "file-context",
          source: "exact-repository-path",
          facts: [`${overlappingFiles.length} exact repository path(s) occur in both objects.`],
        }),
      });
    }
  }
  return stories;
}

function replayClock(value) {
  if (Number.isFinite(value)) return Math.round(value);
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

function buildSessionReplay(session, commits) {
  const callsById = new Map(session.toolActivity.calls.map((call) => [call.id, call]));
  const events = [];
  const placedCallIds = new Set();
  let sequence = 0;
  const append = (event) => {
    sequence += 1;
    // Bounded projection text keeps its ellipsis, so Replay can say the body is an
    // excerpt instead of showing a silently clipped command.
    const bodyExcerpt = typeof event.body === "string" && event.body.endsWith("…");
    events.push({ ...event, ...(bodyExcerpt ? { bodyExcerpt: true } : {}), order: sequence });
  };

  for (const turn of session.dialogue.turns) {
    const promptAt = replayClock(turn.prompt?.timestamp);
    const turnStart = replayClock(turn.startMs);
    append({
      id: `turn:${turn.index}:prompt`,
      type: "prompt",
      turnIndex: turn.index,
      label: "Prompt",
      title: `User prompt ${turn.index}`,
      body: safeText(turn.prompt?.text, 1_500, "Prompt unavailable after privacy filtering"),
      timeBasis: promptAt !== null ? "observed" : turnStart !== null ? "turn-boundary" : "sequence-only",
      ...(promptAt !== null || turnStart !== null ? { atMs: promptAt ?? turnStart } : {}),
      files: [],
    });

    let noteIndex = 0;
    for (const step of turn.steps) {
      if (step.kind === "note") {
        noteIndex += 1;
        append({
          id: `turn:${turn.index}:note:${noteIndex}`,
          type: "intermediate",
          turnIndex: turn.index,
          label: "Intermediate",
          title: `Intermediate response ${noteIndex}`,
          body: safeText(step.text, 400, "Intermediate response unavailable"),
          timeBasis: "sequence-only",
          files: [],
        });
        continue;
      }
      if (step.kind !== "tool") continue;
      const call = callsById.get(step.callId);
      if (!call) continue;
      placedCallIds.add(call.id);
      const atMs = replayClock(call.startedAt);
      const files = [...(call.filePaths ?? (call.filePath ? [call.filePath] : []))];
      append({
        id: `call:${call.id}`,
        type: "tool-call",
        turnIndex: turn.index,
        label: call.actionLabel,
        title: `${call.id} · ${call.actionLabel}`,
        body: safeText(call.detail, 240, `${call.toolName} input was not retained`),
        meta: safeText(call.toolName, 64, "Unknown tool"),
        status: call.status,
        timeBasis: atMs !== null ? "observed" : "sequence-only",
        ...(atMs !== null ? { atMs } : {}),
        ...(call.durationStatus === "observed" && Number.isFinite(call.durationMs) ? { durationMs: call.durationMs } : {}),
        files,
      });
    }

    const responseAt = replayClock(turn.endMs);
    append({
      id: `turn:${turn.index}:response`,
      type: "response",
      turnIndex: turn.index,
      label: "Response",
      title: "Assistant response",
      body: safeText(turn.response, 6_000, "Response body was unavailable or removed by privacy filtering."),
      availability: turn.response ? "retained" : "unavailable",
      timeBasis: responseAt !== null ? "turn-boundary" : "sequence-only",
      ...(responseAt !== null ? { atMs: responseAt } : {}),
      files: [],
    });
  }

  const insertByObservedTime = (event) => {
    const nextIndex = events.findIndex((candidate) => Number.isFinite(candidate.atMs) && candidate.atMs > event.atMs);
    if (nextIndex === -1) events.push(event);
    else events.splice(nextIndex, 0, event);
  };

  const unplacedCalls = session.toolActivity.calls
    .filter((call) => !placedCallIds.has(call.id))
    .slice()
    .sort((left, right) => (replayClock(left.startedAt) ?? Number.POSITIVE_INFINITY)
      - (replayClock(right.startedAt) ?? Number.POSITIVE_INFINITY) || left.step - right.step);
  for (const call of unplacedCalls) {
    const atMs = replayClock(call.startedAt);
    const files = [...(call.filePaths ?? (call.filePath ? [call.filePath] : []))];
    const event = {
      id: `call:${call.id}`,
      type: "tool-call",
      turnIndex: null,
      label: call.actionLabel,
      title: `${call.id} · ${call.actionLabel}`,
      body: safeText(call.detail, 240, `${call.toolName} input was not retained`),
      meta: safeText(call.toolName, 64, "Unknown tool"),
      status: call.status,
      timeBasis: atMs !== null ? "observed" : "sequence-only",
      ...(atMs !== null ? { atMs } : {}),
      ...(call.durationStatus === "observed" && Number.isFinite(call.durationMs) ? { durationMs: call.durationMs } : {}),
      files,
    };
    if (atMs === null) events.push(event);
    else insertByObservedTime(event);
  }

  const directCommitLinks = session.commitLinks.filter((link) => ["explicit", "observed-commit"].includes(link.evidenceKind));
  for (const link of directCommitLinks) {
    const commit = commits.find((candidate) => candidate.hash === link.hash);
    const atMs = commit ? commitTimeMs(commit) : null;
    if (!commit || atMs === null) continue;
    insertByObservedTime({
      id: `commit:${commit.hash}`,
      type: "commit",
      turnIndex: null,
      label: "Commit",
      title: `${commit.shortHash} · ${commit.subject}`,
      body: safeText(`${commit.fileCount} files · +${commit.linesAdded} / -${commit.linesRemoved}. ${link.limitations[0] ?? ""}`, 600),
      meta: link.evidenceKind,
      timeBasis: "observed",
      atMs,
      files: commit.files.map((file) => file.path),
    });
  }

  events.forEach((event, index) => { event.order = index + 1; });
  const eventTimes = events.map((event) => event.atMs).filter(Number.isFinite);
  const observedStart = replayClock(session.firstSeen);
  const observedEnd = replayClock(session.lastSeen);
  const startCandidates = [...eventTimes, observedStart].filter(Number.isFinite);
  const endCandidates = [...events.map((event) => Number.isFinite(event.atMs)
    ? event.atMs + (Number.isFinite(event.durationMs) ? event.durationMs : 0)
    : null), observedEnd].filter(Number.isFinite);
  const files = new Map();
  for (const event of events) {
    for (const filePath of event.files) {
      const file = files.get(filePath) ?? { path: filePath, eventIds: [] };
      file.eventIds.push(event.id);
      files.set(filePath, file);
    }
  }
  for (const file of session.toolActivity.files) {
    if (!files.has(file.path)) files.set(file.path, { path: file.path, eventIds: [] });
  }

  return {
    kind: "SessionReplay",
    schemaVersion: 1,
    timeBasis: eventTimes.length ? "observed-time" : "call-sequence",
    startMs: startCandidates.length ? Math.min(...startCandidates) : null,
    endMs: endCandidates.length ? Math.max(...endCandidates) : null,
    eventCount: events.length,
    timedEventCount: eventTimes.length,
    sequenceOnlyCount: events.filter((event) => event.timeBasis === "sequence-only").length,
    files: [...files.values()].sort((left, right) => left.path.localeCompare(right.path)),
    events,
  };
}

function buildDays(sessions, commits) {
  const byDay = new Map();
  const ensure = (day) => {
    if (!day) return null;
    if (!byDay.has(day)) byDay.set(day, { date: day, sessionIds: [], commitHashes: [], promptCount: 0, toolCallCount: 0 });
    return byDay.get(day);
  };
  for (const session of sessions) {
    const firstDay = isoDay(session.firstSeen);
    const lastDay = isoDay(session.lastSeen);
    const sessionDays = new Set([firstDay, lastDay, ...session.prompts.map((prompt) => prompt.day)].filter(Boolean));
    if (firstDay && lastDay && firstDay !== lastDay) {
      const cursor = new Date(`${firstDay}T00:00:00.000Z`);
      const end = new Date(`${lastDay}T00:00:00.000Z`);
      for (let count = 0; cursor <= end && count < 366; count += 1) {
        sessionDays.add(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
    for (const sessionDay of sessionDays) {
      const day = ensure(sessionDay);
      if (!day) continue;
      day.sessionIds.push(session.sessionId);
      day.promptCount += session.prompts.filter((prompt) => prompt.day === sessionDay).length;
      if (firstDay === lastDay) day.toolCallCount += session.toolCallCount;
    }
  }
  for (const commit of commits) {
    const day = ensure(commit.day);
    if (day) day.commitHashes.push(commit.hash);
  }
  return [...byDay.values()].sort((left, right) => left.date.localeCompare(right.date));
}

const PROVIDER_STATUSES = new Set(["ok", "no-evidence", "error"]);

// Providers keep only platform identity, a status whitelist, and bounded
// counts; raw provider error text stays in CLI-side diagnostics.
function projectProviders(providers, sessions) {
  const includedByPlatform = new Map();
  for (const session of sessions) {
    includedByPlatform.set(session.platform, (includedByPlatform.get(session.platform) ?? 0) + 1);
  }
  return (providers ?? []).map((provider) => {
    const platform = safeText(provider?.platform, 40, "unknown");
    return {
      platform,
      status: PROVIDER_STATUSES.has(provider?.status) ? provider.status : "ok",
      discovered: Math.max(0, Math.trunc(Number(provider?.discovered) || 0)),
      sessionCount: includedByPlatform.get(platform) ?? 0,
    };
  });
}

export function buildHarnessInspectorReport({
  repoRoot,
  featureTree,
  sessions = [],
  correlation,
  providers = [],
  filters = {},
  diagnostics = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const tree = safeTree(featureTree, repoRoot);
  const projectedSessions = sessions.map(projectSession).filter(Boolean);
  const commits = (correlation?.commits ?? []).map(projectCommit);
  const reportDiagnostics = diagnostics.map((item) => safeText(item, 240)).filter(Boolean);
  const stories = buildStoryLinks(tree, projectedSessions, commits, reportDiagnostics);
  for (const session of projectedSessions) {
    session.usageSnapshot = projectUsageSnapshot(session.usageReport, generatedAt);
    session.replay = buildSessionReplay(session, commits);
  }
  const stages = [...new Set(tree.nodes.map((node) => node.stage).filter(Boolean))].sort();
  const unmappedSessionIds = projectedSessions.filter((session) => session.storyLinks.length === 0).map((session) => session.sessionId);

  return {
    kind: HARNESS_INSPECTOR_REPORT_KIND,
    schemaVersion: HARNESS_INSPECTOR_REPORT_SCHEMA_VERSION,
    generatedAt,
    workspace: { name: path.basename(repoRoot ?? "workspace") },
    presentation: {
      defaultCompactCommitEvidenceKinds: [...DEFAULT_COMPACT_COMMIT_EVIDENCE_KINDS],
    },
    filters: {
      platform: safeText(filters.platform, 120, "all"),
      since: filters.since ?? null,
      until: filters.until ?? null,
      stage: safeText(filters.stage, 64),
      commitLimit: Number(filters.commitLimit) || null,
      sessionLimit: Number(filters.sessionLimit) || null,
    },
    providers: projectProviders(providers, projectedSessions),
    featureTree: tree,
    stages,
    stories,
    sessions: projectedSessions,
    commits,
    days: buildDays(projectedSessions, commits),
    diagnostics: [
      ...reportDiagnostics,
      ...(tree.nodes.length === 0 ? ["No feature tree was supplied; use Date mode to inspect observed evidence."] : []),
      ...(unmappedSessionIds.length > 0 ? [`${unmappedSessionIds.length} session(s) have no declared or commit-derived Story link.`] : []),
    ],
  };
}

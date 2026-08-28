import path from "node:path";

import {
  buildToolCallTrace,
  buildUsageReport,
  createAnalyzer,
  observedContextUsage,
  observedProcessingAccounting,
  observedTokenUsage,
  privacySafeUserInputText,
  usageDeduplicationDiagnostics,
  usageObservationFromEvent,
  USAGE_TOKEN_FIELDS,
} from "../session-analysis/index.mjs";
import { redactTranscriptText } from "./redaction.mjs";
import { buildSessionTurns } from "./session-view.mjs";
import { attributeSessionToolName } from "./tool-attribution.mjs";
import { normalizeToolActivity } from "./tool-activity.mjs";

export const DEFAULT_MAX_SESSIONS = 20;
const MAX_PROMPTS_PER_SESSION = 8;
const MAX_FILES_PER_SESSION = 400;
const MAX_MODELS_PER_SESSION = 4;
const PROMPT_SUMMARY_LIMIT = 200;
const MAX_ENTIRE_TRANSCRIPT_LINES = 200_000;
const PATCH_FILE_RE = /^\*\*\*\s+(?:Add|Update|Delete) File:\s+(.+?)\s*$/gmu;
const ESCAPED_PATCH_FILE_RE = /(?:^|\\n)\*\*\*\s+(?:Add|Update|Delete) File:\s+(.+?)(?=\\n|$)/gu;
const POSIX_PRIVATE_PATH_RE = /(^|[^\p{L}\p{N}_])\/(?:Users|home|var|private|tmp|opt)\/[^\s"'`<>]+/gmu;
const WINDOWS_PRIVATE_PATH_RE = /[A-Za-z]:\\(?:Users\\)?[^\s"'`<>]+/gu;

function timestampMillis(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

export function boundedMaxSessions(value, fallback = DEFAULT_MAX_SESSIONS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(100, Math.max(1, Math.trunc(parsed)));
}

function repoRelativePath(filePath, repoRoot) {
  if (typeof filePath !== "string" || filePath.length === 0) return null;
  const windowsAbsolute = /^[A-Za-z]:[\\/]|^\\\\/u.test(filePath);
  const posixAbsolute = path.posix.isAbsolute(filePath);
  const repoIsWindows = /^[A-Za-z]:[\\/]|^\\\\/u.test(repoRoot);
  if ((windowsAbsolute && !repoIsWindows) || (posixAbsolute && repoIsWindows)) return null;
  const pathApi = repoIsWindows ? path.win32 : path.posix;
  const absolute = pathApi.isAbsolute(filePath) ? filePath : pathApi.resolve(repoRoot, filePath);
  const relative = pathApi.relative(repoRoot, absolute);
  if (relative.length === 0 || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative.replaceAll("\\", "/");
}

function isWithinRepo(candidate, repoRoot) {
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  const relative = path.relative(repoRoot, candidate);
  return relative.length === 0 || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

// Hosts emit different tool request types (claude "tool.call", qoder
// "tool.requested"), so detect tool requests by category and lifecycle phase.
function isToolRequest(event) {
  if (event?.type === "tool.call" || event?.type === "tool.requested") return true;
  return event?.category === "tool" && event?.lifecyclePhase === "request";
}

function isFileEditTool(event) {
  return /(?:^|[_-])(?:edit|write|create|patch|replace|update)(?:$|[_-])/iu.test(String(event?.toolName ?? ""));
}

function invocationKey(event) {
  return event?.toolInvocationId
    ?? `${event?.timestamp ?? ""}|${event?.toolName ?? ""}|${event?.commandText ?? event?.filePath ?? ""}`;
}

function attributedToolEvents(events) {
  const names = new Map();
  for (const event of events) {
    if (!isToolRequest(event)) continue;
    names.set(invocationKey(event), attributeSessionToolName(event));
  }
  return events.map((event) => {
    const toolName = names.get(invocationKey(event));
    return toolName ? { ...event, toolName } : event;
  });
}

function transientFilePaths(event, repoRoot) {
  const candidates = [event?.filePath];
  for (const value of [event?.targetPaths, event?.affectedPaths]) {
    if (Array.isArray(value)) candidates.push(...value);
    else if (typeof value === "string") candidates.push(value);
  }
  const commandText = String(event?.commandText ?? "");
  for (const pattern of [PATCH_FILE_RE, ESCAPED_PATCH_FILE_RE]) {
    for (const match of commandText.matchAll(pattern)) candidates.push(match[1]);
  }
  return [...new Set(candidates.map((value) => repoRelativePath(value, repoRoot)).filter(Boolean))];
}

function safeDialogueText(value, limit) {
  const redacted = redactTranscriptText(value, { limit });
  if (!redacted) return null;
  return redacted
    .replace(POSIX_PRIVATE_PATH_RE, "$1<absolute-path>")
    .replace(WINDOWS_PRIVATE_PATH_RE, "<absolute-path>");
}

// Re-normalize a retained Session View step for the portable Session summary.
// The shared normalizers keep this bounded projection identical to the one the
// Session View and the Inspector apply.
function summarizeUsageStep(step) {
  const tokenUsage = observedTokenUsage(step?.tokenUsage);
  const contextUsage = observedContextUsage(step?.contextUsage);
  const processing = observedProcessingAccounting(step);
  if (!tokenUsage && !contextUsage && !processing.processedTokens) return null;
  return {
    kind: "usage",
    ...(tokenUsage ? { tokenUsage } : {}),
    ...(contextUsage ? { contextUsage } : {}),
    ...(step?.basis ? { basis: String(step.basis).slice(0, 40) } : {}),
    ...(step?.source ? { source: String(step.source).slice(0, 80) } : {}),
    ...(step?.model ? { model: String(step.model).slice(0, 80) } : {}),
    ...processing,
    timestamp: step?.timestamp ?? null,
  };
}

function summarizeDialogue(events) {
  const { turns, truncated } = buildSessionTurns(events);
  let toolCallStep = 0;
  return {
    truncated,
    turns: turns.map((turn) => ({
      index: turn.index,
      anchorId: turn.anchorId,
      prompt: {
        text: safeDialogueText(turn.prompt?.text, 1_500),
        timestamp: turn.prompt?.timestamp ?? null,
      },
      steps: (turn.steps ?? []).map((step) => {
        if (step.kind === "tool") {
          toolCallStep += 1;
          return { kind: "tool", callStep: toolCallStep, toolName: String(step.toolName ?? "Unknown tool") };
        }
        if (step.kind === "usage") return summarizeUsageStep(step);
        return step.kind === "note" ? { kind: "note", text: safeDialogueText(step.text, 400) } : null;
      }).filter(Boolean).filter((step) => step.kind !== "note" || step.text),
      toolCallCount: Number(turn.toolCallCount) || 0,
      messageCount: Number(turn.messageCount) || 0,
      intermediateCount: Number(turn.intermediateCount) || 0,
      usageEventCount: Number(turn.usageEventCount) || 0,
      eventCount: Number(turn.eventCount) || 0,
      shownEventCount: Number(turn.shownEventCount) || 0,
      processTruncated: turn.processTruncated === true,
      response: safeDialogueText(turn.response, 6_000),
      responseStatus: ["retained", "incomplete", "unavailable"].includes(turn.responseStatus)
        ? turn.responseStatus
        : (turn.response ? "retained" : "unavailable"),
      durationMs: Number.isFinite(turn.durationMs) ? turn.durationMs : null,
      startMs: Number.isFinite(turn.startMs) ? turn.startMs : null,
      endMs: Number.isFinite(turn.endMs) ? turn.endMs : null,
    })),
  };
}

function addTokenUsage(target, usage, observedFields) {
  if (!usage || typeof usage !== "object") return;
  for (const field of USAGE_TOKEN_FIELDS) {
    if (!Object.hasOwn(usage, field)) continue;
    const value = Number(usage[field]);
    if (!Number.isFinite(value) || value < 0) continue;
    target[field] = (target[field] ?? 0) + value;
    observedFields.add(field);
  }
}

function cumulativeCounter(usage) {
  const explicit = Number(usage?.totalTokens);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  return (Number(usage?.inputTokens) || 0) + (Number(usage?.outputTokens) || 0);
}

// Codex emits cumulative snapshots rather than one independent usage record per
// response. Repeated snapshots replace the prior point, while a decreasing
// counter starts a new accounting segment (for example after a resumed run).
function aggregateCumulativeUsage(snapshots) {
  const aggregate = {};
  const observedFields = new Set();
  let previous = null;
  for (const snapshot of snapshots) {
    if (previous && cumulativeCounter(snapshot) < cumulativeCounter(previous)) {
      addTokenUsage(aggregate, previous, observedFields);
    }
    previous = snapshot;
  }
  if (previous) addTokenUsage(aggregate, previous, observedFields);
  return { aggregate, observedFields };
}

// Reduce hydrated session events into the bounded, privacy-safe summary shape
// consumed by correlate.mjs and render-html.mjs. Pure over events + repoRoot.
export function summarizeSessionEvents(session, events = [], {
  repoRoot,
  platform,
  includeToolTrace = false,
  includeDialogue = false,
} = {}) {
  const attributedEvents = attributedToolEvents(events);
  const files = new Set();
  const prompts = [];
  const models = new Set();
  let firstSeen = timestampMillis(session.firstSeen);
  let lastSeen = timestampMillis(session.lastSeen);
  let promptCount = 0;
  let toolCallCount = 0;
  let assistantMessageCount = 0;
  let fileEditCount = 0;
  let cwdWithinRepo = false;
  const toolCounts = new Map();
  const requestFacts = [];
  const distinctUserTurns = new Set();
  const seenToolInvocations = new Set();
  const tokenTotals = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0 };
  const observedTokenFields = new Set(["inputTokens", "outputTokens", "cacheReadInputTokens"]);
  const cumulativeUsageSnapshots = [];
  const usageSources = new Set();
  const usageBases = new Set();
  const runtimeMetadata = {};
  const contextLayers = new Map();
  const contextCategories = new Map();
  let currentContextUsage = null;
  let compactionCount = 0;
  let usageObserved = false;

  for (const event of attributedEvents) {
    const eventTime = timestampMillis(event?.timestamp);
    if (eventTime !== null) {
      if (firstSeen === null || eventTime < firstSeen) firstSeen = eventTime;
      if (lastSeen === null || eventTime > lastSeen) lastSeen = eventTime;
    }
    if (event?.cwd && !cwdWithinRepo) cwdWithinRepo = isWithinRepo(event.cwd, repoRoot);
    if (isToolRequest(event)) {
      const key = invocationKey(event);
      if (!seenToolInvocations.has(key)) {
        seenToolInvocations.add(key);
        toolCallCount += 1;
        const toolName = event.toolName;
        toolCounts.set(toolName, (toolCounts.get(toolName) ?? 0) + 1);
        const filePaths = transientFilePaths(event, repoRoot);
        for (const filePath of filePaths) if (files.size < MAX_FILES_PER_SESSION) files.add(filePath);
        requestFacts.push({
          step: toolCallCount,
          toolName,
          transientCommandText: event.commandText ?? null,
          filePath: filePaths[0] ?? null,
          filePaths,
          transientInvocationKey: event.toolInvocationId ?? event.requestId ?? event.callId ?? null,
        });
        if (isFileEditTool({ toolName })) fileEditCount += 1;
      }
    }
    if (event?.type === "assistant" && typeof event.content === "string" && event.content.trim().length > 0) {
      assistantMessageCount += 1;
    }
    if (event?.filePath) {
      const relative = repoRelativePath(event.filePath, repoRoot);
      if (relative && files.size < MAX_FILES_PER_SESSION) files.add(relative);
    }
    if (event?.userPrompt === true) {
      promptCount += 1;
      const summary = privacySafeUserInputText(event.userText ?? null, { limit: PROMPT_SUMMARY_LIMIT });
      if (summary) distinctUserTurns.add(summary);
      if (summary && prompts.length < MAX_PROMPTS_PER_SESSION && !prompts.some((prompt) => prompt.text === summary)) {
        prompts.push({ text: summary, timestamp: event.timestamp ?? null });
      }
    }
    if (event?.modelUsage && typeof event.modelUsage === "object") {
      usageObserved = true;
      if (event.usageCumulative === true) cumulativeUsageSnapshots.push(event.modelUsage);
      else addTokenUsage(tokenTotals, event.modelUsage, observedTokenFields);
      if (event.usageSource) usageSources.add(String(event.usageSource));
      else if (event.sourceKind) usageSources.add(String(event.sourceKind));
      if (event.usageBasis) usageBases.add(String(event.usageBasis));
    }
    if (event?.model && models.size < MAX_MODELS_PER_SESSION) models.add(String(event.model));
    if (event?.runtimeMetadata && typeof event.runtimeMetadata === "object") {
      for (const field of ["modelProvider", "cliVersion", "effort"]) {
        if (event.runtimeMetadata[field]) runtimeMetadata[field] = String(event.runtimeMetadata[field]);
      }
    }
    for (const layer of Array.isArray(event?.contextLayers) ? event.contextLayers : []) {
      const kind = String(layer?.kind ?? "").trim();
      const count = Number(layer?.itemCount);
      if (!kind || !Number.isFinite(count) || count <= 0) continue;
      const current = contextLayers.get(kind) ?? 0;
      contextLayers.set(kind, layer.aggregation === "sum" ? current + count : Math.max(current, count));
    }
    for (const category of Array.isArray(event?.contextCategories) ? event.contextCategories : []) {
      const kind = String(category?.kind ?? "").trim();
      const estimatedTokens = Number(category?.estimatedTokens);
      if (!kind || !Number.isFinite(estimatedTokens) || estimatedTokens < 0) continue;
      contextCategories.set(kind, {
        kind,
        label: String(category?.label ?? kind),
        estimatedTokens: Math.round(estimatedTokens),
      });
    }
    if (event?.currentContextUsage && typeof event.currentContextUsage === "object") {
      currentContextUsage = { ...(currentContextUsage ?? {}), ...event.currentContextUsage };
    }
    if (event?.compactionBoundary === true) compactionCount += 1;
  }

  if (cumulativeUsageSnapshots.length > 0) {
    const cumulative = aggregateCumulativeUsage(cumulativeUsageSnapshots);
    addTokenUsage(tokenTotals, cumulative.aggregate, observedTokenFields);
    for (const field of cumulative.observedFields) observedTokenFields.add(field);
  }

  const toolTrace = includeToolTrace
    ? buildToolCallTrace(
      attributedEvents.filter((event) => event?.category === "tool" || event?.toolName || event?.functionCallName),
      { laneLimit: 8, includeTransientInvocationKey: true },
    )
    : null;
  const toolActivity = toolTrace ? normalizeToolActivity(toolTrace.calls, requestFacts) : null;
  const dialogue = includeDialogue ? summarizeDialogue(attributedEvents) : null;
  // Derived from every retained inference, never from the display-bounded
  // dialogue above, so `actualModelCalls` and the processing totals stay the
  // Session's real numbers even when Session View caps what it shows.
  const usageReport = buildUsageReport(
    attributedEvents.map(usageObservationFromEvent).filter(Boolean),
    { diagnostics: usageDeduplicationDiagnostics(attributedEvents) },
  );
  if (toolTrace) {
    toolTrace.calls = toolTrace.calls.map(({ transientInvocationKey: _transientInvocationKey, ...call }) => call);
  }

  const contextWindowTokens = Number(currentContextUsage?.windowTokens);
  const contextUsedTokens = Number(currentContextUsage?.usedTokens);
  const contextPercentFull = Number(currentContextUsage?.percentFull);
  const hasContextUsedTokens = Number.isFinite(contextUsedTokens) && contextUsedTokens >= 0;
  const hasContextWindowTokens = Number.isFinite(contextWindowTokens) && contextWindowTokens > 0;
  const hasContextPercentFull = Number.isFinite(contextPercentFull) && contextPercentFull >= 0 && contextPercentFull <= 100;
  const hasContextWindow = Number.isFinite(contextWindowTokens) && contextWindowTokens > 0
    && Number.isFinite(contextUsedTokens) && contextUsedTokens >= 0;
  const contextManifestObserved = contextLayers.size > 0 || contextCategories.size > 0
    || hasContextUsedTokens || hasContextWindowTokens || hasContextPercentFull || compactionCount > 0;
  const tokenUsage = usageObserved ? {
    ...Object.fromEntries(USAGE_TOKEN_FIELDS
      .filter((field) => observedTokenFields.has(field))
      .map((field) => [field, tokenTotals[field] ?? 0])),
    basis: usageBases.size === 1 ? [...usageBases][0] : usageBases.size > 1 ? "mixed" : "model-inference",
    source: usageSources.size === 1 ? [...usageSources][0] : usageSources.size > 1 ? "mixed-normalized-events" : "normalized-session-events",
    coverage: "observed",
  } : null;
  const contextManifest = contextManifestObserved ? {
    status: hasContextWindow || contextCategories.size > 0 ? "observed" : "partial",
    source: currentContextUsage?.source ?? "normalized-context-events",
    rawTextOmitted: true,
    ...(hasContextUsedTokens ? { usedTokens: Math.round(contextUsedTokens) } : {}),
    ...(hasContextWindowTokens ? { windowTokens: Math.round(contextWindowTokens) } : {}),
    ...(hasContextPercentFull ? { percentFull: Math.round(contextPercentFull * 10) / 10 }
      : hasContextWindow
        ? { percentFull: Math.min(100, Math.round((contextUsedTokens / contextWindowTokens) * 1_000) / 10) }
        : {}),
    ...(currentContextUsage?.basis ? { basis: String(currentContextUsage.basis).slice(0, 40) } : {}),
    compactionCount,
    layers: [...contextLayers.entries()]
      .map(([kind, itemCount]) => ({ kind, itemCount: Math.round(itemCount) }))
      .sort((left, right) => left.kind.localeCompare(right.kind)),
    // Context categories are semantic lanes owned by the host. Preserve their
    // retained order; the UI already uses token estimates for segment widths.
    categories: [...contextCategories.values()],
  } : null;

  return {
    sessionId: session.sessionId,
    platform: platform ?? session.platform ?? null,
    ...(session.revisionId ? { revisionId: session.revisionId } : {}),
    firstSeen: firstSeen === null ? null : new Date(firstSeen).toISOString(),
    lastSeen: lastSeen === null ? null : new Date(lastSeen).toISOString(),
    durationMs: firstSeen !== null && lastSeen !== null ? lastSeen - firstSeen : null,
    cwdWithinRepo,
    files: [...files].sort(),
    prompts,
    promptCount,
    promptObservationCount: promptCount,
    userTurnCount: distinctUserTurns.size,
    retainedUserTurnCount: prompts.length,
    toolCallCount,
    assistantMessageCount,
    fileEditCount,
    toolCounts: Object.fromEntries([...toolCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    ...(toolTrace ? { toolTrace, toolActivity } : {}),
    ...(dialogue ? { dialogue } : {}),
    models: [...models].sort(),
    tokenUsage,
    usageReport,
    runtime: Object.keys(runtimeMetadata).length > 0 ? runtimeMetadata : null,
    contextManifest,
    timestampBasis: session.timestampBasis ?? (firstSeen !== null || lastSeen !== null ? "native-event" : "unobserved"),
  };
}

function withinRange(session, sinceMs, untilMs) {
  const firstSeen = timestampMillis(session.firstSeen);
  const lastSeen = timestampMillis(session.lastSeen);
  if (sinceMs !== null && lastSeen !== null && lastSeen < sinceMs) return false;
  if (untilMs !== null && firstSeen !== null && firstSeen > untilMs) return false;
  return true;
}

export async function collectSessionSummaries({
  workspace,
  repoRoot,
  platform = "qoder",
  since = null,
  until = null,
  maxSessions = DEFAULT_MAX_SESSIONS,
  includeToolTrace = false,
  includeDialogue = false,
} = {}) {
  const analyzer = await createAnalyzer(platform);
  const scopeOptions = { workspace };
  if (since) scopeOptions.since = since;
  if (until) scopeOptions.until = until;
  const scope = await analyzer.resolveScope(scopeOptions);
  const roots = await analyzer.discoverSourceRoots(scope);
  const discovered = await analyzer.discoverSessions(scope, roots);

  const sinceMs = timestampMillis(since);
  const untilMs = timestampMillis(until);
  const selected = discovered
    .filter((session) => withinRange(session, sinceMs, untilMs))
    .sort((a, b) => (timestampMillis(b.lastSeen) ?? 0) - (timestampMillis(a.lastSeen) ?? 0))
    .slice(0, boundedMaxSessions(maxSessions));

  const summaries = [];
  for (const session of selected) {
    const events = await analyzer.readSession(session, scope, {
      includeUserText: true,
      // Command text is transient input for nested-tool attribution and exact
      // structured file extraction. It never enters the returned projection.
      includeCommandText: includeToolTrace,
      includeContent: includeDialogue,
    });
    summaries.push(summarizeSessionEvents(session, events, {
      repoRoot,
      platform,
      includeToolTrace,
      includeDialogue,
    }));
  }
  return summaries;
}

// Discover sessions across several platforms for one workspace, merge the
// candidates by recency under one global maxSessions bound, and hydrate only
// the selected candidates. One provider failing or having no local evidence
// roots never fails the whole collection; each provider reports its own
// status so callers can surface bounded diagnostics.
export async function collectMultiPlatformSessionSummaries({
  workspace,
  repoRoot,
  platforms = [],
  since = null,
  until = null,
  maxSessions = DEFAULT_MAX_SESSIONS,
  includeToolTrace = false,
  includeDialogue = false,
  createAnalyzer: createPlatformAnalyzer = createAnalyzer,
} = {}) {
  const requested = [...new Set(platforms)];
  const sinceMs = timestampMillis(since);
  const untilMs = timestampMillis(until);
  const providers = [];
  const candidates = [];
  for (const platform of requested) {
    const provider = { platform, status: "ok", discovered: 0, included: 0 };
    providers.push(provider);
    try {
      const analyzer = await createPlatformAnalyzer(platform);
      const scopeOptions = { workspace };
      if (since) scopeOptions.since = since;
      if (until) scopeOptions.until = until;
      const scope = await analyzer.resolveScope(scopeOptions);
      const roots = await analyzer.discoverSourceRoots(scope);
      if (!roots.some((root) => root.exists && root.enabled !== false)) {
        provider.status = "no-evidence";
        continue;
      }
      const discovered = (await analyzer.discoverSessions(scope, roots))
        .filter((session) => withinRange(session, sinceMs, untilMs));
      provider.discovered = discovered.length;
      for (const session of discovered) candidates.push({ platform, provider, analyzer, scope, session });
    } catch (error) {
      provider.status = "error";
      provider.message = String(error?.message ?? error);
    }
  }

  const selected = candidates
    .sort((a, b) => (timestampMillis(b.session.lastSeen) ?? 0) - (timestampMillis(a.session.lastSeen) ?? 0))
    .slice(0, boundedMaxSessions(maxSessions));
  const summaries = [];
  for (const candidate of selected) {
    try {
      const events = await candidate.analyzer.readSession(candidate.session, candidate.scope, {
        includeUserText: true,
        includeCommandText: includeToolTrace,
        includeContent: includeDialogue,
      });
      summaries.push(summarizeSessionEvents(candidate.session, events, {
        repoRoot,
        platform: candidate.platform,
        includeToolTrace,
        includeDialogue,
      }));
      candidate.provider.included += 1;
    } catch (error) {
      candidate.provider.status = "error";
      candidate.provider.message = String(error?.message ?? error);
    }
  }
  return { sessions: summaries, providers };
}

// Hydrate one session with full transcript options for the session view.
// Picks the requested session id (exact or unique prefix) or the most recent
// session when no id is given.
export async function collectSessionDetail({
  workspace,
  repoRoot,
  platform = "qoder",
  sessionId = null,
} = {}) {
  const analyzer = await createAnalyzer(platform);
  const scope = await analyzer.resolveScope({ workspace });
  const roots = await analyzer.discoverSourceRoots(scope);
  const discovered = await analyzer.discoverSessions(scope, roots);

  let session = null;
  if (sessionId) {
    const matches = discovered.filter((candidate) =>
      candidate.sessionId === sessionId || candidate.sessionId.startsWith(sessionId));
    if (matches.length === 0) throw new Error(`session not found: ${sessionId}`);
    if (matches.length > 1) throw new Error(`session id is ambiguous: ${sessionId}`);
    [session] = matches;
  } else {
    session = discovered
      .sort((a, b) => (timestampMillis(b.lastSeen) ?? 0) - (timestampMillis(a.lastSeen) ?? 0))[0] ?? null;
    if (!session) throw new Error("no sessions discovered for this workspace");
  }

  const events = await analyzer.readSession(session, scope, {
    includeUserText: true,
    includeContent: true,
    includeCommandText: true,
  });
  return {
    summary: summarizeSessionEvents(session, events, {
      repoRoot,
      platform,
      includeToolTrace: true,
      includeDialogue: true,
    }),
    events,
  };
}

function platformFromEntireAgent(agent, fallback = "claude") {
  const normalized = String(agent ?? "").toLowerCase();
  if (normalized.includes("claude")) return "claude";
  if (normalized.includes("codex")) return "codex";
  if (normalized.includes("qoder")) return "qoder";
  if (normalized.includes("cursor")) return "cursor";
  if (normalized.includes("copilot")) return "copilot";
  return fallback;
}

export async function normalizeEntireCheckpointSession({
  transcript,
  sessionId,
  checkpointId,
  repoRoot,
  agent = null,
  platform = null,
  model = null,
  metadata = null,
} = {}) {
  const resolvedPlatform = platformFromEntireAgent(agent, platform ?? "claude");
  const analyzer = await createAnalyzer(resolvedPlatform);
  const sourceKind = resolvedPlatform === "claude"
    ? "claude-project-jsonl"
    : resolvedPlatform === "codex" ? "codex-session-jsonl" : `${resolvedPlatform}-session-jsonl`;
  const events = [];
  const lines = String(transcript ?? "").split("\n");
  const truncated = lines.length > MAX_ENTIRE_TRANSCRIPT_LINES;
  for (let index = 0; index < Math.min(lines.length, MAX_ENTIRE_TRANSCRIPT_LINES); index += 1) {
    if (!lines[index].trim()) continue;
    let raw;
    try {
      raw = JSON.parse(lines[index]);
    } catch {
      continue;
    }
    const sourceRef = {
      kind: sourceKind,
      path: `entire-checkpoint:${checkpointId}`,
      line: index + 1,
      sessionId,
    };
    const options = { includeUserText: true, includeContent: true, includeCommandText: true };
    const normalized = typeof analyzer.normalizeEvents === "function"
      ? analyzer.normalizeEvents(raw, sourceRef, options)
      : [analyzer.normalizeEvent(raw, sourceRef, options)].filter(Boolean);
    events.push(...normalized);
  }
  events.sort((a, b) => (timestampMillis(a.timestamp) ?? 0) - (timestampMillis(b.timestamp) ?? 0));
  const summary = summarizeSessionEvents({ sessionId, platform: resolvedPlatform }, events, {
    repoRoot,
    platform: resolvedPlatform,
    includeToolTrace: true,
    includeDialogue: true,
  });
  if (model && summary.models.length === 0) summary.models = [model];
  if (metadata?.filesTouched?.length) {
    summary.files = [...new Set([
      ...summary.files,
      ...metadata.filesTouched.map((file) => repoRelativePath(file, repoRoot)).filter(Boolean),
    ])].sort();
  }
  if (!summary.tokenUsage && metadata?.tokenUsage) {
    summary.tokenUsage = {
      inputTokens: Number(metadata.tokenUsage.input_tokens ?? metadata.tokenUsage.inputTokens) || 0,
      outputTokens: Number(metadata.tokenUsage.output_tokens ?? metadata.tokenUsage.outputTokens) || 0,
      cacheReadInputTokens: Number(metadata.tokenUsage.cache_read_tokens ?? metadata.tokenUsage.cacheReadInputTokens) || 0,
      ...(metadata.tokenUsage.cache_creation_input_tokens !== undefined || metadata.tokenUsage.cacheCreationInputTokens !== undefined
        ? { cacheCreationInputTokens: Number(metadata.tokenUsage.cache_creation_input_tokens ?? metadata.tokenUsage.cacheCreationInputTokens) || 0 }
        : {}),
      ...(metadata.tokenUsage.total_tokens !== undefined || metadata.tokenUsage.totalTokens !== undefined
        ? { totalTokens: Number(metadata.tokenUsage.total_tokens ?? metadata.tokenUsage.totalTokens) || 0 }
        : {}),
      basis: "model-inference",
      source: "entire-checkpoint-metadata",
      coverage: "observed",
    };
  }
  if ((!Number.isFinite(summary.durationMs) || summary.durationMs === 0) && Number.isFinite(metadata?.sessionMetrics?.duration_ms)) {
    summary.durationMs = metadata.sessionMetrics.duration_ms;
  }
  summary.source = "entire-checkpoint";
  summary.sourceCheckpointId = checkpointId;
  return { summary, events, truncated };
}

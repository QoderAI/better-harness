import { redactTranscriptText } from "./redaction.mjs";
import { attributeSessionToolName } from "./tool-attribution.mjs";

export const MAX_TURNS = 60;
export const MAX_STEPS_PER_TURN = 80;
const PROMPT_TEXT_LIMIT = 1_500;
const RESPONSE_TEXT_LIMIT = 6_000;
const NOTE_TEXT_LIMIT = 400;
const TOOL_DETAIL_LIMIT = 120;

function timestampMillis(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function isToolRequest(event) {
  if (event?.type === "tool.call" || event?.type === "tool.requested") return true;
  return event?.category === "tool" && event?.lifecyclePhase === "request";
}

const INJECTED_BLOCK_RE = /<(local-command-caveat|command-message|command-args|environment_context|in-app-browser-context|image|skill|system-reminder|recommended_plugins|codex_internal_context|local-command-stdout|instructions)\b[^>]*>[\s\S]*?<\/\1>/giu;
const COMMAND_NAME_RE = /<command-name>\s*([^<]+?)\s*<\/command-name>/iu;
const AGENTS_INSTRUCTION_HEADING_RE = /^#?\s*AGENTS\.md instructions for[^\n]*$/gimu;
const MY_REQUEST_HEADING_RE = /(?:^|\n)#{1,3}\s*My request(?: for Codex)?:\s*/iu;
const ASSISTANT_METADATA_BLOCK_RE = /<oai-mem-citation\b[^>]*>[\s\S]*?<\/oai-mem-citation>/giu;
const ASSISTANT_DIRECTIVE_RE = /^::(?:code-comment|git-stage|git-commit|git-create-branch|git-push|git-create-pr)\{.*\}\s*$/gmu;

// Strip harness-injected wrapper blocks so only what the user actually typed
// (or the slash command they ran) shows as the prompt. Returns null for
// injected-only records that are not a real turn.
export function cleanPromptText(value) {
  if (!value) return null;
  const source = String(value);
  const commandName = source.match(COMMAND_NAME_RE)?.[1] ?? null;
  const requestMarker = source.match(MY_REQUEST_HEADING_RE);
  const userSource = requestMarker?.index !== undefined
    ? source.slice(requestMarker.index + requestMarker[0].length)
    : source;
  const text = userSource
    .replace(COMMAND_NAME_RE, " ")
    .replace(INJECTED_BLOCK_RE, " ")
    .replace(AGENTS_INSTRUCTION_HEADING_RE, " ")
    .trim();
  if (text.length > 0) return text;
  if (commandName) return commandName.startsWith("/") ? commandName : `/${commandName}`;
  return null;
}

function isUserPrompt(event) {
  return event?.userPrompt === true && event?.userInputMeta !== true;
}

// Some hosts store assistant text as a serialized API message; unwrap it so
// the timeline shows prose instead of raw JSON.
function unwrapAssistantPayload(text) {
  if (!/^\s*\{/u.test(text)) return text;
  try {
    const payload = JSON.parse(text);
    const content = payload?.content ?? payload?.message?.content;
    if (typeof content === "string") return content.trim();
    if (Array.isArray(content)) {
      const joined = content
        .filter((item) => typeof item === "string" || item?.type === "text" || (!item?.type && item?.text))
        .map((item) => (typeof item === "string" ? item : item?.text ?? ""))
        .join("\n")
        .trim();
      return joined.length > 0 ? joined : text;
    }
  } catch {
    return text;
  }
  return text;
}

function assistantText(event) {
  if (event?.type !== "assistant") return null;
  const text = typeof event.content === "string" ? event.content.trim() : "";
  if (text.length === 0) return null;
  const unwrapped = unwrapAssistantPayload(text);
  const cleaned = unwrapped
    .replace(ASSISTANT_METADATA_BLOCK_RE, "")
    .replace(ASSISTANT_DIRECTIVE_RE, "")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

const TURN_TOKEN_USAGE_FIELDS = Object.freeze([
  "inputTokens",
  "outputTokens",
  "cacheReadInputTokens",
  "cacheCreationInputTokens",
  "reasoningOutputTokens",
  "totalTokens",
]);

function inferenceUsageStep(event) {
  const sourceUsage = event?.modelInvocationUsage
    ?? (event?.usageCumulative === true ? null : event?.modelUsage);
  const tokenUsage = {};
  if (sourceUsage && typeof sourceUsage === "object") {
    for (const field of TURN_TOKEN_USAGE_FIELDS) {
      if (!Object.hasOwn(sourceUsage, field)) continue;
      const value = Number(sourceUsage[field]);
      if (Number.isFinite(value) && value >= 0) tokenUsage[field] = Math.round(value);
    }
  }
  const usedTokens = Number(event?.currentContextUsage?.usedTokens);
  const windowTokens = Number(event?.currentContextUsage?.windowTokens);
  const hasContext = Number.isFinite(usedTokens) && usedTokens >= 0
    && Number.isFinite(windowTokens) && windowTokens > 0;
  if (Object.keys(tokenUsage).length === 0 && !hasContext) return null;
  const evidenceSource = event?.usageSource ?? event?.currentContextUsage?.source ?? null;
  return {
    kind: "usage",
    ...(Object.keys(tokenUsage).length > 0 ? { tokenUsage } : {}),
    ...(hasContext ? {
      contextUsage: {
        usedTokens: Math.round(usedTokens),
        windowTokens: Math.round(windowTokens),
        percentFull: Math.min(100, Math.round((usedTokens / windowTokens) * 1_000) / 10),
      },
    } : {}),
    ...(event?.usageBasis ? { basis: String(event.usageBasis) } : {}),
    ...(evidenceSource ? { source: String(evidenceSource) } : {}),
    ...(event?.model ? { model: String(event.model) } : {}),
    timestamp: event?.timestamp ?? null,
  };
}

function toolDetail(event) {
  const detail = event?.commandText ?? event?.filePath ?? null;
  if (!detail) return null;
  const redacted = redactTranscriptText(detail, { limit: TOOL_DETAIL_LIMIT * 4 });
  if (!redacted) return null;
  const flattened = redacted.replaceAll(/\s+/gu, " ").trim();
  return flattened.length > TOOL_DETAIL_LIMIT ? `${flattened.slice(0, TOOL_DETAIL_LIMIT - 1)}…` : flattened;
}

function newTurn(index, promptEvent, promptText) {
  return {
    index,
    anchorId: `turn-${index}`,
    prompt: {
      text: redactTranscriptText(promptText, { limit: PROMPT_TEXT_LIMIT }),
      timestamp: promptEvent.timestamp ?? null,
    },
    steps: [],
    toolCallCount: 0,
    messageCount: 0,
    intermediateCount: 0,
    usageEventCount: 0,
    eventCount: 0,
    response: null,
    responseStatus: "unavailable",
    startMs: timestampMillis(promptEvent.timestamp),
    endMs: timestampMillis(promptEvent.timestamp),
    commits: [],
    _assistantMessageCount: 0,
    _lastAssistantText: null,
    _lastObservedKind: null,
    _terminalAssistantText: null,
    _terminalAssistantStepRetained: false,
    _terminalAssistantStep: null,
  };
}

function closeTurn(turn) {
  const hasTerminalResponse = turn._lastObservedKind === "assistant"
    && turn._terminalAssistantText;
  if (hasTerminalResponse) {
    turn.response = redactTranscriptText(turn._terminalAssistantText, { limit: RESPONSE_TEXT_LIMIT });
    turn.responseStatus = turn.response ? "retained" : "unavailable";
    if (turn._terminalAssistantStepRetained && turn._terminalAssistantStep) {
      const retainedIndex = turn.steps.indexOf(turn._terminalAssistantStep);
      if (retainedIndex >= 0) turn.steps.splice(retainedIndex, 1);
    }
  } else if (turn._assistantMessageCount > 0) {
    turn.responseStatus = "incomplete";
  }
  turn.intermediateCount = turn._assistantMessageCount - (turn.responseStatus === "retained" ? 1 : 0);
  turn.messageCount = turn.intermediateCount;
  turn.eventCount = turn.intermediateCount + turn.toolCallCount + turn.usageEventCount;
  turn.shownEventCount = turn.steps.length;
  turn.processTruncated = turn.shownEventCount < turn.eventCount;
  turn.durationMs = turn.startMs !== null && turn.endMs !== null && turn.endMs >= turn.startMs
    ? turn.endMs - turn.startMs
    : null;
  delete turn._assistantMessageCount;
  delete turn._lastAssistantText;
  delete turn._lastObservedKind;
  delete turn._terminalAssistantText;
  delete turn._terminalAssistantStepRetained;
  delete turn._terminalAssistantStep;
  return turn;
}

// Fold a hydrated event stream into entire.io-style turns: each user prompt
// opens a turn that accumulates tool chips and intermediate assistant notes,
// and the final assistant text before the next prompt becomes the response.
export function buildSessionTurns(events = [], options = {}) {
  const ordered = [...events].sort((a, b) => {
    const aTime = timestampMillis(a?.timestamp);
    const bTime = timestampMillis(b?.timestamp);
    if (aTime === null || bTime === null || aTime === bTime) return 0;
    return aTime - bTime;
  });

  const turns = [];
  let current = null;
  let truncated = false;
  // Hosts can emit several request-phase records for one tool call (hook +
  // transcript lanes); count each invocation once.
  const seenToolInvocations = new Set();
  const seenPromptRecords = new Set();
  let previousPrompt = null;

  for (const event of ordered) {
    if (isUserPrompt(event)) {
      const promptText = cleanPromptText(event.userText ?? event.content);
      // Injected-only records (command wrappers, skill bodies) are not real
      // turns; keep accumulating into the current one.
      if (promptText !== null) {
        const promptKey = `${event.timestamp ?? ""}\0${promptText}`;
        if (seenPromptRecords.has(promptKey)) continue;
        seenPromptRecords.add(promptKey);
        const promptMs = timestampMillis(event.timestamp);
        const promptFingerprint = promptText.replaceAll(/\s+/gu, " ").trim();
        if (previousPrompt?.fingerprint === promptFingerprint
          && (promptMs === null || previousPrompt.timestampMs === null || Math.abs(promptMs - previousPrompt.timestampMs) <= 2_000)) continue;
        previousPrompt = { fingerprint: promptFingerprint, timestampMs: promptMs };
        if (current) turns.push(closeTurn(current));
        if (turns.length >= MAX_TURNS) {
          truncated = true;
          current = null;
          break;
        }
        current = newTurn(turns.length + 1, event, promptText);
        continue;
      }
    }
    if (!current) continue;
    const eventMs = timestampMillis(event?.timestamp);
    if (eventMs !== null && (current.endMs === null || eventMs > current.endMs)) current.endMs = eventMs;
    if (isToolRequest(event)) {
      const invocationKey = event.toolInvocationId
        ?? `${event.timestamp ?? ""}|${event.toolName ?? ""}|${event.commandText ?? event.filePath ?? ""}`;
      if (seenToolInvocations.has(invocationKey)) continue;
      seenToolInvocations.add(invocationKey);
      current.toolCallCount += 1;
      current._lastObservedKind = "tool";
      current._lastAssistantText = null;
      current._terminalAssistantStepRetained = false;
      current._terminalAssistantStep = null;
      if (current.steps.length < MAX_STEPS_PER_TURN) {
        current.steps.push({
          kind: "tool",
          toolName: attributeSessionToolName(event),
          detail: toolDetail(event),
        });
      }
      continue;
    }
    const text = assistantText(event);
    if (text && current._lastAssistantText !== text) {
      current._assistantMessageCount += 1;
      current._lastAssistantText = text;
      current._lastObservedKind = "assistant";
      current._terminalAssistantText = text;
      current._terminalAssistantStepRetained = false;
      current._terminalAssistantStep = null;
      if (current.steps.length < MAX_STEPS_PER_TURN) {
        const note = redactTranscriptText(text, { limit: NOTE_TEXT_LIMIT });
        if (note) {
          const step = { kind: "note", text: note };
          current.steps.push(step);
          current._terminalAssistantStepRetained = true;
          current._terminalAssistantStep = step;
        }
      }
    }
    const usageStep = inferenceUsageStep(event);
    if (usageStep) {
      current.usageEventCount += 1;
      if (current.steps.length < MAX_STEPS_PER_TURN) current.steps.push(usageStep);
    }
  }
  if (current) turns.push(closeTurn(current));

  return { turns, truncated };
}

// Place correlated commits after the turn whose window contains their
// authored time; commits before the first turn or after the last window
// attach to the nearest boundary turn.
export function attachCommitsToTurns(turns = [], commits = [], { graceMs = 45 * 60_000 } = {}) {
  if (turns.length === 0) return turns;
  for (const commit of commits) {
    const commitMs = timestampMillis(commit.committedAt ?? commit.authoredAt);
    if (commitMs === null) continue;
    let target = null;
    for (const turn of turns) {
      if (turn.startMs !== null && commitMs >= turn.startMs) target = turn;
    }
    if (!target) {
      const lastTurn = turns.at(-1);
      const lastEnd = lastTurn.endMs ?? lastTurn.startMs;
      if (lastEnd !== null && commitMs > lastEnd + graceMs) continue;
      target = turns[0];
    }
    target.commits.push({
      hash: commit.hash,
      shortHash: commit.shortHash,
      subject: redactTranscriptText(commit.subject, { limit: 500 }) ?? "untitled commit",
      body: redactTranscriptText(commit.body, { limit: 2_000 }),
      authorName: redactTranscriptText(commit.authorName, { limit: 200 }),
      authoredAt: commit.authoredAt,
      committedAt: commit.committedAt ?? commit.authoredAt,
      sessionTrailers: (commit.sessionTrailers ?? [])
        .map((trailer) => redactTranscriptText(trailer, { limit: 600 }))
        .filter(Boolean),
      sessionLinks: commit.sessionLinks ?? [],
      files: (commit.files ?? []).slice(0, 200),
      linesAdded: (commit.files ?? []).reduce((sum, file) => sum + (Number.isFinite(file.added) ? file.added : 0), 0),
      linesRemoved: (commit.files ?? []).reduce((sum, file) => sum + (Number.isFinite(file.removed) ? file.removed : 0), 0),
      confidence: commit.sessionMatch?.confidence ?? null,
      evidence: commit.sessionMatch?.evidence ?? null,
    });
  }
  return turns;
}

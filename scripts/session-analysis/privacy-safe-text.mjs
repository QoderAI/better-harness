const INJECTED_CONTEXT_PREFIX_RE = /^(?:#\s*AGENTS\.md instructions\b|<environment_context>|<skill>|#\s*Files mentioned by the user:)/iu;
const INJECTED_XML_BLOCK_RE = /<(environment_context|skill|recommended_plugins|codex_internal_context|local-command-caveat|local-command-stdout|command-name|command-message|command-args)\b[^>]*>[\s\S]*?<\/\1>/giu;
const TURN_ABORTED_BLOCK_RE = /<turn_aborted\b[^>]*>[\s\S]*?<\/turn_aborted>/giu;
const EMBEDDED_TRANSCRIPT_TAIL_RE = /\s+\[\d+\]\s+(?:user|assistant|system|developer|tool(?:\s+[a-z0-9_.-]+){0,4})\s*:\s[\s\S]*$/iu;
const MARKDOWN_IMAGE_RE = /!\[[^\]\r\n]*\]\((?:<[^>\r\n]+>|[^)\r\n]+)\)/gu;
const MARKDOWN_LINK_RE = /\[([^\]\r\n]{1,200})\]\((?:<[^>\r\n]+>|[^)\r\n]+)\)/gu;
const USER_EVENT_TYPES = new Set(["user", "last-prompt", "UserPromptSubmit"]);

export function privacySafeUserInputSummary(events = [], { limit = 160 } = {}) {
  for (const event of events) {
    if (!USER_EVENT_TYPES.has(event?.type) && event?.userPrompt !== true) continue;
    const summary = privacySafeUserInputText(event?.userText ?? event?.content, { limit });
    if (summary) return summary;
  }
  return null;
}

export function privacySafeUserInputEvidence(
  events = [],
  { requestLimit = 220, intermediateLimit = 120, followUpLimit = 160 } = {},
) {
  const turns = [];
  for (const event of events) {
    if (event?.userInputMeta === true) continue;
    if (!USER_EVENT_TYPES.has(event?.type) && event?.userPrompt !== true) continue;
    const summary = privacySafeUserInputText(event?.userText ?? event?.content, {
      limit: Math.max(500, requestLimit, intermediateLimit, followUpLimit),
    });
    if (summary) turns.push(summary);
  }

  if (turns.length === 0) return null;
  const distinctTurns = turns.filter((turn, index) => turns.indexOf(turn) === index);
  const requestSource = distinctTurns[0];
  const followUpSource = distinctTurns.length > 1 ? distinctTurns.at(-1) : null;
  const intermediateSource = selectIntermediateTurn(distinctTurns.slice(1, -1));
  const retainedTurns = 1 + Number(Boolean(intermediateSource)) + Number(Boolean(followUpSource));
  return {
    request: sanitizePrivateReviewText(requestSource, { limit: requestLimit }),
    intermediate: intermediateSource
      ? sanitizePrivateReviewText(intermediateSource, { limit: intermediateLimit })
      : null,
    followUp: followUpSource
      ? sanitizePrivateReviewText(followUpSource, { limit: followUpLimit })
      : null,
    observedCount: distinctTurns.length,
    observedTurns: distinctTurns.length,
    omittedTurns: Math.max(0, distinctTurns.length - retainedTurns),
  };
}

export function privacySafeUserInputText(value, { limit = 800 } = {}) {
  const prepared = prepareTaskInput(value);
  if (!prepared || isExcludedUserInput(prepared)) return null;
  return sanitizePrivateReviewText(prepared, { limit });
}

export function sanitizePrivateReviewText(value, { limit = 800 } = {}) {
  if (!value) return null;
  const maximum = Math.max(24, Number(limit) || 800);
  const text = String(value)
    .replace(MARKDOWN_IMAGE_RE, " ")
    .replace(MARKDOWN_LINK_RE, "$1")
    .replace(/\b(?:authorization\s*:\s*)?bearer\s+[A-Za-z0-9._~+\/-]{8,}\b/giu, "Bearer <redacted>")
    .replace(/\b(api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+/giu, "$1=<redacted>")
    .replace(/\b(?:sk|ghp|github_pat|xox[abprs])[-_][A-Za-z0-9_-]{8,}\b/giu, "<secret>")
    .replace(/\bAKIA[0-9A-Z]{12,}\b/gu, "<secret>")
    .replace(/(^|[\s("'`@])(?:\.{1,2}[\\/])?(?:[\p{L}\p{N}._-]+[\\/])+[\p{L}\p{N}._-]+/gmu, "$1<path>")
    .replace(/(^|[^\p{L}\p{N}_])\/(?:Users|home|var|private|tmp|opt)\/[^\s"'`<>]+/gmu, "$1<path>")
    .replace(/[A-Za-z]:\\(?:Users\\)?[^\s"'`<>]+/gu, "<path>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu, "<id>")
    .replace(/\b(?:session|thread|task)[-_:](?=[a-z0-9._-]{8,}\b)(?=[a-z0-9._-]*\d)[a-z0-9._-]+\b/giu, "<id>")
    .replace(/<image\b[^>]*>[\s\S]*?<\/image>/giu, " ")
    .replace(/<image\b[^>]*\/?>/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!text) return null;
  return [...text].length <= maximum ? text : `${[...text].slice(0, maximum).join("")}…`;
}

export function privacySafeReviewText(value, { limit = 800 } = {}) {
  const prepared = prepareTaskInput(value);
  if (!prepared) return null;
  return sanitizePrivateReviewText(prepared, { limit });
}

function prepareTaskInput(value) {
  if (!value) return "";
  let text = String(value)
    .replace(INJECTED_XML_BLOCK_RE, " ")
    .replace(TURN_ABORTED_BLOCK_RE, " ")
    .trim();
  const delegatedInput = text.match(/^<codex_delegation>\s*<source_thread_id>[^<]*<\/source_thread_id>\s*<input>([\s\S]*?)<\/input>\s*<\/codex_delegation>$/iu);
  if (delegatedInput) text = delegatedInput[1].trim();
  const requestMarker = text.match(/(?:^|\n)#{1,3}\s*My request for Codex:\s*/iu);
  if (requestMarker?.index !== undefined) {
    text = text.slice(requestMarker.index + requestMarker[0].length).trim();
  } else if (INJECTED_CONTEXT_PREFIX_RE.test(text)) {
    return "";
  }
  return text
    .replace(EMBEDDED_TRANSCRIPT_TAIL_RE, " ")
    .replace(/\s*---\s*Content from referenced files\s*---[\s\S]*$/iu, " ")
    .trim();
}

function isExcludedUserInput(value) {
  const text = String(value ?? "").trim();
  return (/^[{[]/u.test(text)
      && /["<](?:type["']?\s*:\s*["']tool_result|tool_use_id|custom_tool_call_output)/iu.test(text))
    || (/^\{\s*"role"\s*:\s*"(?:user|assistant)"\s*,/u.test(text) && /"content"\s*:/u.test(text))
    || /^<tool_result\b/iu.test(text)
    || /^The following is the Codex agent history\b/iu.test(text)
    || /^\[Request interrupted by user\]$/iu.test(text)
    || /^\[\s*\{\s*"type"\s*:\s*"text"[\s\S]*"text"\s*:\s*"\[Request interrupted by user\]"/iu.test(text);
}

function selectIntermediateTurn(turns = []) {
  return turns.reduce((selected, turn) => {
    if (!selected) return turn;
    const selectedLength = [...selected].length;
    const turnLength = [...turn].length;
    return turnLength >= selectedLength ? turn : selected;
  }, null);
}

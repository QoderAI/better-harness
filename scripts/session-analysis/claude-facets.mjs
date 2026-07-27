import path from "node:path";

import {
  privacySafeReviewText,
  privacySafeUserInputText,
  sanitizePrivateReviewText,
} from "./privacy-safe-text.mjs";
import { isGeneratedHarnessAnalysisRequest } from "./episode-facts.mjs";
import { selectSessions } from "./selection.mjs";
import { isSessionAnalysisRef, sessionAnalysisRef } from "./session-ref.mjs";
import {
  buildSessionCoreFacts,
  createFactsRunContext,
  prepareFactsSessionInventory,
} from "./session-core-facts.mjs";

export const CLAUDE_FACET_SCHEMA_VERSION = 1;
export const CLAUDE_FACET_ANALYSIS_VERSION = "claude-style-facets-v1";

const OUTCOMES = new Set([
  "fully-achieved",
  "mostly-achieved",
  "partially-achieved",
  "not-achieved",
  "unclear",
]);
const SATISFACTION = new Set([
  "explicit-positive",
  "explicit-negative",
  "mixed-explicit",
  "no-explicit-signal",
]);
const SESSION_TYPES = new Set([
  "single-task",
  "multi-task",
  "iterative-refinement",
  "exploration",
  "quick-question",
]);
const OUTCOME_CONTRIBUTION = new Set(["supported", "lead", "unobserved"]);
const CONFIDENCE = new Set(["low", "medium", "high"]);
const SUGGESTION_KINDS = new Set([
  "instruction-experiment",
  "try-existing-lead",
  "working-pattern-lead",
  "loop-candidate",
  "horizon",
]);
const CAPABILITY_STATUS = new Set(["uninspected", "not-applicable"]);
const SLUG_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const RAW_FIELD_RE = /(?:^|_)(?:raw_?)?(?:prompt|command|content|transcript|user_?text|assistant_?text|tool_?output)$/iu;
const USER_TYPES = new Set(["user", "last-prompt", "UserPromptSubmit"]);
const MAX_TRANSCRIPT_LINES = 60;
const MAX_TRANSCRIPT_CHARS = 12_000;

export const CLAUDE_SESSION_FACET_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "underlyingGoal",
    "goalCategories",
    "outcome",
    "satisfaction",
    "sessionType",
    "friction",
    "primarySuccess",
    "briefSummary",
    "evidenceStatements",
    "confidence",
  ],
  properties: {
    underlyingGoal: { type: "string", minLength: 1, maxLength: 240 },
    goalCategories: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      uniqueItems: true,
      items: { type: "string", pattern: "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$" },
    },
    outcome: { type: "string", enum: [...OUTCOMES] },
    satisfaction: { type: "string", enum: [...SATISFACTION] },
    sessionType: { type: "string", enum: [...SESSION_TYPES] },
    friction: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "observation", "consequence"],
        properties: {
          kind: { type: "string", pattern: "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$" },
          observation: { type: "string", minLength: 1, maxLength: 240 },
          consequence: { type: "string", minLength: 1, maxLength: 240 },
        },
      },
    },
    primarySuccess: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "observation", "outcomeContribution"],
      properties: {
        kind: { type: "string", pattern: "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$" },
        observation: { type: "string", minLength: 1, maxLength: 240 },
        outcomeContribution: { type: "string", enum: [...OUTCOME_CONTRIBUTION] },
      },
    },
    briefSummary: { type: "string", minLength: 1, maxLength: 360 },
    evidenceStatements: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: { type: "string", minLength: 1, maxLength: 240 },
    },
    confidence: {
      type: "object",
      additionalProperties: false,
      required: ["level", "reason"],
      properties: {
        level: { type: "string", enum: [...CONFIDENCE] },
        reason: { type: "string", minLength: 1, maxLength: 240 },
      },
    },
  },
});

export const CLAUDE_AGGREGATE_REVIEW_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["summary", "suggestions"],
  properties: {
    summary: { type: "string", minLength: 1, maxLength: 480 },
    suggestions: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "kind", "title", "reason", "supportRefs", "capabilityStatus",
          "nextExperiment", "validation", "evidenceLimit", "confidence",
        ],
        properties: {
          kind: { type: "string", enum: [...SUGGESTION_KINDS] },
          title: { type: "string", minLength: 1, maxLength: 120 },
          reason: { type: "string", minLength: 1, maxLength: 360 },
          supportRefs: {
            type: "array",
            minItems: 2,
            maxItems: 8,
            uniqueItems: true,
            items: { type: "string", pattern: "^qsr1-[a-f0-9]{24}$" },
          },
          capabilityStatus: { type: "string", enum: [...CAPABILITY_STATUS] },
          nextExperiment: { type: "string", minLength: 1, maxLength: 280 },
          validation: { type: "string", minLength: 1, maxLength: 280 },
          evidenceLimit: { type: "string", minLength: 1, maxLength: 280 },
          confidence: { type: "string", enum: [...CONFIDENCE] },
        },
      },
    },
  },
});

export async function analyzeClaudeStyleSessions({
  analyzer,
  platform,
  options = {},
  modelClient,
} = {}) {
  if (!analyzer || typeof analyzer.analyze !== "function" || typeof analyzer.readSession !== "function") {
    throw new Error("claude-facets requires a session analyzer");
  }
  if (!modelClient || typeof modelClient.generateJson !== "function") {
    throw new Error("claude-facets requires a JSON model client");
  }

  const runContext = createFactsRunContext(options, platform);
  const runOptions = runContext.options;
  const scope = await analyzer.resolveScope(runOptions);
  const index = await analyzer.analyze({ ...runOptions, command: "sessions", limit: undefined });
  const inventory = prepareFactsSessionInventory(index.sessions ?? [], runContext);
  const requestedLimit = boundedInteger(options.limit, 1, 5, 5);
  const hydrationLimit = Math.min(inventory.sessions.length, Math.max(24, requestedLimit * 8));
  const hydrationSelection = selectSessions(inventory.sessions, {
    limit: hydrationLimit,
    strategy: options.selection,
    defaultLimit: hydrationLimit,
  });
  const concurrency = boundedInteger(options["model-concurrency"] ?? options.modelConcurrency, 1, 4, 2);
  const hydrated = await mapConcurrent(hydrationSelection.sessions, 4, async (session) => {
    const events = await analyzer.readSession(session, scope, {
      ...runOptions,
      includeContent: true,
      includeUserText: true,
      includeCommandText: false,
    });
    const transcript = compactSessionTranscript(events);
    return { ...session, _events: events, _transcript: transcript };
  });
  const eligible = hydrated.filter((session) => isEligibleFacetSession(session._events, session._transcript));
  const selection = selectSessions(eligible, {
    limit: requestedLimit,
    strategy: options.selection,
    defaultLimit: requestedLimit,
  });
  const facets = await mapConcurrent(selection.sessions, concurrency, async (session) => {
    const events = session._events;
    const sessionRef = sessionAnalysisRef({
      sessionId: session.sessionId,
      platform,
      workspace: scope.workspace,
    });
    const rawFacet = await modelClient.generateJson({
      name: `session-facet-${sessionRef}`,
      prompt: buildSessionFacetPrompt({ sessionRef, events, transcript: session._transcript }),
      schema: CLAUDE_SESSION_FACET_JSON_SCHEMA,
    });
    const facet = normalizeSessionFacet(rawFacet, sessionRef);
    const errors = validateClaudeSessionFacet(facet);
    if (errors.length > 0) {
      throw Object.assign(new Error(`invalid Claude-style session facet: ${errors.join("; ")}`), {
        code: "INVALID_CLAUDE_SESSION_FACET",
        errors,
      });
    }
    return facet;
  });

  const longitudinalSupport = buildLongitudinalSupport(facets);
  const comparisonFacts = buildSessionCoreFacts({
    scope,
    events: selection.sessions.flatMap((session) => session._events),
    selection: {
      strategy: selection.strategy,
      eligibleCount: eligible.length,
      analyzedCount: selection.sessions.length,
    },
    warnings: index.warnings,
    omitted: {
      ...inventory.omitted,
      lowSignalSessions: Math.max(0, hydrated.length - eligible.length),
    },
    episodeLimit: requestedLimit,
  });
  let recommendationReview = {
    status: "not-enough-distinct-facets",
    summary: "At least two distinct validated session facets are required for aggregate recommendation review.",
    suggestions: [],
  };
  if (facets.length >= 2) {
    const rawReview = await modelClient.generateJson({
      name: "aggregate-suggestion-leads",
      prompt: buildAggregateReviewPrompt({ facets, longitudinalSupport }),
      schema: CLAUDE_AGGREGATE_REVIEW_JSON_SCHEMA,
    });
    recommendationReview = normalizeAggregateReview(rawReview);
    const errors = validateAggregateReview(recommendationReview, facets);
    if (errors.length > 0) {
      throw Object.assign(new Error(`invalid Claude-style aggregate review: ${errors.join("; ")}`), {
        code: "INVALID_CLAUDE_AGGREGATE_REVIEW",
        errors,
      });
    }
  }

  return {
    schemaVersion: CLAUDE_FACET_SCHEMA_VERSION,
    kind: "claude-style-session-analysis",
    analysisVersion: CLAUDE_FACET_ANALYSIS_VERSION,
    scope: {
      platform,
      workspace: sanitizePrivateReviewText(path.basename(scope.workspace || "workspace"), { limit: 80 }) ?? "workspace",
      since: scope.since ?? null,
      until: scope.until ?? null,
    },
    selection: {
      strategy: selection.strategy,
      discoveredSessions: index.sessions?.length ?? 0,
      eligibleSessions: eligible.length,
      selectedSessions: facets.length,
      sampled: facets.length < eligible.length,
      omittedActiveSessions: inventory.omitted.activeSessions,
      omittedHomeOnlySessions: inventory.omitted.homeSessionOnly,
      omittedLowSignalSessions: Math.max(0, hydrated.length - eligible.length),
    },
    facets,
    longitudinalSupport,
    comparisonFacts,
    recommendationReview,
    warningCodes: [...new Set((index.warnings ?? []).map((warning) => warning.code).filter(Boolean))].slice(0, 8),
    evidenceBoundary: {
      modelDerived: ["facets", "recommendationReview"],
      deterministic: ["selection", "longitudinalSupport", "comparisonFacts", "warningCodes"],
      excludes: ["rawPrompts", "rawAssistantText", "commands", "toolOutput", "paths", "rawIds", "secrets"],
      findingsUnchanged: true,
    },
  };
}

export function compactSessionTranscript(events = []) {
  const lines = [];
  const seen = new Set();
  const seenDialogue = new Set();
  let userIndex = 0;
  let assistantIndex = 0;
  for (const event of events) {
    if (USER_TYPES.has(event?.type) || event?.userPrompt === true) {
      const text = privacySafeUserInputText(event?.userText ?? event?.content, { limit: 500 });
      if (text && markDialogue(seenDialogue, "user", text)) {
        userIndex += 1;
        pushUnique(lines, seen, `[User ${userIndex}] ${text}`);
      }
    } else if (event?.userVisibleAssistantMessage === true && !event?.toolName) {
      const text = privacySafeReviewText(event?.content, { limit: 300 });
      if (text && markDialogue(seenDialogue, "assistant", text)) {
        assistantIndex += 1;
        pushUnique(lines, seen, `[Assistant ${assistantIndex}] ${text}`);
      }
    }

    if (event?.toolName && event?.lifecyclePhase !== "result" && event?.lifecyclePhase !== "post") {
      pushUnique(lines, seen, `[Tool] ${safeToolName(event.toolName)}`);
    }
    if ((event?.lifecyclePhase === "result" || event?.lifecyclePhase === "post")
      && typeof event?.success === "boolean") {
      pushUnique(lines, seen, `[Tool result] ${event.success ? "passed" : "failed"}`);
    }
    if (event?.userCorrection === true) pushUnique(lines, seen, "[Signal] explicit-user-correction");
    if (event?.taskCompleted === true) pushUnique(lines, seen, "[Signal] structured-completion");
  }

  const bounded = boundTranscriptLines(lines, MAX_TRANSCRIPT_LINES);
  const transcript = bounded.join("\n");
  return [...transcript].length <= MAX_TRANSCRIPT_CHARS
    ? transcript
    : `${[...transcript].slice(0, MAX_TRANSCRIPT_CHARS - 1).join("")}…`;
}

export function buildLongitudinalSupport(facets = []) {
  return {
    distinctFacets: facets.length,
    goalCategories: supportCounts(facets, (facet) => facet.goalCategories),
    outcomes: supportCounts(facets, (facet) => [facet.outcome]),
    satisfaction: supportCounts(facets, (facet) => [facet.satisfaction]),
    friction: supportCounts(facets, (facet) => facet.friction.map((item) => item.kind)),
    primarySuccess: supportCounts(facets, (facet) => [facet.primarySuccess.kind]),
    repeated: {
      goalCategories: repeatedSupport(facets, (facet) => facet.goalCategories),
      friction: repeatedSupport(facets, (facet) => facet.friction.map((item) => item.kind)),
      primarySuccess: repeatedSupport(facets, (facet) => [facet.primarySuccess.kind]),
    },
  };
}

export function validateClaudeSessionFacet(facet, location = "facet") {
  if (!isObject(facet)) return [`${location} must be an object`];
  const allowed = new Set([
    "schemaVersion", "sessionRef", "underlyingGoal", "goalCategories", "outcome",
    "satisfaction", "sessionType", "friction", "primarySuccess", "briefSummary",
    "evidenceStatements", "confidence",
  ]);
  const errors = unsupportedFields(facet, allowed, location);
  for (const field of allowed) {
    if (facet[field] === undefined || facet[field] === null) errors.push(`${location} missing ${field}`);
  }
  if (facet.schemaVersion !== CLAUDE_FACET_SCHEMA_VERSION) errors.push(`${location}.schemaVersion must be ${CLAUDE_FACET_SCHEMA_VERSION}`);
  if (!isSessionAnalysisRef(facet.sessionRef)) errors.push(`${location}.sessionRef must be an opaque session ref`);
  validateText(facet.underlyingGoal, 240, `${location}.underlyingGoal`, errors);
  validateSlugArray(facet.goalCategories, 1, 4, `${location}.goalCategories`, errors);
  if (!OUTCOMES.has(facet.outcome)) errors.push(`${location}.outcome is unsupported`);
  if (!SATISFACTION.has(facet.satisfaction)) errors.push(`${location}.satisfaction is unsupported`);
  if (!SESSION_TYPES.has(facet.sessionType)) errors.push(`${location}.sessionType is unsupported`);
  validateFriction(facet.friction, `${location}.friction`, errors);
  validatePrimarySuccess(facet.primarySuccess, `${location}.primarySuccess`, errors);
  validateText(facet.briefSummary, 360, `${location}.briefSummary`, errors);
  validateTextArray(facet.evidenceStatements, 1, 6, 240, `${location}.evidenceStatements`, errors);
  validateConfidence(facet.confidence, `${location}.confidence`, errors);
  errors.push(...rawFieldErrors(facet, location));
  return errors;
}

export function validateAggregateReview(review, facets = [], location = "recommendationReview") {
  if (!isObject(review)) return [`${location} must be an object`];
  const allowed = new Set(["status", "summary", "suggestions"]);
  const errors = unsupportedFields(review, allowed, location);
  if (review.status !== "candidate-review") errors.push(`${location}.status must be candidate-review`);
  validateText(review.summary, 480, `${location}.summary`, errors);
  if (!Array.isArray(review.suggestions) || review.suggestions.length > 6) {
    errors.push(`${location}.suggestions must be an array with at most six items`);
    return errors;
  }
  const facetByRef = new Map(facets.map((facet) => [facet.sessionRef, facet]));
  review.suggestions.forEach((suggestion, index) => {
    const itemLocation = `${location}.suggestions[${index}]`;
    const fields = new Set([
      "kind", "title", "reason", "supportRefs", "capabilityStatus",
      "nextExperiment", "validation", "evidenceLimit", "confidence",
    ]);
    if (!isObject(suggestion)) {
      errors.push(`${itemLocation} must be an object`);
      return;
    }
    errors.push(...unsupportedFields(suggestion, fields, itemLocation));
    if (!SUGGESTION_KINDS.has(suggestion.kind)) errors.push(`${itemLocation}.kind is unsupported`);
    for (const field of ["title", "reason", "nextExperiment", "validation", "evidenceLimit"]) {
      validateText(suggestion[field], field === "title" ? 120 : field === "reason" ? 360 : 280, `${itemLocation}.${field}`, errors);
    }
    if (!Array.isArray(suggestion.supportRefs)
      || new Set(suggestion.supportRefs).size !== suggestion.supportRefs.length
      || suggestion.supportRefs.length < 2
      || suggestion.supportRefs.length > 8
      || suggestion.supportRefs.some((ref) => !facetByRef.has(ref))) {
      errors.push(`${itemLocation}.supportRefs must name two to eight distinct reviewed facets`);
    }
    if (!CAPABILITY_STATUS.has(suggestion.capabilityStatus)) errors.push(`${itemLocation}.capabilityStatus is unsupported`);
    if (!CONFIDENCE.has(suggestion.confidence)) errors.push(`${itemLocation}.confidence is unsupported`);
    if (suggestion.kind === "working-pattern-lead" && Array.isArray(suggestion.supportRefs)) {
      const support = suggestion.supportRefs.map((ref) => facetByRef.get(ref)).filter(Boolean);
      if (support.length < 2 || support.some((facet) =>
        !["fully-achieved", "mostly-achieved"].includes(facet.outcome)
        || facet.primarySuccess.outcomeContribution !== "supported")) {
        errors.push(`${itemLocation} working-pattern support requires two positive supported outcomes`);
      }
    }
  });
  errors.push(...rawFieldErrors(review, location));
  return errors;
}

function buildSessionFacetPrompt({ sessionRef, events, transcript }) {
  const metadata = compactMetadata(events);
  return [
    "You are extracting one Claude Insights-style semantic facet from a compact coding-agent session.",
    "Return only the JSON object required by the supplied schema.",
    "",
    "Evidence rules:",
    "- Treat the compact transcript and metadata as observations, not complete history.",
    "- Infer the user's underlying goal, but do not invent project facts or capability inventory.",
    "- Outcome may be fully/mostly/partially achieved only when transcript evidence bears on delivery or acceptance.",
    "- Edits, tool calls, assistant claims, and silence do not prove acceptance.",
    "- Satisfaction must be no-explicit-signal unless the user visibly expresses positive or negative feedback.",
    "- Friction requires an observed problem plus an observed consequence; omit merely possible friction.",
    "- primarySuccess.outcomeContribution is supported only when the visible result closes an acceptance boundary.",
    "- Use short kebab-case taxonomy labels that can match across sessions.",
    "- Evidence statements must be concise paraphrases, never raw quotes, paths, ids, commands, or tool output.",
    "- Do not recommend Skills, Hooks, rules, workflows, or findings in a session facet.",
    "",
    `Opaque session ref: ${sessionRef}`,
    `Deterministic metadata: ${JSON.stringify(metadata)}`,
    "Compact transcript:",
    transcript || "[No bounded user-visible transcript text]",
  ].join("\n");
}

function isEligibleFacetSession(events, transcript) {
  if (!transcript || !/^\[User \d+\]/mu.test(transcript)) return false;
  const firstRequest = events
    .filter((event) => USER_TYPES.has(event?.type) || event?.userPrompt === true)
    .map((event) => privacySafeUserInputText(event?.userText ?? event?.content, { limit: 500 }))
    .find(Boolean);
  return Boolean(firstRequest)
    && !isGeneratedHarnessAnalysisRequest(firstRequest)
    && !looksLikeLowSignalAcknowledgement(firstRequest)
    && !looksLikeCodeOnlyRequest(firstRequest);
}

function buildAggregateReviewPrompt({ facets, longitudinalSupport }) {
  const material = facets.map((facet) => ({
    sessionRef: facet.sessionRef,
    underlyingGoal: facet.underlyingGoal,
    goalCategories: facet.goalCategories,
    outcome: facet.outcome,
    satisfaction: facet.satisfaction,
    sessionType: facet.sessionType,
    friction: facet.friction,
    primarySuccess: facet.primarySuccess,
    briefSummary: facet.briefSummary,
    evidenceStatements: facet.evidenceStatements,
    confidence: facet.confidence,
  }));
  return [
    "You are comparing validated Claude Insights-style session facets to surface recommendation leads.",
    "Return only the JSON object required by the supplied schema.",
    "",
    "Hard boundaries:",
    "- These are experiment leads, not Harness findings or final report suggestions.",
    "- Every suggestion requires at least two distinct supportRefs.",
    "- instruction-experiment is for repeated friction whose proposed behavior still needs a controlled comparison.",
    "- working-pattern-lead requires two fully/mostly achieved facets where the same success has supported outcome contribution.",
    "- try-existing-lead cannot claim the capability exists; capabilityStatus stays uninspected.",
    "- loop-candidate requires repeated work, but the next experiment must still inspect trigger, owner, output, validator, and stop boundary.",
    "- horizon must name prerequisites and cannot promise present-tense benefits.",
    "- Do not emit finding ids, severity, scores, AI Fix fields, commands, activation instructions, or project inventory claims.",
    "- If repeated support does not justify a lead, return an empty suggestions array.",
    "",
    `Deterministic longitudinal support: ${JSON.stringify(longitudinalSupport)}`,
    `Validated facet material: ${JSON.stringify(material)}`,
  ].join("\n");
}

function normalizeSessionFacet(raw, sessionRef) {
  return sanitizeObjectStrings({
    ...raw,
    schemaVersion: CLAUDE_FACET_SCHEMA_VERSION,
    sessionRef,
  });
}

function normalizeAggregateReview(raw) {
  return sanitizeObjectStrings({
    ...raw,
    status: "candidate-review",
  });
}

function sanitizeObjectStrings(value) {
  if (Array.isArray(value)) return value.map(sanitizeObjectStrings);
  if (!isObject(value)) {
    if (typeof value !== "string") return value;
    return sanitizePrivateReviewText(value, { limit: 480 }) ?? "";
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitizeObjectStrings(child)]));
}

function compactMetadata(events) {
  const toolCounts = {};
  let userMessages = 0;
  let assistantMessages = 0;
  let failedToolResults = 0;
  let passedToolResults = 0;
  let explicitCorrections = 0;
  let structuredCompletions = 0;
  for (const event of events) {
    if (USER_TYPES.has(event?.type) || event?.userPrompt === true) userMessages += 1;
    if (event?.userVisibleAssistantMessage === true) assistantMessages += 1;
    if (event?.toolName && event?.lifecyclePhase !== "result" && event?.lifecyclePhase !== "post") {
      const name = safeToolName(event.toolName);
      toolCounts[name] = (toolCounts[name] ?? 0) + 1;
    }
    if ((event?.lifecyclePhase === "result" || event?.lifecyclePhase === "post") && event?.success === false) failedToolResults += 1;
    if ((event?.lifecyclePhase === "result" || event?.lifecyclePhase === "post") && event?.success === true) passedToolResults += 1;
    if (event?.userCorrection === true) explicitCorrections += 1;
    if (event?.taskCompleted === true) structuredCompletions += 1;
  }
  return {
    userMessages,
    assistantMessages,
    toolCounts,
    failedToolResults,
    passedToolResults,
    explicitCorrections,
    structuredCompletions,
  };
}

function supportCounts(facets, valuesForFacet) {
  const support = new Map();
  for (const facet of facets) {
    for (const value of new Set(valuesForFacet(facet).filter(Boolean))) {
      if (!support.has(value)) support.set(value, new Set());
      support.get(value).add(facet.sessionRef);
    }
  }
  return [...support.entries()]
    .map(([label, refs]) => ({ label, count: refs.size, supportRefs: [...refs].sort() }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function repeatedSupport(facets, valuesForFacet) {
  return supportCounts(facets, valuesForFacet).filter((entry) => entry.count >= 2);
}

async function mapConcurrent(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function boundTranscriptLines(lines, maximum) {
  if (lines.length <= maximum) return lines;
  const head = Math.floor(maximum / 2);
  const tail = maximum - head - 1;
  return [...lines.slice(0, head), "[Omitted middle turns]", ...lines.slice(-tail)];
}

function pushUnique(lines, seen, line) {
  if (!line || seen.has(line)) return;
  seen.add(line);
  lines.push(line);
}

function markDialogue(seen, role, text) {
  const exactKey = `${role}\u0000${text}`;
  if (seen.has(exactKey)) return false;
  seen.add(exactKey);
  return true;
}

function looksLikeLowSignalAcknowledgement(value) {
  return /^(?:hi|hello(?: world)?|hey|ok(?:ay)?|yes|no|好的?|可以|行(?:啊)?|继续|收到|明白了?)[.!。！]?$/iu.test(String(value ?? "").trim());
}

function looksLikeCodeOnlyRequest(value) {
  const text = String(value ?? "").trim();
  return text.length > 120
    && /^(?:#!|from\s+[A-Za-z0-9_.]+\s+import\s+|import\s+[A-Za-z0-9_.{}, ]+\s+(?:from\s+|const\s+|let\s+|var\s+))/u.test(text);
}

function safeToolName(value) {
  return String(value ?? "unknown").replace(/[^A-Za-z0-9_.:-]/gu, "-").slice(0, 80) || "unknown";
}

function boundedInteger(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function validateFriction(value, location, errors) {
  if (!Array.isArray(value) || value.length > 4) {
    errors.push(`${location} must be an array with at most four items`);
    return;
  }
  value.forEach((item, index) => {
    const itemLocation = `${location}[${index}]`;
    if (!isObject(item)) {
      errors.push(`${itemLocation} must be an object`);
      return;
    }
    errors.push(...unsupportedFields(item, new Set(["kind", "observation", "consequence"]), itemLocation));
    if (!SLUG_RE.test(item.kind ?? "")) errors.push(`${itemLocation}.kind must be kebab-case`);
    validateText(item.observation, 240, `${itemLocation}.observation`, errors);
    validateText(item.consequence, 240, `${itemLocation}.consequence`, errors);
  });
}

function validatePrimarySuccess(value, location, errors) {
  if (!isObject(value)) {
    errors.push(`${location} must be an object`);
    return;
  }
  errors.push(...unsupportedFields(value, new Set(["kind", "observation", "outcomeContribution"]), location));
  if (!SLUG_RE.test(value.kind ?? "")) errors.push(`${location}.kind must be kebab-case`);
  validateText(value.observation, 240, `${location}.observation`, errors);
  if (!OUTCOME_CONTRIBUTION.has(value.outcomeContribution)) errors.push(`${location}.outcomeContribution is unsupported`);
}

function validateConfidence(value, location, errors) {
  if (!isObject(value)) {
    errors.push(`${location} must be an object`);
    return;
  }
  errors.push(...unsupportedFields(value, new Set(["level", "reason"]), location));
  if (!CONFIDENCE.has(value.level)) errors.push(`${location}.level is unsupported`);
  validateText(value.reason, 240, `${location}.reason`, errors);
}

function validateSlugArray(value, minimum, maximum, location, errors) {
  if (!Array.isArray(value)
    || value.length < minimum
    || value.length > maximum
    || new Set(value).size !== value.length
    || value.some((item) => !SLUG_RE.test(item))) {
    errors.push(`${location} must contain ${minimum}-${maximum} distinct kebab-case labels`);
  }
}

function validateTextArray(value, minimum, maximum, textLimit, location, errors) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    errors.push(`${location} must contain ${minimum}-${maximum} items`);
    return;
  }
  value.forEach((item, index) => validateText(item, textLimit, `${location}[${index}]`, errors));
}

function validateText(value, maximum, location, errors) {
  if (typeof value !== "string" || !value.trim() || [...value].length > maximum) {
    errors.push(`${location} must be a non-empty string up to ${maximum} characters`);
  }
}

function unsupportedFields(value, allowed, location) {
  if (!isObject(value)) return [];
  return Object.keys(value)
    .filter((field) => !allowed.has(field))
    .map((field) => `${location} has unsupported field: ${field}`);
}

function rawFieldErrors(value, location) {
  if (Array.isArray(value)) return value.flatMap((item, index) => rawFieldErrors(item, `${location}[${index}]`));
  if (!isObject(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => [
    ...(RAW_FIELD_RE.test(key) && typeof child === "string" && child.trim()
      ? [`${location}.${key} must not contain raw session material`]
      : []),
    ...rawFieldErrors(child, `${location}.${key}`),
  ]);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

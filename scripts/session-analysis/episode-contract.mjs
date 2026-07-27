import { createHash } from "node:crypto";
import path from "node:path";

import {
  deduplicateLifecycleDemandSignals,
  detectLifecycleDemandSignals,
} from "./lifecycle-demand-signals.mjs";
import { buildEpisodeFactsPack } from "./episode-facts.mjs";

export const EVENT_SCHEMA_VERSION = 2;
export const TASK_EPISODE_SCHEMA_VERSION = 3;
export const DEFAULT_EPISODE_GAP_MS = 30 * 60 * 1000;

const EDIT_TOOL_NAMES = new Set([
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "NotebookWrite",
  "SearchReplace",
  "Write",
]);
const PATHLESS_EDIT_TOOL_NAMES = new Set(["apply_patch"]);
const LIFECYCLE_USER_EVENT_TYPES = new Set(["user", "last-prompt", "UserPromptSubmit"]);
const CONVERSATION_USER_EVENT_TYPES = new Set(["user", "last-prompt"]);
const ROUTINE_PERMISSION_MODES = new Set(["", "unknown", "default"]);
const PROMPTED_PERMISSION_DECISIONS = new Set(["asked"]);
const DENIED_PERMISSION_DECISIONS = new Set(["blocked", "denied"]);
const PROMPT_DUPLICATE_WINDOW_MS = 2_000;
const HARNESS_ARTIFACT_PATH_RE = /(?:^|\/)\.qoder\/better-harness(?:\/|$)/i;
const HARNESS_SCRATCH_PATH_RE = /(?:^|\/)(?:_harness_[^/]+|tmp-findings|findings\d+|test-write)\.json$/i;
const VALIDATION_PATTERNS = Object.freeze([
  ["npm test", /\bnpm\s+(?:run\s+)?(?:test|t)\b/i],
  ["pnpm test", /\bpnpm\s+(?:run\s+)?(?:test|t)\b/i],
  ["yarn test", /\byarn\s+(?:run\s+)?(?:test|t)\b/i],
  ["node --test", /\bnode(?:\s+\S+)*\s+--test\b/i],
  ["vitest", /\b(?:npx\s+)?vitest\b|\b(?:npm|pnpm|yarn|bun)\s+run\s+vitest\b/i],
  ["jest", /\b(?:npx\s+)?jest\b|\b(?:npm|pnpm|yarn|bun)\s+run\s+jest\b/i],
  ["pytest", /\bpytest\b|\bpython(?:3)?\s+-m\s+pytest\b/i],
  ["go test", /\bgo\s+test\b/i],
  ["cargo test", /\bcargo\s+test\b/i],
  ["agent-lint", /\bagent-lint\b/i],
  ["typecheck", /\b(?:tsc|vue-tsc)\b|\b(?:npm|pnpm|yarn|bun)\s+run\s+(?:typecheck|type-check|check|compile)\b/i],
  ["lint", /\b(?:eslint|ruff|flake8|pylint)\b|\b(?:npm|pnpm|yarn|bun)\s+run\s+lint\b/i],
  ["git diff --check", /\bgit\s+diff\b[^\n;&|]*\s--check\b/i],
]);

export function stableFingerprint(value, length = 16) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, length);
}

export function eventMillis(event) {
  const value = event?.timestamp;
  if (!value) return null;
  const millis = Date.parse(value);
  return Number.isNaN(millis) ? null : millis;
}

export function eventEvidenceRefs(event) {
  const refs = [event?.evidenceRef, ...(event?.evidenceRefs ?? [])].filter(Boolean);
  const seen = new Set();
  return refs.filter((ref) => {
    const key = JSON.stringify(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isHarnessArtifactPath(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  const normalized = value.replace(/\\/g, "/");
  return HARNESS_ARTIFACT_PATH_RE.test(normalized) || HARNESS_SCRATCH_PATH_RE.test(normalized);
}

function eventTargetPaths(event) {
  return [event?.filePath, ...(event?.targetPaths ?? []), ...(event?.affectedPaths ?? [])]
    .filter((value) => typeof value === "string" && value.trim());
}

function normalizedAbsolutePath(value) {
  const normalized = String(value ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized.startsWith("/") && !/^[A-Za-z]:\//.test(normalized)) return null;
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}

function isOutsideEventWorkspace(value, cwd) {
  const workspace = normalizedAbsolutePath(cwd);
  if (!workspace) return false;
  let target = normalizedAbsolutePath(value);
  if (!target) {
    const relative = String(value ?? "").replace(/\\/g, "/");
    target = /^[A-Za-z]:\//.test(workspace)
      ? normalizedAbsolutePath(path.win32.resolve(workspace.replaceAll("/", "\\"), relative.replaceAll("/", "\\")))
      : normalizedAbsolutePath(path.posix.resolve(workspace, relative));
  }
  if (!target) return false;
  return target !== workspace && !target.startsWith(`${workspace}/`);
}

export function isEditEvent(event) {
  const targetPaths = eventTargetPaths(event);
  if (targetPaths.length > 0 && targetPaths.every(isHarnessArtifactPath)) return false;
  if (targetPaths.length > 0 && event?.cwd && targetPaths.every((value) => isOutsideEventWorkspace(value, event.cwd))) return false;
  if (event?.operation === "edit" || event?.kind === "edit") return true;
  if (event?.type === "event.patch_apply_end") return true;
  if (PATHLESS_EDIT_TOOL_NAMES.has(String(event?.toolName ?? event?.functionCallName ?? "").toLowerCase())) return true;
  if (/^\s*apply_patch(?:\s|$)/u.test(String(event?.commandText ?? ""))) return true;
  return targetPaths.length > 0 && EDIT_TOOL_NAMES.has(event?.toolName);
}

export function validationCategory(event) {
  if (event?.validationCategory) return event.validationCategory;
  const command = String(event?.commandText ?? "");
  return VALIDATION_PATTERNS.find(([, pattern]) => pattern.test(command))?.[0] ?? null;
}

export function isValidationEvent(event) {
  return Boolean(validationCategory(event));
}

export function validationCheckIdentity(event) {
  const category = validationCategory(event);
  if (!category) return null;
  const command = String(event?.commandText ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
  return `check:${stableFingerprint({ category, command: command || null }, 24)}`;
}

export function classifyExecutionSignal(event) {
  const protective = event?.hookDecision === "blocked" || event?.protectionOutcome === "blocked";
  if (protective) {
    return {
      kind: event?.policyOutcome === "false-positive" ? "protective-false-positive" : "protective-intervention",
      confidence: event?.policyOutcome === "false-positive" ? "High" : "Medium",
    };
  }
  if (event?.success === false || event?.hasError || event?.level === "error" || event?.level === "warn") {
    return { kind: "execution-friction", confidence: "Observed" };
  }
  return { kind: "observed", confidence: "Observed" };
}

export function canonicalTaskKey(event) {
  const key = event?.taskEpisodeKey ?? event?.taskId ?? event?.goalId ?? event?.handoffId ?? null;
  const normalized = String(key ?? "").trim();
  return normalized || null;
}

export function deduplicateLifecycleEvents(events = []) {
  const groups = new Map();
  const ungrouped = [];

  for (const event of deduplicatePromptSubmissionEvents(events)) {
    const invocation = event?.toolInvocationId ?? event?.requestId ?? event?.callId ?? null;
    const phase = event?.lifecyclePhase ?? null;
    if (!invocation || !phase || !["pre", "request", "post", "result"].includes(phase)) {
      ungrouped.push(event);
      continue;
    }
    const key = `${event.sessionId ?? "unknown"}:${invocation}`;
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }

  const merged = [];
  for (const group of groups.values()) {
    group.sort(compareEvents);
    const canonical = group.findLast((event) => event.lifecyclePhase === "result")
      ?? group.findLast((event) => event.lifecyclePhase === "post")
      ?? group[0];
    const refs = group.flatMap(eventEvidenceRefs);
    const permissionEvent = group.find((event) => event?.permissionDecision);
    const requestEvent = group.find((event) => event.lifecyclePhase === "pre" || event.lifecyclePhase === "request") ?? group[0];
    merged.push({
      ...canonical,
      ...(requestEvent?.toolName && !canonical?.toolName ? { toolName: requestEvent.toolName } : {}),
      ...(requestEvent?.functionCallName && !canonical?.functionCallName ? { functionCallName: requestEvent.functionCallName } : {}),
      ...(requestEvent?.commandText && !canonical?.commandText ? { commandText: requestEvent.commandText } : {}),
      ...(requestEvent?.filePath && !canonical?.filePath ? { filePath: requestEvent.filePath } : {}),
      ...(requestEvent?.targetPaths && !canonical?.targetPaths ? { targetPaths: requestEvent.targetPaths } : {}),
      ...(requestEvent?.affectedPaths && !canonical?.affectedPaths ? { affectedPaths: requestEvent.affectedPaths } : {}),
      ...(requestEvent?.cwd && !canonical?.cwd ? { cwd: requestEvent.cwd } : {}),
      evidenceRefs: refs,
      ...(permissionEvent?.permissionDecision ? { permissionDecision: permissionEvent.permissionDecision } : {}),
      ...(permissionEvent?.permissionMode ? { permissionMode: permissionEvent.permissionMode } : {}),
      lifecycle: {
        preObserved: group.some((event) => event.lifecyclePhase === "pre" || event.lifecyclePhase === "request"),
        postObserved: group.some((event) => event.lifecyclePhase === "post" || event.lifecyclePhase === "result"),
        deduplicated: group.length > 1,
      },
    });
  }

  return [...ungrouped, ...merged].sort(compareEvents);
}

function deduplicatePromptSubmissionEvents(events) {
  const merged = [];
  for (const event of [...events].sort(compareEvents)) {
    const observation = promptObservation(event);
    const fingerprint = promptFingerprint(event);
    const millis = eventMillis(event);
    if (!observation || !fingerprint || millis === null || !String(event?.sessionId ?? "").trim()) {
      merged.push(event);
      continue;
    }

    let duplicateIndex = -1;
    for (let index = merged.length - 1; index >= 0; index -= 1) {
      const candidate = merged[index];
      const candidateMillis = eventMillis(candidate);
      if (candidateMillis === null || millis - candidateMillis > PROMPT_DUPLICATE_WINDOW_MS) break;
      if (Math.abs(millis - candidateMillis) > PROMPT_DUPLICATE_WINDOW_MS) continue;
      if (String(candidate?.sessionId ?? "") !== String(event.sessionId)) continue;
      if (String(candidate?.planningScope ?? "workspace") !== String(event?.planningScope ?? "workspace")) continue;
      if (candidate?.cwd && event?.cwd && String(candidate.cwd) !== String(event.cwd)) continue;
      const candidateKey = canonicalTaskKey(candidate);
      const eventKey = canonicalTaskKey(event);
      if (candidateKey && eventKey && candidateKey !== eventKey) continue;
      if (promptFingerprint(candidate) !== fingerprint) continue;
      const availability = promptObservationAvailability(candidate);
      if (availability[observation]) continue;
      duplicateIndex = index;
      break;
    }

    if (duplicateIndex < 0) {
      merged.push(event);
      continue;
    }
    merged[duplicateIndex] = mergePromptSubmissionEvents(merged[duplicateIndex], event);
  }
  return merged;
}

function promptObservation(event) {
  if (event?.type === "UserPromptSubmit") return "hookObserved";
  if (CONVERSATION_USER_EVENT_TYPES.has(event?.type)) return "conversationObserved";
  return null;
}

function promptObservationAvailability(event) {
  return {
    hookObserved: event?.promptLifecycle?.hookObserved === true || event?.type === "UserPromptSubmit",
    conversationObserved: event?.promptLifecycle?.conversationObserved === true
      || CONVERSATION_USER_EVENT_TYPES.has(event?.type),
  };
}

function promptFingerprint(event) {
  const value = typeof event?.userText === "string"
    ? event.userText
    : typeof event?.content === "string"
      ? event.content
      : "";
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return normalized ? stableFingerprint({ prompt: normalized }, 24) : null;
}

function mergePromptSubmissionEvents(left, right) {
  const conversation = CONVERSATION_USER_EVENT_TYPES.has(right?.type) ? right
    : CONVERSATION_USER_EVENT_TYPES.has(left?.type) ? left
      : right;
  const hook = right?.type === "UserPromptSubmit" ? right : left;
  const evidenceRefs = [...eventEvidenceRefs(left), ...eventEvidenceRefs(right)]
    .filter((reference, index, all) => all.findIndex((candidate) =>
      JSON.stringify(candidate) === JSON.stringify(reference)) === index);
  return {
    ...hook,
    ...conversation,
    taskEpisodeKey: canonicalTaskKey(conversation) ?? canonicalTaskKey(hook) ?? undefined,
    evidenceRef: conversation?.evidenceRef ?? hook?.evidenceRef,
    evidenceRefs,
    promptLifecycle: {
      hookObserved: true,
      conversationObserved: true,
      deduplicated: true,
    },
  };
}

function compareEvents(left, right) {
  const leftTime = eventMillis(left);
  const rightTime = eventMillis(right);
  if (leftTime !== null && rightTime !== null && leftTime !== rightTime) return leftTime - rightTime;
  if (leftTime === null && rightTime !== null) return 1;
  if (leftTime !== null && rightTime === null) return -1;
  return Number(left?.sequence ?? left?.index ?? 0) - Number(right?.sequence ?? right?.index ?? 0);
}

function episodeStartBoundary(event, current, gapMs) {
  if (!current) return "session-start";
  if (event?.episodeBoundary === true) return "explicit-boundary";
  const currentTime = eventMillis(event);
  if (currentTime !== null && current.lastEventMs !== null && currentTime - current.lastEventMs > gapMs) return "idle-gap";
  const isUserBoundary = event?.type === "user"
    || event?.type === "last-prompt"
    || event?.type === "UserPromptSubmit";
  return isUserBoundary && current.hasProgress ? "progress-handoff" : null;
}

function episodeState(id, sessionId, explicitKey = null, startBoundary = "session-start") {
  return {
    id,
    sessionIds: new Set([sessionId]),
    explicitKey,
    startBoundary,
    events: [],
    firstEventMs: null,
    lastEventMs: null,
    hasProgress: false,
  };
}

function appendEvent(episode, event) {
  episode.events.push(event);
  episode.sessionIds.add(event.sessionId ?? "unknown");
  const millis = eventMillis(event);
  if (millis !== null) {
    if (episode.firstEventMs === null || millis < episode.firstEventMs) episode.firstEventMs = millis;
    if (episode.lastEventMs === null || millis > episode.lastEventMs) episode.lastEventMs = millis;
  }
  if (isEditEvent(event)
    || isValidationEvent(event)
    || event?.episodeProgress === true
    || event?.taskCompleted === true) {
    episode.hasProgress = true;
  }
}

function pathSet(value) {
  const raw = [value?.filePath, ...(value?.targetPaths ?? []), ...(value?.affectedPaths ?? [])]
    .filter((path) => typeof path === "string" && path.trim());
  return new Set(raw.map((path) => path.replace(/\\/g, "/").replace(/^\.\//, "")));
}

function pathsIntersect(left, right) {
  for (const leftPath of left) {
    for (const rightPath of right) {
      if (leftPath === rightPath || leftPath.startsWith(`${rightPath}/`) || rightPath.startsWith(`${leftPath}/`)) {
        return true;
      }
    }
  }
  return false;
}

function validationIsRelevant(change, validation) {
  if (validation?.reviewedAssociation === true || validation?.relevance === "relevant") return true;
  return false;
}

function validationIsCandidate(change, validation) {
  if (validationIsRelevant(change, validation)) return true;
  const changePaths = pathSet(change);
  const validationPaths = pathSet(validation);
  return changePaths.size > 0 && validationPaths.size > 0 && pathsIntersect(changePaths, validationPaths);
}

function summarizeChangeSets(episode) {
  const edits = episode.events.filter(isEditEvent);
  if (edits.length === 0) return [];
  return [{
    id: `${episode.id}:change-1`,
    eventCount: edits.length,
    paths: [...new Set(edits.flatMap((event) => [...pathSet(event)]))].sort(),
    firstSeen: edits[0]?.timestamp ?? null,
    lastSeen: edits.at(-1)?.timestamp ?? null,
    firstOrdinal: episode.events.indexOf(edits[0]),
    lastOrdinal: episode.events.lastIndexOf(edits.at(-1)),
    evidenceRefs: edits.flatMap(eventEvidenceRefs),
  }];
}

function summarizeValidationSets(episode) {
  return episode.events
    .filter(isValidationEvent)
    .map((event, index) => ({
      id: `${episode.id}:validation-${index + 1}`,
      category: validationCategory(event),
      timestamp: event.timestamp ?? null,
      ordinal: episode.events.indexOf(event),
      checkIdentity: validationCheckIdentity(event),
      status: event.success === true ? "passed" : event.success === false || event.hasError ? "failed" : "observed",
      targetPaths: [...pathSet(event)].sort(),
      reviewedAssociation: event.reviewedAssociation === true,
      relevance: event.relevance ?? "unobserved",
      evidenceRefs: eventEvidenceRefs(event),
      _event: event,
    }));
}

function observationOccursAfter({
  earlierTimestamp,
  earlierOrdinal,
  laterTimestamp,
  laterOrdinal,
}) {
  const earlierMs = Date.parse(earlierTimestamp ?? "");
  const laterMs = Date.parse(laterTimestamp ?? "");
  const hasEarlierTime = !Number.isNaN(earlierMs);
  const hasLaterTime = !Number.isNaN(laterMs);
  if (hasEarlierTime && hasLaterTime && earlierMs !== laterMs) {
    return laterMs > earlierMs;
  }
  if (hasEarlierTime !== hasLaterTime) return false;

  const earlier = earlierOrdinal === null || earlierOrdinal === undefined
    ? null
    : Number(earlierOrdinal);
  const later = laterOrdinal === null || laterOrdinal === undefined
    ? null
    : Number(laterOrdinal);
  return Number.isFinite(earlier)
    && Number.isFinite(later)
    && later > earlier;
}

function validationOccursAfterChange(change, validation) {
  return observationOccursAfter({
    earlierTimestamp: change?.lastSeen,
    earlierOrdinal: change?.lastOrdinal,
    laterTimestamp: validation?.timestamp,
    laterOrdinal: validation?.ordinal,
  });
}

function closureFor(episode, changeSets, validationSets) {
  if (changeSets.length === 0) return { status: "not-applicable", reason: "no-edit-observed", relevantValidationCount: 0 };
  const latestChange = changeSets.at(-1);
  const relevant = validationSets.filter((validation) => {
    if (!validationOccursAfterChange(latestChange, validation)) return false;
    return validationIsRelevant({ affectedPaths: latestChange.paths }, validation._event);
  });
  if (relevant.length === 0) {
    return {
      status: "unobserved",
      reason: "no-relevant-validation-observed",
      relevantValidationCount: 0,
      evidenceRefs: latestChange.evidenceRefs,
    };
  }
  const passed = relevant.filter((validation) => validation.status === "passed");
  return {
    status: passed.length > 0 ? "closed" : "observed-without-pass",
    reason: passed.length > 0 ? "relevant-validation-passed" : "relevant-validation-not-passed",
    relevantValidationCount: relevant.length,
    relevantValidationPassedCount: passed.length,
    evidenceRefs: relevant.flatMap((validation) => validation.evidenceRefs),
  };
}

function repairCandidatesFor(episode, validationSets) {
  const edits = episode.events.filter(isEditEvent);
  const validations = episode.events.filter(isValidationEvent).sort(compareEvents);
  const failures = validations.filter((event) => event.success === false || event.hasError);
  const allChangedPaths = [...new Set(edits.flatMap((event) => [...pathSet(event)]))];
  const byEvent = new Map(validationSets.map((validation) => [validation._event, validation]));
  const candidates = [];
  for (const failure of failures) {
    const failureOrdinal = episode.events.indexOf(failure);
    const repair = edits.find((event) => observationOccursAfter({
      earlierTimestamp: failure?.timestamp,
      earlierOrdinal: failureOrdinal,
      laterTimestamp: event?.timestamp,
      laterOrdinal: episode.events.indexOf(event),
    }));
    if (!repair) continue;
    const repairOrdinal = episode.events.indexOf(repair);
    for (const pass of validations.filter((event) => {
      return event.success === true
        && observationOccursAfter({
          earlierTimestamp: repair?.timestamp,
          earlierOrdinal: repairOrdinal,
          laterTimestamp: event?.timestamp,
          laterOrdinal: episode.events.indexOf(event),
        })
        && (validationCheckIdentity(failure) === validationCheckIdentity(event)
          || validationIsCandidate({ affectedPaths: allChangedPaths }, event));
    })) {
      const failureSet = byEvent.get(failure);
      const passSet = byEvent.get(pass);
      if (!failureSet || !passSet) continue;
      const evidenceRefs = [...eventEvidenceRefs(failure), ...eventEvidenceRefs(repair), ...eventEvidenceRefs(pass)];
      candidates.push({
        id: `${episode.id}:repair-${candidates.length + 1}`,
        failureValidationRef: failureSet.id,
        rerunValidationRef: passSet.id,
        failureCheckIdentity: failureSet.checkIdentity,
        rerunCheckIdentity: passSet.checkIdentity,
        sameCheck: failureSet.checkIdentity === passSet.checkIdentity,
        repairOrdinal,
        evidenceRefs,
      });
    }
  }
  return candidates;
}

function repairFor(episode, validationSets) {
  const failures = validationSets.filter((validation) => validation.status === "failed");
  if (failures.length === 0) {
    return { status: "not-applicable", reason: "no-validation-failure-observed", candidates: [], evidenceRefs: [] };
  }
  const candidates = repairCandidatesFor(episode, validationSets);
  if (candidates.length > 0) {
    return {
      status: "review-required",
      reason: "ordered-failure-edit-rerun-candidate-observed",
      candidates,
      evidenceRefs: candidates.flatMap((candidate) => candidate.evidenceRefs),
    };
  }
  return {
    status: "unobserved",
    reason: "failure-without-relevant-repair-pass-observed",
    candidates: [],
    evidenceRefs: failures.flatMap((validation) => validation.evidenceRefs),
  };
}

function safeLearningLabel(value) {
  const normalized = String(value ?? "").replace(/\s+/gu, " ").trim();
  return normalized && normalized.length <= 120 ? normalized : null;
}

function safeLearningAssetRef(value) {
  const normalized = String(value ?? "").replace(/\s+/gu, " ").trim();
  return normalized ? `asset-${stableFingerprint(normalized, 16)}` : null;
}

function safeLearningEvidenceRefs(value) {
  return (Array.isArray(value) ? value : []).slice(0, 8).map((reference, index) => ({
    kind: safeLearningLabel(reference?.kind)?.replace(/[^A-Za-z0-9._-]+/gu, "-").slice(0, 48) || "asset-evidence",
    id: safeLearningAssetRef(reference?.id ?? `${index + 1}`),
  })).filter((reference) => reference.id);
}

function safeLearningAsset(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const ref = safeLearningAssetRef(source.ref);
  if (!ref) return null;
  return {
    kind: safeLearningLabel(source.kind)?.slice(0, 48) || "Unknown",
    ref,
    scope: safeLearningLabel(source.scope)?.replace(/[^A-Za-z0-9._-]+/gu, "-").slice(0, 48) || "unspecified",
    currentTruthRefs: safeLearningEvidenceRefs(source.currentTruthRefs),
    requiredStepRefs: safeLearningEvidenceRefs(source.requiredStepRefs),
    updateEvidenceRefs: safeLearningEvidenceRefs(source.updateEvidenceRefs),
    outcomeEvidenceRefs: safeLearningEvidenceRefs(source.outcomeEvidenceRefs),
  };
}

function learningSignalsFor(episode) {
  return episode.events.flatMap((event) => {
    const source = event?.learningSignal ?? (event?.learningPatternId ? {
      patternId: event.learningPatternId,
      normalizedSignature: event.normalizedSignature,
      taskFamily: event.taskFamily,
      repoArea: event.repoArea,
      changeType: event.changeType,
      frictionType: event.frictionType,
      userCorrection: event.userCorrection,
      assetLoaded: event.assetLoaded,
      assetChanged: event.assetChanged,
      assetRelevant: event.assetRelevant,
      requiredStepApplied: event.requiredStepApplied,
      asset: event.asset,
      mandatory: event.mandatory,
      procedural: event.procedural,
      validationResult: event.validationResult,
      deliveryResult: event.deliveryResult,
      elapsedMs: event.elapsedMs,
      toolCalls: event.toolCalls,
      tokens: event.tokens,
      harnessVersion: event.harnessVersion,
    } : null);
    if (!source || classifyExecutionSignal(event).kind === "protective-intervention") return [];
    const patternId = safeLearningLabel(source.patternId);
    if (!patternId) return [];
    const signal = {
      patternId,
      userCorrection: source.userCorrection === true,
      assetLoaded: source.assetLoaded === true,
      assetChanged: source.assetChanged === true,
      assetRelevant: source.assetRelevant === true,
      requiredStepApplied: source.requiredStepApplied === true,
      mandatory: source.mandatory === true,
      procedural: source.procedural === true,
      elapsedMs: Number.isFinite(Number(source.elapsedMs)) ? Math.max(0, Number(source.elapsedMs)) : 0,
      toolCalls: Number.isFinite(Number(source.toolCalls)) ? Math.max(0, Math.trunc(Number(source.toolCalls))) : 0,
      tokens: source.tokens ?? 0,
      evidenceRefs: eventEvidenceRefs(event),
    };
    const asset = safeLearningAsset(source.asset);
    if (asset) signal.asset = asset;
    const textFields = ["normalizedSignature", "taskFamily", "repoArea", "changeType", "frictionType", "validationResult", "deliveryResult", "harnessVersion"];
    const learningFields = [...textFields, "userCorrection", "asset", "assetLoaded", "assetChanged", "assetRelevant", "requiredStepApplied", "elapsedMs", "toolCalls", "tokens"];
    for (const field of textFields) {
      const value = safeLearningLabel(source[field]);
      if (value) signal[field] = value;
    }
    if (source.fieldProvenance && typeof source.fieldProvenance === "object" && !Array.isArray(source.fieldProvenance)) {
      signal.fieldProvenance = Object.fromEntries(learningFields.flatMap((field) => {
        const provenance = source.fieldProvenance[field];
        return ["host-observed", "deterministic-derived", "ai-reviewed"].includes(provenance)
          ? [[field, provenance]]
          : [];
      }));
    }
    return [signal];
  });
}

function permissionObservation(event) {
  const decision = String(event?.permissionDecision ?? "").trim().toLowerCase();
  const mode = String(event?.permissionMode ?? "unknown").trim().toLowerCase() || "unknown";
  const explicitProtectedAction = event?.protectedAction === true
    || event?.externalSideEffect === true
    || ["protected-action", "external-side-effect"].includes(
      String(event?.permissionBoundary ?? "").trim().toLowerCase(),
    );
  const observed = Boolean(decision) || explicitProtectedAction;
  if (!observed) return null;
  const prompted = PROMPTED_PERMISSION_DECISIONS.has(decision);
  const denied = DENIED_PERMISSION_DECISIONS.has(decision);
  const escalated = event?.permissionEscalated === true || !ROUTINE_PERMISSION_MODES.has(mode);
  const routineAllowed = decision === "allowed" && !escalated && !explicitProtectedAction;
  return {
    event,
    routineAllowed,
    prompted,
    denied,
    escalated,
    explicitProtectedAction,
    protectedAction: !routineAllowed,
  };
}

function uniqueEvidenceRefs(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function representativePermissionEvidence(observations) {
  const boundary = observations.filter((observation) => observation.protectedAction);
  const representatives = [];
  for (const predicate of [
    (observation) => observation.prompted,
    (observation) => observation.denied,
    (observation) => observation.escalated,
    (observation) => observation.explicitProtectedAction,
  ]) {
    const match = boundary.find(predicate);
    if (match) representatives.push(...eventEvidenceRefs(match.event));
  }
  if (boundary.length > 0) {
    representatives.push(...eventEvidenceRefs(boundary[0].event));
    representatives.push(...eventEvidenceRefs(boundary.at(-1).event));
  }
  return uniqueEvidenceRefs(representatives).slice(0, 3);
}

function permissionCoverageSummary(events) {
  const observations = events.map(permissionObservation).filter(Boolean);
  const protectedActions = observations.filter((observation) => observation.protectedAction).length;
  return {
    observed: observations.length,
    routineAllowed: observations.filter((observation) => observation.routineAllowed).length,
    prompted: observations.filter((observation) => observation.prompted).length,
    denied: observations.filter((observation) => observation.denied).length,
    escalated: observations.filter((observation) => observation.escalated).length,
    protectedActions,
  };
}

function permissionBoundarySummary(events) {
  const observations = events.map(permissionObservation).filter(Boolean);
  const protectedActions = observations.filter((observation) => observation.protectedAction).length;
  if (protectedActions === 0) return null;
  return {
    prompted: observations.filter((observation) => observation.prompted).length,
    denied: observations.filter((observation) => observation.denied).length,
    escalated: observations.filter((observation) => observation.escalated).length,
    protectedActions,
    evidenceRefs: representativePermissionEvidence(observations),
  };
}

function lifecycleSignalsFor(episode, platform) {
  return deduplicateLifecycleDemandSignals(
    episode.events.flatMap((event) => lifecycleDemandSignalsForEvent(event, platform)),
  );
}

function lifecycleDemandSignalsForEvent(event, platform) {
  if (!LIFECYCLE_USER_EVENT_TYPES.has(event?.type)) return [];
  return [
    ...(Array.isArray(event?.lifecycleSignals) ? event.lifecycleSignals : []),
    ...detectLifecycleDemandSignals(event, { platform }),
  ];
}

function publicEpisode(episode, platform) {
  const changeSets = summarizeChangeSets(episode);
  const rawValidationSets = summarizeValidationSets(episode);
  const closure = closureFor(episode, changeSets, rawValidationSets);
  const permissionSummary = permissionBoundarySummary(episode.events);
  return {
    id: episode.id,
    sessionCount: episode.sessionIds.size,
    sessionIds: [...episode.sessionIds].sort(),
    continuation: episode.explicitKey ? "explicit" : "session-bounded",
    startBoundary: episode.startBoundary,
    firstSeen: episode.events[0]?.timestamp ?? null,
    lastSeen: episode.events.at(-1)?.timestamp ?? null,
    eventCount: episode.events.length,
    changeSets,
    validationSets: rawValidationSets.map(({ _event, ...validation }) => validation),
    closure,
    repair: repairFor(episode, rawValidationSets),
    elapsedMs: episode.firstEventMs === null || episode.lastEventMs === null
      ? 0
      : Math.max(0, episode.lastEventMs - episode.firstEventMs),
    toolCalls: episode.events.filter((event) => event?.toolName || event?.functionCallName).length,
    lifecycleSignals: lifecycleSignalsFor(episode, platform),
    ...(permissionSummary ? { permissionSummary } : {}),
    learningSignals: learningSignalsFor(episode),
    evidenceRefs: episode.events.flatMap(eventEvidenceRefs),
  };
}

export function buildTaskEpisodes(
  events = [],
  {
    episodeGapMs = DEFAULT_EPISODE_GAP_MS,
    platform,
    includeEpisodeFacts = false,
    includeEpisodeFactDebug = false,
    episodeFactLimit,
  } = {},
) {
  const canonicalEvents = deduplicateLifecycleEvents(events).map((event) => {
    const category = validationCategory(event);
    return category && !event?.validationCategory
      ? { ...event, validationCategory: category }
      : event;
  });
  const explicitEpisodes = new Map();
  const currentBySession = new Map();
  const episodes = [];

  for (const event of canonicalEvents) {
    const sessionId = String(event?.sessionId ?? "unknown");
    const explicitKey = canonicalTaskKey(event);
    if (explicitKey) {
      const id = `episode:${stableFingerprint({ explicitKey })}`;
      const episode = explicitEpisodes.get(explicitKey) ?? episodeState(id, sessionId, explicitKey, "explicit-task-key");
      if (!explicitEpisodes.has(explicitKey)) {
        explicitEpisodes.set(explicitKey, episode);
        episodes.push(episode);
      }
      appendEvent(episode, event);
      continue;
    }

    let current = currentBySession.get(sessionId) ?? null;
    const startBoundary = episodeStartBoundary(event, current, episodeGapMs);
    if (startBoundary) {
      const ordinal = episodes.filter((episode) => episode.explicitKey === null && episode.sessionIds.has(sessionId)).length + 1;
      current = episodeState(`episode:${stableFingerprint({ sessionId, ordinal })}`, sessionId, null, startBoundary);
      episodes.push(current);
      currentBySession.set(sessionId, current);
    }
    appendEvent(current, event);
  }

  const records = episodes
    .map((episode) => ({
      episode: publicEpisode(episode, platform),
      events: episode.events,
      validationResults: episode.events
        .filter(isValidationEvent)
        .map((event) => event?.resultFacts ?? null),
    }))
    .sort((left, right) => String(left.episode.firstSeen).localeCompare(String(right.episode.firstSeen)));

  return {
    schemaVersion: TASK_EPISODE_SCHEMA_VERSION,
    canonicalEvents,
    permissionSummary: permissionCoverageSummary(canonicalEvents),
    episodes: records.map((record) => record.episode),
    ...(includeEpisodeFacts
      ? {
          episodeFacts: buildEpisodeFactsPack(records, {
            limit: episodeFactLimit,
            includeDebugLocators: includeEpisodeFactDebug,
          }),
        }
      : {}),
  };
}

export function countEpisodeClosure(episodes = []) {
  const edited = episodes.filter((episode) => episode.changeSets.length > 0);
  const closed = edited.filter((episode) => episode.closure.status === "closed");
  return {
    eligibleEpisodeCount: edited.length,
    closedEpisodeCount: closed.length,
    closureRate: edited.length === 0 ? null : closed.length / edited.length,
  };
}

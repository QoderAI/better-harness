import { buildTaskEpisodes, classifyExecutionSignal, countEpisodeClosure } from "./episode-contract.mjs";
import { buildObservationManifest } from "./observation-manifest.mjs";
import { buildSessionEfficiencySignal } from "./session-efficiency.mjs";

const DEFAULT_TOP_LIMIT = 8;
const MIN_POST_EDIT_REVIEW_EDIT_COUNT = 5;

const VALIDATION_PATTERNS = Object.freeze([
  { name: "npm test", pattern: /\bnpm\s+(?:run\s+)?(?:test|t)\b/i },
  { name: "pnpm test", pattern: /\bpnpm\s+(?:run\s+)?(?:test|t)\b/i },
  { name: "yarn test", pattern: /\byarn\s+(?:run\s+)?(?:test|t)\b/i },
  { name: "bun test", pattern: /\bbun\s+test\b/i },
  { name: "node --test", pattern: /\bnode(?:\s+\S+)*\s+--test\b/i },
  { name: "vitest", pattern: /\b(?:npx\s+)?vitest\b|\b(?:npm|pnpm|yarn|bun)\s+run\s+vitest\b/i },
  { name: "jest", pattern: /\b(?:npx\s+)?jest\b|\b(?:npm|pnpm|yarn|bun)\s+run\s+jest\b/i },
  { name: "pytest", pattern: /\bpytest\b|\bpython(?:3)?\s+-m\s+pytest\b/i },
  { name: "go test", pattern: /\bgo\s+test\b/i },
  { name: "cargo test", pattern: /\bcargo\s+test\b/i },
  { name: "maven test", pattern: /\bmvn(?:w)?\s+(?:test|verify)\b/i },
  { name: "gradle test", pattern: /\bgradle(?:w)?\s+(?:test|check)\b/i },
  { name: "make test", pattern: /\bmake\s+(?:test|check)\b/i },
  { name: "typecheck", pattern: /\b(?:tsc|vue-tsc)\b|\b(?:npm|pnpm|yarn|bun)\s+run\s+(?:typecheck|type-check|check|compile)\b/i },
  { name: "lint", pattern: /\b(?:eslint|ruff|flake8|pylint)\b|\b(?:npm|pnpm|yarn|bun)\s+run\s+lint\b/i },
  { name: "git diff --check", pattern: /\bgit\s+diff\b[^\n;&|]*\s--check\b/i },
  { name: "qoder plugin validate", pattern: /\bqodercli\s+plugin\s+validate\b/i },
]);

const FRICTION_TYPE_PATTERNS = Object.freeze([
  { name: "failed-event", pattern: /\b(?:fail|failed|failure|error|exception)\b/i },
  { name: "permission-rejection", pattern: /\b(?:denied|rejected|reject|permission)\b/i },
  { name: "aborted-event", pattern: /\b(?:abort|aborted|cancel|cancelled|interrupted)\b/i },
]);

const EDIT_TOOL_NAMES = new Set(["Edit", "MultiEdit", "NotebookEdit", "Write"]);

const EDIT_COMMAND_PATTERNS = Object.freeze([
  { name: "apply_patch", pattern: /\bapply_patch\b|\*\*\*\s+Begin Patch/i },
  { name: "sed in-place", pattern: /\bsed\s+(?:-[^\s]*i|--in-place)\b/i },
  { name: "perl in-place", pattern: /\bperl\s+-[^\s]*i/i },
  { name: "redirect write", pattern: /(?:^|[;&|]\s*)(?:cat|printf|echo)\b[^\n;&|]*(?:\s>>?\s|\|\s*tee\b)/i },
]);

export function buildInsightPack(input = {}) {
  const scope = input.scope ?? {};
  const sources = input.sources ?? [];
  const sessions = input.sessions ?? [];
  const facets = input.facets ?? {};
  const warnings = input.warnings ?? [];
  const events = input.events ?? [];

  const sourceSummary = buildSourceSummary(sources, facets, warnings);
  const initialSample = buildSampleSummary(facets, sessions);
  const selectionStrategy = input.selectionStrategy ?? (initialSample.sampled ? "latest-n" : "all-eligible");
  const manifest = buildObservationManifest({
    scope,
    sources,
    warnings,
    eligibleCount: initialSample.sessionCount,
    analyzedCount: initialSample.analyzedSessionCount,
    selectionStrategy,
    selectionStrata: input.selectionStrata ?? [],
    adapterVersion: input.adapterVersion,
  });
  const sample = {
    ...initialSample,
    confidence: manifest.selection.confidence,
    selectionStrategy: manifest.selection.strategy,
    representative: manifest.selection.representative,
  };
  const executionEvents = events.filter((event) => event.lifecyclePhase !== "pre");
  const episodeAnalysis = buildTaskEpisodes(executionEvents);
  const episodeSummary = buildEpisodeSummary(episodeAnalysis.episodes);
  const validation = buildValidationSignals(executionEvents);
  const validationAfterEdit = buildValidationAfterEditSignal(episodeAnalysis.episodes);
  const friction = buildFrictionSignals(executionEvents, warnings);
  const topTools = topFacetEntries(facets.topTools);
  const topHooks = topFacetEntries(facets.topHooks);
  const topHookCommands = topFacetEntries(facets.topHookCommands);
  const topSkills = topFacetEntries(facets.topSkills);
  const topFunctionCalls = topFacetEntries(facets.topFunctionCalls);
  const inferredSkillReads = topFacetEntries(facets.inferredSkillReads);
  const topModels = topFacetEntries(facets.topModels);
  const topEventTypes = topFacetEntries(facets.topEventTypes);
  const planningSignals = planningFacetEntries(facets.planningSignals);
  const lifecycleDemandSignals = lifecycleFacetEntries(facets.lifecycleDemandSignals);
  const longSessions = longSessionSignal(facets.longSessions);
  const usageEfficiency = buildSessionEfficiencySignal(sessions, executionEvents, {
    ...(input.usageOptions ?? {}),
    platform: scope.platform,
    workspace: scope.workspace,
  });

  const keySignals = {
    topTools,
    topHooks,
    topHookCommands,
    topSkills,
    topFunctionCalls,
    inferredSkillReads,
    topModels,
    topEventTypes,
    planningSignals,
    lifecycleDemandSignals,
    longSessions,
    usageEfficiency,
    validation,
    validationAfterEdit,
    friction,
    coverageGaps: buildCoverageGaps(sourceSummary, sample),
  };

  const cards = buildCards({
    scope,
    sample,
    sourceSummary,
    validation,
    validationAfterEdit,
    friction,
    topTools,
    topHooks,
    topHookCommands,
    topModels,
    planningSignals,
    longSessions,
    usageEfficiency,
  });

  return {
    schemaVersion: 2,
    scope,
    manifest,
    sourceSummary,
    sample,
    episodeSummary,
    keySignals,
    cards,
    actionCandidates: buildActionCandidates({
      sample,
      validation,
      validationAfterEdit,
      friction,
      topHooks,
      topHookCommands,
      sourceSummary,
      longSessions,
      usageEfficiency,
    }),
    warnings,
  };
}

function buildSourceSummary(sources, facets, warnings) {
  const enabled = sources.filter((source) => source.enabled);
  const existingEnabled = enabled.filter((source) => source.exists);
  const missingOptional = sources.filter((source) => source.enabled && source.optional && !source.exists);
  const disabled = sources.filter((source) => !source.enabled);
  return {
    totalSources: sources.length,
    enabledSources: enabled.length,
    existingEnabledSources: existingEnabled.length,
    missingOptionalSources: missingOptional.map((source) => source.id),
    disabledSources: disabled.map((source) => source.id),
    sourceCoverage: facets.sourceCoverage ?? {},
    warningCount: warnings.length,
  };
}

function buildSampleSummary(facets, sessions) {
  const sessionCount = numberOrZero(facets.sessionCount ?? sessions.length);
  const analyzedSessionCount = numberOrZero(facets.analyzedSessionCount ?? sessions.length);
  const sampled = sessionCount > analyzedSessionCount;
  return {
    sessionCount,
    analyzedSessionCount,
    sampled,
    confidence: sampleConfidence(sessionCount, analyzedSessionCount),
    timeRange: facets.timeRange ?? { firstSeen: null, lastSeen: null },
    messageCounts: facets.messageCounts ?? {},
  };
}

function buildValidationSignals(events) {
  const commandMatches = countPatternMatches(events, (event) => event.commandText, VALIDATION_PATTERNS);
  const userMentions = countPatternMatches(
    events.filter((event) => event.type === "user" || event.type === "last-prompt"),
    (event) => event.userText,
    VALIDATION_PATTERNS,
  );
  return {
    commandMatches,
    userMentions,
  };
}

function buildValidationAfterEditSignal(episodes) {
  const editedEpisodes = episodes.filter((episode) => episode.changeSets.length > 0);
  const validationAfterEdit = [];
  let editCount = 0;
  let temporalValidationCount = 0;
  let relevantValidationCount = 0;
  let latestEdit = null;

  for (const episode of editedEpisodes) {
    const latestChange = episode.changeSets.at(-1);
    editCount += episode.changeSets.reduce((count, change) => count + Number(change.eventCount ?? 0), 0);
    if (!latestEdit || String(latestChange.lastSeen) > String(latestEdit.timestamp)) {
      latestEdit = {
        type: "edit",
        toolName: "Edit",
        timestamp: latestChange.lastSeen,
        evidenceRef: latestChange.evidenceRefs?.[0] ?? null,
      };
    }
    const laterValidations = episode.validationSets.filter((validation) => String(validation.timestamp) > String(latestChange.lastSeen));
    temporalValidationCount += laterValidations.length;
    for (const validation of laterValidations) {
      validationAfterEdit.push({
        name: validation.category,
        evidenceRef: validation.evidenceRefs?.[0] ?? null,
      });
    }
    relevantValidationCount += Number(episode.closure.relevantValidationCount ?? 0);
  }

  let status = "no-edit-observed";
  if (editedEpisodes.length > 0 && temporalValidationCount > 0) {
    status = "validated-after-edit";
  } else if (editedEpisodes.length > 0) {
    status = "edit-without-validation";
  }

  return {
    status,
    relevanceStatus: relevantValidationCount > 0 ? "relevant" : editedEpisodes.length > 0 ? "unobserved" : "not-applicable",
    editCount,
    validationAfterEditCount: temporalValidationCount,
    relevantValidationCount,
    latestEdit,
    validationAfterEdit: countByName(validationAfterEdit).slice(0, DEFAULT_TOP_LIMIT),
  };
}

function buildEpisodeSummary(episodes) {
  const closure = countEpisodeClosure(episodes);
  return {
    episodeCount: episodes.length,
    explicitContinuationCount: episodes.filter((episode) => episode.continuation === "explicit").length,
    sessionBoundedEpisodeCount: episodes.filter((episode) => episode.continuation === "session-bounded").length,
    closure,
    unobservedClosureCount: episodes.filter((episode) => episode.closure.status === "unobserved").length,
  };
}

function buildFrictionSignals(events, warnings) {
  const frictionEvents = [];
  for (const event of events) {
    const type = event.type ?? "";
    const summary = event.summary ?? "";
    const level = event.level ?? "";
    const haystack = `${type} ${summary} ${level}`;
    const signal = classifyExecutionSignal(event);
    if (signal.kind === "protective-intervention" || signal.kind === "protective-false-positive") {
      continue;
    }
    const explicitFailure = signal.kind === "execution-friction";
    const matched = FRICTION_TYPE_PATTERNS.find((item) => item.pattern.test(haystack));
    if (!explicitFailure && !matched) {
      continue;
    }
    frictionEvents.push({
      name: matched?.name ?? "failed-event",
      evidenceRef: event.evidenceRef,
    });
  }

  const counted = countByName(frictionEvents);
  const sourceWarnings = warnings.map((warning) => ({
    name: `source-warning:${warning.code}`,
    count: 1,
    evidenceRefs: [],
  }));
  return [...counted, ...sourceWarnings].slice(0, DEFAULT_TOP_LIMIT);
}

function buildCoverageGaps(sourceSummary, sample) {
  const gaps = [];
  if (sourceSummary.missingOptionalSources.length > 0) {
    gaps.push({
      name: "missing-optional-sources",
      count: sourceSummary.missingOptionalSources.length,
      sources: sourceSummary.missingOptionalSources,
    });
  }
  if (sourceSummary.disabledSources.length > 0) {
    gaps.push({
      name: "disabled-sources",
      count: sourceSummary.disabledSources.length,
      sources: sourceSummary.disabledSources,
    });
  }
  if (sample.sampled) {
    gaps.push({
      name: "sampled-sessions",
      count: Math.max(0, sample.sessionCount - sample.analyzedSessionCount),
    });
  }
  return gaps;
}

function buildCards(context) {
  const cards = [
    coverageCard(context),
    validationCard(context),
    validationAfterEditCard(context),
    frictionCard(context),
  ];

  if (context.topTools.length > 0) {
    cards.push({
      id: "tool-mix",
      title: "Tool mix",
      finding: `Most observed tool: ${context.topTools[0].name} (${context.topTools[0].count}).`,
      behaviorChange: "Use this as workflow evidence, then inspect bounded sessions before claiming user intent.",
      scope: scopeLabel(context.scope),
      confidence: context.sample.confidence,
      source: "session",
      evidenceRefs: context.topTools[0].evidenceRefs,
    });
  }

  if (context.topHooks.length > 0) {
    const hookCommand = context.topHookCommands.find((item) => item.name.startsWith(`${context.topHooks[0].name} -> `));
    const commandText = hookCommand ? ` Top hook command: ${hookCommand.name} (${hookCommand.count}).` : "";
    cards.push({
      id: "observed-hooks",
      title: "Observed hooks",
      finding: `Most observed hook: ${context.topHooks[0].name} (${context.topHooks[0].count}).${commandText}`,
      behaviorChange: hookCommand
        ? "Use the hook command as execution attribution, then inspect bounded events before claiming policy impact."
        : "Separate configured hooks from observed hook enforcement, and state when the script target is unavailable.",
      scope: scopeLabel(context.scope),
      confidence: context.sample.confidence,
      source: "session",
      evidenceRefs: hookCommand?.evidenceRefs ?? context.topHooks[0].evidenceRefs,
    });
  }

  if (context.planningSignals.length > 0) {
    const top = context.planningSignals[0];
    cards.push({
      id: "planning-workflow",
      title: "Planning workflow",
      finding: `Observed ${top.host} ${top.kind}: ${top.name} (${top.count}, ${top.scope}).`,
      behaviorChange:
        top.scope === "user-global"
          ? "Treat this as user/global planning capability, then look for project-bound spec or plan evidence before claiming local governance."
          : "Use this as workspace session evidence for Goal/Plan/Spec workflow behavior.",
      scope: scopeLabel(context.scope),
      confidence: top.confidence ?? context.sample.confidence,
      source: "session",
      evidenceRefs: top.evidenceRefs,
    });
  }

  if (context.longSessions.longEitherCount > 0) {
    cards.push(longSessionCard(context));
  }

  if (context.usageEfficiency.coverage.analyzedSessionCount > 0) {
    cards.push(usageEfficiencyCard(context));
  }

  return cards;
}

function coverageCard({ scope, sample, sourceSummary }) {
  const sourceText = `${sourceSummary.existingEnabledSources}/${sourceSummary.enabledSources} enabled source roots exist`;
  return {
    id: "source-coverage",
    title: "Source coverage",
    finding: `Analyzed ${sample.analyzedSessionCount} of ${sample.sessionCount} sessions; ${sourceText}.`,
    behaviorChange: sample.sampled
      ? "Treat conclusions as sampled and increase the limit or time scope before making broad claims."
      : "Use this as the current workspace evidence boundary for final insight cards.",
    scope: scopeLabel(scope),
    confidence: sample.confidence,
    source: "session",
    evidenceRefs: [],
  };
}

function validationCard({ scope, sample, validation }) {
  const top = validation.commandMatches[0];
  const mention = validation.userMentions[0];
  return {
    id: "validation-behavior",
    title: "Validation behavior",
    finding: validationFinding(top, mention),
    behaviorChange: validationBehaviorChange(top, mention),
    scope: scopeLabel(scope),
    confidence: top ? sample.confidence : "Low",
    source: top ? "session" : "transcript",
    evidenceRefs: top?.evidenceRefs ?? mention?.evidenceRefs ?? [],
  };
}

function validationFinding(top, mention) {
  if (top) {
    return `Observed validation command category: ${top.name} (${top.count}).`;
  }
  if (mention) {
    return `Validation was mentioned by the user, but no matching command execution was observed: ${mention.name} (${mention.count}).`;
  }
  return "No validation command category was observed in the analyzed session sample.";
}

function validationBehaviorChange(top, mention) {
  if (top) {
    return "Use observed validation as execution evidence, not just configured command availability.";
  }
  if (mention) {
    return "Treat this as a validation execution gap until a matching tool command is found in bounded evidence.";
  }
  return "Inspect more sessions or add explicit validation guidance before claiming validation-after-edit behavior.";
}

function validationAfterEditCard({ scope, sample, validationAfterEdit }) {
  return {
    id: "post-edit-validation",
    title: "Post-edit validation",
    finding: validationAfterEditFinding(validationAfterEdit),
    behaviorChange: validationAfterEditBehaviorChange(validationAfterEdit),
    scope: scopeLabel(scope),
    confidence: validationAfterEdit.status === "no-edit-observed" ? "Low" : sample.confidence,
    source: "session",
    evidenceRefs: validationAfterEditEvidenceRefs(validationAfterEdit),
  };
}

function validationAfterEditFinding(signal) {
  if (signal.status === "validated-after-edit") {
    const top = signal.validationAfterEdit[0];
    return `Observed ${signal.editCount} edit event(s) and later validation: ${top.name} (${top.count}).`;
  }
  if (signal.status === "edit-without-validation") {
    return `Observed ${signal.editCount} edit event(s), but no later validation command in the analyzed sample.`;
  }
  if (signal.status === "validation-without-edit") {
    return "Observed validation commands, but no edit event in the analyzed sample.";
  }
  return "No edit event was observed in the analyzed sample.";
}

function validationAfterEditBehaviorChange(signal) {
  if (signal.status === "validated-after-edit") {
    return "Use this as evidence for validation-after-edit behavior, with the sample boundary still visible.";
  }
  if (signal.status === "edit-without-validation") {
    if (signal.editCount < MIN_POST_EDIT_REVIEW_EDIT_COUNT) {
      return "Keep this as bounded sample context only; fewer than five project edit events is too small for a post-edit finding.";
    }
    return "Route this lead to Harness session-evidence review to inspect the affected Task Episodes and later relevant validation before any finding.";
  }
  if (signal.status === "validation-without-edit") {
    return "Do not claim validation-after-edit behavior unless an edit event is in the same bounded evidence.";
  }
  return "Inspect more sessions before making claims about edit or validation habits.";
}

function validationAfterEditEvidenceRefs(signal) {
  if (signal.status === "validated-after-edit") {
    return signal.validationAfterEdit[0]?.evidenceRefs ?? [];
  }
  return signal.latestEdit?.evidenceRef ? [signal.latestEdit.evidenceRef] : [];
}

function frictionCard({ scope, sample, friction }) {
  const top = friction.find((item) => !item.name.startsWith("source-warning:"));
  return {
    id: "execution-friction",
    title: "Execution friction",
    finding: top ? `Observed friction category: ${top.name} (${top.count}).` : "No strong execution friction signal in the analyzed sample.",
    behaviorChange: top
      ? "Open bounded sessions behind this category before turning it into a user-facing recommendation."
      : "Keep friction claims narrow unless additional failed commands, rejected actions, or warnings are inspected.",
    scope: scopeLabel(scope),
    confidence: top ? sample.confidence : "Low",
    source: "session",
    evidenceRefs: top?.evidenceRefs ?? [],
  };
}

function longSessionCard({ scope, sample, longSessions }) {
  const topActive = longSessions.topByActive[0];
  const topWall = longSessions.topByWall[0];
  const finding =
    longSessions.longActiveCount > 0
      ? `Observed ${longSessions.longActiveCount} active long session(s); longest active estimate: ${formatDuration(topActive.activeMs)}.`
      : `Observed ${longSessions.longWallCount} wall-span long session(s), but no active long-session threshold match.`;
  return {
    id: "session-complexity",
    title: "Session complexity",
    finding,
    behaviorChange:
      longSessions.recommendation.status === "inspect-active-long-sessions"
        ? "Review task family, outcome, and friction before deciding whether this duration reflects a problem or any decomposition, tool, delegation, or model change is needed."
        : "Treat wall-span-only sessions as idle/resume evidence before recommending delegation.",
    scope: scopeLabel(scope),
    confidence: sample.confidence,
    source: "session",
    evidenceRefs: topActive?.evidenceRefs ?? topWall?.evidenceRefs ?? [],
  };
}

function usageEfficiencyCard({ scope, sample, usageEfficiency }) {
  const coverage = usageEfficiency.coverage;
  const long = usageEfficiency.longSessions;
  return {
    id: "session-usage-efficiency",
    title: "Session usage efficiency",
    finding: `Full selected-set census found ${long.longActiveCount} active-long session candidate(s), ${long.wallOnlyCount} wall-only span(s), and ${coverage.responseCount} deduplicated model response(s). Accounting mode: ${usageEfficiency.accountingMode}.`,
    behaviorChange: usageEfficiency.accountingMode === "effort-proxy"
      ? "Use active minutes, model requests, and retry evidence as effort proxies; do not claim exact token or credit savings. Review bounded high-effort sessions before recommending a model change."
      : "Review bounded high-effort sessions by task family and outcome before estimating savings or recommending a model change.",
    scope: scopeLabel(scope),
    confidence: sample.selectionStrategy === "all-eligible" ? "High" : sample.confidence,
    source: "session",
    evidenceRefs: usageEfficiency.candidates[0]?.evidenceRefs ?? [],
  };
}

function buildActionCandidates({
  sample,
  validation,
  validationAfterEdit,
  friction,
  topHooks,
  topHookCommands,
  sourceSummary,
  longSessions,
  usageEfficiency,
}) {
  const candidates = [];
  if (validation.commandMatches.length === 0 && validation.userMentions.length > 0) {
    candidates.push({
      kind: "validation-execution-gap",
      priority: "High",
      action: "Check bounded session events for actual validation commands before reporting validation-after-edit behavior.",
      confidence: "Low",
    });
  } else if (validation.commandMatches.length === 0) {
    candidates.push({
      kind: "validation-guidance",
      priority: "Medium",
      action: "Inspect project validation commands and add guidance only if sessions show repeated missing validation.",
      confidence: "Low",
    });
  }
  if (friction.some((item) => !item.name.startsWith("source-warning:"))) {
    candidates.push({
      kind: "friction-review",
      priority: "High",
      action: "Use `show --include-events` on the evidence sessions before writing remediation guidance.",
      confidence: sample.confidence,
    });
  }
  if (validationAfterEdit.status === "edit-without-validation"
    && validationAfterEdit.editCount >= MIN_POST_EDIT_REVIEW_EDIT_COUNT) {
    candidates.push({
      kind: "post-edit-validation-review",
      priority: "High",
      action: "In Harness session-evidence review, inspect the affected Task Episodes and later relevant validation before returning any conclusion or finding.",
      confidence: sample.confidence,
    });
  }
  if (topHooks.length > 0) {
    candidates.push({
      kind: "hook-evidence",
      priority: "Medium",
      action:
        topHookCommands.length > 0
          ? "Compare observed hook commands with configured hooks before changing hook policy."
          : "Compare observed hook events with configured hooks, and state that command/script attribution is unavailable.",
      confidence: sample.confidence,
    });
  }
  if (longSessions.recommendation.status === "consider-delegation") {
    candidates.push({
      kind: "specialist-delegation",
      priority: "High",
      action:
        "Consider subagents or Experts for repeated active long sessions, then run Loop Discovery before creating a durable Custom Agent or Skill.",
      confidence: sample.confidence,
    });
  }
  for (const opportunity of usageEfficiency.opportunities ?? []) {
    if (opportunity.kind === "wall-span-noise") continue;
    candidates.push({
      kind: opportunity.kind,
      priority: opportunity.priority,
      action: opportunity.action,
      confidence: opportunity.status === "observed" ? sample.confidence : "Medium",
      savingsMode: opportunity.savingsMode,
    });
  }
  if (sourceSummary.disabledSources.length > 0 || sourceSummary.missingOptionalSources.length > 0 || sample.sampled) {
    candidates.push({
      kind: "evidence-boundary",
      priority: "Medium",
      action: "Record source gaps and sampling limits in the final report.",
      confidence: "High",
    });
  }
  return candidates;
}

function countPatternMatches(events, textFn, patterns) {
  return countByName(collectPatternMatches(events, textFn, patterns)).slice(0, DEFAULT_TOP_LIMIT);
}

function collectPatternMatches(events, textFn, patterns) {
  const matches = [];
  for (const event of events) {
    const text = textFn(event);
    if (!text) {
      continue;
    }
    for (const item of patterns) {
      if (item.pattern.test(text)) {
        matches.push({ ...event, name: item.name, evidenceRef: event.event?.evidenceRef ?? event.evidenceRef });
      }
    }
  }
  return matches;
}

function countByName(items) {
  const counts = new Map();
  const refs = new Map();
  for (const item of items) {
    counts.set(item.name, (counts.get(item.name) ?? 0) + 1);
    if (!refs.has(item.name)) {
      refs.set(item.name, []);
    }
    if (item.evidenceRef && refs.get(item.name).length < 3) {
      refs.get(item.name).push(item.evidenceRef);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count, evidenceRefs: refs.get(name) ?? [] }));
}

function topFacetEntries(entries, limit = DEFAULT_TOP_LIMIT) {
  return (entries ?? []).slice(0, limit).map((entry) => ({
    name: entry.name,
    count: entry.count,
    evidenceRefs: entry.evidenceRefs ?? [],
  }));
}

function planningFacetEntries(entries, limit = DEFAULT_TOP_LIMIT) {
  return (entries ?? []).slice(0, limit).map((entry) => ({
    name: entry.name,
    kind: entry.kind,
    host: entry.host,
    scope: entry.scope,
    confidence: entry.confidence,
    count: entry.count,
    evidenceRefs: entry.evidenceRefs ?? [],
  }));
}

function lifecycleFacetEntries(entries, limit = DEFAULT_TOP_LIMIT) {
  return (entries ?? []).slice(0, limit).map((entry) => ({
    schemaVersion: entry.schemaVersion,
    intent: entry.intent,
    family: entry.family,
    dimensionId: entry.dimensionId,
    checkId: entry.checkId,
    host: entry.host,
    scope: entry.scope,
    confidence: entry.confidence,
    count: entry.count,
    evidenceRefs: entry.evidenceRefs ?? [],
  }));
}

function longSessionSignal(facet = {}) {
  return {
    thresholds: facet.thresholds ?? {},
    analyzedSessionCount: numberOrZero(facet.analyzedSessionCount),
    longActiveCount: numberOrZero(facet.longActiveCount),
    longWallCount: numberOrZero(facet.longWallCount),
    wallOnlyCount: numberOrZero(facet.wallOnlyCount),
    longEitherCount: numberOrZero(facet.longEitherCount),
    longActiveRatio: Number(facet.longActiveRatio ?? 0),
    recommendation: facet.recommendation ?? {
      status: "observe-only",
      reason: "no-long-session-facet",
      ownerHint: "needs-session-analysis",
    },
    topByActive: longSessionRows(facet.topByActive),
    topByWall: longSessionRows(facet.topByWall),
  };
}

function longSessionRows(rows = []) {
  return rows.slice(0, DEFAULT_TOP_LIMIT).map((row) => ({
    id: row.id,
    label: row.label,
    firstSeen: row.firstSeen,
    lastSeen: row.lastSeen,
    wallMs: numberOrZero(row.wallMs),
    activeMs: numberOrNull(row.activeMs),
    activeTimeObserved: row.activeTimeObserved !== false,
    maxIdleGapMs: numberOrNull(row.maxIdleGapMs),
    idleGapCount: numberOrNull(row.idleGapCount),
    userPromptCount: numberOrZero(row.userPromptCount),
    toolCallCount: numberOrZero(row.toolCallCount),
    eventCount: numberOrZero(row.eventCount),
    evidenceRefs: row.evidenceRefs ?? [],
  }));
}

function isEditEvent(event) {
  if (EDIT_TOOL_NAMES.has(event.toolName)) {
    return true;
  }
  const commandText = event.commandText ?? "";
  return EDIT_COMMAND_PATTERNS.some((item) => item.pattern.test(commandText));
}

function latestObserved(items) {
  return items
    .slice()
    .sort((a, b) => compareObserved(a, b))
    .at(-1);
}

function compareObserved(a, b) {
  const left = a.time ?? Number.NEGATIVE_INFINITY;
  const right = b.time ?? Number.NEGATIVE_INFINITY;
  if (left !== right) {
    return left - right;
  }
  return a.index - b.index;
}

function isAfter(candidate, reference) {
  if (candidate.time !== null && reference.time !== null) {
    return candidate.time > reference.time;
  }
  return candidate.index > reference.index;
}

function toSignalEvent(item) {
  return {
    type: item.event.type,
    toolName: item.event.toolName ?? null,
    timestamp: item.event.timestamp ?? null,
    evidenceRef: item.event.evidenceRef ?? null,
  };
}

function eventMillis(event) {
  if (!event.timestamp) {
    return null;
  }
  const millis = Date.parse(event.timestamp);
  return Number.isNaN(millis) ? null : millis;
}

function sampleConfidence(sessionCount, analyzedSessionCount) {
  if (sessionCount === 0 || analyzedSessionCount === 0) {
    return "Low";
  }
  if (analyzedSessionCount >= sessionCount) {
    return "High";
  }
  const ratio = analyzedSessionCount / sessionCount;
  return ratio >= 0.5 ? "Medium" : "Low";
}

function scopeLabel(scope) {
  return scope.workspace ? "workspace-only" : "platform-scoped";
}

function formatDuration(ms) {
  const minutes = Math.round(numberOrZero(ms) / 60_000);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}h ${String(remainder).padStart(2, "0")}m`;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function numberOrNull(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

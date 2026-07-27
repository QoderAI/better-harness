export const ANALYZE_EVIDENCE_TOKEN_BUDGET = 6_000;

const MAX_TEXT_LENGTH = 420;
const MAX_PRACTICE_ROWS = 8;
const MAX_PATHS = 5;
const MAX_SKILL_CANDIDATES = 5;
const MAX_REGRESSION_CANDIDATES = 3;
const MAX_TASK_EPISODES = 5;
const MAX_SEMANTIC_OBSERVATIONS = 8;
const MAX_DELIVERY_ROWS = 8;
const MAX_INTERVENTIONS = 5;

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, maximum = MAX_TEXT_LENGTH) {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  if (text.length <= maximum) return text;
  return `${text.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

function humanLabel(value) {
  return cleanText(value, 120)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/^./u, (character) => character.toUpperCase());
}

function count(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function yesNo(value) {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "not stated";
}

function list(values, maximum = MAX_PATHS) {
  const normalized = [...new Set(rows(values).map((value) => cleanText(value, 180)).filter(Boolean))];
  const shown = normalized.slice(0, maximum);
  return {
    text: shown.join(", "),
    omitted: Math.max(0, normalized.length - shown.length),
  };
}

function withOmitted(text, omitted) {
  return omitted > 0 ? `${text} (+${omitted} omitted)` : text;
}

function section(title, lines) {
  return ["", title.toUpperCase(), ...(lines.length > 0 ? lines : ["No bounded evidence observed."])];
}

export function estimateEvidenceTokens(value) {
  let ascii = 0;
  let nonAscii = 0;
  for (const character of String(value ?? "")) {
    if (character.codePointAt(0) <= 0x7f) ascii += 1;
    else nonAscii += 1;
  }
  return Math.ceil(ascii / 4) + nonAscii;
}

function fitTokenBudget(lines, budget = ANALYZE_EVIDENCE_TOKEN_BUDGET) {
  const complete = lines.join("\n");
  if (estimateEvidenceTokens(complete) <= budget) return complete;

  const kept = [];
  for (const line of lines) {
    const omitted = lines.length - kept.length;
    const note = `[Global evidence budget reached; ${omitted} formatted line(s) omitted.]`;
    if (estimateEvidenceTokens([...kept, line, note].join("\n")) > budget) break;
    kept.push(line);
  }
  let omitted = lines.length - kept.length;
  let note = `[Global evidence budget reached; ${omitted} formatted line(s) omitted.]`;
  while (kept.length > 0 && estimateEvidenceTokens([...kept, note].join("\n")) > budget) {
    kept.pop();
    omitted = lines.length - kept.length;
    note = `[Global evidence budget reached; ${omitted} formatted line(s) omitted.]`;
  }
  return [...kept, note].join("\n");
}

function observationScopeLines(manifest = {}) {
  const scope = manifest.scope ?? {};
  const sources = manifest.sources ?? {};
  const selection = manifest.selection ?? {};
  const privacy = manifest.privacy ?? {};
  const warnings = list(manifest.warningCodes, 8);
  const boundary = [scope.since ? `since ${cleanText(scope.since)}` : null, scope.until ? `until ${cleanText(scope.until)}` : null]
    .filter(Boolean)
    .join("; ");
  return [
    `Source roots: ${count(sources.existingEnabled)} of ${count(sources.enabled)} enabled roots exist; ${count(sources.total)} roots were discovered.`,
    `Session selection: analyzed ${count(selection.analyzedCount)} of ${count(selection.eligibleCount)} eligible sessions with ${cleanText(selection.strategy || "unspecified")} selection; confidence ${cleanText(selection.confidence || "not stated")}; representative ${yesNo(selection.representative)}.`,
    `Scope: ${cleanText(scope.workspaceScope || "workspace")}; global capability metadata included ${yesNo(scope.includeGlobalCapabilities)}${boundary ? `; ${boundary}` : ""}.`,
    `Privacy boundary: ${cleanText(privacy.mode || "not stated")}; raw prompts included ${yesNo(privacy.rawPromptIncluded)}; raw commands included ${yesNo(privacy.rawCommandIncluded)}; absolute home paths included ${yesNo(privacy.absoluteHomePathIncluded)}.`,
    ...(warnings.text ? [`Source warnings: ${withOmitted(warnings.text, warnings.omitted)}.`] : []),
  ];
}

function dimensionEvidenceLines(dimensions = {}) {
  return Object.entries(dimensions).slice(0, 8).map(([dimension, value]) => {
    const present = rows(value?.present);
    const wired = rows(value?.wired);
    const labels = list([...present, ...wired].map((row) => row?.label), 5);
    const evidence = labels.text ? ` Representative evidence: ${withOmitted(labels.text, labels.omitted)}.` : "";
    return `- ${humanLabel(dimension)}: ${present.length} observed and ${wired.length} connected signal(s).${evidence}`;
  });
}

function practiceCoverageLines(practice = {}) {
  const coverage = rows(practice.coverageRows);
  const selected = coverage.slice(0, MAX_PRACTICE_ROWS).map((row) => {
    const paths = list(row?.paths);
    const scopes = list(row?.scopes, 4);
    return `- Agent practice coverage: ${cleanText(row?.surface || "unlabelled surface")} has ${count(row?.count)} asset(s) in ${scopes.text || "an unspecified scope"}${paths.text ? `; paths: ${withOmitted(paths.text, paths.omitted)}` : ""}.`;
  });
  if (coverage.length > selected.length) selected.push(`- Agent practice coverage: ${coverage.length - selected.length} additional row(s) omitted.`);
  return selected;
}

function learningAssetLines(learning = {}) {
  if (!learning || typeof learning !== "object") return [];
  const output = [];
  const reusable = learning.reusableSkillEvidence ?? {};
  const skillCandidates = rows(reusable.candidates);
  if (reusable.status || skillCandidates.length > 0) {
    output.push(`- Reusable Skill evidence: ${cleanText(reusable.status || "status not stated")}; ${skillCandidates.length} candidate asset(s), ${rows(reusable.observedProjectSkills).length} observed project Skill(s), and ${rows(reusable.unresolvedNameMatches).length} unresolved name match(es).`);
    for (const candidate of skillCandidates.slice(0, MAX_SKILL_CANDIDATES)) {
      const route = candidate?.routePath ? ` via ${cleanText(candidate.routePath, 180)}` : "";
      output.push(`  - ${cleanText(candidate?.path || candidate?.id || "unnamed Skill", 220)}: trigger ${yesNo(candidate?.trigger)}, procedure ${yesNo(candidate?.procedure)}, output ${yesNo(candidate?.output)}, validation ${yesNo(candidate?.validation)}, routed ${yesNo(candidate?.routed)}${route}.`);
    }
    if (skillCandidates.length > MAX_SKILL_CANDIDATES) output.push(`  - ${skillCandidates.length - MAX_SKILL_CANDIDATES} additional Skill candidate(s) omitted.`);
  }

  const regression = learning.regressionTestEvidence ?? {};
  const regressionCandidates = rows(regression.candidates);
  if (regression.status || regressionCandidates.length > 0) {
    output.push(`- Regression-test evidence: ${cleanText(regression.status || "status not stated")}; inspected ${count(regression.inspectedCommitCount)} commit(s) and retained ${regressionCandidates.length} source/test co-change candidate(s).`);
    for (const candidate of regressionCandidates.slice(0, MAX_REGRESSION_CANDIDATES)) {
      const sources = list(candidate?.sourcePaths, 3);
      const tests = list(candidate?.testPaths, 3);
      output.push(`  - Sources: ${withOmitted(sources.text || "not stated", sources.omitted)}. Tests: ${withOmitted(tests.text || "not stated", tests.omitted)}. Path-correlated ${yesNo(candidate?.pathCorrelated)}.`);
    }
    if (regressionCandidates.length > MAX_REGRESSION_CANDIDATES) output.push(`  - ${regressionCandidates.length - MAX_REGRESSION_CANDIDATES} additional co-change candidate(s) omitted.`);
  }

  const canonical = learning.canonicalSpecEvidence ?? {};
  const specCandidates = rows(canonical.candidates);
  if (canonical.status || specCandidates.length > 0) {
    const paths = list(specCandidates.map((candidate) => candidate?.path ?? candidate?.id));
    output.push(`- Canonical planning evidence: ${cleanText(canonical.status || "status not stated")}; ${specCandidates.length} candidate(s)${paths.text ? `; paths: ${withOmitted(paths.text, paths.omitted)}` : ""}.`);
  }
  return output;
}

function diagnosticsLines(repository = {}) {
  const output = [];
  const learning = repository.learningCaptureDiagnostics ?? {};
  const signals = learning.signals ?? {};
  const observedSkills = rows(signals.observedSkills);
  const unscopedSkills = rows(signals.unscopedObservedSkills);
  const friction = rows(signals.frictionSignals);
  if (Object.keys(learning).length > 0) {
    output.push(`- Learning observation coverage: ${rows(learning.episodeRecords).length} episode record(s), ${rows(learning.recurringIssueCandidates).length} recurring candidate(s), ${observedSkills.length} scoped Skill observation(s), and ${unscopedSkills.length} unscoped Skill observation(s).`);
    const frictionList = list(friction.map((row) => `${row?.name}: ${count(row?.count)}`), 6);
    if (frictionList.text) output.push(`  - Aggregated friction signals: ${withOmitted(frictionList.text, frictionList.omitted)}.`);
    const coverage = list(Object.entries(learning.coverage ?? {}).map(([key, value]) => `${humanLabel(key)}=${cleanText(value, 100)}`), 9);
    if (coverage.text) output.push(`  - Coverage boundary: ${withOmitted(coverage.text, coverage.omitted)}.`);
  }

  const workflow = repository.workflowDemandDiagnostics ?? {};
  if (Object.keys(workflow).length > 0) {
    output.push(`- Workflow-demand observation: ${rows(workflow.currentHandoffs).length} current handoff(s) and ${rows(workflow.repeatedCandidates).length} repeated candidate(s); candidate contents are not projected into this brief.`);
    const coverage = list(Object.entries(workflow.coverage ?? {}).map(([key, value]) => `${humanLabel(key)}=${cleanText(value, 100)}`), 7);
    if (coverage.text) output.push(`  - Coverage boundary: ${withOmitted(coverage.text, coverage.omitted)}.`);
  }
  return output;
}

function repositoryFactLines(repository = {}) {
  const secret = repository.secretScanCoverage ?? {};
  return [
    ...(repository.projectName ? [`Project label: ${cleanText(repository.projectName, 160)}.`] : []),
    ...dimensionEvidenceLines(repository.dimensions),
    ...practiceCoverageLines(repository.aiAgentPractice),
    ...learningAssetLines(repository.learningCaptureEvidence),
    ...(Object.keys(secret).length > 0 ? [`- Sensitive-config scan coverage: ${cleanText(secret.status || "not stated")}; ${count(secret.scannedFileCount)} of ${count(secret.candidateCount)} candidate file(s) scanned, ${count(secret.skippedFileCount)} skipped, ${count(secret.errorCount)} read error(s), truncated ${yesNo(secret.truncated)}.`] : []),
    ...diagnosticsLines(repository),
  ];
}

function usageLines(sessionEvents = {}) {
  const output = [];
  const activity = sessionEvents.usageActivity ?? {};
  if (Object.keys(activity).length > 0) {
    const skills = rows(activity.skills).slice(0, 5).map((row) => `${row?.name ?? row?.label ?? "unlabelled"}: ${count(row?.total)}`);
    output.push(`Usage activity: ${count(activity.sessions?.total)} session(s) in the complete activity census${skills.length > 0 ? `; top bounded Skill observations: ${skills.join(", ")}` : ""}.`);
  }
  const usage = sessionEvents.usageEfficiency ?? {};
  if (Object.keys(usage).length > 0) {
    const selection = usage.selection ?? {};
    const long = usage.longSessions ?? {};
    const accounting = usage.accounting ?? {};
    output.push(`Usage census: analyzed ${count(selection.analyzedSessionCount)} of ${count(selection.eligibleSessionCount)} eligible sessions; complete ${yesNo(selection.complete)}; ${count(long.activeCount)} active-long and ${count(long.wallOnlyCount)} wall-only session(s); accounting ${cleanText(accounting.mode || "not stated")}.`);
  }
  return output;
}

function episodeActivity(episode) {
  return rows(episode?.changeSets).reduce((sum, row) => sum + count(row?.eventCount), 0)
    + rows(episode?.validationSets).reduce((sum, row) => sum + count(row?.eventCount), 0) * 3
    + rows(episode?.lifecycleSignals).length * 2
    + rows(episode?.learningSignals).length * 2;
}

function representativeEpisodes(episodes) {
  if (episodes.length <= MAX_TASK_EPISODES) return episodes;
  const selected = new Set([0, episodes.length - 1]);
  const ranked = episodes.map((episode, index) => ({ index, activity: episodeActivity(episode) }))
    .sort((left, right) => right.activity - left.activity || left.index - right.index);
  for (const entry of ranked) {
    if (selected.size >= MAX_TASK_EPISODES) break;
    selected.add(entry.index);
  }
  return [...selected].sort((left, right) => left - right).map((index) => episodes[index]);
}

function taskEpisodeLines(taskEpisodes = []) {
  const episodes = rows(taskEpisodes);
  const selected = representativeEpisodes(episodes);
  const output = selected.map((episode, index) => {
    const changeEvents = rows(episode?.changeSets).reduce((sum, row) => sum + count(row?.eventCount), 0);
    const validationEvents = rows(episode?.validationSets).reduce((sum, row) => sum + count(row?.eventCount), 0);
    const elapsedSeconds = Number.isFinite(Number(episode?.elapsedMs)) ? `${(Number(episode.elapsedMs) / 1_000).toFixed(1)} seconds` : "duration unavailable";
    const reference = cleanText(episode?.id, 80);
    return `- Episode ${index + 1}${reference ? ` (${reference})` : ""}: ${cleanText(episode?.startBoundary || "boundary not stated")}; ${count(episode?.sessionCount || 1)} session(s); ${changeEvents} change event(s) in ${rows(episode?.changeSets).length} set(s); ${validationEvents} validation event(s) in ${rows(episode?.validationSets).length} set(s); closure ${cleanText(episode?.closure?.status || "not stated")}; repair ${cleanText(episode?.repair?.status || "not stated")}; ${elapsedSeconds}; ${count(episode?.toolCalls)} tool call(s); ${count(episode?.eventEvidenceCount)} retained event(s).`;
  });
  if (episodes.length > selected.length) output.push(`- ${episodes.length - selected.length} additional task episode(s) omitted; selection retained the first, last, and highest observed activity episodes.`);
  return output;
}

function sessionFactLines(sessionEvents = {}, taskEpisodes = []) {
  const permissions = sessionEvents.permissionSummary ?? {};
  return [
    `Session packet: ${count(sessionEvents.selectedSessionCount)} selected session(s), ${count(sessionEvents.candidateEpisodeCount)} retained candidate episode(s), and ${count(sessionEvents.discardedEpisodeCount)} discarded episode(s).`,
    ...(Object.keys(permissions).length > 0 ? [`Permissions observed: ${count(permissions.observed)} total; ${count(permissions.routineAllowed)} routine allowed, ${count(permissions.prompted)} prompted, ${count(permissions.denied)} denied, ${count(permissions.escalated)} escalated, and ${count(permissions.protectedActions)} protected action(s).`] : []),
    ...usageLines(sessionEvents),
    ...taskEpisodeLines(taskEpisodes),
  ];
}

function semanticObservationLines(semanticFacets = []) {
  const observations = rows(semanticFacets).filter((row) => cleanText(row?.summary));
  const selected = observations.slice(0, MAX_SEMANTIC_OBSERVATIONS).map((row) => {
    const refs = rows(row?.evidenceRefs).length;
    return `- ${cleanText(row.summary)}${refs > 0 ? ` (${refs} bounded evidence reference(s))` : ""}`;
  });
  if (observations.length > selected.length) selected.push(`- ${observations.length - selected.length} additional analyzer observation(s) omitted.`);
  return selected;
}

function deliveryLines(deliveryEvidence = []) {
  const evidence = rows(deliveryEvidence);
  const selected = evidence.slice(0, MAX_DELIVERY_ROWS).map((row) => {
    const summary = cleanText(row?.summary);
    return `- ${summary || "Delivery event"}: ${cleanText(row?.status || "status not stated")}; level ${cleanText(row?.level || "not stated")}; ${rows(row?.evidenceRefs).length} bounded reference(s).`;
  });
  if (evidence.length > selected.length) selected.push(`- ${evidence.length - selected.length} additional delivery row(s) omitted.`);
  return selected;
}

function interventionLines(interventionLedger = []) {
  const interventions = rows(interventionLedger);
  const selected = interventions.slice(0, MAX_INTERVENTIONS).map((entry) => {
    const asset = entry?.asset ?? {};
    const result = entry?.result ?? {};
    return `- ${cleanText(asset.label || asset.type || "Intervention")}: owner ${cleanText(entry?.owner || "not stated")}; result ${cleanText(result.state || "not stated")}; primary metric ${cleanText(entry?.primaryMetric?.id || "not stated")}; guardrail ${cleanText(entry?.guardrailMetric?.id || "not stated")}; stop or revert when ${cleanText(entry?.stopOrRevertCondition || "not stated", 260)}`;
  });
  if (interventions.length > selected.length) selected.push(`- ${interventions.length - selected.length} additional intervention row(s) omitted.`);
  return selected;
}

function assessmentBoundaryLines(assessmentDecisions = []) {
  return rows(assessmentDecisions).slice(0, 8).map((decision) => {
    if (decision?.kind === "repository-review") {
      return `- Repository review: ${cleanText(decision.status || "status not stated")}; ${rows(decision.requiredFrameworks).length} framework(s), ${rows(decision.requiredChecks).length} repository check(s), and ${rows(decision.requiredSoftwareFluencyCapabilities).length} Software Fluency capability review(s) remain in scope.`;
    }
    if (decision?.kind === "score-review") {
      return `- Score review: ${cleanText(decision.status || "status not stated")}; ${rows(decision.dimensions).length} dimension(s) await AI judgment.`;
    }
    if (decision?.kind === "session-insights") {
      return `- Session observation review: ${cleanText(decision.status || "status not stated")}; ${count(decision.cardCount)} observation card(s) from ${count(decision.analyzedSessionCount)} analyzed session(s).`;
    }
    return `- ${humanLabel(decision?.kind || "review boundary")}: ${cleanText(decision?.status || "status not stated")}.`;
  });
}

export function formatHarnessEvidence(source, { workspace, platform, language }) {
  const lines = [
    "HARNESS ANALYSIS EVIDENCE",
    "",
    "This is a read-only evidence brief, not a report conclusion.",
    "Projected report conclusions are intentionally excluded; use the observations and boundaries below to make your own evidence-backed decisions.",
    `Workspace: ${workspace}`,
    `Platform: ${platform}`,
    `Language: ${language}`,
    `Budget: at most ${ANALYZE_EVIDENCE_TOKEN_BUDGET} estimated tokens; each evidence domain uses bounded representative rows and reports omissions.`,
    ...section("Observation scope", observationScopeLines(source.manifest)),
    ...section("Repository facts", repositoryFactLines(source.repositoryEvidence)),
    ...section("Session and task facts", sessionFactLines(source.sessionEvents, source.taskEpisodes)),
    ...section("Analyzer observations", semanticObservationLines(source.semanticFacets)),
    ...section("Delivery evidence", deliveryLines(source.deliveryEvidence)),
    ...section("Intervention history", interventionLines(source.interventionLedger)),
    ...section("Review boundaries", assessmentBoundaryLines(source.assessmentDecisions)),
  ];
  return fitTokenBudget(lines);
}

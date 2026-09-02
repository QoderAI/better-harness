import { validateTaskEvidencePacket } from "../../../scripts/task-evidence-upload/index.mjs";

export const DASHBOARD_INPUT_KIND = "better-harness.dashboard-input";
export const DASHBOARD_INPUT_SCHEMA_VERSION = 1;

const MAX_PROJECTED_ITEMS = 10_000;
const REQUIRED_TOP_LEVEL_KEYS = Object.freeze([
  "kind",
  "schemaVersion",
  "generatedAt",
  "workspace",
  "window",
  "sources",
  "usageSummary",
  "usageActivity",
  "providerBreakdown",
  "deliverySignals",
  "assetInventories",
  "evidenceDeliveries",
]);
const OPTIONAL_TOP_LEVEL_KEYS = Object.freeze([
  "commitAttribution",
  "topology",
  "contextUsage",
]);
const TOKEN_FIELDS = Object.freeze([
  "inputTokens",
  "outputTokens",
  "cacheReadInputTokens",
  "cacheCreationInputTokens",
]);
// A bare time overlap (`low`) attributes nothing, so it can never produce a
// commit-to-session reference.
const ATTRIBUTING_CONFIDENCES = Object.freeze(["explicit", "high", "medium"]);

export class DashboardInputContractError extends TypeError {
  constructor(message) {
    super(message);
    this.name = "DashboardInputContractError";
    this.code = "INVALID_DASHBOARD_INPUT";
  }
}

function fail(message) {
  throw new DashboardInputContractError(message);
}

function recordAt(value, pointer) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${pointer} must be an object.`);
  }
  return value;
}

function exactKeys(value, pointer, required, optional = []) {
  const object = recordAt(value, pointer);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.hasOwn(object, key)) fail(`${pointer}.${key} is required.`);
  }
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) fail(`${pointer}.${key} is not supported by this schema version.`);
  }
  return object;
}

function arrayAt(value, pointer) {
  if (!Array.isArray(value)) fail(`${pointer} must be an array.`);
  if (value.length > MAX_PROJECTED_ITEMS) fail(`${pointer} exceeds the Dashboard projection limit.`);
  return value;
}

function stringAt(value, pointer) {
  if (typeof value !== "string") fail(`${pointer} must be a string.`);
  return value;
}

function nullableStringAt(value, pointer) {
  if (value !== null) stringAt(value, pointer);
  return value;
}

// A join key that is present but blank names nothing a consumer could match,
// which is the same reason a blank revision is refused: it offers an identifier
// the producer never held.
function identifierAt(value, pointer) {
  if (stringAt(value, pointer).trim() === "") fail(`${pointer} must not be blank.`);
  return value;
}

function booleanAt(value, pointer) {
  if (typeof value !== "boolean") fail(`${pointer} must be a boolean.`);
  return value;
}

function nonNegativeNumberAt(value, pointer) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail(`${pointer} must be a finite non-negative number.`);
  }
  return value;
}

function nonNegativeIntegerAt(value, pointer) {
  nonNegativeNumberAt(value, pointer);
  if (!Number.isSafeInteger(value)) fail(`${pointer} must be a safe integer.`);
  return value;
}

function stringArrayAt(value, pointer) {
  return arrayAt(value, pointer).map((entry, index) => stringAt(entry, `${pointer}[${index}]`));
}

function numberArrayAt(value, pointer, expectedLength) {
  const entries = arrayAt(value, pointer);
  if (entries.length !== expectedLength) {
    fail(`${pointer} must contain ${expectedLength} entries to align with usageActivity.dates.`);
  }
  entries.forEach((entry, index) => nonNegativeNumberAt(entry, `${pointer}[${index}]`));
  return entries;
}

function validateTokenTotals(value, pointer) {
  const totals = exactKeys(value, pointer, TOKEN_FIELDS);
  for (const field of TOKEN_FIELDS) nonNegativeNumberAt(totals[field], `${pointer}.${field}`);
}

function validateUsageSummary(value) {
  const summary = exactKeys(value, "dashboardInput.usageSummary", [
    "kind", "schemaVersion", "selection", "usageEfficiency", "evidenceBoundary",
  ]);
  if (summary.kind !== "better-harness.session-usage-summary" || summary.schemaVersion !== 1) {
    fail("dashboardInput.usageSummary uses an unsupported kind or schema version.");
  }

  const selection = recordAt(summary.selection, "dashboardInput.usageSummary.selection");
  stringAt(selection.strategy, "dashboardInput.usageSummary.selection.strategy");
  nonNegativeIntegerAt(selection.eligibleCount, "dashboardInput.usageSummary.selection.eligibleCount");
  nonNegativeIntegerAt(selection.analyzedCount, "dashboardInput.usageSummary.selection.analyzedCount");
  booleanAt(selection.complete, "dashboardInput.usageSummary.selection.complete");

  const efficiency = recordAt(summary.usageEfficiency, "dashboardInput.usageSummary.usageEfficiency");
  stringAt(efficiency.accountingMode, "dashboardInput.usageSummary.usageEfficiency.accountingMode");
  const coverage = recordAt(efficiency.coverage, "dashboardInput.usageSummary.usageEfficiency.coverage");
  for (const key of [
    "analyzedSessionCount", "responseCount", "usageFieldObservedCount", "nonZeroUsageCount",
    "modelAttributedResponseCount", "unattributedResponseCount",
  ]) nonNegativeIntegerAt(coverage[key], `dashboardInput.usageSummary.usageEfficiency.coverage.${key}`);
  booleanAt(coverage.exactCreditsAvailable, "dashboardInput.usageSummary.usageEfficiency.coverage.exactCreditsAvailable");
  stringArrayAt(coverage.cacheAccountingModes, "dashboardInput.usageSummary.usageEfficiency.coverage.cacheAccountingModes");

  const longSessions = recordAt(efficiency.longSessions, "dashboardInput.usageSummary.usageEfficiency.longSessions");
  for (const key of ["longActiveCount", "longWallCount", "wallOnlyCount"]) {
    nonNegativeIntegerAt(longSessions[key], `dashboardInput.usageSummary.usageEfficiency.longSessions.${key}`);
  }
  if (efficiency.tokenTotals !== null) {
    validateTokenTotals(efficiency.tokenTotals, "dashboardInput.usageSummary.usageEfficiency.tokenTotals");
  }
  for (const [index, entry] of arrayAt(efficiency.modelUsage, "dashboardInput.usageSummary.usageEfficiency.modelUsage").entries()) {
    const pointer = `dashboardInput.usageSummary.usageEfficiency.modelUsage[${index}]`;
    const model = exactKeys(entry, pointer, [
      "model", "responseCount", "usageFieldObservedCount", "nonZeroUsageCount", "tokenTotals",
    ]);
    stringAt(model.model, `${pointer}.model`);
    for (const key of ["responseCount", "usageFieldObservedCount", "nonZeroUsageCount"]) {
      nonNegativeIntegerAt(model[key], `${pointer}.${key}`);
    }
    if (model.tokenTotals !== null) validateTokenTotals(model.tokenTotals, `${pointer}.tokenTotals`);
  }
  const outcomeReview = exactKeys(efficiency.outcomeReview, "dashboardInput.usageSummary.usageEfficiency.outcomeReview", [
    "status", "reviewedCandidateCount", "reviewedActiveLongCount", "comparableModelOutcomeEvidence", "reason",
  ]);
  stringAt(outcomeReview.status, "dashboardInput.usageSummary.usageEfficiency.outcomeReview.status");
  nonNegativeIntegerAt(outcomeReview.reviewedCandidateCount, "dashboardInput.usageSummary.usageEfficiency.outcomeReview.reviewedCandidateCount");
  nonNegativeIntegerAt(outcomeReview.reviewedActiveLongCount, "dashboardInput.usageSummary.usageEfficiency.outcomeReview.reviewedActiveLongCount");
  booleanAt(outcomeReview.comparableModelOutcomeEvidence, "dashboardInput.usageSummary.usageEfficiency.outcomeReview.comparableModelOutcomeEvidence");
  nullableStringAt(outcomeReview.reason, "dashboardInput.usageSummary.usageEfficiency.outcomeReview.reason");
  nonNegativeIntegerAt(efficiency.candidateCount, "dashboardInput.usageSummary.usageEfficiency.candidateCount");
  nonNegativeIntegerAt(efficiency.opportunityCount, "dashboardInput.usageSummary.usageEfficiency.opportunityCount");

  const boundary = recordAt(summary.evidenceBoundary, "dashboardInput.usageSummary.evidenceBoundary");
  booleanAt(boundary.hasEligibleSessions, "dashboardInput.usageSummary.evidenceBoundary.hasEligibleSessions");
  booleanAt(boundary.requiresSemanticReview, "dashboardInput.usageSummary.evidenceBoundary.requiresSemanticReview");
  booleanAt(boundary.exactCostAvailable, "dashboardInput.usageSummary.evidenceBoundary.exactCostAvailable");
  stringArrayAt(boundary.warningCodes, "dashboardInput.usageSummary.evidenceBoundary.warningCodes");
}

function validateDatedSeries(value, pointer, expectedLength) {
  for (const [index, series] of arrayAt(value, pointer).entries()) {
    const row = recordAt(series, `${pointer}[${index}]`);
    stringAt(row.name, `${pointer}[${index}].name`);
    nonNegativeNumberAt(row.total, `${pointer}[${index}].total`);
    numberArrayAt(row.daily, `${pointer}[${index}].daily`, expectedLength);
  }
}

function validateUsageActivity(value) {
  const activity = recordAt(value, "dashboardInput.usageActivity");
  if (activity.schemaVersion !== 4 || activity.dateBasis !== "UTC") {
    fail("dashboardInput.usageActivity uses an unsupported schema version or date basis.");
  }
  stringAt(activity.measurementBasis, "dashboardInput.usageActivity.measurementBasis");
  booleanAt(activity.truncated, "dashboardInput.usageActivity.truncated");
  const dates = stringArrayAt(activity.dates, "dashboardInput.usageActivity.dates");
  const sessions = recordAt(activity.sessions, "dashboardInput.usageActivity.sessions");
  nonNegativeNumberAt(sessions.total, "dashboardInput.usageActivity.sessions.total");
  numberArrayAt(sessions.starts, "dashboardInput.usageActivity.sessions.starts", dates.length);
  numberArrayAt(sessions.activeMinutes, "dashboardInput.usageActivity.sessions.activeMinutes", dates.length);
  validateDatedSeries(activity.models, "dashboardInput.usageActivity.models", dates.length);
  validateDatedSeries(activity.skills, "dashboardInput.usageActivity.skills", dates.length);
  if (activity.mcps !== undefined) validateDatedSeries(activity.mcps, "dashboardInput.usageActivity.mcps", dates.length);
  if (activity.tokens !== undefined) {
    const tokens = recordAt(activity.tokens, "dashboardInput.usageActivity.tokens");
    nonNegativeIntegerAt(tokens.observedResponseCount, "dashboardInput.usageActivity.tokens.observedResponseCount");
    validateTokenTotals(tokens.totals, "dashboardInput.usageActivity.tokens.totals");
    const daily = recordAt(tokens.daily, "dashboardInput.usageActivity.tokens.daily");
    for (const field of TOKEN_FIELDS) {
      numberArrayAt(daily[field], `dashboardInput.usageActivity.tokens.daily.${field}`, dates.length);
    }
  }
  return dates;
}

function validateWorkspace(value) {
  const workspace = exactKeys(value, "dashboardInput.workspace", ["id", "label"]);
  stringAt(workspace.id, "dashboardInput.workspace.id");
  stringAt(workspace.label, "dashboardInput.workspace.label");
}

function validateWindow(value, dates) {
  const window = exactKeys(value, "dashboardInput.window", ["firstDate", "lastDate", "dayCount", "truncated"]);
  nullableStringAt(window.firstDate, "dashboardInput.window.firstDate");
  nullableStringAt(window.lastDate, "dashboardInput.window.lastDate");
  nonNegativeIntegerAt(window.dayCount, "dashboardInput.window.dayCount");
  booleanAt(window.truncated, "dashboardInput.window.truncated");
  if (window.dayCount !== dates.length
    || window.firstDate !== (dates[0] ?? null)
    || window.lastDate !== (dates.at(-1) ?? null)) {
    fail("dashboardInput.window must match the dated usageActivity boundary.");
  }
}

function validateSources(value) {
  const sources = exactKeys(value, "dashboardInput.sources", [
    "sessionProviders", "assetProviders", "tokenProviders", "errors",
  ]);
  for (const key of ["sessionProviders", "assetProviders", "tokenProviders"]) {
    stringArrayAt(sources[key], `dashboardInput.sources.${key}`);
  }
  for (const [index, error] of arrayAt(sources.errors, "dashboardInput.sources.errors").entries()) {
    const row = exactKeys(error, `dashboardInput.sources.errors[${index}]`, ["source", "message"]);
    stringAt(row.source, `dashboardInput.sources.errors[${index}].source`);
    stringAt(row.message, `dashboardInput.sources.errors[${index}].message`);
  }
}

function validateNamedCounts(value, pointer) {
  for (const [index, entry] of arrayAt(value, pointer).entries()) {
    const row = exactKeys(entry, `${pointer}[${index}]`, ["name", "count"]);
    stringAt(row.name, `${pointer}[${index}].name`);
    nonNegativeNumberAt(row.count, `${pointer}[${index}].count`);
  }
}

function validateProviderBreakdown(value) {
  const keys = [
    "provider", "analyzedSessions", "eligibleSessions", "responseCount",
    "modelAttributedResponseCount", "activeMinutes", "accountingMode",
    "cacheAccountingModes", "tokenTotals", "editCount", "episodeCount",
  ];
  for (const [index, entry] of arrayAt(value, "dashboardInput.providerBreakdown").entries()) {
    const pointer = `dashboardInput.providerBreakdown[${index}]`;
    const row = exactKeys(entry, pointer, keys);
    stringAt(row.provider, `${pointer}.provider`);
    for (const key of [
      "analyzedSessions", "eligibleSessions", "responseCount", "modelAttributedResponseCount", "editCount", "episodeCount",
    ]) nonNegativeIntegerAt(row[key], `${pointer}.${key}`);
    nonNegativeNumberAt(row.activeMinutes, `${pointer}.activeMinutes`);
    stringAt(row.accountingMode, `${pointer}.accountingMode`);
    stringArrayAt(row.cacheAccountingModes, `${pointer}.cacheAccountingModes`);
    if (row.tokenTotals !== null) validateTokenTotals(row.tokenTotals, `${pointer}.tokenTotals`);
  }
}

function validateDeliverySignals(value) {
  if (value === null) return;
  const signals = exactKeys(value, "dashboardInput.deliverySignals", [
    "validationAfterEdit", "validationCommands", "episodes", "friction", "topTools", "observedHooks",
  ]);
  const validation = exactKeys(signals.validationAfterEdit, "dashboardInput.deliverySignals.validationAfterEdit", [
    "status", "editCount", "validationAfterEditCount", "relevantValidationCount",
  ]);
  stringAt(validation.status, "dashboardInput.deliverySignals.validationAfterEdit.status");
  for (const key of ["editCount", "validationAfterEditCount", "relevantValidationCount"]) {
    nonNegativeIntegerAt(validation[key], `dashboardInput.deliverySignals.validationAfterEdit.${key}`);
  }
  const episodes = exactKeys(signals.episodes, "dashboardInput.deliverySignals.episodes", [
    "episodeCount", "eligibleEpisodeCount", "closedEpisodeCount", "unobservedClosureCount",
  ]);
  for (const key of ["episodeCount", "eligibleEpisodeCount", "closedEpisodeCount", "unobservedClosureCount"]) {
    nonNegativeIntegerAt(episodes[key], `dashboardInput.deliverySignals.episodes.${key}`);
  }
  for (const key of ["validationCommands", "friction", "topTools", "observedHooks"]) {
    validateNamedCounts(signals[key], `dashboardInput.deliverySignals.${key}`);
  }
}

function validateCommitAttribution(value) {
  if (value === undefined) return;
  const commit = exactKeys(value, "dashboardInput.commitAttribution", [
    "graceMinutes", "correlatedSessionCount", "commitCount", "attributedCommits",
    "linesAdded", "linesRemoved", "attributedLinesAdded", "attributedLinesRemoved",
    "byConfidence", "byPlatform", "attributedCommitRefs",
  ]);
  for (const key of [
    "graceMinutes", "correlatedSessionCount", "commitCount", "attributedCommits",
    "linesAdded", "linesRemoved", "attributedLinesAdded", "attributedLinesRemoved",
  ]) nonNegativeNumberAt(commit[key], `dashboardInput.commitAttribution.${key}`);
  const confidence = exactKeys(commit.byConfidence, "dashboardInput.commitAttribution.byConfidence", [
    "explicit", "high", "medium", "low",
  ]);
  for (const key of ["explicit", "high", "medium", "low"]) {
    nonNegativeIntegerAt(confidence[key], `dashboardInput.commitAttribution.byConfidence.${key}`);
  }
  for (const [index, entry] of arrayAt(commit.byPlatform, "dashboardInput.commitAttribution.byPlatform").entries()) {
    const pointer = `dashboardInput.commitAttribution.byPlatform[${index}]`;
    const row = exactKeys(entry, pointer, ["platform", "commitCount"]);
    stringAt(row.platform, `${pointer}.platform`);
    nonNegativeIntegerAt(row.commitCount, `${pointer}.commitCount`);
  }
  const refs = arrayAt(commit.attributedCommitRefs, "dashboardInput.commitAttribution.attributedCommitRefs");
  // A reference exists only where an attributing match did, so more references
  // than attributed commits means the projection lost its own boundary.
  if (refs.length > commit.attributedCommits) {
    fail("dashboardInput.commitAttribution.attributedCommitRefs cannot exceed attributedCommits.");
  }
  for (const [index, entry] of refs.entries()) {
    const pointer = `dashboardInput.commitAttribution.attributedCommitRefs[${index}]`;
    const row = exactKeys(entry, pointer, ["commit", "sessionId", "platform", "confidence"]);
    identifierAt(row.commit, `${pointer}.commit`);
    identifierAt(row.sessionId, `${pointer}.sessionId`);
    nullableStringAt(row.platform, `${pointer}.platform`);
    if (!ATTRIBUTING_CONFIDENCES.includes(row.confidence)) {
      fail(`${pointer}.confidence must be an attributing confidence.`);
    }
  }
}

function validateTopology(value) {
  if (value === undefined) return;
  const topology = exactKeys(value, "dashboardInput.topology", [
    "target", "memberCount", "members", "instructionScopes", "trackedFiles",
  ]);
  stringAt(topology.target, "dashboardInput.topology.target");
  nonNegativeIntegerAt(topology.memberCount, "dashboardInput.topology.memberCount");
  nonNegativeIntegerAt(topology.trackedFiles, "dashboardInput.topology.trackedFiles");
  for (const [index, entry] of arrayAt(topology.members, "dashboardInput.topology.members").entries()) {
    const pointer = `dashboardInput.topology.members[${index}]`;
    const row = exactKeys(entry, pointer, ["route", "kind"]);
    stringAt(row.route, `${pointer}.route`);
    stringAt(row.kind, `${pointer}.kind`);
  }
  const scopes = exactKeys(topology.instructionScopes, "dashboardInput.topology.instructionScopes", [
    "total", "effective", "candidate",
  ]);
  for (const key of ["total", "effective", "candidate"]) {
    nonNegativeIntegerAt(scopes[key], `dashboardInput.topology.instructionScopes.${key}`);
  }
}

function validateContextUsage(value) {
  if (value === undefined) return;
  const context = recordAt(value, "dashboardInput.contextUsage");
  if (context.schemaVersion !== 1) fail("dashboardInput.contextUsage uses an unsupported schema version.");
  if (context.status !== "observed" && context.status !== "unobserved") {
    fail("dashboardInput.contextUsage.status is not supported.");
  }
  stringAt(context.evidence, "dashboardInput.contextUsage.evidence");
  if (context.capturedAt !== undefined) stringAt(context.capturedAt, "dashboardInput.contextUsage.capturedAt");
  for (const key of ["totalTokensUsed", "contextWindowSize", "percentFull"]) {
    if (context[key] !== undefined) nonNegativeNumberAt(context[key], `dashboardInput.contextUsage.${key}`);
  }
  for (const [index, entry] of arrayAt(context.categories, "dashboardInput.contextUsage.categories").entries()) {
    const pointer = `dashboardInput.contextUsage.categories[${index}]`;
    const category = recordAt(entry, pointer);
    stringAt(category.id, `${pointer}.id`);
    stringAt(category.label, `${pointer}.label`);
    nonNegativeNumberAt(category.estimatedTokens, `${pointer}.estimatedTokens`);
  }
  for (const [index, entry] of arrayAt(context.items, "dashboardInput.contextUsage.items").entries()) {
    const pointer = `dashboardInput.contextUsage.items[${index}]`;
    const item = recordAt(entry, pointer);
    stringAt(item.id, `${pointer}.id`);
    stringAt(item.categoryId, `${pointer}.categoryId`);
    stringAt(item.label, `${pointer}.label`);
    nonNegativeNumberAt(item.estimatedTokens, `${pointer}.estimatedTokens`);
    nonNegativeNumberAt(item.characterCount, `${pointer}.characterCount`);
  }
  const coverage = recordAt(context.coverage, "dashboardInput.contextUsage.coverage");
  nonNegativeIntegerAt(coverage.itemCount, "dashboardInput.contextUsage.coverage.itemCount");
  nonNegativeIntegerAt(coverage.sourceItemCount, "dashboardInput.contextUsage.coverage.sourceItemCount");
  booleanAt(coverage.truncated, "dashboardInput.contextUsage.coverage.truncated");
  if (coverage.rawTextOmitted !== true) fail("dashboardInput.contextUsage.coverage.rawTextOmitted must be true.");
  const actions = recordAt(context.actions, "dashboardInput.contextUsage.actions");
  if (actions.openAgentId !== null) stringAt(actions.openAgentId, "dashboardInput.contextUsage.actions.openAgentId");
}

function validateAssetInventories(value) {
  for (const [index, report] of arrayAt(value, "dashboardInput.assetInventories").entries()) {
    const pointer = `dashboardInput.assetInventories[${index}]`;
    const object = recordAt(report, pointer);
    if (object.kind !== "agent-lint" || object.profile !== "agent-assets-review") {
      fail(`${pointer} uses an unsupported report kind or profile.`);
    }
    const inventory = recordAt(object.assetInventory, `${pointer}.assetInventory`);
    stringAt(inventory.provider, `${pointer}.assetInventory.provider`);
    const summary = exactKeys(inventory.summary, `${pointer}.assetInventory.summary`, [
      "skills", "mcps", "commands", "hooks", "rules", "agents", "plugins",
    ]);
    for (const key of ["skills", "mcps", "commands", "hooks", "rules", "agents", "plugins"]) {
      nonNegativeIntegerAt(summary[key], `${pointer}.assetInventory.summary.${key}`);
    }
    if (inventory.assets !== undefined) {
      for (const [assetIndex, asset] of arrayAt(inventory.assets, `${pointer}.assetInventory.assets`).entries()) {
        const assetPointer = `${pointer}.assetInventory.assets[${assetIndex}]`;
        const identity = recordAt(asset, assetPointer);
        stringAt(identity.kind, `${assetPointer}.kind`);
        stringAt(identity.id, `${assetPointer}.id`);
        stringAt(identity.name, `${assetPointer}.name`);
        stringAt(identity.scope, `${assetPointer}.scope`);
        // Absent means the host declared none. Present but empty would claim a
        // revision the host never recorded, so it is rejected rather than kept.
        for (const field of ["revision", "publisher"]) {
          if (identity[field] === undefined) continue;
          if (stringAt(identity[field], `${assetPointer}.${field}`).trim() === "") {
            fail(`${assetPointer}.${field} must be omitted when the host declared none.`);
          }
        }
      }
    }
    if (inventory.assetsTruncated !== undefined) booleanAt(inventory.assetsTruncated, `${pointer}.assetInventory.assetsTruncated`);
    arrayAt(object.findings, `${pointer}.findings`);
  }
}

function validateEvidenceDeliveries(value) {
  const deliveries = exactKeys(value, "dashboardInput.evidenceDeliveries", ["items", "total", "truncated"]);
  const items = arrayAt(deliveries.items, "dashboardInput.evidenceDeliveries.items");
  nonNegativeIntegerAt(deliveries.total, "dashboardInput.evidenceDeliveries.total");
  booleanAt(deliveries.truncated, "dashboardInput.evidenceDeliveries.truncated");
  if (deliveries.total < items.length) fail("dashboardInput.evidenceDeliveries.total cannot be smaller than items.length.");
  for (const [index, delivery] of items.entries()) {
    const pointer = `dashboardInput.evidenceDeliveries.items[${index}]`;
    const row = exactKeys(delivery, pointer, [
      "organization", "endpoint", "acceptedAt", "receiptState", "packetDigest", "packetBytes", "packet",
    ]);
    for (const key of ["organization", "endpoint", "acceptedAt", "receiptState", "packetDigest"]) {
      stringAt(row[key], `${pointer}.${key}`);
    }
    nonNegativeIntegerAt(row.packetBytes, `${pointer}.packetBytes`);
    const packet = recordAt(row.packet, `dashboardInput.evidenceDeliveries.items[${index}].packet`);
    if (packet.kind !== "better-harness.task-evidence-packet" || packet.schemaVersion !== 1) {
      fail(`dashboardInput.evidenceDeliveries.items[${index}].packet uses an unsupported kind or schema version.`);
    }
    try {
      validateTaskEvidencePacket(packet);
    } catch (error) {
      fail(`${pointer}.packet is invalid: ${error?.message ?? String(error)}`);
    }
  }
}

export function validateDashboardInputV1(value) {
  const input = exactKeys(
    value,
    "dashboardInput",
    REQUIRED_TOP_LEVEL_KEYS,
    OPTIONAL_TOP_LEVEL_KEYS,
  );
  if (input.kind !== DASHBOARD_INPUT_KIND || input.schemaVersion !== DASHBOARD_INPUT_SCHEMA_VERSION) {
    fail("dashboardInput uses an unsupported kind or schema version.");
  }
  const generatedAt = stringAt(input.generatedAt, "dashboardInput.generatedAt");
  if (Number.isNaN(Date.parse(generatedAt)) || new Date(generatedAt).toISOString() !== generatedAt) {
    fail("dashboardInput.generatedAt must be an ISO 8601 UTC timestamp.");
  }
  validateWorkspace(input.workspace);
  validateSources(input.sources);
  validateUsageSummary(input.usageSummary);
  const dates = validateUsageActivity(input.usageActivity);
  validateWindow(input.window, dates);
  validateProviderBreakdown(input.providerBreakdown);
  validateDeliverySignals(input.deliverySignals);
  validateCommitAttribution(input.commitAttribution);
  validateTopology(input.topology);
  validateContextUsage(input.contextUsage);
  validateAssetInventories(input.assetInventories);
  validateEvidenceDeliveries(input.evidenceDeliveries);
  return input;
}

export function parseDashboardInputV1(source) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    fail("Dashboard collector stdout must be one valid JSON document.");
  }
  return validateDashboardInputV1(parsed);
}

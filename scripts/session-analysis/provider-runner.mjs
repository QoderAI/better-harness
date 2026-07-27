import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { parseBooleanFlag } from "./cli.mjs";
import { buildFileReadDiagnostics } from "./file-reads.mjs";
import { buildInsightPack } from "./insights.mjs";
import { topLifecycleDemandSignals } from "./lifecycle-demand-signals.mjs";
import { buildLongSessionFacet } from "./long-sessions.mjs";
import { topPlanningSignals } from "./planning-signals.mjs";
import { selectSessions, selectionSummary } from "./selection.mjs";
import { collectSessionSelectionEntries, selectSessionEntriesWithPlan } from "./selection-plan.mjs";
import {
  buildSessionCoreFacts,
  createFactsRunContext,
  factsHydrationLimit,
  prepareFactsSessionInventory,
} from "./session-core-facts.mjs";
import { mergeTimeRange, timestampMillis } from "./time.mjs";

const DEFAULT_LIMIT = 50;

export function publicScope(scope = {}) {
  return Object.fromEntries(
    Object.entries(scope).filter(([key]) => !key.endsWith("Time") && key !== "raw" && !key.startsWith("_")),
  );
}

export function publicSource(root = {}) {
  return {
    id: root.id,
    kind: root.kind,
    role: root.role,
    path: root.path,
    exists: root.exists,
    enabled: root.enabled,
    optional: root.optional,
    workspaceScoped: root.workspaceScoped,
    ...(root.coverage ? { coverage: root.coverage } : {}),
  };
}

export function sourceWarnings(roots = []) {
  return [
    ...roots
      .filter((root) => root.enabled && !root.optional && !root.exists)
      .map((root) => ({
        code: "missing-required-root",
        message: `${root.kind} root does not exist: ${root.path}`,
        source: root.id,
      })),
    ...roots
      .filter((root) => root.enabled && root.optional && !root.exists)
      .map((root) => ({
        code: "missing-optional-root",
        message: `${root.kind} root does not exist: ${root.path}`,
        source: root.id,
      })),
    ...roots
      .filter((root) => !root.enabled)
      .map((root) => ({
        code: "disabled-source-root",
        message: root.disabledHint ? `${root.kind} root is disabled; ${root.disabledHint}` : `${root.kind} root is disabled`,
        source: root.id,
      })),
    ...roots.flatMap((root) => Array.isArray(root.warnings) ? root.warnings : []),
  ];
}

function filterSessionsByScope(sessions, scope) {
  return sessions.filter((session) => {
    if (scope.sessionId && session.sessionId !== scope.sessionId) return false;
    if (scope.sinceTime !== null && session.lastSeen && timestampMillis(session.lastSeen) < scope.sinceTime) return false;
    if (scope.untilTime !== null && session.firstSeen && timestampMillis(session.firstSeen) > scope.untilTime) return false;
    return true;
  });
}

function topEntries(events, values, limit = 20) {
  const groups = new Map();
  for (const event of events) {
    for (const value of values(event)) {
      if (!value) continue;
      const key = String(value);
      const group = groups.get(key) ?? { name: key, count: 0, evidenceRefs: [] };
      group.count += 1;
      if (event.evidenceRef && group.evidenceRefs.length < 5) group.evidenceRefs.push(event.evidenceRef);
      groups.set(key, group);
    }
  }
  return [...groups.values()]
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, limit);
}

function countMessages(events) {
  const counts = new Map();
  for (const event of events) {
    if (!["user", "assistant", "last-prompt", "message"].includes(event.type)) continue;
    counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
}

export function buildProviderFacets({ indexedSessions = [], detailedSessions = [], events = [], platform }) {
  const sourceCoverage = {};
  for (const session of indexedSessions) {
    for (const kind of session.sourceKinds ?? []) sourceCoverage[kind] = (sourceCoverage[kind] ?? 0) + 1;
  }
  const timeRange = { firstSeen: null, lastSeen: null };
  for (const session of detailedSessions.length > 0 ? detailedSessions : indexedSessions) {
    mergeTimeRange(timeRange, session.firstSeen);
    mergeTimeRange(timeRange, session.lastSeen);
  }
  const executionEvents = events.filter((event) => event.lifecyclePhase !== "pre");
  return {
    sessionCount: indexedSessions.length,
    analyzedSessionCount: detailedSessions.length,
    sourceCoverage,
    timeRange,
    messageCounts: countMessages(events),
    topEventTypes: topEntries(executionEvents, (event) => [event.type]),
    topTools: topEntries(executionEvents, (event) => [event.toolName]),
    topHooks: topEntries(executionEvents, (event) => [event.hookName]),
    topHookCommands: topEntries(executionEvents, (event) => [event.hookName && event.hookCommand
      ? `${event.hookName} -> ${event.hookCommand}`
      : null]),
    topSkills: topEntries(executionEvents, (event) => event.skillNames ?? (event.skillName ? [event.skillName] : [])),
    topFunctionCalls: topEntries(executionEvents, (event) => [event.functionCallName]),
    inferredSkillReads: topEntries(executionEvents, (event) => [event.skillReadName]),
    topModels: topEntries(executionEvents, (event) => [event.model]),
    planningSignals: topPlanningSignals(events, { platform }),
    lifecycleDemandSignals: topLifecycleDemandSignals(events, { platform }),
    longSessions: buildLongSessionFacet(detailedSessions, events),
  };
}

async function pricingTable(options) {
  if (!options["pricing-table"]) return undefined;
  return JSON.parse(await readFile(path.resolve(options["pricing-table"]), "utf8"));
}

export async function runProviderAnalysis(analyzer, options = {}, config = {}) {
  const platform = config.platform ?? "unknown";
  const adapterVersion = config.adapterVersion ?? `${platform}-v1`;
  const factsMode = options.command === "facts";
  const factsContext = factsMode
    ? createFactsRunContext(options, platform, typeof analyzer.currentSessionId === "function" ? analyzer.currentSessionId() : null)
    : null;
  if (factsContext) options = factsContext.options;
  const scope = await analyzer.resolveScope(options);
  const roots = await analyzer.discoverSourceRoots(scope);
  const discovered = Array.isArray(options.sessionInventory)
    ? filterSessionsByScope(options.sessionInventory, scope)
    : filterSessionsByScope(await analyzer.discoverSessions(scope, roots), scope);
  const factsInventory = factsMode
    ? prepareFactsSessionInventory(discovered, factsContext)
    : { sessions: discovered, omitted: {} };
  const sessions = factsInventory.sessions;
  const warnings = [
    ...sourceWarnings(roots),
    ...(typeof analyzer.analysisWarnings === "function" ? await analyzer.analysisWarnings(scope, roots, sessions) : []),
  ];
  const resultBase = {
    scope: publicScope(scope),
    sources: roots.map(publicSource),
    sessions,
    facets: null,
    warnings,
  };
  if (options.command === "sources") return resultBase;
  if (options.command === "sessions") {
    const limit = options.limit === undefined ? null : Number(options.limit);
    return { ...resultBase, sessions: Number.isFinite(limit) ? sessions.slice(0, limit) : sessions };
  }

  const insightMode = options.command === "insights";
  const fileReadMode = options.command === "file-reads";
  const eventOptions = factsMode
    ? { ...options, includeCommandText: true, includeUserText: true, includeContent: false }
    : options.command === "facets" || insightMode || fileReadMode
      ? { ...options, includeCommandText: true, includeUserText: true, includeContent: true }
      : options;
  const selectionEntries = !factsMode && (options.selectionEntries ?? (options.selectionPlan
    ? await collectSessionSelectionEntries({
        analyzer,
        sessions,
        scope,
        concurrency: options.selectionConcurrency ?? options["selection-concurrency"] ?? 4,
      })
    : null));
  const selection = !factsMode && options.selectionPlan
    ? selectSessionEntriesWithPlan(selectionEntries, options.selectionPlan)
    : selectSessions(sessions, {
        limit: factsMode ? factsHydrationLimit(options.limit) : options.limit,
        strategy: factsMode ? options.selection ?? "stratified" : options.selection,
        defaultLimit: factsMode ? 5 : DEFAULT_LIMIT,
      });
  const detailedSessions = [];
  const events = [];
  for (const session of selection.sessions) {
    const sessionEvents = await analyzer.readSession(session, scope, eventOptions);
    events.push(...sessionEvents);
    detailedSessions.push(analyzer.mergeSession(sessionEvents, session));
  }
  if (factsMode) {
    const sourceCoverage = typeof analyzer.factsSourceCoverage === "function"
      ? await analyzer.factsSourceCoverage(scope, {
          roots,
          discoveredSessions: discovered,
          eligibleSessions: sessions,
          selectedSessions: selection.sessions,
          events,
          warnings,
        })
      : null;
    return buildSessionCoreFacts({
      scope,
      events,
      selection,
      warnings,
      omitted: factsInventory.omitted,
      episodeLimit: options["episode-limit"] ?? options.episodeLimit ?? options.limit,
      debug: parseBooleanFlag(options.debug ?? false),
      sourceCoverage,
    });
  }
  if (fileReadMode) {
    return {
      ...resultBase,
      sessions: detailedSessions,
      selection: selectionSummary(selection),
      fileReads: buildFileReadDiagnostics({
        scope: publicScope(scope),
        indexedSessions: sessions,
        sessions: detailedSessions,
        warnings,
        events,
        selectionStrategy: selection.strategy,
        selectionStrata: selection.strata,
        adapterVersion,
      }),
    };
  }
  const facets = buildProviderFacets({ indexedSessions: sessions, detailedSessions, events, platform });
  if (insightMode) {
    return {
      ...resultBase,
      sessions: detailedSessions,
      selection: selectionSummary(selection),
      facets,
      insights: buildInsightPack({
        scope: publicScope(scope),
        sources: roots.map(publicSource),
        sessions: detailedSessions,
        facets,
        warnings,
        events,
        selectionStrategy: selection.strategy,
        selectionStrata: selection.strata,
        adapterVersion,
        usageOptions: { pricingTable: await pricingTable(options) },
      }),
    };
  }
  return { ...resultBase, sessions: detailedSessions, selection: selectionSummary(selection), facets };
}

function filterEvents(result, type) {
  if (!type) return result;
  return {
    ...result,
    sessions: result.sessions.map((session) => ({
      ...session,
      events: (session.events ?? []).filter((event) => event.type === type),
    })),
  };
}

export async function runProviderCommand(analyzer, command, options = {}) {
  const commandOptions = { ...options, command };
  if (command === "show" || command === "events") {
    commandOptions["session-id"] = options["session-id"] ?? options._?.[0] ?? null;
    if (!commandOptions["session-id"]) throw new Error(`${command} requires --session-id <id>`);
  }
  if (["sources", "sessions", "facets", "insights", "facts", "file-reads"].includes(command)) {
    return analyzer.analyze(commandOptions);
  }
  if (command === "show" || command === "events") {
    const index = await analyzer.analyze({ ...commandOptions, command: "sessions", limit: 1 });
    const scope = await analyzer.resolveScope(commandOptions);
    const sessions = [];
    for (const session of index.sessions) {
      const events = await analyzer.readSession(session, scope, commandOptions);
      sessions.push({
        ...analyzer.mergeSession(events, session),
        events: command === "show" && !parseBooleanFlag(options["include-events"] ?? false) ? undefined : events,
      });
    }
    return command === "events" ? filterEvents({ ...index, sessions }, options.type) : { ...index, sessions };
  }
  throw new Error(`Unknown command: ${command}`);
}

export function formatProviderMarkdown(provider, command, result) {
  if (result?.kind === "session-core-facts") {
    const lines = ["# Session Core Facts", "", `Candidates: ${result.candidates.length}`];
    for (const candidate of result.candidates) lines.push(`- ${candidate.ref}: ${candidate.request.summary}`);
    return `${lines.join("\n")}\n`;
  }
  const lines = [`# ${provider} Session Analysis: ${command}`, "", `Workspace: ${result.scope.workspace}`, "",
    `Sources: ${result.sources.length}`, `Sessions: ${result.sessions.length}`];
  if (result.facets) lines.push(`Analyzed sessions: ${result.facets.analyzedSessionCount}`);
  if (result.insights) lines.push(`Insight cards: ${result.insights.cards.length}`);
  if (result.fileReads) lines.push(`File access events: ${result.fileReads.sample.fileAccessCount}`);
  if (result.warnings.length > 0) {
    lines.push("", "## Warnings");
    for (const warning of result.warnings) lines.push(`- ${warning.code}: ${warning.message}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function emitProviderResult({ provider, command, options, result }) {
  const format = options.format ?? "json";
  const output = format === "markdown" || format === "md"
    ? formatProviderMarkdown(provider, command, result)
    : format === "json"
      ? command === "facts" ? `${JSON.stringify(result)}\n` : `${JSON.stringify(result, null, 2)}\n`
      : null;
  if (output === null) throw new Error(`Unsupported format: ${format}`);
  if (typeof options.output === "string" && options.output.trim()) {
    const outputPath = path.resolve(options.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output);
    process.stdout.write(`${JSON.stringify({ ok: true, output: outputPath, format })}\n`);
    return;
  }
  process.stdout.write(output);
}

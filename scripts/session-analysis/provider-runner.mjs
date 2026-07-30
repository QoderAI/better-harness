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
import {
  WORKSPACE_CWD_MATCH,
  WORKSPACE_SESSION_MATCH,
  classifyWorkspaceCwd,
  qualifyWorkspaceSession,
  summarizeWorkspaceQualifications,
  validateWorkspaceMatchTopology,
} from "./workspace-match.mjs";

const DEFAULT_LIMIT = 50;
const DEFAULT_WORKSPACE_PREFLIGHT_MAX_LINES = 2_000;
const DEFAULT_WORKSPACE_PATH_FACT_LIMIT = 2_000;
const SESSION_WORKSPACE_CWDS = Symbol("session-workspace-cwds");
const SESSION_READ_COVERAGE = Symbol("session-read-coverage");

function boundedPositiveInteger(value, fallback, maximum = 20_000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(maximum, Math.max(1, Math.trunc(parsed)));
}

function workspacePreflightMaxLines(options = {}) {
  return boundedPositiveInteger(
    options.workspacePreflightMaxLines ?? options["workspace-preflight-max-lines"],
    DEFAULT_WORKSPACE_PREFLIGHT_MAX_LINES,
  );
}

function workspacePathFactLimit(options = {}) {
  return boundedPositiveInteger(
    options.workspacePathFactLimit ?? options["workspace-path-fact-limit"],
    DEFAULT_WORKSPACE_PATH_FACT_LIMIT,
  );
}

function fullHydrationEventOptions(options = {}) {
  const hydrationOptions = { ...options };
  delete hydrationOptions.workspacePreflightMaxLines;
  delete hydrationOptions["workspace-preflight-max-lines"];
  return hydrationOptions;
}

export function workspaceMatchScopeFromOptions(options = {}) {
  return options.topology ? validateWorkspaceMatchTopology(options.topology) : null;
}

export function bindSessionWorkspaceCwds(session, candidates = []) {
  if (!session || typeof session !== "object") return session;
  const values = [...new Set(
    (Array.isArray(candidates) ? candidates : [candidates])
      .filter((candidate) => typeof candidate === "string" && candidate.length > 0),
  )];
  Object.defineProperty(session, SESSION_WORKSPACE_CWDS, {
    configurable: true,
    enumerable: false,
    value: Object.freeze(values),
  });
  return session;
}

export function sessionWorkspaceCwds(session) {
  const bound = session?.[SESSION_WORKSPACE_CWDS];
  if (Array.isArray(bound) && bound.length > 0) return bound;
  const explicit = session?.workspaceCwd ?? session?.cwd;
  return typeof explicit === "string" && explicit.length > 0 ? [explicit] : [];
}

export function sessionWorkspaceCwd(session, workspaceScope) {
  if (!workspaceScope) return sessionWorkspaceCwds(session)[0] ?? null;
  if (session?.workspaceMatch === WORKSPACE_SESSION_MATCH.DIRECT_CWD) {
    return workspaceScope.requestedWorkspace;
  }
  if (session?.workspaceMatch === WORKSPACE_SESSION_MATCH.ROOT_CWD) {
    return workspaceScope.gitRoot;
  }
  const candidates = sessionWorkspaceCwds(session);
  if (candidates.length === 0) return null;
  const matches = new Set(candidates.map((candidate) => classifyWorkspaceCwd(candidate, workspaceScope)));
  if (matches.size !== 1) return null;
  const [match] = matches;
  if (match === WORKSPACE_CWD_MATCH.DIRECT) return workspaceScope.requestedWorkspace;
  if (match === WORKSPACE_CWD_MATCH.ROOT_CANDIDATE) return workspaceScope.gitRoot;
  return candidates.length === 1 ? candidates[0] : null;
}

export function markSessionReadCoverage(events, { truncated = false } = {}) {
  if (!Array.isArray(events)) return events;
  Object.defineProperty(events, SESSION_READ_COVERAGE, {
    configurable: true,
    enumerable: false,
    value: Object.freeze({ truncated: truncated === true }),
  });
  return events;
}

function sessionReadCoverage(events) {
  return events?.[SESSION_READ_COVERAGE] ?? null;
}

function trustedPathFacts(events = [], limit = DEFAULT_WORKSPACE_PATH_FACT_LIMIT) {
  const pathFacts = [];
  let truncated = false;
  for (const event of events) {
    const paths = [
      event?.filePath,
      ...(Array.isArray(event?.targetPaths) ? event.targetPaths : []),
      ...(Array.isArray(event?.affectedPaths) ? event.affectedPaths : []),
    ];
    for (const candidate of paths) {
      if (typeof candidate !== "string" || candidate.length === 0) continue;
      if (pathFacts.length >= limit) {
        truncated = true;
        break;
      }
      pathFacts.push(event?.cwd ? { path: candidate, cwd: event.cwd } : { path: candidate });
    }
    if (truncated) break;
  }
  return { pathFacts, truncated };
}

async function readWorkspacePreflight(analyzer, session, scope, options) {
  const maxLines = workspacePreflightMaxLines(options);
  const readOptions = {
    ...options,
    includeCommandText: false,
    includeUserText: false,
    includeContent: false,
    "include-command-text": false,
    "include-user-text": false,
    "include-content": false,
    workspacePreflightMaxLines: maxLines,
  };
  const read = typeof analyzer.readWorkspacePreflight === "function"
    ? await analyzer.readWorkspacePreflight(session, scope, readOptions)
    : await analyzer.readSession(session, scope, readOptions);
  if (Array.isArray(read)) {
    const coverage = sessionReadCoverage(read);
    return { events: read, truncated: coverage ? coverage.truncated : true };
  }
  return {
    events: Array.isArray(read?.events) ? read.events : [],
    truncated: read?.truncated === true
      || (read?.truncated !== false && !sessionReadCoverage(read?.events))
      || sessionReadCoverage(read?.events)?.truncated === true,
  };
}

function admittedSession(session, qualification) {
  const admitted = {
    ...session,
    workspaceMatch: qualification.workspaceMatch,
  };
  return bindSessionWorkspaceCwds(admitted, sessionWorkspaceCwds(session));
}

export async function qualifyWorkspaceSessionInventory({
  analyzer,
  sessions = [],
  scope,
  options = {},
} = {}) {
  const workspaceScope = scope?._workspaceMatchScope ?? null;
  if (!workspaceScope) {
    return {
      enabled: false,
      sessions,
      qualifications: [],
      workspaceScope: null,
    };
  }

  const admitted = [];
  const qualifications = [];
  const pathFactLimit = workspacePathFactLimit(options);
  for (const session of sessions) {
    const cwd = sessionWorkspaceCwd(session, workspaceScope);
    const cwdMatch = classifyWorkspaceCwd(cwd, workspaceScope);
    let qualification;
    if (cwdMatch === WORKSPACE_CWD_MATCH.ROOT_CANDIDATE) {
      const preflight = await readWorkspacePreflight(analyzer, session, scope, options);
      const facts = trustedPathFacts(preflight.events, pathFactLimit);
      qualification = qualifyWorkspaceSession({
        cwd,
        pathFacts: facts.pathFacts,
        truncated: preflight.truncated || facts.truncated,
      }, workspaceScope);
    } else {
      qualification = qualifyWorkspaceSession({ cwd }, workspaceScope);
    }
    qualifications.push(qualification);
    if (qualification.qualified) admitted.push(admittedSession(session, qualification));
  }

  return {
    enabled: true,
    sessions: admitted,
    qualifications,
    workspaceScope,
  };
}

export function recheckHydratedWorkspaceSession(session, events, workspaceRun, options = {}) {
  if (!workspaceRun?.enabled) return null;
  if (session?.workspaceMatch === WORKSPACE_SESSION_MATCH.DIRECT_CWD) {
    return qualifyWorkspaceSession({ cwd: workspaceRun.workspaceScope.requestedWorkspace }, workspaceRun.workspaceScope);
  }
  const facts = trustedPathFacts(events, workspacePathFactLimit(options));
  const cwd = sessionWorkspaceCwd(session, workspaceRun.workspaceScope);
  const readCoverage = sessionReadCoverage(events);
  return qualifyWorkspaceSession({
    cwd,
    pathFacts: facts.pathFacts,
    truncated: facts.truncated || !readCoverage || readCoverage.truncated,
  }, workspaceRun.workspaceScope);
}

export function workspaceQualifiedSelectionEntries(entries, sessions, workspaceRun) {
  if (!workspaceRun?.enabled || !Array.isArray(entries)) return entries;
  const eligibleIds = new Set(sessions.map((session) => session?.sessionId).filter(Boolean));
  const reconciled = entries.filter((entry) => eligibleIds.has(entry?.session?.sessionId));
  if (reconciled.length !== entries.length || reconciled.length !== sessions.length) {
    throw Object.assign(new Error("session selection entries do not match the qualified workspace population"), {
      code: "SESSION_SELECTION_WORKSPACE_POPULATION_DRIFT",
    });
  }
  return reconciled;
}

export async function hydrateWorkspaceSelection({
  analyzer,
  selection,
  scope,
  eventOptions = {},
  workspaceRun,
  options = {},
} = {}) {
  const selectedSessions = selection?.sessions ?? [];
  const admittedSessions = [];
  const detailedSessions = [];
  const events = [];
  const hydrationQualifications = [];
  for (const session of selectedSessions) {
    const sessionEvents = await analyzer.readSession(session, scope, eventOptions);
    const qualification = recheckHydratedWorkspaceSession(session, sessionEvents, workspaceRun, options);
    if (qualification && session.workspaceMatch === WORKSPACE_SESSION_MATCH.ROOT_CWD) {
      hydrationQualifications.push(qualification);
    }
    if (qualification && !qualification.qualified) continue;
    admittedSessions.push(session);
    for (const event of sessionEvents) {
      events.push(event);
    }
    detailedSessions.push(analyzer.mergeSession(sessionEvents, session));
  }
  const effectiveSelection = workspaceRun?.enabled && admittedSessions.length !== selectedSessions.length
    ? {
        ...selection,
        sessions: admittedSessions,
        analyzedCount: admittedSessions.length,
      }
    : selection;
  return { selection: effectiveSelection, detailedSessions, events, hydrationQualifications };
}

export function workspaceMatchDiagnostics(workspaceRun, hydrationQualifications = []) {
  if (!workspaceRun?.enabled) return null;
  return Object.freeze({
    kind: "better-harness.session-workspace-match",
    schemaVersion: 1,
    preflight: summarizeWorkspaceQualifications(workspaceRun.qualifications),
    hydration: summarizeWorkspaceQualifications(hydrationQualifications),
  });
}

export function withWorkspaceMatchDiagnostics(result, workspaceRun, hydrationQualifications = []) {
  const diagnostics = workspaceMatchDiagnostics(workspaceRun, hydrationQualifications);
  return diagnostics ? { ...result, sessionWorkspaceMatch: diagnostics } : result;
}

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
  const workspaceRun = await qualifyWorkspaceSessionInventory({
    analyzer,
    sessions: discovered,
    scope,
    options,
  });
  const qualifiedSessions = workspaceRun.sessions;
  const factsInventory = factsMode
    ? prepareFactsSessionInventory(qualifiedSessions, factsContext)
    : { sessions: qualifiedSessions, omitted: {} };
  const sessions = factsInventory.sessions;
  const warnings = [
    ...sourceWarnings(roots),
    ...(typeof analyzer.analysisWarnings === "function" ? await analyzer.analysisWarnings(scope, roots, sessions) : []),
  ];
  const resultBase = withWorkspaceMatchDiagnostics({
    scope: publicScope(scope),
    sources: roots.map(publicSource),
    sessions,
    facets: null,
    warnings,
  }, workspaceRun);
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
  const suppliedSelectionEntries = workspaceQualifiedSelectionEntries(
    options.selectionEntries,
    sessions,
    workspaceRun,
  );
  const selectionEntries = !factsMode && (suppliedSelectionEntries ?? (options.selectionPlan
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
  const hydration = await hydrateWorkspaceSelection({
    analyzer,
    selection,
    scope,
    eventOptions: fullHydrationEventOptions(eventOptions),
    workspaceRun,
    options,
  });
  const effectiveSelection = hydration.selection;
  const detailedSessions = hydration.detailedSessions;
  const events = hydration.events;
  if (factsMode) {
    const sourceCoverage = typeof analyzer.factsSourceCoverage === "function"
      ? await analyzer.factsSourceCoverage(scope, {
          roots,
          discoveredSessions: discovered,
          eligibleSessions: sessions,
          selectedSessions: effectiveSelection.sessions,
          events,
          warnings,
        })
      : null;
    return withWorkspaceMatchDiagnostics(buildSessionCoreFacts({
      scope,
      events,
      selection: effectiveSelection,
      warnings,
      omitted: factsInventory.omitted,
      episodeLimit: options["episode-limit"] ?? options.episodeLimit ?? options.limit,
      debug: parseBooleanFlag(options.debug ?? false),
      sourceCoverage,
    }), workspaceRun, hydration.hydrationQualifications);
  }
  if (fileReadMode) {
    return withWorkspaceMatchDiagnostics({
      ...resultBase,
      sessions: detailedSessions,
      selection: selectionSummary(effectiveSelection),
      fileReads: buildFileReadDiagnostics({
        scope: publicScope(scope),
        indexedSessions: sessions,
        sessions: detailedSessions,
        warnings,
        events,
        selectionStrategy: effectiveSelection.strategy,
        selectionStrata: effectiveSelection.strata,
        adapterVersion,
      }),
    }, workspaceRun, hydration.hydrationQualifications);
  }
  const facets = buildProviderFacets({ indexedSessions: sessions, detailedSessions, events, platform });
  if (insightMode) {
    return withWorkspaceMatchDiagnostics({
      ...resultBase,
      sessions: detailedSessions,
      selection: selectionSummary(effectiveSelection),
      facets,
      insights: buildInsightPack({
        scope: publicScope(scope),
        sources: roots.map(publicSource),
        sessions: detailedSessions,
        facets,
        warnings,
        events,
        selectionStrategy: effectiveSelection.strategy,
        selectionStrata: effectiveSelection.strata,
        adapterVersion,
        usageOptions: { pricingTable: await pricingTable(options) },
      }),
    }, workspaceRun, hydration.hydrationQualifications);
  }
  return withWorkspaceMatchDiagnostics({
    ...resultBase,
    sessions: detailedSessions,
    selection: selectionSummary(effectiveSelection),
    facets,
  }, workspaceRun, hydration.hydrationQualifications);
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
    const workspaceRun = {
      enabled: Boolean(scope._workspaceMatchScope),
      workspaceScope: scope._workspaceMatchScope ?? null,
    };
    const sessions = [];
    const hydrationQualifications = [];
    const eventOptions = fullHydrationEventOptions(commandOptions);
    for (const session of index.sessions) {
      const events = await analyzer.readSession(session, scope, eventOptions);
      const qualification = recheckHydratedWorkspaceSession(session, events, workspaceRun, commandOptions);
      if (qualification && session.workspaceMatch === WORKSPACE_SESSION_MATCH.ROOT_CWD) {
        hydrationQualifications.push(qualification);
      }
      if (qualification && !qualification.qualified) continue;
      sessions.push({
        ...analyzer.mergeSession(events, session),
        events: command === "show" && !parseBooleanFlag(options["include-events"] ?? false) ? undefined : events,
      });
    }
    const result = index.sessionWorkspaceMatch
      ? {
          ...index,
          sessions,
          sessionWorkspaceMatch: {
            ...index.sessionWorkspaceMatch,
            hydration: summarizeWorkspaceQualifications(hydrationQualifications),
          },
        }
      : { ...index, sessions };
    return command === "events" ? filterEvents(result, options.type) : result;
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

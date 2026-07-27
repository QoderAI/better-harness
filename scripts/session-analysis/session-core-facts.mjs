import path from "node:path";

import { buildTaskEpisodes } from "./episode-contract.mjs";
import { finalizeSessionCoreFacts } from "./episode-facts.mjs";

const DEFAULT_ACTIVE_WINDOW_MS = 60_000;
const MIN_FACT_SESSION_POOL = 12;
const MAX_FACT_SESSION_POOL = 40;

export function factsHydrationLimit(value) {
  const requested = Number(value ?? 5);
  const bounded = Number.isFinite(requested) ? Math.max(1, Math.min(5, Math.trunc(requested))) : 5;
  return Math.min(MAX_FACT_SESSION_POOL, Math.max(MIN_FACT_SESSION_POOL, bounded * 8));
}

export function createFactsRunContext(options = {}, platform = "unknown", providerSessionId = null) {
  const startedAt = Number(options._factsStartedAt ?? Date.now());
  const suppliedUntil = options.until !== undefined && options.until !== null && options.until !== "";
  const environmentSessionId = providerSessionId ?? ({
    codex: process.env.CODEX_THREAD_ID,
    qoder: process.env.QODER_SESSION_ID,
    claude: process.env.CLAUDE_SESSION_ID,
    cursor: process.env.CURSOR_SESSION_ID,
  })[platform];
  const excludedSessionId = String(
    options["exclude-session-id"] ?? options.excludeSessionId ?? environmentSessionId ?? "",
  ).trim() || null;
  const activeWindowValue = Number(
    options["exclude-active-window-ms"]
      ?? options.excludeActiveWindowMs
      ?? DEFAULT_ACTIVE_WINDOW_MS,
  );
  const activeWindowMs = Number.isFinite(activeWindowValue) && activeWindowValue >= 0
    ? activeWindowValue
    : DEFAULT_ACTIVE_WINDOW_MS;

  return {
    options: {
      ...options,
      until: suppliedUntil ? options.until : new Date(startedAt).toISOString(),
      _factsStartedAt: startedAt,
    },
    startedAt,
    suppliedUntil,
    excludedSessionId,
    activeWindowMs,
    platform,
  };
}

export function prepareFactsSessionInventory(sessions = [], context = {}) {
  const omitted = { activeSessions: 0, homeSessionOnly: 0 };
  const prepared = [];

  for (const sourceSession of sessions) {
    let session = sourceSession;
    if (context.platform === "qoder") {
      const refs = (sourceSession?.sourceRefs ?? []).filter((reference) => reference?.kind !== "home-session");
      if (refs.length === 0) {
        omitted.homeSessionOnly += 1;
        continue;
      }
      session = { ...sourceSession, sourceRefs: refs };
    }

    if (context.excludedSessionId
      && String(session?.sessionId ?? "") === context.excludedSessionId) {
      omitted.activeSessions += 1;
      continue;
    }

    if (!context.excludedSessionId
      && !context.suppliedUntil
      && context.activeWindowMs > 0
      && isActiveSession(session, context.startedAt, context.activeWindowMs)) {
      omitted.activeSessions += 1;
      continue;
    }
    prepared.push(session);
  }

  return { sessions: prepared, omitted };
}

export function buildSessionCoreFacts({
  scope = {},
  events = [],
  selection = {},
  warnings = [],
  omitted = {},
  episodeLimit,
  debug = false,
  sourceCoverage = null,
} = {}) {
  const executionEvents = events.filter((event) => event?.lifecyclePhase !== "pre");
  const episodeAnalysis = buildTaskEpisodes(executionEvents, {
    platform: scope.platform,
    includeEpisodeFacts: true,
    includeEpisodeFactDebug: debug === true,
    episodeFactLimit: episodeLimit,
  });
  return finalizeSessionCoreFacts({
    scope: {
      platform: scope.platform,
      workspaceLabel: path.basename(String(scope.workspace ?? "workspace")),
      until: scope.until,
    },
    selection: {
      strategy: selection.strategy,
      eligibleCount: selection.eligibleCount,
      selectedCount: selection.analyzedCount,
      sampled: Number(selection.eligibleCount ?? 0) > Number(selection.analyzedCount ?? 0),
    },
    episodeFacts: episodeAnalysis.episodeFacts,
    warnings,
    omitted,
    sourceCoverage,
  });
}

function isActiveSession(session, startedAt, activeWindowMs) {
  const observedAt = Date.parse(session?.lastSeen ?? session?.firstSeen ?? "");
  if (Number.isNaN(observedAt)) return false;
  return observedAt >= startedAt - activeWindowMs && observedAt <= startedAt + activeWindowMs;
}

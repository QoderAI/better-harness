import { timestampMillis } from "./time.mjs";

const DEFAULT_ACTIVE_GAP_CAP_MS = 5 * 60 * 1000;
const DEFAULT_IDLE_GAP_MS = 30 * 60 * 1000;
const DEFAULT_LONG_ACTIVE_MS = 45 * 60 * 1000;
const DEFAULT_LONG_WALL_MS = 2 * 60 * 60 * 1000;
const DEFAULT_TOP_LIMIT = 8;

export function buildLongSessionFacet(sessions = [], events = [], options = {}) {
  const { thresholds, rows } = measureLongSessionRows(sessions, events, options);
  const longActiveRows = rows.filter((row) => Number.isFinite(row.activeMs) && row.activeMs >= thresholds.activeMs);
  const longWallRows = rows.filter((row) => row.wallMs >= thresholds.wallMs);
  const longActiveIds = new Set(longActiveRows.map((row) => row.id));
  const longWallIds = new Set(longWallRows.map((row) => row.id));
  const longEitherIds = new Set([...longActiveIds, ...longWallIds]);
  const longActiveRatio = rows.length > 0 ? longActiveRows.length / rows.length : 0;

  return {
    thresholds,
    analyzedSessionCount: rows.length,
    longActiveCount: longActiveRows.length,
    longWallCount: longWallRows.length,
    wallOnlyCount: longWallRows.filter((row) => !longActiveIds.has(row.id)).length,
    longEitherCount: longEitherIds.size,
    longActiveRatio: Number(longActiveRatio.toFixed(3)),
    recommendation: delegationRecommendation(longActiveRows.length),
    topByActive: topLongRows(longActiveRows, "activeMs"),
    topByWall: topLongRows(longWallRows, "wallMs"),
  };
}

export function measureLongSessionRows(sessions = [], events = [], options = {}) {
  const thresholds = {
    activeMs: numberOrDefault(options.activeMs, DEFAULT_LONG_ACTIVE_MS),
    wallMs: numberOrDefault(options.wallMs, DEFAULT_LONG_WALL_MS),
    activeGapCapMs: numberOrDefault(options.activeGapCapMs, DEFAULT_ACTIVE_GAP_CAP_MS),
    idleGapMs: numberOrDefault(options.idleGapMs, DEFAULT_IDLE_GAP_MS),
  };

  const eventsBySession = groupEventsBySession(events);
  const rows = sessions.map((session) => measureSession(session, eventsBySession.get(session.sessionId) ?? [], thresholds));
  return { thresholds, rows };
}

function groupEventsBySession(events) {
  const grouped = new Map();
  for (const event of events) {
    if (!event.sessionId) {
      continue;
    }
    if (!grouped.has(event.sessionId)) {
      grouped.set(event.sessionId, []);
    }
    grouped.get(event.sessionId).push(event);
  }
  return grouped;
}

function measureSession(session, events, thresholds) {
  const sortedTimes = events
    .filter((event) => event.activityTimestamp !== false)
    .map((event) => timestampMillis(event.timestamp))
    .filter((time) => time !== null)
    .sort((a, b) => a - b);
  const first = sortedTimes[0] ?? timestampMillis(session.firstSeen);
  const last = sortedTimes.at(-1) ?? timestampMillis(session.lastSeen);
  const activeTimeObserved = session.eventTimestampCoverage === undefined || sortedTimes.length >= 2;
  let activeMs = activeTimeObserved ? 0 : null;
  let maxIdleGapMs = activeTimeObserved ? 0 : null;
  let idleGapCount = activeTimeObserved ? 0 : null;

  for (let index = 1; index < sortedTimes.length; index += 1) {
    const gap = Math.max(0, sortedTimes[index] - sortedTimes[index - 1]);
    activeMs += Math.min(gap, thresholds.activeGapCapMs);
    if (gap >= thresholds.idleGapMs) {
      idleGapCount += 1;
      maxIdleGapMs = Math.max(maxIdleGapMs, gap);
    }
  }

  const firstEvidence = events.find((event) => event.evidenceRef)?.evidenceRef ?? null;
  const userPromptCount = events.filter(isUserPromptEvent).length;
  const toolCallCount = events.filter(isToolEvent).length;

  return {
    id: session.sessionId,
    label: shortSessionLabel(session.sessionId),
    firstSeen: session.firstSeen ?? null,
    lastSeen: session.lastSeen ?? null,
    wallMs: first !== null && last !== null ? Math.max(0, last - first) : 0,
    activeMs,
    activeTimeObserved,
    maxIdleGapMs,
    idleGapCount,
    userPromptCount,
    toolCallCount,
    eventCount: events.length,
    evidenceRefs: firstEvidence ? [firstEvidence] : [],
  };
}

function topLongRows(rows, field) {
  return rows
    .slice()
    .sort((a, b) => b[field] - a[field] || b.activeMs - a.activeMs || b.wallMs - a.wallMs || a.id.localeCompare(b.id))
    .slice(0, DEFAULT_TOP_LIMIT)
    .map((row) => ({
      id: row.id,
      label: row.label,
      firstSeen: row.firstSeen,
      lastSeen: row.lastSeen,
      wallMs: row.wallMs,
      activeMs: row.activeMs,
      activeTimeObserved: row.activeTimeObserved,
      maxIdleGapMs: row.maxIdleGapMs,
      idleGapCount: row.idleGapCount,
      userPromptCount: row.userPromptCount,
      toolCallCount: row.toolCallCount,
      eventCount: row.eventCount,
      evidenceRefs: row.evidenceRefs,
    }));
}

function delegationRecommendation(longActiveCount) {
  if (longActiveCount > 0) {
    return {
      status: "inspect-active-long-sessions",
      reason: "duration-alone-needs-outcome-review",
      ownerHint: "needs-semantic-review",
    };
  }
  return {
    status: "observe-only",
    reason: "wall-span-alone-is-idle-or-resume-evidence",
    ownerHint: "no-delegation-from-wall-only",
  };
}

function isUserPromptEvent(event) {
  if (typeof event.userPrompt === "boolean") return event.userPrompt;
  return event.type === "user" || event.type === "last-prompt" || event.type === "UserPromptSubmit";
}

function isToolEvent(event) {
  return Boolean(event.toolName || event.functionCallName || event.type?.includes("tool"));
}

function shortSessionLabel(sessionId) {
  return String(sessionId ?? "unknown").slice(0, 8);
}

function numberOrDefault(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export const COMMIT_SESSION_LINK_SCHEMA_VERSION = 1;
export const DEFAULT_GRACE_MINUTES = 45;
export const MAX_EVIDENCE_FILES = 20;

export const CONFIDENCE_LEVELS = Object.freeze(["explicit", "high", "medium", "low"]);
const CONFIDENCE_RANK = Object.freeze({ explicit: 0, high: 1, medium: 2, low: 3 });

function timestampMillis(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

export function boundedGraceMinutes(value, fallback = DEFAULT_GRACE_MINUTES) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(24 * 60, Math.trunc(parsed));
}

function linkMatch(commit, session) {
  const links = Array.isArray(commit.sessionLinks) && commit.sessionLinks.length > 0
    ? commit.sessionLinks
    : (commit.sessionTrailers ?? []).map((value) => ({ type: "harness-session", value }));
  for (const link of links) {
    if (link.type === "harness-session"
      && (link.value === session.sessionId || link.value.endsWith(`/${session.sessionId}`))) {
      return link;
    }
    if (link.type === "entire-checkpoint" && session.checkpointIds?.includes(link.value)) {
      return link;
    }
  }
  return null;
}

function timeOverlap(commitTime, session, graceMs) {
  const firstSeen = timestampMillis(session.firstSeen);
  const lastSeen = timestampMillis(session.lastSeen);
  if (commitTime === null || firstSeen === null || lastSeen === null) return false;
  return commitTime >= firstSeen && commitTime <= lastSeen + graceMs;
}

function overlappingFiles(commit, session) {
  const sessionFiles = new Set(Array.isArray(session.files) ? session.files : []);
  return commit.files
    .map((file) => file.path)
    .filter((filePath) => sessionFiles.has(filePath));
}

// A commit whose recorded time falls inside an observed `git commit` tool call
// has stronger provenance than a broad session-window match. This deliberately
// proves only that the session created the Git object; it does not claim that
// the same session authored the already-dirty workspace files.
function observedCommitCall(commitTime, session) {
  if (commitTime === null) return null;
  const toleranceMs = 2_000;
  return (session?.toolActivity?.calls ?? []).find((call) => {
    if (call?.operation !== "create-commit" || call?.status !== "observed") return false;
    if (call?.durationStatus !== "observed" || !Number.isFinite(call?.startedAt) || !Number.isFinite(call?.durationMs)) return false;
    const start = call.startedAt - toleranceMs;
    const end = call.startedAt + Math.max(0, call.durationMs) + toleranceMs;
    return commitTime >= start && commitTime <= end;
  }) ?? null;
}

function confidenceFor({ explicit, observedCommit, overlapsTime, fileOverlapCount, cwdWithinRepo }) {
  if (explicit) return "explicit";
  if (observedCommit) return "high";
  if (!overlapsTime) return null;
  if (fileOverlapCount > 0) return "high";
  if (cwdWithinRepo) return "medium";
  return "low";
}

export function correlateCommitSession(commit, session, { graceMs } = {}) {
  const commitTime = timestampMillis(commit.committedAt ?? commit.authoredAt);
  const link = linkMatch(commit, session);
  const commitCall = observedCommitCall(commitTime, session);
  const overlapsTime = timeOverlap(commitTime, session, graceMs ?? DEFAULT_GRACE_MINUTES * 60_000);
  const overlap = overlappingFiles(commit, session);
  const cwdWithinRepo = session.cwdWithinRepo === true;
  const confidence = confidenceFor({
    explicit: Boolean(link),
    observedCommit: Boolean(commitCall),
    overlapsTime,
    fileOverlapCount: overlap.length,
    cwdWithinRepo,
  });
  if (!confidence) return null;

  const lastSeen = timestampMillis(session.lastSeen);
  return {
    sessionId: session.sessionId,
    platform: session.platform ?? null,
    confidence,
    evidence: {
      linkType: link?.type ?? null,
      trailer: link?.value ?? null,
      checkpointId: link?.type === "entire-checkpoint" ? link.value : null,
      commitObservedInCall: commitCall?.id ?? null,
      commitTimeBasis: commit.committedAt ? "committedAt" : "authoredAt",
      timeOverlap: overlapsTime,
      commitToLastSeenMs: commitTime !== null && lastSeen !== null ? commitTime - lastSeen : null,
      overlappingFileCount: overlap.length,
      overlappingFiles: overlap.slice(0, MAX_EVIDENCE_FILES),
      cwdWithinRepo,
    },
  };
}

function matchOrder(a, b) {
  const rank = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
  if (rank !== 0) return rank;
  const observed = Number(Boolean(b.evidence.commitObservedInCall)) - Number(Boolean(a.evidence.commitObservedInCall));
  if (observed !== 0) return observed;
  const files = b.evidence.overlappingFileCount - a.evidence.overlappingFileCount;
  if (files !== 0) return files;
  const aDistance = Math.abs(a.evidence.commitToLastSeenMs ?? Number.MAX_SAFE_INTEGER);
  const bDistance = Math.abs(b.evidence.commitToLastSeenMs ?? Number.MAX_SAFE_INTEGER);
  if (aDistance !== bDistance) return aDistance - bDistance;
  return String(a.sessionId).localeCompare(String(b.sessionId));
}

export function correlateCommitsWithSessions(commits = [], sessions = [], options = {}) {
  const graceMinutes = boundedGraceMinutes(options.graceMinutes);
  const graceMs = graceMinutes * 60_000;
  const linkedCommits = commits.map((commit) => ({
    hash: commit.hash,
    shortHash: commit.shortHash,
    subject: commit.subject,
    authorName: commit.authorName,
    authoredAt: commit.authoredAt,
    committedAt: commit.committedAt ?? commit.authoredAt,
    fileCount: commit.files.length,
    linesAdded: sumStat(commit.files, "added"),
    linesRemoved: sumStat(commit.files, "removed"),
    sessionTrailers: commit.sessionTrailers,
    sessionLinks: commit.sessionLinks ?? [],
    matches: sessions
      .map((session) => correlateCommitSession(commit, session, { graceMs }))
      .filter(Boolean)
      .sort(matchOrder),
  }));

  return {
    schemaVersion: COMMIT_SESSION_LINK_SCHEMA_VERSION,
    graceMinutes,
    sessionCount: sessions.length,
    commits: linkedCommits,
  };
}

function sumStat(files, key) {
  return files.reduce((total, file) => total + (Number.isFinite(file[key]) ? file[key] : 0), 0);
}

// Repository-side evidence: what the sessions produced, and how the workspace
// is laid out.
//
// Session analysis measures agent activity. `commit-session-link` is the only
// bridge from that activity to delivered change, and `workspace-topology` is
// the only source of the project members an organization view needs in order to
// be more than one flat repository. Both are bounded and read-only.

import {
  correlateCommitsWithSessions,
  DEFAULT_GRACE_MINUTES,
} from "../../../scripts/commit-session-link/correlate.mjs";
import { collectCommitFacts } from "../../../scripts/commit-session-link/git-facts.mjs";
import { collectMultiPlatformSessionSummaries } from "../../../scripts/commit-session-link/session-source.mjs";
import { resolveWorkspaceTopology } from "../../../scripts/workspace-topology/index.mjs";

export const DEFAULT_COMMIT_WINDOW = 100;
export const DEFAULT_CORRELATION_SESSIONS = 60;

// A commit is attributed when at least one session matched it with usable
// evidence. `low` stays unattributed: it means nothing beyond a loose time
// overlap, which every concurrent session would satisfy.
const ATTRIBUTING_CONFIDENCE = new Set(["explicit", "high", "medium"]);

function attributedMatch(commit) {
  return commit.matches.find((match) => ATTRIBUTING_CONFIDENCE.has(match.confidence)) ?? null;
}

// Counts alone cannot be joined to anything. One reference per attributed
// commit carries the commit and the session that earned the attribution, which
// is the only key a Task evidence packet's `links.commitRefs` and
// `links.sessionRefs` can be matched against. Subjects, authors and file lists
// still stay out of the projection.
export const MAX_ATTRIBUTED_COMMIT_REFS = 200;

/**
 * Correlate recent commits with discovered sessions and reduce them to counts
 * a page can render, plus the bounded commit-to-session references those counts
 * were derived from. Comparing `attributedCommitRefs.length` with
 * `attributedCommits` states whether the reference list was bounded.
 */
export function projectCommitAttribution(correlation) {
  const commits = correlation.commits ?? [];
  const byConfidence = { explicit: 0, high: 0, medium: 0, low: 0 };
  const byPlatform = new Map();
  const attributedCommitRefs = [];
  let attributedCommits = 0;
  let attributedLinesAdded = 0;
  let attributedLinesRemoved = 0;
  let linesAdded = 0;
  let linesRemoved = 0;

  for (const commit of commits) {
    linesAdded += commit.linesAdded;
    linesRemoved += commit.linesRemoved;
    const match = attributedMatch(commit);
    if (!match) continue;
    attributedCommits += 1;
    attributedLinesAdded += commit.linesAdded;
    attributedLinesRemoved += commit.linesRemoved;
    byConfidence[match.confidence] = (byConfidence[match.confidence] ?? 0) + 1;
    byPlatform.set(match.platform, (byPlatform.get(match.platform) ?? 0) + 1);
    if (attributedCommitRefs.length < MAX_ATTRIBUTED_COMMIT_REFS) {
      attributedCommitRefs.push({
        commit: String(commit.hash ?? commit.shortHash ?? ""),
        sessionId: String(match.sessionId ?? ""),
        platform: match.platform ?? null,
        confidence: match.confidence,
      });
    }
  }

  return {
    graceMinutes: correlation.graceMinutes,
    correlatedSessionCount: correlation.sessionCount,
    commitCount: commits.length,
    attributedCommits,
    linesAdded,
    linesRemoved,
    attributedLinesAdded,
    attributedLinesRemoved,
    byConfidence,
    byPlatform: [...byPlatform.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([platform, commitCount]) => ({ platform, commitCount })),
    attributedCommitRefs,
  };
}

/** The bounded member routes an organization view groups work by. */
export function projectTopology(topology) {
  const members = topology?.members?.items ?? [];
  const scopes = topology?.instructionScopes?.items ?? [];
  return {
    target: topology?.target?.kind ?? "unknown",
    memberCount: topology?.members?.total ?? members.length,
    members: members.slice(0, 24).map((member) => ({ route: member.route, kind: member.kind })),
    instructionScopes: {
      total: topology?.instructionScopes?.total ?? scopes.length,
      effective: scopes.filter((scope) => scope.activation === "effective").length,
      candidate: scopes.filter((scope) => scope.activation === "candidate").length,
    },
    trackedFiles: topology?.discovery?.tracked ?? 0,
  };
}

/**
 * Collect both repository signals. Either can be unavailable — a workspace
 * without git has no commits, and a failed topology resolution must not fail
 * the whole collection — so each failure is reported and the other survives.
 */
export async function collectRepositorySignals({
  workspace,
  platforms = [],
  commitLimit = DEFAULT_COMMIT_WINDOW,
  maxSessions = DEFAULT_CORRELATION_SESSIONS,
  graceMinutes = DEFAULT_GRACE_MINUTES,
} = {}) {
  const errors = [];

  const commitAttribution = await (async () => {
    const { repoRoot, commits } = collectCommitFacts({ workspace, limit: commitLimit });
    const { sessions, providers } = await collectMultiPlatformSessionSummaries({
      workspace,
      repoRoot,
      platforms,
      maxSessions,
    });
    for (const provider of providers) {
      if (provider.status === "error") {
        errors.push({ source: `${provider.platform}:commits`, message: provider.message ?? "session discovery failed" });
      }
    }
    return projectCommitAttribution(correlateCommitsWithSessions(commits, sessions, { graceMinutes }));
  })().catch((error) => {
    errors.push({ source: "commits", message: error?.message ?? String(error) });
    return null;
  });

  const topology = await Promise.resolve()
    .then(() => resolveWorkspaceTopology({ workspace }))
    .then((resolved) => projectTopology(resolved?.topology ?? resolved))
    .catch((error) => {
      errors.push({ source: "topology", message: error?.message ?? String(error) });
      return null;
    });

  return { commitAttribution, topology, errors };
}

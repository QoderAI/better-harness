export const SESSION_VIEWER_REPORT_KIND = "SessionViewerReportV1";
export const SESSION_VIEWER_REPORT_SCHEMA_VERSION = 1;

// Canonical read-only projection shared by native host sessions and Entire
// checkpoint transcripts. It deliberately does not reuse HarnessCheckpointV1:
// that contract indexes Harness artifact runs, while this one describes an
// agent-session timeline and its commit/checkpoint evidence.
export function buildSessionViewerReport({
  session,
  turns = [],
  commitCount = 0,
  unresolvedCheckpoints = [],
} = {}) {
  if (!session?.sessionId) throw new Error("buildSessionViewerReport requires a session id");
  const commits = turns.flatMap((turn) => turn.commits ?? []);
  const finalResponseCount = turns.filter((turn) => turn.response).length;
  const responseCount = Math.max(finalResponseCount, session.assistantMessageCount ?? 0);
  const intermediateStepCount = Math.max(0, responseCount - finalResponseCount);
  const linesAdded = commits.reduce((sum, commit) => sum + (commit.linesAdded ?? 0), 0);
  const linesRemoved = commits.reduce((sum, commit) => sum + (commit.linesRemoved ?? 0), 0);
  const tools = Object.entries(session.toolCounts ?? {})
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return {
    kind: SESSION_VIEWER_REPORT_KIND,
    schemaVersion: SESSION_VIEWER_REPORT_SCHEMA_VERSION,
    session: {
      sessionId: session.sessionId,
      platform: session.platform ?? null,
      models: [...(session.models ?? [])],
      firstSeen: session.firstSeen ?? null,
      lastSeen: session.lastSeen ?? null,
      durationMs: session.durationMs ?? null,
      files: [...(session.files ?? [])],
      tokenUsage: session.tokenUsage ?? null,
      toolTrace: session.toolTrace ?? { schemaVersion: 2, totalCalls: 0, shownCalls: 0, truncated: false, calls: [] },
      source: session.source ?? "native-session",
    },
    counts: {
      prompts: turns.length,
      responses: responseCount,
      intermediateSteps: intermediateStepCount,
      commits: Math.max(commitCount, commits.length),
      toolCalls: session.toolCallCount ?? 0,
      fileEdits: session.fileEditCount ?? 0,
      filesTouched: session.files?.length ?? 0,
      linesAdded,
      linesRemoved,
    },
    tools,
    turns,
    unresolvedCheckpoints: [...unresolvedCheckpoints],
  };
}

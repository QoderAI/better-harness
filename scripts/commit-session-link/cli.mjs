#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { boundedGraceMinutes, correlateCommitSession, correlateCommitsWithSessions, DEFAULT_GRACE_MINUTES } from "./correlate.mjs";
import {
  attachCheckpointFactsToSessions,
  collectEntireCheckpointFacts,
  readEntireCheckpointSession,
} from "./entire-checkpoints.mjs";
import { boundedCommitLimit, collectCommitFacts, CommitSessionLinkError, DEFAULT_COMMIT_LIMIT } from "./git-facts.mjs";
import { renderCommitSessionHtml } from "./render-html.mjs";
import { renderSessionViewerHtml } from "./render-session-html.mjs";
import {
  boundedMaxSessions,
  collectSessionDetail,
  collectSessionSummaries,
  DEFAULT_MAX_SESSIONS,
  normalizeEntireCheckpointSession,
} from "./session-source.mjs";
import { attachCommitsToTurns, buildSessionTurns } from "./session-view.mjs";

const HELP = `Commit Session Link v1

Correlate local git commits with discovered coding-agent sessions using
commit trailers, time overlap, touched files, and session cwd evidence.

Usage:
  node scripts/commit-session-link/cli.mjs correlate [--workspace <dir>] [--platform <host>] [--commits <n>] [--commit <ref>] [--grace-minutes <n>] [--max-sessions <n>]
  node scripts/commit-session-link/cli.mjs render --commit <ref> [--workspace <dir>] [--platform <host>] [--grace-minutes <n>] [--max-sessions <n>] [--out <file>]
  node scripts/commit-session-link/cli.mjs render-session [--session-id <id>] [--workspace <dir>] [--platform <host>] [--commits <n>] [--grace-minutes <n>] [--out <file>]

Options:
  --workspace <dir>      Repository to inspect (default: current directory)
  --platform <host>      Session platform such as qoder, claude, codex (default: qoder)
  --commits <n>          Bound scanned commits (default: ${DEFAULT_COMMIT_LIMIT})
  --commit <ref>         Correlate or render a single commit
  --session-id <id>      Session id or unique prefix for render-session (default: most recent)
  --grace-minutes <n>    Session-end grace window in minutes (default: ${DEFAULT_GRACE_MINUTES})
  --max-sessions <n>     Bound hydrated sessions (default: ${DEFAULT_MAX_SESSIONS})
  --out <file>           HTML output path for render and render-session
  -h, --help             Print this help without reading git or session data

correlate emits one JSON document on stdout. render writes a commit-view HTML
file and render-session writes a Session Viewer HTML file; both emit a JSON
summary on stdout.
`;

const COMMANDS = new Set(["correlate", "render", "render-session"]);
const ALLOWED_OPTIONS = new Set([
  "--workspace",
  "--platform",
  "--commits",
  "--commit",
  "--session-id",
  "--grace-minutes",
  "--max-sessions",
  "--out",
]);

// Unrecognized argv values may hold private paths, so usage errors report only
// allowlisted flag names.
class UsageError extends Error {
  constructor(reason, safeFlag) {
    super(safeFlag ? `${reason}: ${safeFlag}` : reason);
    this.code = "INVALID_USAGE";
    this.exitCode = 64;
  }
}

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith("--") || !ALLOWED_OPTIONS.has(flag)) throw new UsageError("unrecognized option");
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new UsageError("missing option value", flag);
    if (Object.hasOwn(options, flag)) throw new UsageError("duplicate option", flag);
    options[flag] = value;
    index += 1;
  }
  return options;
}

async function buildCorrelation(options, { singleCommit = false } = {}) {
  const workspace = path.resolve(options["--workspace"] ?? process.cwd());
  const graceMinutes = boundedGraceMinutes(options["--grace-minutes"]);
  const { repoRoot, commits } = collectCommitFacts({
    workspace,
    commit: singleCommit ? options["--commit"] ?? "HEAD" : options["--commit"] ?? null,
    limit: boundedCommitLimit(options["--commits"]),
  });

  const commitTimes = commits
    .map((commit) => new Date(commit.committedAt ?? commit.authoredAt).getTime())
    .filter((time) => Number.isFinite(time));
  const graceMs = graceMinutes * 60_000;
  const discoveredSessions = await collectSessionSummaries({
    workspace,
    repoRoot,
    platform: options["--platform"] ?? "qoder",
    since: commitTimes.length > 0 ? new Date(Math.min(...commitTimes) - graceMs).toISOString() : null,
    until: commitTimes.length > 0 ? new Date(Math.max(...commitTimes)).toISOString() : null,
    maxSessions: boundedMaxSessions(options["--max-sessions"]),
  });
  const checkpointResolution = collectEntireCheckpointFacts({ repoRoot, commits });
  const sessions = attachCheckpointFactsToSessions(discoveredSessions, checkpointResolution.checkpoints);

  const report = correlateCommitsWithSessions(commits, sessions, { graceMinutes });
  return { workspace, repoRoot, commits, sessions, report, checkpointResolution };
}

async function runCorrelate(options) {
  const { repoRoot, report, checkpointResolution } = await buildCorrelation(options);
  process.stdout.write(`${JSON.stringify({
    ...report,
    repoRoot,
    platform: options["--platform"] ?? "qoder",
    checkpointResolution,
  }, null, 2)}\n`);
}

async function runRender(options) {
  const { repoRoot, commits, sessions, report } = await buildCorrelation(options, { singleCommit: true });
  const linkedCommit = report.commits[0];
  const html = renderCommitSessionHtml({
    commit: { ...linkedCommit, files: commits[0].files },
    sessions,
    graceMinutes: report.graceMinutes,
  });

  const outputPath = path.resolve(
    options["--out"]
      ?? path.join(repoRoot, ".qoder", "better-harness-runs", "commit-session-link", `commit-${linkedCommit.shortHash}.html`),
  );
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, "utf8");

  process.stdout.write(`${JSON.stringify({
    outputPath,
    commit: linkedCommit.hash,
    subject: linkedCommit.subject,
    matchedSessions: linkedCommit.matches.length,
  }, null, 2)}\n`);
}

async function runRenderSession(options) {
  const workspace = path.resolve(options["--workspace"] ?? process.cwd());
  const graceMinutes = boundedGraceMinutes(options["--grace-minutes"]);
  const graceMs = graceMinutes * 60_000;
  const { repoRoot, commits } = collectCommitFacts({
    workspace,
    limit: boundedCommitLimit(options["--commits"], 50),
  });
  const checkpointResolution = collectEntireCheckpointFacts({ repoRoot, commits });
  let detail = null;
  let nativeError = null;
  try {
    detail = await collectSessionDetail({
      workspace,
      repoRoot,
      platform: options["--platform"] ?? "qoder",
      sessionId: options["--session-id"] ?? null,
    });
  } catch (error) {
    nativeError = error;
  }
  if (!detail) {
    const requestedId = options["--session-id"] ?? null;
    const candidates = checkpointResolution.checkpoints.flatMap((checkpoint) =>
      checkpoint.sessions.map((session) => ({ checkpoint, session })));
    let matches = requestedId
      ? candidates.filter(({ session }) => session.sessionId === requestedId || session.sessionId.startsWith(requestedId))
      : candidates;
    if (matches.length === 0) throw nativeError ?? new Error("session not found in native or Entire checkpoint evidence");
    if (!requestedId) {
      const newestSessionId = matches[0].session.sessionId;
      matches = matches.filter(({ session }) => session.sessionId === newestSessionId);
    }
    const matchedSessionIds = new Set(matches.map(({ session }) => session.sessionId));
    if (matchedSessionIds.size !== 1) throw new Error(`session id is ambiguous: ${requestedId}`);
    // A session can have several checkpoints. Git log and checkpoint discovery are
    // newest-first, so prefer the newest self-contained transcript for that session.
    const stored = matches
      .map(({ checkpoint, session }) => readEntireCheckpointSession(repoRoot, checkpoint, session.sessionId))
      .find(Boolean);
    if (!stored) throw nativeError ?? new Error("Entire checkpoint transcript is unavailable");
    detail = await normalizeEntireCheckpointSession({
      transcript: stored.transcript,
      sessionId: stored.session.sessionId,
      checkpointId: stored.checkpoint.checkpointId,
      repoRoot,
      agent: stored.session.agent,
      platform: options["--platform"] ?? null,
      model: stored.session.model,
      metadata: stored.session,
    });
  }
  const { summary: discoveredSummary, events } = detail;
  const [summary] = attachCheckpointFactsToSessions([discoveredSummary], checkpointResolution.checkpoints);
  const sessionCommits = commits
    .map((commit) => ({
      ...commit,
      sessionMatch: correlateCommitSession(commit, summary, { graceMs }),
    }))
    .filter((commit) => commit.sessionMatch !== null);
  const { turns, truncated } = buildSessionTurns(events);
  attachCommitsToTurns(turns, sessionCommits, { graceMs });
  const html = renderSessionViewerHtml({
    session: summary,
    turns,
    truncated: truncated || detail.truncated === true,
    commitCount: sessionCommits.length,
    unresolvedCheckpoints: checkpointResolution.unresolved,
  });

  const shortId = summary.sessionId.replaceAll(/[^A-Za-z0-9_-]/gu, "").slice(0, 12) || "session";
  const outputPath = path.resolve(
    options["--out"]
      ?? path.join(repoRoot, ".qoder", "better-harness-runs", "commit-session-link", `session-viewer-${shortId}.html`),
  );
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, "utf8");

  process.stdout.write(`${JSON.stringify({
    outputPath,
    sessionId: summary.sessionId,
    turns: turns.length,
    linkedCommits: sessionCommits.length,
    linkedCheckpoints: summary.checkpointIds.length,
    unresolvedCheckpoints: checkpointResolution.unresolved.length,
  }, null, 2)}\n`);
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return 0;
  }
  const [command, ...rest] = argv;
  if (!COMMANDS.has(command)) {
    process.stderr.write("Unknown command; expected correlate, render, or render-session\n");
    return 64;
  }
  try {
    const options = parseOptions(rest);
    if (command === "correlate") await runCorrelate(options);
    else if (command === "render") await runRender(options);
    else await runRenderSession(options);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n`);
      return error.exitCode;
    }
    if (error instanceof CommitSessionLinkError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  process.exitCode = await main();
}

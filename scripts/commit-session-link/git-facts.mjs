import { spawnSync } from "node:child_process";

const RECORD_SEPARATOR = "\u001e";
const FIELD_SEPARATOR = "\u001f";
const LOG_FORMAT = `${RECORD_SEPARATOR}%H${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%aI${FIELD_SEPARATOR}%cI${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%b${FIELD_SEPARATOR}`;
const SESSION_TRAILER_RE = /^(Harness-Session|Entire-Checkpoint):\s*(\S+)\s*$/gimu;

export const DEFAULT_COMMIT_LIMIT = 20;
export const MAX_COMMIT_LIMIT = 200;

export class CommitSessionLinkError extends Error {
  constructor(message, code = "COMMIT_SESSION_LINK_ERROR") {
    super(message);
    this.code = code;
  }
}

function runGit(workspace, args) {
  const result = spawnSync("git", args, {
    cwd: workspace,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) {
    throw new CommitSessionLinkError(`git is not available: ${result.error.message}`, "GIT_UNAVAILABLE");
  }
  if (result.status !== 0) {
    const detail = String(result.stderr ?? "").trim().split("\n")[0] ?? "";
    throw new CommitSessionLinkError(`git ${args[0]} failed: ${detail}`, "GIT_FAILED");
  }
  return result.stdout;
}

export function resolveRepoRoot(workspace) {
  return runGit(workspace, ["rev-parse", "--show-toplevel"]).trim();
}

export function boundedCommitLimit(value, fallback = DEFAULT_COMMIT_LIMIT) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(MAX_COMMIT_LIMIT, Math.max(1, Math.trunc(parsed)));
}

// Parse `git log --numstat` output split by explicit record/field separators so
// commit subjects and bodies with newlines or unusual characters stay intact.
function parseLogRecords(stdout) {
  const commits = [];
  for (const record of stdout.split(RECORD_SEPARATOR)) {
    if (record.trim().length === 0) continue;
    const [hash, authorName, authoredAt, committedAt, subject, body] = record.split(FIELD_SEPARATOR);
    if (!hash || !authoredAt) continue;
    commits.push({
      hash: hash.trim(),
      shortHash: hash.trim().slice(0, 7),
      authorName: authorName ?? null,
      authoredAt: authoredAt.trim(),
      committedAt: committedAt?.trim() || authoredAt.trim(),
      subject: (subject ?? "").trim(),
      body: (body ?? "").trim(),
      files: [],
      sessionLinks: parseSessionLinkTrailers(body ?? ""),
      sessionTrailers: parseSessionTrailers(body ?? ""),
    });
  }
  return commits;
}

export function parseNumstatZ(block) {
  const files = [];
  const fields = String(block).split("\0");
  for (let index = 0; index < fields.length; index += 1) {
    const match = fields[index].match(/^(\d+|-)\t(\d+|-)\t([\s\S]*)$/u);
    if (!match) continue;
    let filePath = match[3];
    // With --numstat -z, rename/copy records end their stat prefix at the NUL
    // and carry old/new paths as the next two NUL-delimited fields.
    if (filePath.length === 0) {
      const oldPath = fields[index + 1];
      const newPath = fields[index + 2];
      if (oldPath === undefined || newPath === undefined) continue;
      filePath = newPath;
      index += 2;
    }
    files.push({
      path: filePath,
      added: match[1] === "-" ? null : Number(match[1]),
      removed: match[2] === "-" ? null : Number(match[2]),
    });
  }
  return files;
}

export function parseSessionTrailers(body) {
  return parseSessionLinkTrailers(body).map((link) => link.value);
}

export function parseSessionLinkTrailers(body) {
  const links = [];
  for (const match of String(body).matchAll(SESSION_TRAILER_RE)) {
    const type = match[1].toLowerCase() === "harness-session" ? "harness-session" : "entire-checkpoint";
    const value = match[2].trim();
    if (value.length > 0 && !links.some((link) => link.type === type && link.value === value)) {
      links.push({ type, value });
    }
  }
  return links;
}

export function collectCommitFacts({
  workspace,
  commit = null,
  limit = DEFAULT_COMMIT_LIMIT,
  since = null,
  until = null,
} = {}) {
  const repoRoot = resolveRepoRoot(workspace);
  const args = ["log", `--format=${LOG_FORMAT}`, "--no-patch", "--no-color"];
  if (commit) {
    args.push("--max-count=1", commit);
  } else {
    if (since) args.push(`--since=${since}`);
    if (until) args.push(`--until=${until}`);
    args.push(`--max-count=${boundedCommitLimit(limit)}`);
  }
  const commits = parseLogRecords(runGit(repoRoot, args));
  if (commit && commits.length === 0) {
    throw new CommitSessionLinkError(`commit not found: ${commit}`, "COMMIT_NOT_FOUND");
  }
  for (const fact of commits) {
    fact.files = parseNumstatZ(runGit(repoRoot, [
      "diff-tree",
      "--root",
      "--no-commit-id",
      "--numstat",
      "-r",
      "-z",
      "-M",
      fact.hash,
      "--",
    ]));
  }
  return { repoRoot, commits };
}

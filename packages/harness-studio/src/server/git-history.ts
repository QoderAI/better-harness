import { execFile } from "node:child_process";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { basename } from "node:path";
import type {
  GitCommitDetail,
  GitCommitFileChange,
  GitFileChangeKind,
  GitFilePatch,
  GitGraphEdge,
  GitHistoryCommit,
  GitHistoryRef,
  GitLogPage,
  GitRefsSnapshot,
} from "../git-history-model.js";

const GIT_OUTPUT_LIMIT = 16 * 1024 * 1024;
const PATCH_OUTPUT_LIMIT = 4 * 1024 * 1024;
const SEARCH_SCAN_LIMIT = 2_000;
const MAX_PAGE_SIZE = 100;
const MAX_HISTORY_ROWS = 5_000;
const MAX_CURSOR_LENGTH = 8_192;
const CURSOR_SECRET = randomBytes(32);

export class GitHistoryError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export interface GitLogOptions {
  refs?: string[];
  search?: string;
  limit?: number;
  cursor?: string;
}

interface GitLogCursor {
  version: 1;
  mode: "history" | "search";
  offset: number;
  total: number;
  signature: string;
  lanes: Array<string | null>;
}

interface RawCommit {
  sha: string;
  shortSha: string;
  summary: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  parents: string[];
  refs: GitHistoryRef[];
}

export async function isGitRepository(repoPath: string | undefined): Promise<boolean> {
  return await resolveGitRepositoryRoot(repoPath) !== undefined;
}

export async function resolveGitRepositoryRoot(repoPath: string | undefined): Promise<string | undefined> {
  if (repoPath === undefined) return undefined;
  const root = await runGitOptional(repoPath, ["rev-parse", "--show-toplevel"]);
  return root?.trim() || undefined;
}

export async function readGitRefs(repoPath: string): Promise<GitRefsSnapshot> {
  return await readGitRefsAtRoot(await requireGitRepositoryRoot(repoPath));
}

export async function readGitRefsAtRoot(repoRoot: string): Promise<GitRefsSnapshot> {
  const [currentBranchOutput, headShaOutput, localOutput, remoteOutput, tagOutput] = await Promise.all([
    runGitOptional(repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    runGitOptional(repoRoot, ["rev-parse", "--verify", "HEAD"]),
    runGit(repoRoot, ["for-each-ref", "--format=%(refname)%1f%(refname:short)%1f%(objectname)%1f%(*objectname)%1e", "refs/heads/"]),
    runGit(repoRoot, ["for-each-ref", "--format=%(refname)%1f%(refname:short)%1f%(objectname)%1f%(*objectname)%1e", "refs/remotes/"]),
    runGit(repoRoot, ["for-each-ref", "--format=%(refname)%1f%(refname:short)%1f%(objectname)%1f%(*objectname)%1e", "refs/tags/"]),
  ]);
  const currentBranch = currentBranchOutput?.trim() || null;
  const headSha = headShaOutput?.trim() || null;
  const local = parseRefRecords(localOutput, "local", currentBranch);
  const remote = parseRefRecords(remoteOutput, "remote", currentBranch)
    .filter((ref) => !ref.id.endsWith("/HEAD"));
  const tags = parseRefRecords(tagOutput, "tag", currentBranch);
  const head = headSha === null
    ? null
    : {
        id: "HEAD",
        name: currentBranch ?? `detached at ${headSha.slice(0, 8)}`,
        kind: "head" as const,
        commitSha: headSha,
        isCurrent: true,
      };
  return {
    kind: "GitRefsSnapshotV1",
    repository: {
      label: basename(repoRoot),
      currentBranch,
      headSha,
      detached: currentBranch === null && headSha !== null,
    },
    head,
    local,
    remote,
    tags,
  };
}

export async function readGitLog(
  repoPath: string,
  options: GitLogOptions = {},
  retainedRefs?: GitRefsSnapshot,
): Promise<GitLogPage> {
  const repoRoot = retainedRefs === undefined ? await requireGitRepositoryRoot(repoPath) : repoPath;
  const refsSnapshot = retainedRefs ?? await readGitRefsAtRoot(repoRoot);
  const limit = boundedInteger(options.limit ?? 40, 1, MAX_PAGE_SIZE, "limit");
  const search = (options.search ?? "").normalize("NFKC").trim();
  if (search.length > 120) throw new GitHistoryError("Search is limited to 120 characters.", 400, "INVALID_SEARCH");

  const requestedRefs = [...new Set(options.refs ?? [])];
  const allowedRefs = new Set([
    ...(refsSnapshot.head === null ? [] : [refsSnapshot.head.id]),
    ...refsSnapshot.local.map((ref) => ref.id),
    ...refsSnapshot.remote.map((ref) => ref.id),
    ...refsSnapshot.tags.map((ref) => ref.id),
  ]);
  for (const ref of requestedRefs) {
    if (!allowedRefs.has(ref)) throw new GitHistoryError("One or more selected refs are unavailable.", 400, "INVALID_REF");
  }
  const allRefs = [
    ...(refsSnapshot.head === null ? [] : [refsSnapshot.head]),
    ...refsSnapshot.local,
    ...refsSnapshot.remote,
    ...refsSnapshot.tags,
  ];
  const refsById = new Map(allRefs.map((ref) => [ref.id, ref]));
  const revisions = [...new Set((requestedRefs.length > 0 ? requestedRefs.map((id) => refsById.get(id)!) : allRefs)
    .map((ref) => ref.commitSha))];
  const refsBySha = new Map<string, GitHistoryRef[]>();
  for (const ref of [...refsSnapshot.local, ...refsSnapshot.remote, ...refsSnapshot.tags]) {
    refsBySha.set(ref.commitSha, [...(refsBySha.get(ref.commitSha) ?? []), ref]);
  }
  if (revisions.length === 0) return emptyGitLogPage();

  const signature = gitQuerySignature(revisions, search);
  const cursor = options.cursor === undefined ? undefined : decodeGitLogCursor(options.cursor, signature, search === "" ? "history" : "search");
  const totalReachable = cursor?.total ?? await readRevisionCount(repoRoot, revisions);

  if (search !== "") {
    const output = await runGit(repoRoot, [
      "--no-pager",
      "log",
      "--date-order",
      `--max-count=${SEARCH_SCAN_LIMIT}`,
      "--format=%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%aI%x1f%P%x00",
      ...revisions,
      "--",
    ]);
    const laidOut = layoutCommitGraph(parseLogRecords(output, refsBySha));
    const matched = laidOut.filter((commit) => commitMatches(commit, search));
    const offset = cursor?.offset ?? 0;
    if (offset > matched.length) throw invalidCursor();
    const commits = matched.slice(offset, offset + limit);
    const hasMore = offset + commits.length < matched.length;
    return {
      kind: "GitLogPageV1",
      commits,
      total: matched.length,
      hasMore,
      ...(hasMore ? { nextCursor: encodeGitLogCursor({ version: 1, mode: "search", offset: offset + commits.length, total: totalReachable, signature, lanes: [] }) } : {}),
      searchTruncated: totalReachable > SEARCH_SCAN_LIMIT,
      historyTruncated: false,
    };
  }

  const visibleTotal = Math.min(totalReachable, MAX_HISTORY_ROWS);
  const offset = cursor?.offset ?? 0;
  if (offset > visibleTotal) throw invalidCursor();
  const scanCount = Math.min(limit + 1, Math.max(0, visibleTotal - offset + 1));
  const output = scanCount === 0 ? "" : await runGit(repoRoot, [
    "--no-pager",
    "log",
    "--date-order",
    `--skip=${offset}`,
    `--max-count=${scanCount}`,
    "--format=%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%aI%x1f%P%x00",
    ...revisions,
    "--",
  ]);
  const rawCommits = parseLogRecords(output, refsBySha);
  const page = layoutCommitGraphPage(rawCommits.slice(0, limit), cursor?.lanes.map((lane) => lane ?? undefined));
  const hasMore = offset + page.commits.length < visibleTotal;
  return {
    kind: "GitLogPageV1",
    commits: page.commits,
    total: totalReachable,
    hasMore,
    ...(hasMore ? { nextCursor: encodeGitLogCursor({
      version: 1,
      mode: "history",
      offset: offset + page.commits.length,
      total: totalReachable,
      signature,
      lanes: page.lanes.map((lane) => lane ?? null),
    }) } : {}),
    searchTruncated: false,
    historyTruncated: totalReachable > MAX_HISTORY_ROWS,
  };
}

export async function readGitCommit(repoPath: string, sha: string): Promise<GitCommitDetail> {
  return await readGitCommitAtRoot(await requireGitRepositoryRoot(repoPath), sha);
}

export async function readGitCommitAtRoot(repoRoot: string, sha: string): Promise<GitCommitDetail> {
  requireFullSha(sha);
  const resolved = await runGitOptional(repoRoot, ["rev-parse", "--verify", `${sha}^{commit}`]);
  if (resolved?.trim() !== sha.toLowerCase()) throw new GitHistoryError("Commit is unavailable in this workspace.", 404, "COMMIT_NOT_FOUND");
  const metadata = await runGit(repoRoot, ["show", "--no-patch", "--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%P%x00%B", sha]);
  const [commitSha = sha, shortSha = sha.slice(0, 8), authorName = "", authorEmail = "", authoredAt = "", parentsText = "", ...messageParts] = metadata.trimEnd().split("\0");
  const parents = parentsText.split(/\s+/u).filter(Boolean);
  const diffRange = parents.length > 0 ? [parents[0]!, sha] : ["--root", sha];
  const [nameStatus, numstat] = await Promise.all([
    runGit(repoRoot, ["diff-tree", "--no-commit-id", "-r", "-z", "--name-status", "--find-renames", "--find-copies", ...diffRange]),
    runGit(repoRoot, ["diff-tree", "--no-commit-id", "-r", "-z", "--numstat", "--find-renames", "--find-copies", ...diffRange]),
  ]);
  const normalizedMessage = messageParts.join("\0").trimEnd();
  const files = mergeFileStats(parseNameStatus(nameStatus), parseNumstat(numstat));
  return {
    kind: "GitCommitDetailV1",
    commit: {
      sha: commitSha,
      shortSha,
      summary: normalizedMessage.split(/\r?\n/u)[0] ?? "",
      message: normalizedMessage,
      authorName,
      authorEmail,
      authoredAt,
      parents,
    },
    files,
  };
}

export async function readGitFilePatch(repoPath: string, sha: string, path: string): Promise<GitFilePatch> {
  const repoRoot = await requireGitRepositoryRoot(repoPath);
  return await readGitFilePatchAtRoot(repoRoot, sha, path);
}

export async function readGitFilePatchAtRoot(
  repoRoot: string,
  sha: string,
  path: string,
  retainedDetail?: GitCommitDetail,
): Promise<GitFilePatch> {
  if (path === "" || path.length > 1_024 || path.includes("\0")) {
    throw new GitHistoryError("File path is invalid.", 400, "INVALID_PATH");
  }
  const detail = retainedDetail ?? await readGitCommitAtRoot(repoRoot, sha);
  if (detail.commit.sha !== sha) throw new GitHistoryError("Commit detail does not match the requested patch.", 400, "INVALID_COMMIT");
  const file = detail.files.find((candidate) => candidate.path === path);
  if (file === undefined) throw new GitHistoryError("File is not part of this commit.", 404, "FILE_NOT_FOUND");
  let patch: string;
  try {
    const parents = detail.commit.parents;
    patch = await runGit(repoRoot, parents.length > 0 ? [
      "--no-pager", "diff", "--no-ext-diff", "--find-renames", "--find-copies", parents[0]!, sha, "--",
      ...(file.previousPath === undefined ? [] : [file.previousPath]),
      path,
    ] : [
      "--no-pager", "show", "--format=", "--no-ext-diff", "--find-renames", "--find-copies", sha, "--",
      ...(file.previousPath === undefined ? [] : [file.previousPath]),
      path,
    ], PATCH_OUTPUT_LIMIT);
  } catch (error) {
    if (error instanceof GitHistoryError && error.code === "OUTPUT_LIMIT") {
      throw new GitHistoryError("This file patch is too large to preview.", 413, "PATCH_TOO_LARGE");
    }
    throw error;
  }
  return {
    kind: "GitFilePatchV1",
    sha,
    path,
    patch,
    binary: file.binary || /(?:Binary files .* differ|GIT binary patch)/u.test(patch),
  };
}

export function parseLogRecords(output: string, refsBySha = new Map<string, GitHistoryRef[]>()): RawCommit[] {
  return output.split("\0").flatMap((record): RawCommit[] => {
    const normalized = record.replace(/^\r?\n/u, "");
    if (normalized === "") return [];
    const [sha, shortSha, summary, authorName, authorEmail, authoredAt, parentsText = ""] = normalized.split("\x1f");
    if (!sha || !shortSha || summary === undefined || authorName === undefined || !authoredAt) return [];
    return [{
      sha,
      shortSha,
      summary,
      authorName,
      authorEmail: authorEmail ?? "",
      authoredAt,
      parents: parentsText.trim().split(/\s+/u).filter(Boolean),
      refs: refsBySha.get(sha) ?? [],
    }];
  });
}

export function layoutCommitGraph(commits: RawCommit[]): GitHistoryCommit[] {
  return layoutCommitGraphPage(commits).commits;
}

export function layoutCommitGraphPage(
  commits: RawCommit[],
  initialLanes: Array<string | undefined> = [],
): { commits: GitHistoryCommit[]; lanes: Array<string | undefined> } {
  const lanes = [...initialLanes];
  const laidOut = commits.map((commit) => {
    let lane = lanes.indexOf(commit.sha);
    if (lane < 0) {
      lane = firstEmptyLane(lanes);
      lanes[lane] = commit.sha;
    }
    const activeLanes = lanes.flatMap((value, index) => value === undefined ? [] : [index]);
    lanes[lane] = undefined;
    const graphEdges: GitGraphEdge[] = [];
    commit.parents.forEach((parent, parentIndex) => {
      let parentLane = lanes.indexOf(parent);
      if (parentLane < 0) {
        parentLane = parentIndex === 0 && lanes[lane] === undefined ? lane : firstEmptyLane(lanes);
        lanes[parentLane] = parent;
      }
      graphEdges.push({ fromLane: lane, toLane: parentLane, isMerge: parentIndex > 0 });
    });
    while (lanes.length > 0 && lanes.at(-1) === undefined) lanes.pop();
    return { ...commit, lane, graphEdges, activeLanes };
  });
  return { commits: laidOut, lanes };
}

export function parseNameStatus(output: string): Array<Pick<GitCommitFileChange, "path" | "previousPath" | "status">> {
  const fields = output.split("\0");
  const files: Array<Pick<GitCommitFileChange, "path" | "previousPath" | "status">> = [];
  for (let index = 0; index < fields.length;) {
    const token = fields[index++];
    if (!token) continue;
    const statusCode = token[0] ?? "M";
    const status = mapFileStatus(statusCode);
    if (statusCode === "R" || statusCode === "C") {
      const previousPath = fields[index++] ?? "";
      const path = fields[index++] ?? "";
      if (path !== "") files.push({ path, previousPath, status });
    } else {
      const path = fields[index++] ?? "";
      if (path !== "") files.push({ path, status });
    }
  }
  return files;
}

export function parseNumstat(output: string): Map<string, { additions: number; deletions: number; binary: boolean }> {
  const fields = output.split("\0");
  const stats = new Map<string, { additions: number; deletions: number; binary: boolean }>();
  for (let index = 0; index < fields.length;) {
    const record = fields[index++];
    if (!record) continue;
    const [addText = "0", deleteText = "0", inlinePath = ""] = record.split("\t");
    const binary = addText === "-" || deleteText === "-";
    let path = inlinePath;
    if (path === "") {
      index += 1; // previous path for a rename/copy
      path = fields[index++] ?? "";
    }
    if (path !== "") stats.set(path, {
      additions: binary ? 0 : Number.parseInt(addText, 10) || 0,
      deletions: binary ? 0 : Number.parseInt(deleteText, 10) || 0,
      binary,
    });
  }
  return stats;
}

function mergeFileStats(
  files: Array<Pick<GitCommitFileChange, "path" | "previousPath" | "status">>,
  stats: Map<string, { additions: number; deletions: number; binary: boolean }>,
): GitCommitFileChange[] {
  return files.map((file) => ({ ...file, ...(stats.get(file.path) ?? { additions: 0, deletions: 0, binary: false }) }));
}

function parseRefRecords(output: string, kind: "local" | "remote" | "tag", currentBranch: string | null): GitHistoryRef[] {
  return output.split("\x1e").flatMap((record): GitHistoryRef[] => {
    const [id, shortName, objectSha, peeledSha] = record.trim().split("\x1f");
    if (!id || !shortName || !objectSha) return [];
    const remote = kind === "remote" ? shortName.split("/")[0] : undefined;
    const name = kind === "remote" && remote !== undefined ? shortName.slice(remote.length + 1) : shortName;
    return [{
      id,
      name,
      kind,
      commitSha: peeledSha || objectSha,
      ...(remote === undefined ? {} : { remote }),
      ...(kind === "local" && name === currentBranch ? { isCurrent: true } : {}),
    }];
  }).sort((left, right) => left.name.localeCompare(right.name));
}

function commitMatches(commit: GitHistoryCommit, query: string): boolean {
  const needle = query.toLocaleLowerCase();
  return [commit.sha, commit.shortSha, commit.summary, commit.authorName, commit.authorEmail]
    .some((value) => value.toLocaleLowerCase().includes(needle));
}

function mapFileStatus(status: string): GitFileChangeKind {
  if (status === "A") return "added";
  if (status === "D") return "deleted";
  if (status === "R") return "renamed";
  if (status === "C") return "copied";
  if (status === "T") return "type-changed";
  return "modified";
}

function firstEmptyLane(lanes: Array<string | undefined>): number {
  const empty = lanes.indexOf(undefined);
  return empty < 0 ? lanes.length : empty;
}

async function readRevisionCount(repoPath: string, revisions: string[]): Promise<number> {
  const output = await runGit(repoPath, ["rev-list", "--count", ...revisions, "--"]);
  return Number.parseInt(output.trim(), 10) || 0;
}

async function requireGitRepositoryRoot(repoPath: string): Promise<string> {
  const root = await resolveGitRepositoryRoot(repoPath);
  if (root === undefined) throw new GitHistoryError("The open workspace is not a Git repository.", 404, "NOT_GIT_REPOSITORY");
  return root;
}

function emptyGitLogPage(): GitLogPage {
  return {
    kind: "GitLogPageV1",
    commits: [],
    total: 0,
    hasMore: false,
    searchTruncated: false,
    historyTruncated: false,
  };
}

function gitQuerySignature(revisions: string[], search: string): string {
  return createHash("sha256").update(JSON.stringify({ revisions, search })).digest("hex");
}

function encodeGitLogCursor(cursor: GitLogCursor): string {
  const payload = Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
  return `${payload}.${cursorMac(payload)}`;
}

function decodeGitLogCursor(value: string, signature: string, mode: GitLogCursor["mode"]): GitLogCursor {
  if (value.length === 0 || value.length > MAX_CURSOR_LENGTH) throw invalidCursor();
  try {
    const [payload, mac, ...rest] = value.split(".");
    if (!payload || !mac || rest.length > 0) throw invalidCursor();
    const expected = Buffer.from(cursorMac(payload), "utf8");
    const actual = Buffer.from(mac, "utf8");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw invalidCursor();
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!isRecord(parsed)
      || parsed.version !== 1
      || parsed.mode !== mode
      || parsed.signature !== signature
      || !Number.isInteger(parsed.offset)
      || (parsed.offset as number) < 0
      || (parsed.offset as number) > MAX_HISTORY_ROWS
      || !Number.isInteger(parsed.total)
      || (parsed.total as number) < 0
      || !Array.isArray(parsed.lanes)
      || parsed.lanes.length > 256
      || !parsed.lanes.every((lane) => lane === null || typeof lane === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(lane))) {
      throw invalidCursor();
    }
    return parsed as unknown as GitLogCursor;
  } catch (error) {
    if (error instanceof GitHistoryError) throw error;
    throw invalidCursor();
  }
}

function cursorMac(payload: string): string {
  return createHmac("sha256", CURSOR_SECRET).update(payload).digest("base64url");
}

function invalidCursor(): GitHistoryError {
  return new GitHistoryError("The history cursor is invalid or expired.", 400, "INVALID_CURSOR");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireFullSha(sha: string): void {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(sha)) throw new GitHistoryError("Commit id is invalid.", 400, "INVALID_COMMIT");
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new GitHistoryError(`${label} is outside the supported range.`, 400, "INVALID_PAGE");
  }
  return value;
}

async function runGitOptional(repoPath: string, args: string[], maxBuffer = GIT_OUTPUT_LIMIT): Promise<string | undefined> {
  try {
    return await runGit(repoPath, args, maxBuffer);
  } catch {
    return undefined;
  }
}

function runGit(repoPath: string, args: string[], maxBuffer = GIT_OUTPUT_LIMIT): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, {
      cwd: repoPath,
      encoding: "utf8",
      maxBuffer,
      windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" },
    }, (error, stdout) => {
      if (error !== null) {
        const outputLimit = "code" in error && error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
        reject(new GitHistoryError(
          outputLimit ? "Git output exceeded the supported limit." : "Git could not read this workspace.",
          outputLimit ? 413 : 422,
          outputLimit ? "OUTPUT_LIMIT" : "GIT_READ_FAILED",
        ));
        return;
      }
      resolve(stdout);
    });
  });
}

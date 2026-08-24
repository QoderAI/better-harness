export type GitRefKind = "head" | "local" | "remote" | "tag";

export interface GitHistoryRef {
  /** Canonical, server-validated revision passed back to the log route. */
  id: string;
  name: string;
  kind: GitRefKind;
  commitSha: string;
  remote?: string;
  isCurrent?: boolean;
}

export interface GitRepositorySummary {
  label: string;
  currentBranch: string | null;
  headSha: string | null;
  detached: boolean;
}

export interface GitRefsSnapshot {
  kind: "GitRefsSnapshotV1";
  repository: GitRepositorySummary;
  head: GitHistoryRef | null;
  local: GitHistoryRef[];
  remote: GitHistoryRef[];
  tags: GitHistoryRef[];
}

export interface GitGraphEdge {
  fromLane: number;
  toLane: number;
  isMerge: boolean;
}

export interface GitHistoryCommit {
  sha: string;
  shortSha: string;
  summary: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  parents: string[];
  refs: GitHistoryRef[];
  lane: number;
  graphEdges: GitGraphEdge[];
  activeLanes: number[];
}

export interface GitLogPage {
  kind: "GitLogPageV1";
  commits: GitHistoryCommit[];
  total: number;
  hasMore: boolean;
  nextCursor?: string;
  searchTruncated: boolean;
  historyTruncated: boolean;
}

export type GitFileChangeKind = "added" | "modified" | "deleted" | "renamed" | "copied" | "type-changed";

export interface GitCommitFileChange {
  path: string;
  previousPath?: string;
  status: GitFileChangeKind;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface GitCommitDetail {
  kind: "GitCommitDetailV1";
  commit: Omit<GitHistoryCommit, "refs" | "lane" | "graphEdges" | "activeLanes"> & { message: string };
  files: GitCommitFileChange[];
}

export interface GitFilePatch {
  kind: "GitFilePatchV1";
  sha: string;
  path: string;
  patch: string;
  binary: boolean;
}

export function isGitRefsSnapshot(value: unknown): value is GitRefsSnapshot {
  if (!isRecord(value) || value.kind !== "GitRefsSnapshotV1" || !isRecord(value.repository)) return false;
  return (value.head === null || isGitRef(value.head))
    && Array.isArray(value.local) && value.local.every(isGitRef)
    && Array.isArray(value.remote) && value.remote.every(isGitRef)
    && Array.isArray(value.tags) && value.tags.every(isGitRef);
}

export function isGitLogPage(value: unknown): value is GitLogPage {
  return isRecord(value)
    && value.kind === "GitLogPageV1"
    && Array.isArray(value.commits)
    && value.commits.every(isGitCommit)
    && Number.isInteger(value.total)
    && typeof value.hasMore === "boolean"
    && (value.nextCursor === undefined || typeof value.nextCursor === "string")
    && typeof value.searchTruncated === "boolean"
    && typeof value.historyTruncated === "boolean";
}

export function isGitCommitDetail(value: unknown): value is GitCommitDetail {
  return isRecord(value)
    && value.kind === "GitCommitDetailV1"
    && isRecord(value.commit)
    && typeof value.commit.sha === "string"
    && typeof value.commit.message === "string"
    && Array.isArray(value.files)
    && value.files.every((file) => isRecord(file) && typeof file.path === "string" && typeof file.status === "string");
}

export function isGitFilePatch(value: unknown): value is GitFilePatch {
  return isRecord(value)
    && value.kind === "GitFilePatchV1"
    && typeof value.sha === "string"
    && typeof value.path === "string"
    && typeof value.patch === "string"
    && typeof value.binary === "boolean";
}

function isGitRef(value: unknown): value is GitHistoryRef {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && typeof value.kind === "string"
    && typeof value.commitSha === "string";
}

function isGitCommit(value: unknown): value is GitHistoryCommit {
  return isRecord(value)
    && typeof value.sha === "string"
    && typeof value.summary === "string"
    && Array.isArray(value.parents)
    && Array.isArray(value.refs)
    && Number.isInteger(value.lane)
    && Array.isArray(value.graphEdges)
    && Array.isArray(value.activeLanes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

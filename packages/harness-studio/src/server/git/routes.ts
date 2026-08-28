import { GitCommitDetail } from "../../contracts/git-history.js";
import { GitHistoryError, readGitCommitAtRoot, readGitFilePatchAtRoot, readGitLog, readGitRefsAtRoot } from "../git-history.js";
import { open } from "node:fs/promises";
import { ServerResponse } from "node:http";
import { respondJson } from "../http-utils.js";
import { HarnessStudioState, StudioWorkspace } from "../studio-types.js";

type GitStudioWorkspace = StudioWorkspace & { gitRoot: string };

function gitWorkspace(state: HarnessStudioState): GitStudioWorkspace {
  const workspace = state.workspace;
  if (workspace?.gitRoot === undefined) {
    throw new GitHistoryError("The open workspace is not a Git repository.", 404, "NOT_GIT_REPOSITORY");
  }
  return workspace as GitStudioWorkspace;
}
export async function serveGitRefs(response: ServerResponse, state: HarnessStudioState): Promise<void> {
  try {
    const workspace = gitWorkspace(state);
    const refs = await readGitRefsAtRoot(workspace.gitRoot);
    workspace.gitRefs = refs;
    respondJson(response, 200, refs, { "Cache-Control": "no-store" });
  } catch (error) {
    respondGitError(response, error);
  }
}
export async function serveGitLog(response: ServerResponse, state: HarnessStudioState, url: URL): Promise<void> {
  try {
    const limitText = url.searchParams.get("limit");
    const workspace = gitWorkspace(state);
    const refs = workspace.gitRefs ?? await readGitRefsAtRoot(workspace.gitRoot);
    workspace.gitRefs = refs;
    respondJson(response, 200, await readGitLog(workspace.gitRoot, {
      refs: url.searchParams.getAll("ref"),
      search: url.searchParams.get("search") ?? undefined,
      limit: limitText === null ? undefined : Number(limitText),
      cursor: url.searchParams.get("cursor") ?? undefined,
    }, refs), { "Cache-Control": "no-store" });
  } catch (error) {
    respondGitError(response, error);
  }
}
export async function serveGitCommit(response: ServerResponse, state: HarnessStudioState, sha: string): Promise<void> {
  try {
    const workspace = gitWorkspace(state);
    respondJson(response, 200, await cachedGitCommit(workspace, sha), { "Cache-Control": "no-store" });
  } catch (error) {
    respondGitError(response, error);
  }
}
export async function serveGitFilePatch(
  response: ServerResponse,
  state: HarnessStudioState,
  sha: string,
  path: string | null,
): Promise<void> {
  try {
    if (path === null) throw new GitHistoryError("File path is required.", 400, "INVALID_PATH");
    const workspace = gitWorkspace(state);
    const detail = await cachedGitCommit(workspace, sha);
    respondJson(response, 200, await readGitFilePatchAtRoot(workspace.gitRoot, sha, path, detail), { "Cache-Control": "no-store" });
  } catch (error) {
    respondGitError(response, error);
  }
}
async function cachedGitCommit(workspace: GitStudioWorkspace, sha: string): Promise<GitCommitDetail> {
  const cached = workspace.gitCommitCache?.get(sha);
  if (cached !== undefined) return cached;
  const detail = await readGitCommitAtRoot(workspace.gitRoot, sha);
  if (workspace.gitCommitCache !== undefined) {
    workspace.gitCommitCache.set(sha, detail);
    if (workspace.gitCommitCache.size > 64) {
      const oldest = workspace.gitCommitCache.keys().next().value as string | undefined;
      if (oldest !== undefined) workspace.gitCommitCache.delete(oldest);
    }
  }
  return detail;
}
function respondGitError(response: ServerResponse, error: unknown): void {
  if (error instanceof GitHistoryError) {
    respondJson(response, error.status, { error: error.message, code: error.code });
    return;
  }
  respondJson(response, 500, { error: "Git history is unavailable.", code: "GIT_HISTORY_FAILED" });
}

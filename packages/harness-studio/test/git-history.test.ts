import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isGitRepository,
  layoutCommitGraph,
  parseLogRecords,
  parseNameStatus,
  parseNumstat,
  readGitCommit,
  readGitFilePatch,
  readGitLog,
  readGitRefs,
} from "../src/server/git-history.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("workspace Git history", () => {
  it("lists HEAD, local, remote, and tag refs without exposing a path", async () => {
    const repo = await makeRepository();
    const refs = await readGitRefs(repo.path);

    expect(refs.repository).toEqual(expect.objectContaining({ label: basename(repo.path), currentBranch: "main", detached: false }));
    expect(JSON.stringify(refs)).not.toContain(repo.path);
    expect(refs.head).toMatchObject({ id: "HEAD", name: "main", commitSha: repo.mergeSha });
    expect(refs.local.map((ref) => ref.id)).toEqual(expect.arrayContaining(["refs/heads/main", "refs/heads/feature/commit-view"]));
    expect(refs.remote).toContainEqual(expect.objectContaining({ id: "refs/remotes/origin/main", remote: "origin", name: "main" }));
    expect(refs.remote.map((ref) => ref.id)).not.toContain("refs/remotes/origin/HEAD");
    expect(refs.remote.every((ref) => ref.name !== "")).toBe(true);
    expect(refs.tags).toContainEqual(expect.objectContaining({ id: "refs/tags/v1.0.0", name: "v1.0.0" }));
    expect(await isGitRepository(repo.path)).toBe(true);
  });

  it("filters exact local and remote refs, searches, paginates, and lays out merges", async () => {
    const repo = await makeRepository();
    const first = await readGitLog(repo.path, { limit: 2 });
    const second = await readGitLog(repo.path, { limit: 2, cursor: first.nextCursor });
    const third = await readGitLog(repo.path, { limit: 2, cursor: second.nextCursor });
    const unpaged = await readGitLog(repo.path, { limit: 100 });
    const feature = await readGitLog(repo.path, { refs: ["refs/heads/feature/commit-view"], limit: 40 });
    const remote = await readGitLog(repo.path, { refs: ["refs/remotes/origin/main"], limit: 40 });
    const search = await readGitLog(repo.path, { search: "ALICE@EXAMPLE.COM", limit: 40 });

    expect(first.commits).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    const paged = [...first.commits, ...second.commits, ...third.commits];
    expect(new Set(paged.map((commit) => commit.sha)).size).toBe(unpaged.commits.length);
    expect(paged).toEqual(unpaged.commits);
    expect(first.hasMore).toBe(true);
    expect(feature.commits.map((commit) => commit.sha)).toContain(repo.featureSha);
    expect(feature.commits.map((commit) => commit.sha)).not.toContain(repo.mainOnlySha);
    expect(remote.commits.map((commit) => commit.sha)).toContain(repo.mergeSha);
    expect(search.commits).toHaveLength(first.total);
    expect(first.commits[0]).toMatchObject({ sha: repo.mergeSha, parents: expect.arrayContaining([expect.any(String), expect.any(String)]) });
    expect(first.commits[0]!.graphEdges).toHaveLength(2);
    await expect(readGitLog(repo.path, { refs: ["refs/heads/feature/commit-view"], limit: 2, cursor: first.nextCursor })).rejects.toMatchObject({ status: 400, code: "INVALID_CURSOR" });
  });

  it("returns full multiline messages, renamed files, stats, and a selected file patch", async () => {
    const repo = await makeRepository();
    const detail = await readGitCommit(repo.path, repo.renameSha);
    const renamed = detail.files.find((file) => file.status === "renamed");

    expect(detail.commit.message).toContain("Preserve the full commit body.");
    expect(renamed).toMatchObject({ previousPath: "notes.txt", path: "docs/notes.txt", binary: false });
    const patch = await readGitFilePatch(repo.path, repo.renameSha, "docs/notes.txt");
    expect(patch.patch).toContain("diff --git a/notes.txt b/docs/notes.txt");
    expect(patch.binary).toBe(false);
    await expect(readGitFilePatch(repo.path, repo.renameSha, "not-in-commit.txt")).rejects.toMatchObject({ status: 404, code: "FILE_NOT_FOUND" });
  });

  it("uses the repository root for nested workspaces and first-parent merge patches", async () => {
    const repo = await makeRepository();
    const nested = join(repo.path, "packages", "app");
    await mkdir(nested, { recursive: true });

    const refs = await readGitRefs(nested);
    const detail = await readGitCommit(nested, repo.mergeSha);
    const feature = detail.files.find((file) => file.path === "feature.txt");
    const patch = await readGitFilePatch(nested, repo.mergeSha, "feature.txt");

    expect(refs.repository.label).toBe(basename(repo.path));
    expect(feature).toMatchObject({ status: "added", additions: 1, deletions: 0 });
    expect(patch.patch).toContain("+feature");
  });

  it("reports Git execution failures instead of converting them into empty history", async () => {
    const repo = await makeRepository();
    const refs = await readGitRefs(repo.path);
    const missing = "f".repeat(40);
    const broken = {
      ...refs,
      head: refs.head === null ? null : { ...refs.head, commitSha: missing },
      local: refs.local.map((ref) => ({ ...ref, commitSha: missing })),
      remote: [],
      tags: [],
    };

    await expect(readGitLog(repo.path, {}, broken)).rejects.toMatchObject({ status: 422, code: "GIT_READ_FAILED" });
  });

  it("stops cursor pagination at an honest 5,000-row presentation cap", async () => {
    const path = await makeLargeRepository(5_001);
    const refs = await readGitRefs(path);
    let cursor: string | undefined;
    let visible = 0;
    let last;
    do {
      last = await readGitLog(path, { limit: 100, cursor }, refs);
      visible += last.commits.length;
      cursor = last.nextCursor;
    } while (cursor !== undefined);

    expect(visible).toBe(5_000);
    expect(last).toMatchObject({ total: 5_001, hasMore: false, historyTruncated: true });
  }, 20_000);

  it("parses delimiter-safe records and rename numstat as behavior", () => {
    const records = parseLogRecords(`a`.repeat(40) + `\x1faaaaaaa\x1fsubject\x1fAlice\x1falice@example.com\x1f2026-08-22T10:00:00Z\x1f${"b".repeat(40)}\x00`);
    const graph = layoutCommitGraph(records);
    const names = parseNameStatus("R100\0before.txt\0after.txt\0M\0other.txt\0");
    const stats = parseNumstat("1\t2\t\x00before.txt\x00after.txt\x003\t4\tother.txt\x00");

    expect(graph[0]).toMatchObject({ lane: 0, graphEdges: [{ fromLane: 0, toLane: 0, isMerge: false }] });
    expect(names).toEqual([
      { previousPath: "before.txt", path: "after.txt", status: "renamed" },
      { path: "other.txt", status: "modified" },
    ]);
    expect(stats.get("after.txt")).toEqual({ additions: 1, deletions: 2, binary: false });
    expect(stats.get("other.txt")).toEqual({ additions: 3, deletions: 4, binary: false });
  });
});

async function makeRepository(): Promise<{
  path: string;
  featureSha: string;
  mainOnlySha: string;
  renameSha: string;
  mergeSha: string;
}> {
  const path = await mkdtemp(join(tmpdir(), "harness-studio-git-"));
  directories.push(path);
  git(path, "init", "-b", "main");
  git(path, "config", "user.name", "Alice Example");
  git(path, "config", "user.email", "alice@example.com");
  await writeFile(join(path, "notes.txt"), "first\n", "utf8");
  git(path, "add", "notes.txt");
  git(path, "commit", "-m", "docs: add notes", "-m", "A body that must not split the log record.");
  git(path, "tag", "v1.0.0");

  git(path, "switch", "-c", "feature/commit-view");
  await writeFile(join(path, "feature.txt"), "feature\n", "utf8");
  git(path, "add", "feature.txt");
  git(path, "commit", "-m", "feat: add feature history");
  const featureSha = git(path, "rev-parse", "HEAD");

  git(path, "switch", "main");
  await writeFile(join(path, "main.txt"), "main\n", "utf8");
  git(path, "add", "main.txt");
  git(path, "commit", "-m", "feat: main-only work");
  const mainOnlySha = git(path, "rev-parse", "HEAD");

  await mkdir(join(path, "docs"));
  git(path, "mv", "notes.txt", "docs/notes.txt");
  git(path, "commit", "-m", "docs: move notes", "-m", "Preserve the full commit body.");
  const renameSha = git(path, "rev-parse", "HEAD");
  git(path, "merge", "--no-ff", "feature/commit-view", "-m", "merge: feature history");
  const mergeSha = git(path, "rev-parse", "HEAD");
  git(path, "update-ref", "refs/remotes/origin/main", mergeSha);
  git(path, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  return { path, featureSha, mainOnlySha, renameSha, mergeSha };
}

async function makeLargeRepository(commitCount: number): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "harness-studio-git-large-"));
  directories.push(path);
  git(path, "init", "-b", "main");
  const commands: string[] = [];
  for (let index = 0; index < commitCount; index += 1) {
    const message = `history ${index}`;
    commands.push(
      "commit refs/heads/main",
      `mark :${index + 1}`,
      `author History Test <history@example.com> ${index + 1} +0000`,
      `committer History Test <history@example.com> ${index + 1} +0000`,
      `data ${Buffer.byteLength(message)}`,
      message,
      ...(index === 0 ? [] : [`from :${index}`]),
      "",
    );
  }
  commands.push("done", "");
  execFileSync("git", ["fast-import", "--quiet"], {
    cwd: path,
    input: commands.join("\n"),
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },
  });
  return path;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, LC_ALL: "C" } }).trim();
}

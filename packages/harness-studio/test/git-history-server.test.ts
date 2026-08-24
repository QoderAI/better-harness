import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startHarnessStudioServer, type StartedHarnessStudioServer } from "../src/server/server.js";

const directories: string[] = [];
let started: StartedHarnessStudioServer | undefined;

afterEach(async () => {
  await started?.close();
  started = undefined;
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Git history HTTP contract", () => {
  it("binds every Git read to the server-owned open workspace and redacts paths", async () => {
    const appDir = await makeDirectory("studio-git-app-");
    await writeFile(join(appDir, "index.html"), "<!doctype html><title>Git fixture</title>", "utf8");
    const gitWorkspace = await makeGitWorkspace();
    const plainWorkspace = await makeDirectory("studio-plain-workspace-");
    const selections = [gitWorkspace.nestedPath, plainWorkspace];
    started = await startHarnessStudioServer({
      appDir,
      workspaceDirectoryPicker: async () => selections.shift(),
      workspaceSessionProvider: { discover: async (path) => ({ label: basename(path), sessions: [] }) },
    });

    expect(await json(`${started.url}/api/config`)).toMatchObject({ gitEnabled: false });
    expect((await fetch(`${started.url}/api/git/refs`)).status).toBe(404);
    expect(await json(`${started.url}/api/workspace/open`, { method: "POST" })).toMatchObject({ opened: true });
    expect(await json(`${started.url}/api/config`)).toMatchObject({ gitEnabled: true, workspaceConnected: true });

    const refs = await json(`${started.url}/api/git/refs`);
    const log = await json(`${started.url}/api/git/log?limit=1`);
    const next = await json(`${started.url}/api/git/log?limit=1&cursor=${encodeURIComponent(log.nextCursor)}`);
    const detail = await json(`${started.url}/api/git/commits/${gitWorkspace.sha}`);
    const patch = await json(`${started.url}/api/git/commits/${gitWorkspace.sha}/patch?path=README.md`);
    expect(refs).toMatchObject({ kind: "GitRefsSnapshotV1", repository: { label: basename(gitWorkspace.path), currentBranch: "main" } });
    expect(log).toMatchObject({ kind: "GitLogPageV1", total: 2, hasMore: true, nextCursor: expect.any(String), commits: [{ sha: gitWorkspace.sha }] });
    expect(next).toMatchObject({ kind: "GitLogPageV1", total: 2, hasMore: false, commits: [{ sha: gitWorkspace.firstSha }] });
    expect(detail).toMatchObject({ kind: "GitCommitDetailV1", commit: { sha: gitWorkspace.sha }, files: [{ path: "README.md" }] });
    expect(patch).toMatchObject({ kind: "GitFilePatchV1", sha: gitWorkspace.sha, path: "README.md" });
    expect(patch.patch).toContain("+second");
    expect(JSON.stringify({ refs, log, detail, patch })).not.toContain(gitWorkspace.path);

    const invalid = await fetch(`${started.url}/api/git/log?ref=${encodeURIComponent("refs/heads/not-real")}`);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "One or more selected refs are unavailable.", code: "INVALID_REF" });

    const tamperedCursor = await fetch(`${started.url}/api/git/log?limit=1&cursor=${encodeURIComponent(`${log.nextCursor}x`)}`);
    expect(tamperedCursor.status).toBe(400);
    expect(await tamperedCursor.json()).toEqual({ error: "The history cursor is invalid or expired.", code: "INVALID_CURSOR" });

    await fetch(`${started.url}/api/workspace`, { method: "DELETE" });
    await json(`${started.url}/api/workspace/open`, { method: "POST" });
    expect(await json(`${started.url}/api/config`)).toMatchObject({ gitEnabled: false, workspaceConnected: true });
    const unavailable = await fetch(`${started.url}/api/git/log`);
    expect(unavailable.status).toBe(404);
    expect(JSON.stringify(await unavailable.json())).not.toContain(plainWorkspace);
  });
});

async function makeGitWorkspace(): Promise<{ path: string; nestedPath: string; firstSha: string; sha: string }> {
  const path = await makeDirectory("studio-git-workspace-");
  git(path, "init", "-b", "main");
  git(path, "config", "user.name", "Studio Test");
  git(path, "config", "user.email", "studio@example.com");
  await writeFile(join(path, "README.md"), "# Fixture\n", "utf8");
  git(path, "add", "README.md");
  git(path, "commit", "-m", "docs: add fixture");
  const firstSha = git(path, "rev-parse", "HEAD");
  await writeFile(join(path, "README.md"), "# Fixture\nsecond\n", "utf8");
  git(path, "add", "README.md");
  git(path, "commit", "-m", "docs: update fixture");
  const nestedPath = join(path, "packages", "app");
  await mkdir(nestedPath, { recursive: true });
  return { path, nestedPath, firstSha, sha: git(path, "rev-parse", "HEAD") };
}

async function makeDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, LC_ALL: "C" } }).trim();
}

async function json(url: string, init?: RequestInit): Promise<any> {
  const response = await fetch(url, init);
  expect(response.ok).toBe(true);
  return await response.json();
}

import { spawnSync } from "node:child_process";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";

import {
  createSessionExecutionPlan,
  executeSessionExecutionPlan,
  inspectPiCheckpoint,
  validateSessionExecutionPlan,
  validateSessionExecutionPlanEnvelope,
  writeSessionExecutionPlan,
  readSessionExecutionPlan,
  type SessionContinuationRunner,
  type SessionExecutionPlan,
} from "../src/session-executor/index.js";
import {
  assertContainedSessionPath,
  preparePiCheckpointSession,
} from "../src/session-executor/pi-runner.js";

const temporaryDirectories: string[] = [];
const ROOT_ENTRY = "root0001";
const TARGET_ENTRY = "target02";

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

function git(cwd: string, args: string[], allowedExitCodes: number[] = [0]): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const status = result.status ?? 1;
  if (result.error || !allowedExitCodes.includes(status)) {
    throw result.error ?? new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return { status, stdout: result.stdout, stderr: result.stderr };
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
  temporaryDirectories.push(directory);
  return directory;
}

async function createRepository(): Promise<{ root: string; baseCommit: string }> {
  const root = await temporaryDirectory("harness-session-executor-repo-");
  git(root, ["init", "--initial-branch=main"]);
  git(root, ["config", "user.name", "Harness Test"]);
  git(root, ["config", "user.email", "harness-test@example.com"]);
  await writeFile(path.join(root, "README.md"), "# fixture\n", "utf8");
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-m", "test: seed fixture"]);
  return { root, baseCommit: git(root, ["rev-parse", "HEAD"]).stdout.trim() };
}

function sourceSessionLines(cwd: string, sessionId = "source-session-1"): Array<Record<string, unknown>> {
  const timestamp = "2026-08-16T00:00:00.000Z";
  return [
    {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: sessionId,
      timestamp,
      cwd,
    },
    {
      type: "custom",
      id: ROOT_ENTRY,
      parentId: null,
      timestamp,
      customType: "fixture",
      data: { step: "root" },
    },
    {
      type: "custom",
      id: TARGET_ENTRY,
      parentId: ROOT_ENTRY,
      timestamp,
      customType: "fixture",
      data: { step: "target" },
    },
    {
      type: "custom",
      id: "sibling3",
      parentId: ROOT_ENTRY,
      timestamp,
      customType: "fixture",
      data: { step: "sibling" },
    },
    {
      type: "custom",
      id: "later004",
      parentId: TARGET_ENTRY,
      timestamp,
      customType: "fixture",
      data: { step: "later" },
    },
  ];
}

async function writeSourceSession(cwd: string): Promise<string> {
  const directory = await temporaryDirectory("harness-session-source-");
  const sessionFile = path.join(directory, "session.jsonl");
  await writeFile(
    sessionFile,
    `${sourceSessionLines(cwd).map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    "utf8",
  );
  return sessionFile;
}

async function createPlan(repo: string, baseCommit: string, sessionFile: string): Promise<SessionExecutionPlan> {
  return createSessionExecutionPlan({
    workspace: repo,
    base: baseCommit,
    sessionFile,
    entryId: TARGET_ENTRY,
    prompt: "Continue the fixture from the selected checkpoint.",
    commitMessage: "feat(session): continue checkpoint",
    now: () => new Date("2026-08-16T01:00:00.000Z"),
  });
}

async function persistFakeContinuation(
  sourceSessionFile: string,
  sessionDirectory: string,
  worktree: string,
  executionSessionId: string,
): Promise<string> {
  await mkdir(sessionDirectory, { recursive: true });
  const lines = (await readFile(sourceSessionFile, "utf8"))
    .trimEnd()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  lines[0] = {
    ...lines[0],
    id: executionSessionId,
    cwd: worktree,
    parentSession: sourceSessionFile,
  };
  lines.push({
    type: "custom",
    id: "continued5",
    parentId: TARGET_ENTRY,
    timestamp: "2026-08-16T01:01:00.000Z",
    customType: "fixture-continuation",
    data: { complete: true },
  });
  const sessionFile = path.join(sessionDirectory, `${executionSessionId}.jsonl`);
  await writeFile(sessionFile, `${lines.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
  return sessionFile;
}

function fakeRunner(options: { changeFiles: boolean }): SessionContinuationRunner {
  return async ({ worktree, sourceSessionFile, sessionDirectory }) => {
    if (options.changeFiles) {
      await writeFile(path.join(worktree, "generated.txt"), "continued from checkpoint\n", "utf8");
    }
    const executionSessionId = "execution-session-1";
    return {
      provider: "pi",
      executionSessionId,
      sessionFile: await persistFakeContinuation(
        sourceSessionFile,
        sessionDirectory,
        worktree,
        executionSessionId,
      ),
      model: { provider: "fixture", id: "no-network" },
      toolCalls: options.changeFiles ? [{ id: "tool-1", name: "write" }] : [],
      output: "done",
    };
  };
}

describe("session execution planning", () => {
  it("binds an exact Git tree and exact Pi branch into a tamper-evident plan", async () => {
    const { root, baseCommit } = await createRepository();
    const sessionFile = await writeSourceSession(root);
    const plan = await createPlan(root, baseCommit, sessionFile);

    expect(plan).toMatchObject({
      schemaVersion: "session-execution-plan-v1",
      provider: "pi",
      workspace: { root, baseCommit },
      checkpoint: {
        sessionId: "source-session-1",
        entryId: TARGET_ENTRY,
        entryType: "custom",
        branchEntryIds: [ROOT_ENTRY, TARGET_ENTRY],
      },
      constraints: {
        isolation: "detached-git-worktree",
        readTools: ["read", "ls"],
        mutationTools: ["edit", "write"],
        shell: false,
        maxToolCalls: 64,
        maxDurationMs: 900_000,
      },
    });
    expect(plan.planId).toMatch(/^sep_[a-f0-9]{64}$/u);
    expect(plan.output.ref).toBe(`refs/better-harness/session-executions/${plan.planId}`);
    expect(plan.workspace.baseTree).toBe(git(root, ["rev-parse", `${baseCommit}^{tree}`]).stdout.trim());

    const planFile = path.join(await temporaryDirectory("harness-session-plan-"), "plan.json");
    await expect(writeSessionExecutionPlan(planFile, plan)).resolves.toBe(planFile);
    await expect(readSessionExecutionPlan(planFile)).resolves.toEqual(plan);
    await expect(writeSessionExecutionPlan(planFile, plan)).rejects.toMatchObject({ code: "OUTPUT_EXISTS" });

    const tampered = structuredClone(plan);
    tampered.continuation.prompt = "changed after planning";
    expect(() => validateSessionExecutionPlanEnvelope(tampered)).toThrowError(
      expect.objectContaining({ code: "PLAN_TAMPERED" }),
    );
    await expect(createSessionExecutionPlan({
      workspace: root,
      base: baseCommit,
      sessionFile,
      entryId: TARGET_ENTRY,
      prompt: "Continue safely.",
      commitMessage: "feat(session): spoof\n\nHarness-Session: another-session",
    })).rejects.toMatchObject({ code: "RESERVED_TRAILER" });
  });

  it("rejects a changed source transcript before creating execution state", async () => {
    const { root, baseCommit } = await createRepository();
    const sessionFile = await writeSourceSession(root);
    const plan = await createPlan(root, baseCommit, sessionFile);
    await appendFile(sessionFile, `${JSON.stringify({
      type: "custom",
      id: "tamper06",
      parentId: TARGET_ENTRY,
      timestamp: "2026-08-16T02:00:00.000Z",
      customType: "tamper",
    })}\n`, "utf8");

    await expect(validateSessionExecutionPlan(plan)).rejects.toMatchObject({
      code: "CHECKPOINT_CHANGED",
    });
    expect(git(root, ["show-ref", "--verify", "--quiet", plan.output.ref], [0, 1]).status).toBe(1);
  });
});

describe("Pi checkpoint adapter", () => {
  it("forks the JSONL and makes the selected entry the active leaf", async () => {
    const worktree = await temporaryDirectory("harness-session-worktree-");
    const sourceSessionFile = await writeSourceSession(worktree);
    const sessionDirectory = path.join(await temporaryDirectory("harness-session-fork-"), "sessions");
    const sourceBefore = await readFile(sourceSessionFile, "utf8");

    const { sessionManager } = await preparePiCheckpointSession({
      sourceSessionFile,
      entryId: TARGET_ENTRY,
      worktree,
      sessionDirectory,
    });

    expect(sessionManager.getLeafId()).toBe(TARGET_ENTRY);
    expect(sessionManager.getBranch().map((entry) => entry.id)).toEqual([ROOT_ENTRY, TARGET_ENTRY]);
    sessionManager.appendCustomEntry("continued", { ok: true });
    expect(sessionManager.getLeafEntry()?.parentId).toBe(TARGET_ENTRY);
    expect(sessionManager.getHeader()).toMatchObject({
      cwd: worktree,
      parentSession: sourceSessionFile,
    });
    expect(await readFile(sourceSessionFile, "utf8")).toBe(sourceBefore);
  });

  it("contains tool paths and denies Git metadata", async () => {
    const worktree = await temporaryDirectory("harness-session-containment-");
    await writeFile(path.join(worktree, "inside.txt"), "inside\n", "utf8");
    await expect(assertContainedSessionPath(worktree, path.join(worktree, "inside.txt"), {
      mustExist: true,
    })).resolves.toBe(path.join(worktree, "inside.txt"));
    await expect(assertContainedSessionPath(worktree, path.resolve(worktree, "..", "outside.txt")))
      .rejects.toMatchObject({ code: "PATH_OUTSIDE_WORKTREE" });
    await expect(assertContainedSessionPath(worktree, path.join(worktree, ".git", "config")))
      .rejects.toMatchObject({ code: "PATH_OUTSIDE_WORKTREE" });

    if (process.platform !== "win32") {
      const outside = await temporaryDirectory("harness-session-outside-");
      await writeFile(path.join(outside, "secret.txt"), "secret\n", "utf8");
      await symlink(outside, path.join(worktree, "escape"), "dir");
      await expect(assertContainedSessionPath(worktree, path.join(worktree, "escape", "secret.txt"), {
        mustExist: true,
      })).rejects.toMatchObject({ code: "PATH_OUTSIDE_WORKTREE" });
    }
  });
});

describe("session execution apply", () => {
  it("creates a one-parent result commit and ref without changing the caller worktree", async () => {
    const { root, baseCommit } = await createRepository();
    const sessionFile = await writeSourceSession(root);
    await writeFile(path.join(root, "caller-scratch.txt"), "do not stage\n", "utf8");
    const statusBefore = git(root, ["status", "--porcelain=v1"]).stdout;
    const plan = await createPlan(root, baseCommit, sessionFile);

    const receipt = await executeSessionExecutionPlan(plan, {
      runner: fakeRunner({ changeFiles: true }),
      now: (() => {
        const values = [
          new Date("2026-08-16T01:00:00.000Z"),
          new Date("2026-08-16T01:02:00.000Z"),
        ];
        return () => values.shift() ?? new Date("2026-08-16T01:02:00.000Z");
      })(),
    });

    expect(receipt).toMatchObject({
      status: "complete",
      planId: plan.planId,
      checkpoint: {
        sourceSessionId: "source-session-1",
        entryId: TARGET_ENTRY,
      },
      execution: {
        sessionId: "execution-session-1",
        model: { provider: "fixture", id: "no-network" },
      },
      result: {
        parent: baseCommit,
        ref: plan.output.ref,
        changedPaths: ["generated.txt"],
      },
      cleanup: { worktreeRemoved: true, warnings: [] },
    });
    expect(git(root, ["rev-parse", plan.output.ref]).stdout.trim()).toBe(receipt.result.commit);
    expect(git(root, ["rev-list", "--parents", "-n", "1", receipt.result.commit]).stdout.trim().split(" "))
      .toEqual([receipt.result.commit, baseCommit]);
    expect(git(root, ["show", `${receipt.result.commit}:generated.txt`]).stdout)
      .toBe("continued from checkpoint\n");
    expect(git(root, ["show", "-s", "--format=%B", receipt.result.commit]).stdout)
      .toContain("Harness-Session: execution-session-1");
    expect(git(root, ["rev-parse", "HEAD"]).stdout.trim()).toBe(baseCommit);
    expect(git(root, ["symbolic-ref", "--short", "HEAD"]).stdout.trim()).toBe("main");
    expect(git(root, ["status", "--porcelain=v1"]).stdout).toBe(statusBefore);

    const storedReceipt = JSON.parse(
      await readFile(path.join(plan.output.artifactDir, "receipt.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(storedReceipt.status).toBe("complete");
    expect(JSON.stringify(receipt)).not.toContain(plan.continuation.prompt);
    await expect(inspectPiCheckpoint(receipt.execution.sessionFile, TARGET_ENTRY)).resolves.toMatchObject({
      sessionId: "execution-session-1",
    });
  });

  it("fails closed and removes incomplete artifacts when the continuation changes nothing", async () => {
    const { root, baseCommit } = await createRepository();
    const sessionFile = await writeSourceSession(root);
    const plan = await createPlan(root, baseCommit, sessionFile);

    await expect(executeSessionExecutionPlan(plan, {
      runner: fakeRunner({ changeFiles: false }),
    })).rejects.toMatchObject({ code: "NO_CHANGES" });
    expect(git(root, ["show-ref", "--verify", "--quiet", plan.output.ref], [0, 1]).status).toBe(1);
    await expect(readFile(path.join(plan.output.artifactDir, "receipt.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    expect(git(root, ["worktree", "list", "--porcelain"]).stdout.match(/^worktree /gmu)).toHaveLength(1);
  });
});

describe("session executor CLI", () => {
  const cliPath = fileURLToPath(new URL("../dist/session-executor/cli.js", import.meta.url));

  it("writes a validated plan without invoking a model", async () => {
    const { root, baseCommit } = await createRepository();
    const sessionFile = await writeSourceSession(root);
    const planFile = path.join(await temporaryDirectory("harness-session-cli-plan-"), "plan.json");
    const result = spawnSync(process.execPath, [
      cliPath,
      "plan",
      "--workspace",
      root,
      "--base",
      baseCommit,
      "--session",
      sessionFile,
      "--entry",
      TARGET_ENTRY,
      "--prompt",
      "Continue from the CLI checkpoint.",
      "--commit-message",
      "feat(session): continue from cli",
      "--out",
      planFile,
      "--json",
    ], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schemaVersion: "session-execution-plan-v1",
      baseCommit,
      checkpoint: { sessionId: "source-session-1", entryId: TARGET_ENTRY },
    });
    await expect(readSessionExecutionPlan(planFile)).resolves.toMatchObject({
      workspace: { baseCommit },
      checkpoint: { entryId: TARGET_ENTRY },
    });
  });

  it("is help-first and requires explicit run confirmation before reading a plan", () => {
    const help = spawnSync(process.execPath, [cliPath, "--help"], { encoding: "utf8" });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Harness Session Executor POC");

    const guarded = spawnSync(process.execPath, [cliPath, "run", "--plan", "missing.json"], {
      encoding: "utf8",
    });
    expect(guarded.status).toBe(64);
    expect(guarded.stderr).toContain("run requires --yes");
    expect(guarded.stderr).not.toContain("PLAN_NOT_FOUND");
  });
});

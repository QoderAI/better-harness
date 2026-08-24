import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { createSessionExecutionPlan } from "@qoder-ai/harness/session-executor";
import { afterEach, describe, expect, it } from "vitest";
import { createCheckpointHistoryCatalogAdapter } from "../../src/server/query/checkpoint-history.js";
import { lockHistoryExperiment } from "../../src/server/experiment-lock.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("checkpoint history adapter and experiment lock", () => {
  it("lists opaque rows, resolves a validated checkpoint, and creates no worktree", async () => {
    const fixture = await createHistoryFixture({ requestVerified: true, startCheckpointVerified: true });
    const adapter = createCheckpointHistoryCatalogAdapter(fixture.catalogPath);

    const history = await adapter.list();
    expect(history).toEqual({
      adapter: { id: "pi-project-history-v1", label: "Project agent history" },
      items: [expect.objectContaining({
        id: "episode_one",
        title: "Inspect checkpoint runner",
        requestPreview: "Inspect the checkpoint runner.",
        provenance: "verified-history",
        checkpointVerified: true,
      })],
    });
    expect(JSON.stringify(history)).not.toContain(fixture.root);

    const resolved = await adapter.resolve("episode_one", 2);
    expect(resolved.checkpointSource).toMatchObject({
      status: "ready",
      materialization: { count: 2, timing: "on-run" },
    });
    expect(resolved.request).toMatchObject({ verified: true, prompt: "Inspect the checkpoint runner.\n" });
    expect(git(fixture.repository, ["worktree", "list", "--porcelain"]).match(/^worktree /gm)).toHaveLength(1);
  });

  it("rejects catalog paths that escape their source directory", async () => {
    const fixture = await createHistoryFixture({ requestVerified: true, startCheckpointVerified: true });
    const catalog = JSON.parse(await readFile(fixture.catalogPath, "utf8")) as { items: Array<{ request: { prompt: string } }> };
    catalog.items[0]!.request.prompt = "../private-prompt.md";
    await writeFile(fixture.catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

    await expect(createCheckpointHistoryCatalogAdapter(fixture.catalogPath).list())
      .rejects.toThrow(/portable catalog-owned relative path/);
  });

  it("writes one content-addressed lock and carries only verified history identity", async () => {
    const fixture = await createHistoryFixture({ requestVerified: true, startCheckpointVerified: true });
    const adapter = createCheckpointHistoryCatalogAdapter(fixture.catalogPath);
    const resolved = await adapter.resolve("episode_one", 2);
    const template = await createTemplate(fixture.root, fixture.digest);
    const outputRoot = join(fixture.root, "locks");

    const first = await lockHistoryExperiment({ templateManifestPath: template, history: resolved, outputRoot });
    const second = await lockHistoryExperiment({ templateManifestPath: template, history: resolved, outputRoot });

    expect(second.receipt.lockId).toBe(first.receipt.lockId);
    expect((await readdir(outputRoot)).filter((entry) => entry.startsWith("lock_"))).toEqual([first.receipt.lockId]);
    const manifest = JSON.parse(await readFile(first.manifestPath, "utf8")) as {
      checkpointRef: { digest: string };
      lanes: Array<{ origin: string; startCheckpointDigest?: string; identity?: { promptHash?: string } }>;
    };
    const observed = manifest.lanes.find((lane) => lane.origin === "observed");
    expect(manifest.checkpointRef.digest).toBe(fixture.digest);
    expect(observed).toMatchObject({
      startCheckpointDigest: fixture.digest,
      identity: { promptHash: resolved.request.promptHash },
    });
    expect(await readFile(join(first.manifestPath, "..", "skills", "deep-guide", "SKILL.md"), "utf8"))
      .toBe("Inspect evidence before conclusions.\n");
    expect(git(fixture.repository, ["worktree", "list", "--porcelain"]).match(/^worktree /gm)).toHaveLength(1);
  });

  it("retains named provenance gaps for an unverified imported episode", async () => {
    const fixture = await createHistoryFixture({ requestVerified: false, startCheckpointVerified: false });
    const adapter = createCheckpointHistoryCatalogAdapter(fixture.catalogPath);
    const resolved = await adapter.resolve("episode_one", 2);
    const template = await createTemplate(fixture.root, fixture.digest);
    const locked = await lockHistoryExperiment({
      templateManifestPath: template,
      history: resolved,
      outputRoot: join(fixture.root, "locks"),
    });
    const manifest = JSON.parse(await readFile(locked.manifestPath, "utf8")) as {
      lanes: Array<{ origin: string; startCheckpointDigest?: string; identity?: { promptHash?: string } }>;
    };
    const observed = manifest.lanes.find((lane) => lane.origin === "observed");
    expect(observed?.startCheckpointDigest).toBeUndefined();
    expect(observed?.identity?.promptHash).toBeUndefined();
  });
});

async function createHistoryFixture(options: {
  requestVerified: boolean;
  startCheckpointVerified: boolean;
}): Promise<{ root: string; repository: string; catalogPath: string; digest: string }> {
  const root = await temporaryDirectory("studio-history-");
  const repository = join(root, "repository");
  await mkdir(repository);
  git(repository, ["init", "--initial-branch=main"]);
  git(repository, ["config", "user.name", "Harness Test"]);
  git(repository, ["config", "user.email", "harness-test@example.com"]);
  await writeFile(join(repository, "README.md"), "# fixture\n", "utf8");
  git(repository, ["add", "."]);
  git(repository, ["commit", "-m", "test: seed fixture"]);
  const baseCommit = git(repository, ["rev-parse", "HEAD"]);
  const timestamp = "2026-08-17T00:00:00.000Z";
  const sessionFile = join(root, "session.jsonl");
  await writeFile(sessionFile, [
    { type: "session", version: CURRENT_SESSION_VERSION, id: "history-session", timestamp, cwd: repository },
    { type: "custom", id: "root0001", parentId: null, timestamp, customType: "fixture" },
    { type: "custom", id: "checkpoint", parentId: "root0001", timestamp, customType: "fixture" },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n", "utf8");
  const plan = await createSessionExecutionPlan({
    workspace: repository,
    base: baseCommit,
    sessionFile,
    entryId: "checkpoint",
    prompt: "Continue from checkpoint.",
    commitMessage: "test: history continuation",
  });
  const planSource = `${JSON.stringify(plan, null, 2)}\n`;
  await writeFile(join(root, "checkpoint.json"), planSource, "utf8");
  await writeFile(join(root, "prompt.md"), "Inspect the checkpoint runner.\n", "utf8");
  await writeFile(join(root, "trajectory.jsonl"), `${JSON.stringify({ type: "tool-call-started", toolCallId: "read", toolName: "Read", input: { path: "README.md" } })}\n`, "utf8");
  const digest = `sha256:${createHash("sha256").update(planSource).digest("hex")}`;
  const catalogPath = join(root, "history.json");
  await writeFile(catalogPath, `${JSON.stringify({
    schemaVersion: "checkpoint-history.v1",
    adapter: { id: "pi-project-history-v1", label: "Project agent history" },
    items: [{
      id: "episode_one",
      title: "Inspect checkpoint runner",
      occurredAt: timestamp,
      checkpointRef: { plan: "./checkpoint.json", digest },
      request: { prompt: "./prompt.md", verified: options.requestVerified },
      observed: {
        trajectory: "./trajectory.jsonl",
        startCheckpointVerified: options.startCheckpointVerified,
        identity: { harnessId: "checkpoint-agent", model: "performance" },
      },
    }],
  }, null, 2)}\n`, "utf8");
  return { root, repository, catalogPath, digest };
}

async function createTemplate(root: string, digest: string): Promise<string> {
  const template = join(root, "template");
  await mkdir(join(template, "skills", "deep-guide"), { recursive: true });
  await writeFile(join(template, "skills", "deep-guide", "SKILL.md"), "Inspect evidence before conclusions.\n", "utf8");
  await writeFile(join(template, "agent.harness"), `
language 0.3
skill deep-guide { source "./skills/deep-guide" }
workflow single-pass { session coder }
harness checkpoint-agent {
  workflow single-pass
  agent coder { use skill deep-guide }
}
runtime qoder { adapter "@harness/adapter-qoder" }
deployment checkpoint-agent-qoder { harness checkpoint-agent runtime qoder }
`, "utf8");
  await writeFile(join(template, "checkpoint.json"), "{}\n", "utf8");
  await writeFile(join(template, "prompt.md"), "Template request.\n", "utf8");
  await writeFile(join(template, "history.jsonl"), "{}\n", "utf8");
  await writeFile(join(template, "grader.json"), "{}\n", "utf8");
  const manifestPath = join(template, "experiment.json");
  await writeFile(manifestPath, `${JSON.stringify({
    schemaVersion: "harness-experiment.v1",
    harness: "./agent.harness",
    checkpointRef: { plan: "./checkpoint.json", digest },
    task: {
      prompt: "./prompt.md",
      expectedFiles: ["README.md"],
      grader: { kind: "readme-package-v1", contract: "./grader.json" },
    },
    runtime: {
      host: "qoder",
      tools: ["Read", "Write", "Edit", "Bash"],
      allowedTools: [],
      disallowedTools: ["WebFetch", "WebSearch", "Agent", "Task"],
      permissionMode: "default",
      maxTurns: 8,
      timeoutMs: 30_000,
      network: "deny",
      enableFileCheckpointing: false,
    },
    lanes: [
      { id: "history", origin: "observed", trajectory: "./history.jsonl" },
      { id: "default", origin: "execute", harnessId: "checkpoint-agent", trials: 1, runtime: { profile: "qoder-default-v1", model: "performance" } },
      { id: "minimal", origin: "execute", harnessId: "checkpoint-agent", trials: 1, runtime: { profile: "qoder-minimal-v1", model: "performance" } },
    ],
    contrasts: [
      { id: "profile", lanes: ["default", "minimal"] },
      { id: "history-context", lanes: ["history", "default", "minimal"] },
    ],
    trials: { seed: 17, order: "randomized" },
  }, null, 2)}\n`, "utf8");
  return manifestPath;
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

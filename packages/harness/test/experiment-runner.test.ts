import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { HarnessRunEmitter, type HarnessExecutor } from "../src/exec/index.js";
import { runHarnessExperiment, type ExperimentRunEvent } from "../src/experiment/runner.js";
import { createSessionExecutionPlan } from "../src/session-executor/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("checkpoint experiment runner", () => {
  it("preflights once, serializes materialization, then executes lanes in parallel", async () => {
    const root = await temporaryDirectory("harness-experiment-repo-");
    git(root, ["init", "--initial-branch=main"]);
    git(root, ["config", "user.name", "Harness Test"]);
    git(root, ["config", "user.email", "harness-test@example.com"]);
    await writeFile(join(root, "README.md"), "# fixture\n", "utf8");
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture", type: "module", exports: "./index.js" }), "utf8");
    await writeFile(join(root, "index.js"), "export const value = 1;\n", "utf8");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "test: seed fixture"]);
    const baseCommit = git(root, ["rev-parse", "HEAD"]);

    const fixture = await temporaryDirectory("harness-experiment-fixture-");
    const sessionFile = join(fixture, "session.jsonl");
    const timestamp = "2026-08-17T00:00:00.000Z";
    await writeFile(sessionFile, [
      { type: "session", version: CURRENT_SESSION_VERSION, id: "source-session", timestamp, cwd: root },
      { type: "custom", id: "root0001", parentId: null, timestamp, customType: "fixture" },
      { type: "custom", id: "target02", parentId: "root0001", timestamp, customType: "fixture" },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n", "utf8");
    const plan = await createSessionExecutionPlan({
      workspace: root,
      base: baseCommit,
      sessionFile,
      entryId: "target02",
      prompt: "Continue from checkpoint.",
      commitMessage: "test: experiment continuation",
    });
    const planPath = join(fixture, "checkpoint.json");
    const planSource = `${JSON.stringify(plan, null, 2)}\n`;
    await writeFile(planPath, planSource, "utf8");
    // A recorded historical continuation may already own the plan's original
    // output ref. Experiments reuse the checkpoint identity, not that output.
    git(root, ["update-ref", plan.output.ref, baseCommit]);
    const digest = `sha256:${createHash("sha256").update(planSource).digest("hex")}`;
    await writeFile(join(fixture, "agent.harness"), `
      language 0.3
      skill inspect { description "Inspect before editing." }
      workflow single-pass { session coder }
      harness checkpoint-agent {
        workflow single-pass
        agent coder { use skill inspect }
      }
      runtime qoder { adapter "@harness/adapter-qoder" }
      deployment checkpoint-agent-qoder { harness checkpoint-agent runtime qoder }
    `, "utf8");
    await writeFile(join(fixture, "prompt.md"), "Inspect the fixture.\n", "utf8");
    await writeFile(join(fixture, "grader.json"), JSON.stringify({
      requiredHeadings: ["fixture"],
      publicApi: ["value"],
      requiredCodeTokens: ["value"],
      requiredAnyCodeTokens: [["value"]],
      forbiddenClaims: [],
      exampleLanguages: ["js"],
      forbidRemoteLinks: true,
    }), "utf8");
    const manifestPath = join(fixture, "experiment.json");
    await writeFile(manifestPath, JSON.stringify({
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
        { id: "default", origin: "execute", harnessId: "checkpoint-agent", trials: 1, runtime: { profile: "qoder-default-v1", model: "performance" } },
        { id: "minimal", origin: "execute", harnessId: "checkpoint-agent", trials: 1, runtime: { profile: "qoder-minimal-v1", model: "performance" } },
      ],
      contrasts: [{ id: "profile", lanes: ["default", "minimal"] }],
      trials: { seed: 17, order: "randomized" },
    }, null, 2) + "\n", "utf8");

    let active = 0;
    let maximumActive = 0;
    let arrivals = 0;
    let release!: () => void;
    const bothStarted = new Promise<void>((resolvePromise) => { release = resolvePromise; });
    const events: ExperimentRunEvent[] = [];
    const executorFactory = (context: Parameters<NonNullable<Parameters<typeof runHarnessExperiment>[0]["executorFactory"]>>[0]): HarnessExecutor => ({
      host: "qoder",
      async execute(revision) {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        arrivals += 1;
        if (arrivals === 2) release();
        await bothStarted;
        const emitter = new HarnessRunEmitter(context.onRunEvent);
        emitter.start({ revisionId: revision.revisionId, host: "qoder" });
        emitter.toolCall("Read", {
          toolUseId: `read-${context.lane.id}`,
          input: { path: join(context.worktree, "README.md") },
        });
        emitter.finish(0);
        active -= 1;
        return { host: "qoder", revisionId: revision.revisionId, exitCode: 0, output: "done", errorOutput: "", warnings: [] };
      },
    });

    const outputDirectory = join(fixture, "evidence");
    const compareSet = await runHarnessExperiment({
      manifestPath,
      outputDirectory,
      experimentId: "exp_parallel_test",
      executorFactory,
      onEvent: (event) => events.push(event),
    });

    expect(maximumActive).toBe(2);
    expect(compareSet.trials).toHaveLength(2);
    expect(compareSet.checkpoint.completeness.kind).toBe("clean-tree");
    expect(events.filter((event) => event.type === "lane-ready")).toHaveLength(2);
    expect(events.filter((event) => event.type === "lane-event")).toEqual(expect.arrayContaining([
      expect.objectContaining({ experimentId: "exp_parallel_test", laneId: "default", runId: "exp_parallel_test:default:1" }),
      expect.objectContaining({ experimentId: "exp_parallel_test", laneId: "minimal", runId: "exp_parallel_test:minimal:1" }),
    ]));
    expect(JSON.stringify(events)).not.toContain(root);
    expect(JSON.stringify(events)).toContain("<trial-root>/README.md");
    expect(JSON.parse(await readFile(join(outputDirectory, "compare-set.json"), "utf8"))).toMatchObject({
      schemaVersion: "harness-compare-set.v2",
    });
    expect(git(root, ["worktree", "list", "--porcelain"]).match(/^worktree /gm)).toHaveLength(1);
    expect(git(root, ["for-each-ref", "--format=%(refname)", "refs/better-harness/experiments/exp_parallel_test"])
      .split("\n").filter(Boolean)).toHaveLength(2);
  });
});

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

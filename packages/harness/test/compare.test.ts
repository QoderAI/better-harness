import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { HarnessExecutor } from "../src/exec/executor.js";
import { loadSkillDeliveries } from "../src/exec/index.js";
import { gradeReadmePackage } from "../src/compare/grader.js";
import { loadHarnessCompareManifest, resolveHarnessCompareRuntime } from "../src/compare/manifest.js";
import { createBoundedQoderPermissionCallback, type ToolPermissionDecision } from "../src/compare/permissions.js";
import { npmInvocation, runCommand } from "../src/compare/process.js";
import { runHarnessComparison } from "../src/compare/runner.js";
import { trustedFixtureEnvironment } from "../src/compare/sandbox.js";
import { parseHarnessCompareVerdict } from "../src/compare/verdict.js";
import { parseHarnessCompareVerdictDirectory } from "../src/compare/verdict-directory.js";

const EXPERIMENT_URL = new URL("../examples/readme-compare/experiment.json", import.meta.url);
const MINIMAL_EXPERIMENT_URL = new URL(
  "../examples/readme-compare/minimal-profile-experiment.json",
  import.meta.url,
);
const EXPERIMENT_PATH = fileURLToPath(EXPERIMENT_URL);
const MINIMAL_EXPERIMENT_PATH = fileURLToPath(MINIMAL_EXPERIMENT_URL);
const CONTRACT_PATH = fileURLToPath(new URL("../examples/readme-compare/grader-contract.json", import.meta.url));
const FIXTURE_URL = new URL("../examples/readme-compare/fixture", import.meta.url);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("harness compare manifest", () => {
  it("loads the frozen README experiment with owned relative paths", async () => {
    const loaded = await loadHarnessCompareManifest(EXPERIMENT_PATH);

    expect(loaded.value).toMatchObject({
      schemaVersion: "harness-compare.v1",
      variants: { baseline: "readme-baseline", candidate: "readme-grounded" },
      runtime: { host: "qoder", permissionMode: "default", network: "deny" },
    });
    expect(loaded.resolved.fixture).toBe(fileURLToPath(FIXTURE_URL));
  });

  it("rejects every auto-approved tool surface", async () => {
    const directory = await makeTemporaryDirectory();
    const manifest = JSON.parse(await readFile(EXPERIMENT_URL, "utf8")) as {
      runtime: { allowedTools: string[] };
    };
    manifest.runtime.allowedTools = ["Bash"];
    const path = join(directory, "experiment.json");
    await writeFile(path, JSON.stringify(manifest), "utf8");

    await expect(loadHarnessCompareManifest(path)).rejects.toThrow(/allowedTools must be empty/);
  });

  it("accepts an isolated same-harness comparison when runtime profiles differ", async () => {
    const loaded = await loadHarnessCompareManifest(MINIMAL_EXPERIMENT_PATH);

    expect(loaded.value.variants).toEqual({
      baseline: "readme-grounded",
      candidate: "readme-grounded",
    });
    expect(resolveHarnessCompareRuntime(loaded.value, "baseline")).toMatchObject({
      profile: "qoder-default-v1",
      tools: ["Read", "Glob", "Grep", "Edit", "Write", "Bash"],
    });
    expect(resolveHarnessCompareRuntime(loaded.value, "candidate")).toMatchObject({
      profile: "qoder-minimal-v1",
      tools: ["Read", "Write", "Edit", "Bash"],
    });
  });

  it("rejects a denied network that leaves a web tool reachable", async () => {
    const directory = await makeTemporaryDirectory();
    const manifest = JSON.parse(await readFile(EXPERIMENT_URL, "utf8")) as {
      runtime: { network: string; disallowedTools: string[] };
    };
    expect(manifest.runtime.network).toBe("deny");
    manifest.runtime.disallowedTools = manifest.runtime.disallowedTools.filter((tool) => tool !== "WebFetch");
    const path = join(directory, "experiment.json");
    await writeFile(path, JSON.stringify(manifest), "utf8");

    await expect(loadHarnessCompareManifest(path)).rejects.toThrow(/network 'deny' requires disallowedTools/);
  });
});

describe("bounded Qoder permissions", () => {
  it("allows owned file operations and frozen validation commands", async () => {
    const directory = await makeTemporaryDirectory();
    const decisions: ToolPermissionDecision[] = [];
    const callback = createBoundedQoderPermissionCallback(directory, decisions, ["README.md"]);

    await expect(callback("Write", { file_path: "README.md" }, toolOptions())).resolves.toEqual({ behavior: "allow" });
    await expect(callback("Bash", { command: "npm test" }, toolOptions())).resolves.toEqual({ behavior: "allow" });
    expect(decisions.map((decision) => decision.behavior)).toEqual(["allow", "allow"]);
  });

  it("denies repository escapes, command chaining, network tools, and unknown commands", async () => {
    const directory = await makeTemporaryDirectory();
    const callback = createBoundedQoderPermissionCallback(directory, [], ["README.md"]);

    await expect(callback("Write", { file_path: "../outside.md" }, toolOptions())).resolves.toMatchObject({ behavior: "deny" });
    await expect(callback("Write", { file_path: "package.json" }, toolOptions())).resolves.toMatchObject({ behavior: "deny" });
    await expect(callback("Write", { file_path: ".git/config" }, toolOptions())).resolves.toMatchObject({ behavior: "deny" });
    await expect(callback("Bash", { command: "npm test && curl example.com" }, toolOptions())).resolves.toMatchObject({ behavior: "deny" });
    await expect(callback("WebFetch", { url: "https://example.com" }, toolOptions())).resolves.toMatchObject({ behavior: "deny" });
    await expect(callback("Bash", { command: "pwd" }, toolOptions())).resolves.toMatchObject({ behavior: "deny" });
  });
});

describe("validation command execution", () => {
  it("drops credential canaries from the trusted-fixture child environment", () => {
    const env = trustedFixtureEnvironment({
      PATH: "/bin",
      HOME: "/tmp/home",
      GITHUB_TOKEN: "secret",
      AWS_SECRET_ACCESS_KEY: "secret",
    });

    expect(env).toEqual({ PATH: "/bin", HOME: "/tmp/home" });
  });

  it("runs npm without a shell on this host", async () => {
    const directory = await makeTemporaryDirectory();
    const invocation = npmInvocation(["--version"]);

    const result = await runCommand(invocation.command, invocation.args, {
      cwd: directory,
      timeoutMs: 60_000,
      env: process.env,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("README coding comparison", () => {
  it("rejects malformed persisted verdict values at the compare owner boundary", () => {
    expect(() => parseHarnessCompareVerdict({
      schemaVersion: "harness-compare-result.v1",
      status: "accept",
      reason: "invalid fixture",
      treatmentAxis: "harness",
      policy: {
        minimumMatchedPairs: 5,
        maxInfrastructureErrorRatio: 0.2,
        maxCostRatio: 1.25,
        minimumMeanScoreGain: 5,
      },
      manifestHash: "manifest",
      fixtureHash: "fixture",
      harnessHash: "harness",
      sandbox: {
        policy: "trusted-fixture",
        envPolicy: "allowlist",
        envKeys: [],
        networkPolicy: "unverified",
        fsScope: "trial-root",
        permissionFlags: [],
      },
      matchedPairs: { pairs: 0, candidateWins: 0, baselineWins: 0, ties: 0, meanScoreDelta: 0 },
      baseline: {
        trials: 1,
        completedTrials: 1,
        infrastructureErrors: 0,
        passedTrials: 1,
        passRate: 1,
        meanScore: 100,
        totalCostUsd: "0.01",
        totalCredits: 0,
      },
      candidate: {},
      trials: [],
    })).toThrow(/baseline.totalCostUsd/);
  });

  it("rejects a persisted verdict whose decision policy sits below the evidence floor", () => {
    expect(() => parseHarnessCompareVerdict({
      schemaVersion: "harness-compare-result.v1",
      status: "accept",
      reason: "one lucky pair",
      treatmentAxis: "harness",
      // A verdict may demand more evidence than the default, never less.
      policy: {
        minimumMatchedPairs: 1,
        maxInfrastructureErrorRatio: 0.2,
        maxCostRatio: 1.25,
        minimumMeanScoreGain: 5,
      },
      manifestHash: "manifest",
      fixtureHash: "fixture",
      harnessHash: "harness",
      matchedPairs: { pairs: 1, candidateWins: 1, baselineWins: 0, ties: 0, meanScoreDelta: 100 },
      baseline: {},
      candidate: {},
      trials: [],
    })).toThrow(/policy.minimumMatchedPairs/);
  });

  it("rejects generated examples that request host capabilities", async () => {
    const directory = await makeTemporaryDirectory();
    await cp(FIXTURE_URL, directory, { recursive: true, force: true });
    await writeFile(
      join(directory, "README.md"),
      VALID_README.replace("console.log(value);", "console.log(process.env);"),
      "utf8",
    );

    const grade = await gradeReadmePackage({
      trialRoot: directory,
      contractPath: CONTRACT_PATH,
      changedFiles: ["README.md"],
      expectedFiles: ["README.md"],
    });

    expect(grade.checks.find((item) => item.id === "quick-start")).toMatchObject({
      passed: false,
      command: { stderr: expect.stringContaining("outside the isolated example policy") },
    });
  });

  it("grades a tampered package entry point without loading it into the grader", async () => {
    const directory = await makeTemporaryDirectory();
    await cp(FIXTURE_URL, directory, { recursive: true, force: true });
    await writeFile(join(directory, "README.md"), VALID_README, "utf8");
    await writeFile(
      join(directory, "src/index.mjs"),
      "globalThis.harnessGraderTampered = true;\nthrow new Error('tampered entry point');\n",
      "utf8",
    );

    const grade = await gradeReadmePackage({
      trialRoot: directory,
      contractPath: CONTRACT_PATH,
      changedFiles: ["README.md", "src/index.mjs"],
      expectedFiles: ["README.md"],
    });

    expect("harnessGraderTampered" in globalThis).toBe(false);
    expect(grade.passed).toBe(false);
    expect(grade.checks.find((item) => item.id === "public-api")).toMatchObject({
      passed: false,
      command: { stderr: expect.stringContaining("tampered entry point") },
    });
    expect(grade.checks.find((item) => item.id === "scope")).toMatchObject({ passed: false });
  });

  it("reports insufficient_evidence when a single matched pair is all the evidence there is", async () => {
    const directory = await makeTemporaryDirectory();
    const output = join(directory, "evidence");
    const fixtureReadme = new URL("../examples/readme-compare/fixture/README.md", import.meta.url);
    await expect(readFile(fixtureReadme, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    const verdict = await runHarnessComparison({
      manifestPath: EXPERIMENT_PATH,
      outputDirectory: output,
      trialCount: 1,
      executorFactory: ({ trialRoot }): HarnessExecutor => ({
        host: "qoder",
        execute: async (revision) => {
          if (revision.harness.id === "readme-grounded") {
            await writeFile(join(trialRoot, "README.md"), VALID_README, "utf8");
          }
          return {
            host: "qoder",
            revisionId: revision.revisionId,
            exitCode: 0,
            output: "completed",
            errorOutput: "",
            warnings: [],
            trace: [{ type: "result", subtype: "success", file_path: join(trialRoot, "README.md") }],
            metrics: { durationMs: 10, turns: 1, costUsd: 0.001 },
          };
        },
      }),
    });

    const candidateTrial = verdict.trials.find((trial) => trial.variant === "candidate");
    const quickStart = candidateTrial?.grade.checks.find((item) => item.id === "quick-start");
    expect(quickStart?.command?.stderr).toBe("");
    expect(quickStart).toMatchObject({ passed: true });
    // The candidate won the only pair that ran. One pair is a smoke test, so the
    // verdict withholds promotion instead of calling a coin flip an improvement.
    expect(verdict.status).toBe("insufficient_evidence");
    expect(verdict.reason).toMatch(/matched pair/);
    expect(verdict.matchedPairs).toMatchObject({ pairs: 1, candidateWins: 1, baselineWins: 0 });
    expect(verdict.treatmentAxis).toBe("harness");
    expect(verdict.baseline).toMatchObject({ passedTrials: 0, meanScore: 0 });
    expect(verdict.candidate).toMatchObject({ passedTrials: 1, meanScore: 100 });
    // Cost is reported per completed trial, because totals across unequal
    // completion counts are not comparable.
    expect(verdict.candidate.costPerCompletedTrialUsd).toBe(0.001);
    expect(candidateTrial).toMatchObject({
      classification: "passed",
      changedFiles: ["README.md"],
      grade: { passed: true, score: 100 },
      sandbox: {
        policy: "trusted-fixture",
        envPolicy: "allowlist",
        networkPolicy: "unverified",
        fsScope: "trial-root",
      },
    });
    expect(await parseHarnessCompareVerdictDirectory(output)).toEqual(verdict);
    expect(JSON.parse(await readFile(join(output, "H1/revision.json"), "utf8"))).toMatchObject({
      revisionId: candidateTrial?.revisionId,
    });
    expect(JSON.parse(await readFile(join(output, "H1/resolution-report.json"), "utf8"))).toMatchObject({
      status: "resolved",
    });
    expect(JSON.parse(await readFile(join(output, "H1/materialization-receipt.json"), "utf8"))).toMatchObject({
      revisionId: candidateTrial?.revisionId,
    });
    expect(JSON.parse(await readFile(join(output, "H1/trial-001/sandbox-receipt.json"), "utf8"))).toMatchObject({
      networkPolicy: "unverified",
    });
    expect(await readFile(join(output, "H1/trial-001/patch.diff"), "utf8")).toContain("README.md");
    expect(await readFile(join(output, "H1/trial-001/patch.diff"), "utf8")).toContain("+# Retry Kit");
    const redactedTrace = await readFile(join(output, "H1/trial-001/trace.jsonl"), "utf8");
    const traceEvent = JSON.parse(redactedTrace.trim()) as { file_path?: string };
    expect(traceEvent.file_path?.replaceAll("\\", "/")).toBe("<trial-root>/README.md");
    expect(JSON.parse(await readFile(join(output, "H1/trial-001/validation.json"), "utf8"))).toMatchObject({ passed: true });
    const persistedVerdict = JSON.parse(await readFile(join(output, "verdict.json"), "utf8")) as unknown;
    expect(parseHarnessCompareVerdict(persistedVerdict)).toEqual(verdict);
    expect(await readFile(join(output, "verdict.html"), "utf8")).toContain("Harness compare verdict");
    await expect(readFile(fixtureReadme, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    // The trial rows are the evidence: an edited summary no longer parses.
    const forged = structuredClone(persistedVerdict) as { baseline: { meanScore: number } };
    forged.baseline.meanScore = 100;
    expect(() => parseHarnessCompareVerdict(forged)).toThrow(/baseline.meanScore is 100/);

    const promoted = structuredClone(persistedVerdict) as {
      status: string;
      reason: string;
      policy: { minimumMatchedPairs: number };
    };
    promoted.policy.minimumMatchedPairs = 5;
    promoted.status = "accept";
    promoted.reason = "forged promotion";
    expect(() => parseHarnessCompareVerdict(promoted)).toThrow(
      /status is 'accept'.*compute 'insufficient_evidence'/,
    );
  });

  it("locks and delivers a source-backed skill declared by a compared harness", async () => {
    const directory = await makeTemporaryDirectory();
    const output = join(directory, "evidence");
    const harnessDirectory = join(directory, "harnesses");
    await mkdir(harnessDirectory, { recursive: true });

    const sourceBackedHarness = `
      language 0.3
      skill coding-loop-discipline {
        description "Inspect the repository, make the requested scoped change, and validate it."
      }
      skill deep-guide {
        source "./skills/deep-guide"
      }
      workflow readme-loop {
        session writer
      }
      harness readme-baseline {
        workflow readme-loop
        agent writer {
          use skill coding-loop-discipline
          use skill deep-guide
        }
      }
      harness readme-grounded {
        workflow readme-loop
        agent writer {
          use skill coding-loop-discipline
        }
      }
      runtime qoder { adapter "@harness/adapter-qoder" }
      deployment readme-baseline-qoder { harness readme-baseline runtime qoder }
      deployment readme-grounded-qoder { harness readme-grounded runtime qoder }
    `;
    await writeFile(join(harnessDirectory, "readme-compare.harness"), sourceBackedHarness, "utf8");
    await mkdir(join(harnessDirectory, "skills", "deep-guide"), { recursive: true });
    await writeFile(
      join(harnessDirectory, "skills", "deep-guide", "SKILL.md"),
      "Never touch generated files.\n",
      "utf8",
    );
    await cp(fileURLToPath(new URL("../examples/readme-compare/fixture", import.meta.url)), join(directory, "fixture"), { recursive: true });
    await cp(fileURLToPath(new URL("../examples/readme-compare/prompt.md", import.meta.url)), join(directory, "prompt.md"));
    await cp(
      fileURLToPath(new URL("../examples/readme-compare/grader-contract.json", import.meta.url)),
      join(directory, "grader-contract.json"),
    );
    const manifest = JSON.parse(await readFile(EXPERIMENT_URL, "utf8")) as Record<string, unknown>;
    manifest.harness = "./harnesses/readme-compare.harness";
    await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest), "utf8");

    const seenRuns: Array<{
      harnessId: string;
      sourceLocks: unknown[];
      sourceRoot: string | undefined;
      deliveredBody: string | undefined;
    }> = [];
    const verdict = await runHarnessComparison({
      manifestPath: join(directory, "manifest.json"),
      outputDirectory: output,
      trialCount: 1,
      executorFactory: ({ trialRoot }): HarnessExecutor => ({
        host: "qoder",
        execute: async (revision, bundle, task) => {
          const deliveries = await loadSkillDeliveries(revision, bundle, { sourceRoot: task.sourceRoot });
          seenRuns.push({
            harnessId: revision.harness.id,
            sourceLocks: [...revision.sourceLocks],
            sourceRoot: task.sourceRoot,
            deliveredBody: deliveries.get("deep-guide")?.body,
          });
          if (revision.harness.id === "readme-grounded") {
            await writeFile(join(trialRoot, "README.md"), VALID_README, "utf8");
          }
          return {
            host: "qoder",
            revisionId: revision.revisionId,
            exitCode: 0,
            output: "completed",
            errorOutput: "",
            warnings: [],
          };
        },
      }),
    });

    // Resolution succeeding at all is the point: before locking was wired in,
    // the baseline harness failed to resolve with "requires exactly one
    // content lock".
    expect(verdict.status).not.toBe("infrastructure_error");
    const baselineRun = seenRuns.find((entry) => entry.harnessId === "readme-baseline");
    expect(baselineRun?.sourceLocks).toEqual([
      expect.objectContaining({ capabilityId: "deep-guide", uri: "./skills/deep-guide" }),
    ]);
    expect(baselineRun?.sourceRoot).toBe(harnessDirectory);
    expect(baselineRun?.deliveredBody).toBe("Never touch generated files.\n");
  });

  it("accepts a candidate that wins the matched pairs its policy requires", async () => {
    const directory = await makeTemporaryDirectory();
    const output = join(directory, "evidence");

    const verdict = await runHarnessComparison({
      manifestPath: EXPERIMENT_PATH,
      outputDirectory: output,
      trialCount: 2,
      decisionPolicy: { minimumMatchedPairs: 2 },
      executorFactory: ({ trialRoot }): HarnessExecutor => ({
        host: "qoder",
        execute: async (revision) => {
          if (revision.harness.id === "readme-grounded") {
            await writeFile(join(trialRoot, "README.md"), VALID_README, "utf8");
          }
          return {
            host: "qoder",
            revisionId: revision.revisionId,
            exitCode: 0,
            output: "completed",
            errorOutput: "",
            warnings: [],
            trace: [{ type: "result", subtype: "success", file_path: join(trialRoot, "README.md") }],
            metrics: { durationMs: 10, turns: 1, costUsd: 0.001 },
          };
        },
      }),
    });

    expect(verdict.status).toBe("accept");
    expect(verdict.matchedPairs).toMatchObject({ pairs: 2, candidateWins: 2, baselineWins: 0 });
    expect(verdict.policy.minimumMatchedPairs).toBe(2);
    expect(parseHarnessCompareVerdict(JSON.parse(await readFile(join(output, "verdict.json"), "utf8")))).toEqual(verdict);
  });

  it("reports harness setup breakage as an infrastructure error instead of a coding outcome", async () => {
    const directory = await makeTemporaryDirectory();
    const output = join(directory, "evidence");

    const verdict = await runHarnessComparison({
      manifestPath: EXPERIMENT_PATH,
      outputDirectory: output,
      trialCount: 1,
      executorFactory: (): HarnessExecutor => {
        throw new Error("SDK worker could not start");
      },
    });

    expect(verdict.status).toBe("infrastructure_error");
    expect(verdict.trials).toHaveLength(2);
    expect(verdict.trials.every((trial) => trial.classification === "infrastructure_error")).toBe(true);
    expect(verdict.baseline).toMatchObject({ trials: 1, completedTrials: 0, infrastructureErrors: 1, passRate: 0 });
    expect(verdict.trials[0].grade.checks[0]).toMatchObject({
      id: "infrastructure",
      detail: expect.stringContaining("SDK worker could not start"),
    });
    expect(JSON.parse(await readFile(join(output, "H0/trial-001/metrics.json"), "utf8"))).toMatchObject({
      classification: "infrastructure_error",
      grade: { passed: false, score: 0 },
    });
  });

  it("routes each variant through its resolved Qoder runtime profile", async () => {
    const directory = await makeTemporaryDirectory();
    const output = join(directory, "evidence");
    const observed: Array<{ profile: string; tools: string[] }> = [];

    const verdict = await runHarnessComparison({
      manifestPath: MINIMAL_EXPERIMENT_PATH,
      outputDirectory: output,
      trialCount: 1,
      executorFactory: (context): HarnessExecutor => {
        observed.push({ profile: context.runtime.profile, tools: [...context.runtime.tools] });
        return {
          host: "qoder",
          execute: async (revision) => {
            await writeFile(join(context.trialRoot, "README.md"), VALID_README, "utf8");
            return {
              host: "qoder",
              revisionId: revision.revisionId,
              exitCode: 0,
              output: "completed",
              errorOutput: "",
              warnings: [],
              runtimeReceipt: {
                executor: "injected-test-executor",
                runtimeProfile: context.runtime.profile,
                tools: [...context.runtime.tools],
                allowedTools: [],
                disallowedTools: [...context.runtime.disallowedTools],
                permissionCallback: "configured",
              },
            };
          },
        };
      },
    });

    expect(observed).toEqual(expect.arrayContaining([
      {
        profile: "qoder-default-v1",
        tools: ["Read", "Glob", "Grep", "Edit", "Write", "Bash"],
      },
      {
        profile: "qoder-minimal-v1",
        tools: ["Read", "Write", "Edit", "Bash"],
      },
    ]));
    expect(verdict.trials).toEqual(expect.arrayContaining([
      expect.objectContaining({ variant: "baseline", runtimeProfile: "qoder-default-v1" }),
      expect.objectContaining({ variant: "candidate", runtimeProfile: "qoder-minimal-v1" }),
    ]));
    expect(JSON.parse(await readFile(join(output, "H1/trial-001/runtime-receipt.json"), "utf8")))
      .toMatchObject({ runtimeProfile: "qoder-minimal-v1", tools: ["Read", "Write", "Edit", "Bash"] });
  });
});

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "harness-compare-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function toolOptions(): { signal: AbortSignal; toolUseID: string } {
  return { signal: new AbortController().signal, toolUseID: "tool-use-1" };
}

const VALID_README = `# Retry Kit

## Purpose

\`@fixture/retry-kit\` retries asynchronous operations with abort support.

## Installation

\`\`\`sh
npm install @fixture/retry-kit
\`\`\`

## Quick Start

\`\`\`js
import { retry } from "@fixture/retry-kit";

const value = await retry(async () => "ready", { maxAttempts: 3 });
console.log(value);
\`\`\`

## API

- \`retry\` runs an asynchronous operation until it succeeds or exhausts its attempts.
- \`RetryExhaustedError\` reports the final failure.
- \`DEFAULT_MAX_ATTEMPTS\` exposes the default.

## Behavior

The default \`maxAttempts\` is \`3\`. An \`AbortSignal\` is checked before every attempt and while waiting for backoff.

## Verification

Run \`npm test\`.
`;

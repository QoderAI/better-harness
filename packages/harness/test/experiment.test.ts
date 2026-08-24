import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ReadmeGrade } from "../src/compare/grader.js";
import type { SandboxReceipt } from "../src/compare/sandbox.js";
import { deriveContrastAttribution, evaluateObservedLane } from "../src/experiment/axis.js";
import type { CheckpointCompleteness } from "../src/experiment/checkpoint.js";
import {
  buildExperimentCompareSet,
  type ContrastResult,
  type ExperimentTrialResult,
  type HarnessExperimentCompareSet,
} from "../src/experiment/compare-set.js";
import type { HarnessExperimentManifest } from "../src/experiment/contract.js";
import { loadHarnessExperimentManifest } from "../src/experiment/manifest.js";

const EXAMPLE_URL = new URL("../examples/checkpoint-experiment/experiment.json", import.meta.url);
const EXAMPLE_PATH = fileURLToPath(EXAMPLE_URL);
const DIGEST = "sha256:3f786850e387550fdab836ed7e6dc881de23001b8e2f4a1c9b2a2f9a3d5d3f3f";
const PROMPT_HASH = "sha256:0000000000000000000000000000000000000000000000000000000000000001";
const CLEAN_TREE: CheckpointCompleteness = { kind: "clean-tree", verifiedAt: "2026-08-17T00:00:00.000Z" };
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("harness-experiment.v1 manifest", () => {
  it("references the checkpoint instead of restating it", async () => {
    const loaded = await loadHarnessExperimentManifest(EXAMPLE_PATH);

    expect(loaded.value.checkpointRef).toEqual({ plan: "./checkpoint.json", digest: DIGEST });
    expect(loaded.resolved.checkpointPlan).toBe(
      fileURLToPath(new URL("../examples/checkpoint-experiment/checkpoint.json", import.meta.url)),
    );
    expect(loaded.resolved.trajectories).toEqual({
      history: fileURLToPath(
        new URL("../examples/checkpoint-experiment/history/trajectory.jsonl", import.meta.url),
      ),
    });
    // The checkpoint's own fields are not mirrored onto the experiment root.
    expect(loaded.value).not.toHaveProperty("workspace");
    expect(loaded.value).not.toHaveProperty("checkpoint");
  });

  it("carries per-lane model and profile while the host stays shared", async () => {
    const loaded = await loadHarnessExperimentManifest(EXAMPLE_PATH);
    const lanes = loaded.value.lanes;

    expect(loaded.value.runtime.host).toBe("qoder");
    expect(lanes.map((lane) => lane.origin)).toEqual(["observed", "execute", "execute"]);
    expect(lanes[1]).toMatchObject({
      origin: "execute",
      trials: 5,
      runtime: { profile: "qoder-default-v1", model: "performance" },
    });
    // A lane's runtime carries exactly profile and model, so it cannot move the host.
    for (const lane of lanes) {
      if (lane.origin !== "execute") continue;
      expect(Object.keys(lane.runtime).sort()).toEqual(["model", "profile"]);
    }
  });

  it("rejects an author-declared axis on a contrast", async () => {
    const path = await writeManifest((manifest) => {
      (manifest.contrasts[0] as unknown as Record<string, unknown>).axis = "model";
    });

    await expect(loadHarnessExperimentManifest(path)).rejects.toThrow(
      /Invalid harness-experiment\.v1 manifest/,
    );
  });

  it("rejects an author-declared mode on a contrast", async () => {
    const path = await writeManifest((manifest) => {
      (manifest.contrasts[0] as unknown as Record<string, unknown>).mode = "descriptive";
    });

    await expect(loadHarnessExperimentManifest(path)).rejects.toThrow(
      /Invalid harness-experiment\.v1 manifest/,
    );
  });

  it("rejects a contrast that references an unknown lane", async () => {
    const path = await writeManifest((manifest) => {
      manifest.contrasts[0]!.lanes = ["fresh-default", "ghost-lane"];
    });

    await expect(loadHarnessExperimentManifest(path)).rejects.toThrow(
      /references unknown lane 'ghost-lane'/,
    );
  });

  it("rejects an observed lane that started from another checkpoint", async () => {
    const path = await writeManifest((manifest) => {
      const lane = manifest.lanes[0]!;
      if (lane.origin !== "observed") throw new Error("fixture lane 0 must be observed");
      lane.startCheckpointDigest =
        "sha256:1111111111111111111111111111111111111111111111111111111111111111";
    });

    await expect(loadHarnessExperimentManifest(path)).rejects.toThrow(
      /started from a different checkpoint/,
    );
  });

  it("keeps imported history with no recorded checkpoint as contextual evidence", async () => {
    const manifest = await loadExample((draft) => {
      const lane = draft.lanes[0]!;
      if (lane.origin !== "observed") throw new Error("fixture lane 0 must be observed");
      delete lane.startCheckpointDigest;
    });
    const lane = manifest.lanes[0]!;
    if (lane.origin !== "observed") throw new Error("fixture lane 0 must be observed");

    expect(evaluateObservedLane(lane, {
      taskPromptHash: PROMPT_HASH,
      completeness: CLEAN_TREE,
    }).missing).toContain("startCheckpointDigest");
  });

  it("rejects an experiment with nothing fresh to execute", async () => {
    const path = await writeManifest((manifest) => {
      manifest.lanes = manifest.lanes.filter((lane) => lane.origin === "observed");
      manifest.lanes.push({ ...manifest.lanes[0]!, id: "history-two" });
      manifest.contrasts = [{ id: "only-history", lanes: ["history", "history-two"] }];
    });

    await expect(loadHarnessExperimentManifest(path)).rejects.toThrow(
      /at least one lane must have origin 'execute'/,
    );
  });

  it("rejects a trajectory path escaping the manifest directory", async () => {
    const path = await writeManifest((manifest) => {
      const lane = manifest.lanes[0]!;
      if (lane.origin !== "observed") throw new Error("fixture lane 0 must be observed");
      lane.trajectory = "../outside/trajectory.jsonl";
    });

    await expect(loadHarnessExperimentManifest(path)).rejects.toThrow(
      /not a portable relative path/,
    );
  });

  it("rejects duplicate lane ids", async () => {
    const path = await writeManifest((manifest) => {
      manifest.lanes[2]!.id = manifest.lanes[1]!.id;
    });

    await expect(loadHarnessExperimentManifest(path)).rejects.toThrow(/duplicate lane id/);
  });
});

describe("derived contrast attribution", () => {
  it("attributes a single moved axis over two execute lanes", async () => {
    const manifest = await loadExample();

    const attribution = deriveContrastAttribution(
      manifest,
      manifest.contrasts.find((contrast) => contrast.id === "profile-effect")!,
      { taskPromptHash: PROMPT_HASH, completeness: CLEAN_TREE },
    );

    expect(attribution).toMatchObject({ mode: "attributable", axis: "runtime-profile" });
    expect(attribution.movedAxes).toEqual(["runtime-profile"]);
  });

  it("attributes model when only the model differs", async () => {
    const manifest = await loadExample((draft) => {
      const lane = draft.lanes[2]!;
      if (lane.origin !== "execute") throw new Error("fixture lane 2 must execute");
      lane.runtime.profile = "qoder-default-v1";
      lane.runtime.model = "reasoning";
    });

    const attribution = deriveContrastAttribution(manifest, contrastNamed(manifest, "profile-effect"), {
      taskPromptHash: PROMPT_HASH,
      completeness: CLEAN_TREE,
    });

    expect(attribution).toMatchObject({ mode: "attributable", axis: "model" });
  });

  it("attributes harness when only the harness differs", async () => {
    const manifest = await loadExample((draft) => {
      const lane = draft.lanes[2]!;
      if (lane.origin !== "execute") throw new Error("fixture lane 2 must execute");
      lane.harnessId = "readme-baseline";
      lane.runtime.profile = "qoder-default-v1";
    });

    const attribution = deriveContrastAttribution(manifest, contrastNamed(manifest, "profile-effect"), {
      taskPromptHash: PROMPT_HASH,
      completeness: CLEAN_TREE,
    });

    expect(attribution).toMatchObject({ mode: "attributable", axis: "harness" });
  });

  it("refuses attribution when harness and model both move", async () => {
    const manifest = await loadExample((draft) => {
      const lane = draft.lanes[2]!;
      if (lane.origin !== "execute") throw new Error("fixture lane 2 must execute");
      lane.harnessId = "readme-baseline";
      lane.runtime.profile = "qoder-default-v1";
      lane.runtime.model = "reasoning";
    });

    const attribution = deriveContrastAttribution(manifest, contrastNamed(manifest, "profile-effect"), {
      taskPromptHash: PROMPT_HASH,
      completeness: CLEAN_TREE,
    });

    expect(attribution).toMatchObject({ mode: "descriptive", reason: "multi-axis" });
    expect(attribution.movedAxes).toEqual(["harness", "model"]);
  });

  it("calls an identical pair a repeatability measurement, not a treatment", async () => {
    const manifest = await loadExample((draft) => {
      const lane = draft.lanes[2]!;
      if (lane.origin !== "execute") throw new Error("fixture lane 2 must execute");
      lane.runtime.profile = "qoder-default-v1";
    });

    const attribution = deriveContrastAttribution(manifest, contrastNamed(manifest, "profile-effect"), {
      taskPromptHash: PROMPT_HASH,
      completeness: CLEAN_TREE,
    });

    expect(attribution).toMatchObject({ mode: "descriptive", reason: "no-axis-moved" });
    expect(attribution.movedAxes).toEqual([]);
  });

  it("keeps a three-lane contrast descriptive regardless of configuration", async () => {
    const manifest = await loadExample((draft) => {
      const lane = draft.lanes[0]!;
      if (lane.origin !== "observed") throw new Error("fixture lane 0 must be observed");
      lane.startCheckpointDigest = DIGEST;
      lane.identity = {
        harnessId: "readme-grounded",
        revisionId: "rev-1",
        profile: "qoder-default-v1",
        model: "performance",
        promptHash: PROMPT_HASH,
        environmentReceipt: "./history/environment.json",
      };
    });

    const attribution = deriveContrastAttribution(manifest, contrastNamed(manifest, "history-context"), {
      taskPromptHash: PROMPT_HASH,
      completeness: CLEAN_TREE,
    });

    expect(attribution).toMatchObject({ mode: "descriptive", reason: "lane-count" });
  });
});

describe("observed lane eligibility", () => {
  it("names every missing identity fact on a partially recorded trajectory", async () => {
    const manifest = await loadExample();
    const lane = manifest.lanes[0]!;
    if (lane.origin !== "observed") throw new Error("fixture lane 0 must be observed");

    const eligibility = evaluateObservedLane(lane, {
      taskPromptHash: PROMPT_HASH,
      completeness: CLEAN_TREE,
    });

    expect(eligibility.matched).toBe(false);
    expect(eligibility.missing).toEqual([
      "startCheckpointDigest",
      "revisionId",
      "profile",
      "environmentReceipt",
      "promptHash",
    ]);
  });

  it("reports a prompt mismatch separately from an absent prompt hash", async () => {
    const manifest = await loadExample((draft) => {
      const lane = draft.lanes[0]!;
      if (lane.origin !== "observed") throw new Error("fixture lane 0 must be observed");
      lane.startCheckpointDigest = DIGEST;
      lane.identity = {
        harnessId: "readme-grounded",
        revisionId: "rev-1",
        profile: "qoder-default-v1",
        model: "performance",
        promptHash: "sha256:00000000000000000000000000000000000000000000000000000000000000ff",
        environmentReceipt: "./history/environment.json",
      };
    });
    const lane = manifest.lanes[0]!;
    if (lane.origin !== "observed") throw new Error("fixture lane 0 must be observed");

    const eligibility = evaluateObservedLane(lane, {
      taskPromptHash: PROMPT_HASH,
      completeness: CLEAN_TREE,
    });

    expect(eligibility.missing).toEqual(["promptHash-mismatch"]);
  });

  it("withholds matched status while checkpoint completeness is unverified", async () => {
    const manifest = await loadExample((draft) => {
      const lane = draft.lanes[0]!;
      if (lane.origin !== "observed") throw new Error("fixture lane 0 must be observed");
      lane.startCheckpointDigest = DIGEST;
      lane.identity = {
        harnessId: "readme-grounded",
        revisionId: "rev-1",
        profile: "qoder-default-v1",
        model: "performance",
        promptHash: PROMPT_HASH,
        environmentReceipt: "./history/environment.json",
      };
    });
    const lane = manifest.lanes[0]!;
    if (lane.origin !== "observed") throw new Error("fixture lane 0 must be observed");

    const withClean = evaluateObservedLane(lane, {
      taskPromptHash: PROMPT_HASH,
      completeness: CLEAN_TREE,
    });
    const withUnverified = evaluateObservedLane(lane, {
      taskPromptHash: PROMPT_HASH,
      completeness: { kind: "unverified", reason: "worktree state at checkpoint time is unknown" },
    });

    expect(withClean.matched).toBe(true);
    expect(withUnverified.matched).toBe(false);
    expect(withUnverified.missing).toEqual(["checkpoint-completeness"]);
  });
});

describe("harness-compare-set.v2", () => {
  it("keeps an unmatched observed lane out of every verdict", async () => {
    const manifest = await loadExample();

    const set = buildExperimentCompareSet({
      manifest,
      manifestHash: "sha256:manifest",
      taskPromptHash: PROMPT_HASH,
      graderContractHash: "sha256:grader",
      completeness: CLEAN_TREE,
      trials: [
        ...laneTrials("fresh-default", 5, { passed: true, score: 80 }),
        ...laneTrials("fresh-minimal", 5, { passed: false, score: 40 }),
      ],
    });

    expect(set.observedLanes).toEqual([
      {
        laneId: "history",
        matched: false,
        missing: ["startCheckpointDigest", "revisionId", "profile", "environmentReceipt", "promptHash"],
      },
    ]);
    const historyContext = set.contrasts.find((contrast) => contrast.id === "history-context")!;
    expect(historyContext.status).toBe("descriptive");
    expect(historyContext.attribution).toMatchObject({ reason: "observed-lane-not-matched" });
    expect(historyContext.matchedPairs).toBeNull();
  });

  it("decides an attributable contrast on the shared compare ladder", async () => {
    const manifest = await loadExample();

    const set = buildExperimentCompareSet({
      manifest,
      manifestHash: "sha256:manifest",
      taskPromptHash: PROMPT_HASH,
      graderContractHash: "sha256:grader",
      completeness: CLEAN_TREE,
      trials: [
        ...laneTrials("fresh-default", 5, { passed: false, score: 40 }),
        ...laneTrials("fresh-minimal", 5, { passed: true, score: 90 }),
      ],
    });

    const profileEffect = set.contrasts.find((contrast) => contrast.id === "profile-effect")!;
    expect(profileEffect.attribution).toMatchObject({
      mode: "attributable",
      axis: "runtime-profile",
    });
    expect(profileEffect.status).toBe("accept");
    expect(profileEffect.matchedPairs).toMatchObject({ pairs: 5, candidateWins: 5 });
  });

  it("reports insufficient evidence when each lane ran once", async () => {
    const manifest = await loadExample();

    const set = buildExperimentCompareSet({
      manifest,
      manifestHash: "sha256:manifest",
      taskPromptHash: PROMPT_HASH,
      graderContractHash: "sha256:grader",
      completeness: CLEAN_TREE,
      trials: [
        ...laneTrials("fresh-default", 1, { passed: false, score: 10 }),
        ...laneTrials("fresh-minimal", 1, { passed: true, score: 100 }),
      ],
    });

    const profileEffect = set.contrasts.find((contrast) => contrast.id === "profile-effect")!;
    expect(profileEffect.attribution).toMatchObject({ mode: "attributable" });
    expect(profileEffect.status).toBe("insufficient_evidence");
    expect(profileEffect.matchedPairs).toMatchObject({ pairs: 1 });
  });

  it("withholds a promotion status that the same evidence would earn on one axis", async () => {
    // Identical trial evidence, judged twice. The only difference is whether the
    // lanes moved one variable or two.
    const trials = [
      ...laneTrials("fresh-default", 5, { passed: false, score: 20 }),
      ...laneTrials("fresh-minimal", 5, { passed: true, score: 95 }),
    ];
    const shared = {
      manifestHash: "sha256:manifest",
      taskPromptHash: PROMPT_HASH,
      graderContractHash: "sha256:grader",
      completeness: CLEAN_TREE,
      trials,
    };
    const singleAxis = buildExperimentCompareSet({ manifest: await loadExample(), ...shared });
    const multiAxis = buildExperimentCompareSet({
      manifest: await loadExample((draft) => {
        const lane = draft.lanes[2]!;
        if (lane.origin !== "execute") throw new Error("fixture lane 2 must execute");
        lane.harnessId = "readme-baseline";
        lane.runtime.profile = "qoder-default-v1";
        lane.runtime.model = "reasoning";
      }),
      ...shared,
    });

    expect(contrastResult(singleAxis, "profile-effect").status).toBe("accept");
    expect(contrastResult(multiAxis, "profile-effect")).toMatchObject({
      status: "descriptive",
      attribution: { mode: "descriptive", reason: "multi-axis" },
      matchedPairs: null,
    });
  });

  it("aggregates an ungraded observed lane without inventing a score", async () => {
    const manifest = await loadExample();

    const set = buildExperimentCompareSet({
      manifest,
      manifestHash: "sha256:manifest",
      taskPromptHash: PROMPT_HASH,
      graderContractHash: "sha256:grader",
      completeness: CLEAN_TREE,
      trials: [
        { ...trialRow("history", 1), grade: undefined },
        ...laneTrials("fresh-default", 2, { passed: true, score: 70 }),
        ...laneTrials("fresh-minimal", 2, { passed: true, score: 70 }),
      ],
    });

    const history = set.lanes.find((lane) => lane.laneId === "history")!;
    expect(history).toMatchObject({ origin: "observed", graded: false, runtimeProfile: null });
    expect(history.aggregate.meanScore).toBe(0);
    expect(history.aggregate.completedTrials).toBe(0);
    expect(set.checkpoint).toEqual({ digest: DIGEST, completeness: CLEAN_TREE });
    expect(set.schemaVersion).toBe("harness-compare-set.v2");
  });

  it("rejects a trial that names a lane the manifest does not declare", async () => {
    const manifest = await loadExample();

    expect(() =>
      buildExperimentCompareSet({
        manifest,
        manifestHash: "sha256:manifest",
        taskPromptHash: PROMPT_HASH,
        graderContractHash: "sha256:grader",
        completeness: CLEAN_TREE,
        trials: laneTrials("ghost-lane", 1, { passed: true, score: 50 }),
      }),
    ).toThrow(/unknown lane 'ghost-lane'/);
  });
});

async function loadExample(
  mutate?: (manifest: HarnessExperimentManifest) => void,
): Promise<HarnessExperimentManifest> {
  if (mutate === undefined) {
    return (await loadHarnessExperimentManifest(EXAMPLE_PATH)).value;
  }
  const path = await writeManifest(mutate);
  return (await loadHarnessExperimentManifest(path)).value;
}

/** Write a mutated copy of the example beside its referenced files. */
async function writeManifest(
  mutate: (manifest: HarnessExperimentManifest) => void,
): Promise<string> {
  const manifest = JSON.parse(await readFile(EXAMPLE_URL, "utf8")) as HarnessExperimentManifest;
  mutate(manifest);
  const directory = await makeTemporaryDirectory();
  const path = join(directory, "experiment.json");
  await writeFile(path, JSON.stringify(manifest), "utf8");
  return path;
}

function contrastNamed(
  manifest: HarnessExperimentManifest,
  id: string,
): HarnessExperimentManifest["contrasts"][number] {
  const contrast = manifest.contrasts.find((candidate) => candidate.id === id);
  if (contrast === undefined) throw new Error(`fixture has no contrast '${id}'`);
  return contrast;
}

function contrastResult(set: HarnessExperimentCompareSet, id: string): ContrastResult {
  const contrast = set.contrasts.find((candidate) => candidate.id === id);
  if (contrast === undefined) throw new Error(`compare set has no contrast '${id}'`);
  return contrast;
}

function laneTrials(
  laneId: string,
  count: number,
  outcome: { passed: boolean; score: number },
): ExperimentTrialResult[] {
  return Array.from({ length: count }, (_unused, index) => ({
    ...trialRow(laneId, index + 1),
    grade: grade(outcome),
  }));
}

function trialRow(laneId: string, trial: number): ExperimentTrialResult {
  return {
    laneId,
    harnessId: "readme-grounded",
    runtimeProfile: "qoder-default-v1",
    model: "performance",
    trial,
    classification: "passed",
    changedFiles: ["README.md"],
    executorExitCode: 0,
    executorError: "",
    revisionId: "rev-1",
    durationMs: 1000,
    artifactDirectory: `${laneId}/trial-${String(trial).padStart(3, "0")}`,
    sandbox: SANDBOX,
  };
}

function grade(outcome: { passed: boolean; score: number }): ReadmeGrade {
  return {
    kind: "readme-package-v1",
    passed: outcome.passed,
    score: outcome.score,
    checks: [{ id: "headings", passed: outcome.passed, hard: true, weight: 100, detail: "" }],
  };
}

const SANDBOX: SandboxReceipt = {
  policy: "trusted-fixture",
  envPolicy: "allowlist",
  envKeys: ["PATH"],
  networkPolicy: "unverified",
  fsScope: "trial-root",
  permissionFlags: [],
};

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "harness-experiment-"));
  temporaryDirectories.push(directory);
  return directory;
}

import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compileHarness } from "../compiler/compile.js";
import type { HarnessExecutor, HarnessRunResult } from "../exec/executor.js";
import { prepareMaterialization } from "../exec/materialization.js";
import { QoderSdkAdapter, QoderSdkExecutor } from "../exec/qoder-sdk.js";
import type { HarnessRunEvent } from "../exec/events.js";
import type { HarnessIrBundle, HarnessRevision } from "../ir/index.js";
import { canonicalJson, sha256Hex } from "../ir/canonical.js";
import { resolveHarness } from "../resolver/resolve.js";
import { lockCapabilitySources } from "../resolver/source-lock.js";
import { gradeReadmePackage } from "../compare/grader.js";
import { createBoundedQoderPermissionCallback, type ToolPermissionDecision } from "../compare/permissions.js";
import { createTrustedFixtureSandbox } from "../compare/sandbox.js";
import { validateSessionExecutionPlan, type SessionExecutionPlan } from "../session-executor/index.js";
import { buildExperimentCompareSet, type ExperimentTrialResult, type HarnessExperimentCompareSet } from "./compare-set.js";
import { isExecuteLane, isObservedLane, type ExecuteLane, type HarnessExperimentManifest } from "./contract.js";
import { loadHarnessExperimentManifest, type LoadedHarnessExperimentManifest } from "./manifest.js";

export type ExperimentRunEventType =
  | "experiment-started"
  | "lane-preparing"
  | "lane-ready"
  | "lane-started"
  | "lane-event"
  | "lane-finished"
  | "lane-failed"
  | "experiment-finished"
  | "experiment-cancelled";

export interface ExperimentRunEvent {
  type: ExperimentRunEventType;
  experimentId: string;
  laneId: string | null;
  runId: string | null;
  at: string;
  detail?: string;
  event?: HarnessRunEvent;
  result?: ExperimentTrialResult;
  compareSet?: HarnessExperimentCompareSet;
}

export interface ExperimentLaneExecutorContext {
  lane: ExecuteLane;
  trial: number;
  worktree: string;
  abortController: AbortController;
  permissionDecisions: ToolPermissionDecision[];
  traceEvents: unknown[];
  runtime: HarnessExperimentManifest["runtime"];
  expectedFiles: string[];
  onRunEvent: (event: HarnessRunEvent) => void;
}

export type ExperimentLaneExecutorFactory = (context: ExperimentLaneExecutorContext) => HarnessExecutor;

export interface RunHarnessExperimentOptions {
  manifestPath: string;
  outputDirectory: string;
  experimentId?: string;
  executorFactory?: ExperimentLaneExecutorFactory;
  signal?: AbortSignal;
  onEvent?: (event: ExperimentRunEvent) => void;
  now?: () => Date;
}

interface PreparedJob {
  lane: ExecuteLane;
  trial: number;
  runId: string;
  worktree: string;
  temporaryRoot: string;
  artifactDirectory: string;
}

/**
 * Execute every fresh lane from one immutable session execution plan.
 *
 * Preflight is global, worktree creation is deliberately serialized, and only
 * then are jobs released in parallel. A rejected job is converted to lane
 * evidence instead of cancelling its siblings.
 */
export async function runHarnessExperiment(
  options: RunHarnessExperimentOptions,
): Promise<HarnessExperimentCompareSet> {
  const now = options.now ?? (() => new Date());
  const experimentId = options.experimentId ?? `exp_${randomUUID().replaceAll("-", "")}`;
  const emit = (event: Omit<ExperimentRunEvent, "experimentId" | "at">): void => {
    options.onEvent?.({ ...event, experimentId, at: now().toISOString() });
  };
  const loaded = await loadHarnessExperimentManifest(options.manifestPath);
  const preflight = await preflightExperiment(loaded);
  const outputDirectory = resolve(options.outputDirectory);
  await mkdir(dirname(outputDirectory), { recursive: true });
  await mkdir(outputDirectory);
  await writeJson(join(outputDirectory, "manifest.json"), loaded.value);
  await writeJson(join(outputDirectory, "checkpoint-receipt.json"), {
    digest: loaded.value.checkpointRef.digest,
    completeness: preflight.completeness,
    baseCommit: preflight.plan.workspace.baseCommit,
    baseTree: preflight.plan.workspace.baseTree,
    sessionSha256: preflight.plan.checkpoint.sessionSha256,
    entryId: preflight.plan.checkpoint.entryId,
  });
  await persistObservedEvidence(loaded, outputDirectory);
  emit({ type: "experiment-started", laneId: null, runId: null });

  const abortController = new AbortController();
  const abort = (): void => abortController.abort(options.signal?.reason);
  if (options.signal?.aborted === true) {
    abort();
  } else {
    options.signal?.addEventListener("abort", abort, { once: true });
  }
  const jobs: PreparedJob[] = [];
  try {
    for (const lane of loaded.value.lanes.filter(isExecuteLane)) {
      for (let trial = 1; trial <= lane.trials; trial += 1) {
        assertNotAborted(abortController.signal);
        const runId = `${experimentId}:${lane.id}:${trial}`;
        emit({ type: "lane-preparing", laneId: lane.id, runId, detail: `trial ${trial}` });
        const temporaryRoot = await mkdtemp(join(tmpdir(), "better-harness-experiment-"));
        const worktree = join(temporaryRoot, "worktree");
        try {
          git(preflight.plan.workspace.root, ["worktree", "add", "--detach", worktree, preflight.plan.workspace.baseCommit]);
        } catch (error) {
          await rm(temporaryRoot, { recursive: true, force: true });
          throw error;
        }
        const artifactDirectory = join(outputDirectory, lane.id, `trial-${String(trial).padStart(3, "0")}`);
        await mkdir(artifactDirectory, { recursive: true });
        jobs.push({ lane, trial, runId, worktree, temporaryRoot, artifactDirectory });
        emit({ type: "lane-ready", laneId: lane.id, runId });
      }
    }

    const settled = await Promise.allSettled(jobs.map((job) => executePreparedJob({
      job,
      loaded,
      preflight,
      experimentId,
      abortController,
      executorFactory: options.executorFactory ?? defaultExperimentExecutorFactory(loaded.value),
      emit,
    })));
    const trials: ExperimentTrialResult[] = [];
    for (let index = 0; index < settled.length; index += 1) {
      const outcome = settled[index]!;
      const job = jobs[index]!;
      if (outcome.status === "fulfilled") {
        trials.push(outcome.value);
      } else {
        const failed = infrastructureFailure(job, errorMessage(outcome.reason));
        await persistTrialEvidence(job.artifactDirectory, failed, undefined, [], []);
        trials.push(failed);
        emit({ type: "lane-failed", laneId: job.lane.id, runId: job.runId, detail: failed.executorError, result: failed });
      }
    }
    const compareSet = buildExperimentCompareSet({
      manifest: loaded.value,
      manifestHash: `sha256:${sha256Hex(canonicalJson(loaded.value))}`,
      taskPromptHash: `sha256:${sha256Hex(preflight.prompt)}`,
      graderContractHash: `sha256:${sha256Hex(preflight.graderContract)}`,
      completeness: preflight.completeness,
      trials,
    });
    await writeJson(join(outputDirectory, "compare-set.json"), compareSet);
    emit({
      type: abortController.signal.aborted ? "experiment-cancelled" : "experiment-finished",
      laneId: null,
      runId: null,
      compareSet,
    });
    return compareSet;
  } finally {
    options.signal?.removeEventListener("abort", abort);
    for (const job of jobs) {
      await removeWorktree(preflight.plan.workspace.root, job);
    }
  }
}

async function preflightExperiment(loaded: LoadedHarnessExperimentManifest): Promise<{
  plan: SessionExecutionPlan;
  prompt: string;
  graderContract: string;
  bundle: HarnessIrBundle;
  revisions: Map<string, HarnessRevision>;
  completeness: { kind: "clean-tree"; verifiedAt: string } | { kind: "unverified"; reason: string };
}> {
  const planBytes = await readFile(loaded.resolved.checkpointPlan);
  const digest = `sha256:${createHash("sha256").update(planBytes).digest("hex")}`;
  if (digest !== loaded.value.checkpointRef.digest) {
    throw new Error(`Checkpoint digest mismatch: manifest records ${loaded.value.checkpointRef.digest}, read ${digest}.`);
  }
  const parsed = JSON.parse(planBytes.toString("utf8")) as unknown;
  const { plan } = await validateSessionExecutionPlan(parsed, { allowExistingOutputRef: true });
  const [harnessSource, prompt, graderContract] = await Promise.all([
    readFile(loaded.resolved.harness, "utf8"),
    readFile(loaded.resolved.prompt, "utf8"),
    readFile(loaded.resolved.graderContract, "utf8"),
  ]);
  const compiled = await compileHarness([{ uri: pathToFileURL(loaded.resolved.harness).href, text: harnessSource }]);
  if (!compiled.bundle) {
    throw new Error(`Harness compilation failed: ${compiled.diagnostics.map((item) => item.message).join("; ")}`);
  }
  const sourceLocks = await lockCapabilitySources(compiled.bundle, { root: dirname(loaded.resolved.harness) });
  const revisions = new Map<string, HarnessRevision>();
  for (const lane of loaded.value.lanes.filter(isExecuteLane)) {
    const adapter = adapterFor(loaded.value, lane);
    const resolvedLane = resolveHarness(compiled.bundle, lane.harnessId, loaded.value.runtime.host, { adapter, sourceLocks });
    if (!resolvedLane.revision) {
      throw new Error(`Cannot resolve lane '${lane.id}': ${resolvedLane.report.errors.join("; ")}`);
    }
    revisions.set(lane.id, resolvedLane.revision);
  }
  const status = git(plan.workspace.root, ["status", "--porcelain", "--untracked-files=all"]).trim();
  const head = git(plan.workspace.root, ["rev-parse", "HEAD"]).trim();
  const completeness = status === "" && head === plan.workspace.baseCommit
    ? { kind: "clean-tree" as const, verifiedAt: new Date().toISOString() }
    : { kind: "unverified" as const, reason: "source workspace did not exactly match the checkpoint commit at preflight" };
  return { plan, prompt, graderContract, bundle: compiled.bundle, revisions, completeness };
}

async function executePreparedJob(input: {
  job: PreparedJob;
  loaded: LoadedHarnessExperimentManifest;
  preflight: Awaited<ReturnType<typeof preflightExperiment>>;
  experimentId: string;
  abortController: AbortController;
  executorFactory: ExperimentLaneExecutorFactory;
  emit: (event: Omit<ExperimentRunEvent, "experimentId" | "at">) => void;
}): Promise<ExperimentTrialResult> {
  const { job } = input;
  assertNotAborted(input.abortController.signal);
  input.emit({ type: "lane-started", laneId: job.lane.id, runId: job.runId });
  const permissionDecisions: ToolPermissionDecision[] = [];
  const traceEvents: unknown[] = [];
  const started = Date.now();
  const executor = input.executorFactory({
    lane: job.lane,
    trial: job.trial,
    worktree: job.worktree,
    abortController: input.abortController,
    permissionDecisions,
    traceEvents,
    runtime: input.loaded.value.runtime,
    expectedFiles: input.loaded.value.task.expectedFiles,
    onRunEvent: (event) => {
      const redacted = redactEvidenceValue(event, job.worktree) as HarnessRunEvent;
      traceEvents.push(redacted);
      input.emit({ type: "lane-event", laneId: job.lane.id, runId: job.runId, event: redacted });
    },
  });
  const revision = input.preflight.revisions.get(job.lane.id);
  if (!revision) throw new Error(`No preflight revision for lane '${job.lane.id}'.`);
  await Promise.all([
    writeJson(join(job.artifactDirectory, "revision.json"), revision),
    writeJson(
      join(job.artifactDirectory, "materialization-receipt.json"),
      prepareMaterialization(revision, input.preflight.bundle, adapterFor(input.loaded.value, job.lane)),
    ),
  ]);
  let execution: HarnessRunResult;
  try {
    execution = await executor.execute(revision, input.preflight.bundle, {
      prompt: input.preflight.prompt,
      cwd: job.worktree,
      sourceRoot: dirname(input.loaded.resolved.harness),
      abortSignal: input.abortController.signal,
    });
  } catch (error) {
    throw new Error(`Executor failed: ${errorMessage(error)}`);
  }
  const changedFiles = changedPaths(job.worktree);
  git(job.worktree, ["add", "--all", "--", "."]);
  const patch = git(job.worktree, ["diff", "--cached", "--binary", "HEAD", "--"]);
  const sandbox = createTrustedFixtureSandbox();
  const grade = await gradeReadmePackage({
    trialRoot: job.worktree,
    contractPath: input.loaded.resolved.graderContract,
    changedFiles,
    expectedFiles: input.loaded.value.task.expectedFiles,
    sandbox,
  });
  const stagedTree = git(job.worktree, ["write-tree"]);
  const resultCommit = git(job.worktree, ["commit-tree", stagedTree, "-p", input.preflight.plan.workspace.baseCommit], {
    input: `harness experiment ${input.experimentId} ${job.lane.id} trial ${job.trial}\n`,
  });
  const ref = `refs/better-harness/experiments/${sanitizeRef(input.experimentId)}/${sanitizeRef(job.lane.id)}/${job.trial}`;
  git(input.preflight.plan.workspace.root, [
    "update-ref",
    ref,
    resultCommit,
    "0".repeat(input.preflight.plan.workspace.baseCommit.length),
  ]);
  const result: ExperimentTrialResult = {
    laneId: job.lane.id,
    harnessId: job.lane.harnessId,
    runtimeProfile: job.lane.runtime.profile,
    model: job.lane.runtime.model,
    trial: job.trial,
    classification: execution.exitCode === 0 && grade.passed ? "passed" : "failed",
    changedFiles,
    grade,
    executorExitCode: execution.exitCode,
    executorError: String(redactEvidenceValue(execution.errorOutput, job.worktree)),
    revisionId: revision.revisionId,
    durationMs: Date.now() - started,
    artifactDirectory: `${job.lane.id}/trial-${String(job.trial).padStart(3, "0")}`,
    sandbox: sandbox.describe(),
    ...(execution.metrics ? { metrics: execution.metrics } : {}),
  };
  await persistTrialEvidence(job.artifactDirectory, result, execution, traceEvents, permissionDecisions, {
    patch,
    stagedTree,
    resultCommit,
    ref,
  });
  input.emit({ type: "lane-finished", laneId: job.lane.id, runId: job.runId, result });
  return result;
}

function defaultExperimentExecutorFactory(
  manifest: HarnessExperimentManifest,
): ExperimentLaneExecutorFactory {
  return (context) => {
    const runtime = effectiveRuntime(manifest, context.lane);
    return new QoderSdkExecutor({
      profile: context.lane.runtime.profile,
      tools: runtime.tools,
      allowedTools: runtime.allowedTools,
      disallowedTools: runtime.disallowedTools,
      permissionMode: manifest.runtime.permissionMode,
      canUseTool: createBoundedQoderPermissionCallback(
        context.worktree,
        context.permissionDecisions,
        context.expectedFiles,
      ),
      maxTurns: manifest.runtime.maxTurns,
      persistSession: false,
      model: context.lane.runtime.model,
      enableFileCheckpointing: manifest.runtime.enableFileCheckpointing,
      onRunEvent: context.onRunEvent,
    });
  };
}

function adapterFor(manifest: HarnessExperimentManifest, lane: ExecuteLane) {
  const runtime = effectiveRuntime(manifest, lane);
  return new QoderSdkAdapter({
    profile: lane.runtime.profile,
    tools: runtime.tools,
    allowedTools: runtime.allowedTools,
    disallowedTools: runtime.disallowedTools,
    permissionMode: manifest.runtime.permissionMode,
    canUseTool: async () => ({ behavior: "allow" as const }),
    maxTurns: manifest.runtime.maxTurns,
    persistSession: false,
    model: lane.runtime.model,
    enableFileCheckpointing: manifest.runtime.enableFileCheckpointing,
  }).describe();
}

function effectiveRuntime(manifest: HarnessExperimentManifest, lane: ExecuteLane): {
  tools: string[];
  allowedTools: string[];
  disallowedTools: string[];
} {
  return lane.runtime.profile === "qoder-minimal-v1"
    ? {
        tools: ["Read", "Write", "Edit", "Bash"],
        allowedTools: [],
        disallowedTools: manifest.runtime.disallowedTools.filter(
          (tool) => !["Read", "Write", "Edit", "Bash"].includes(tool),
        ),
      }
    : {
        tools: [...manifest.runtime.tools],
        allowedTools: [...manifest.runtime.allowedTools],
        disallowedTools: [...manifest.runtime.disallowedTools],
      };
}

async function persistObservedEvidence(
  loaded: LoadedHarnessExperimentManifest,
  outputDirectory: string,
): Promise<void> {
  for (const lane of loaded.value.lanes.filter(isObservedLane)) {
    const laneDirectory = join(outputDirectory, lane.id);
    await mkdir(laneDirectory, { recursive: true });
    await Promise.all([
      copyFile(loaded.resolved.trajectories[lane.id]!, join(laneDirectory, "trajectory.jsonl")),
      writeJson(join(laneDirectory, "observed-identity.json"), lane.identity ?? {}),
    ]);
  }
}

function infrastructureFailure(job: PreparedJob, detail: string): ExperimentTrialResult {
  return {
    laneId: job.lane.id,
    harnessId: job.lane.harnessId,
    runtimeProfile: job.lane.runtime.profile,
    model: job.lane.runtime.model,
    trial: job.trial,
    classification: "infrastructure_error",
    changedFiles: [],
    executorExitCode: 1,
    executorError: detail,
    revisionId: "unavailable",
    durationMs: 0,
    artifactDirectory: `${job.lane.id}/trial-${String(job.trial).padStart(3, "0")}`,
    sandbox: createTrustedFixtureSandbox().describe(),
  };
}

async function persistTrialEvidence(
  artifactDirectory: string,
  result: ExperimentTrialResult,
  execution: HarnessRunResult | undefined,
  traceEvents: unknown[],
  permissionDecisions: ToolPermissionDecision[],
  gitReceipt?: Record<string, unknown>,
): Promise<void> {
  await Promise.all([
    writeJson(join(artifactDirectory, "result.json"), result),
    writeJson(join(artifactDirectory, "runtime-receipt.json"), execution?.runtimeReceipt ?? { executor: "unavailable" }),
    writeJson(join(artifactDirectory, "sandbox-receipt.json"), result.sandbox),
    writeJson(join(artifactDirectory, "permission-decisions.json"), permissionDecisions),
    writeFile(join(artifactDirectory, "trajectory.jsonl"), traceEvents.map((event) => JSON.stringify(event)).join("\n") + (traceEvents.length ? "\n" : ""), "utf8"),
    writeFile(join(artifactDirectory, "patch.diff"), String(gitReceipt?.patch ?? ""), "utf8"),
    writeJson(join(artifactDirectory, "git-receipt.json"), gitReceipt ?? {}),
  ]);
}

function changedPaths(worktree: string): string[] {
  return git(worktree, ["status", "--porcelain", "-z", "--untracked-files=all"])
    .split("\0")
    .filter(Boolean)
    .map((entry) => entry.slice(3))
    .sort();
}

async function removeWorktree(repoRoot: string, job: PreparedJob): Promise<void> {
  try {
    git(repoRoot, ["worktree", "remove", "--force", job.worktree]);
  } catch {
    // Evidence already records the run. Cleanup is best effort and pruning below
    // prevents a stale administrative entry from blocking the next experiment.
  }
  await rm(job.temporaryRoot, { recursive: true, force: true });
  try {
    git(repoRoot, ["worktree", "prune"]);
  } catch {
    // Best effort only.
  }
}

function git(cwd: string, args: string[], options: { input?: string } = {}): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    input: options.input,
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  }).trim();
}

function sanitizeRef(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "run";
}

function redactEvidenceValue(value: unknown, worktree: string): unknown {
  if (typeof value === "string") {
    const redacted = value
      .replaceAll(worktree, "<trial-root>")
      .replaceAll(worktree.replaceAll("\\", "/"), "<trial-root>");
    return redacted === value ? value : redacted.replaceAll("\\", "/");
  }
  if (Array.isArray(value)) return value.map((item) => redactEvidenceValue(item, worktree));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactEvidenceValue(item, worktree)]));
  }
  return value;
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("Experiment cancelled.");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

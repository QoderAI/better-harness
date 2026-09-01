import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { compileHarness } from "../compiler/compile.js";
import type { HarnessExecutor, HarnessRunResult } from "../exec/executor.js";
import { QoderSdkAdapter, QoderSdkExecutor } from "../exec/qoder-sdk.js";
import { prepareMaterialization } from "../exec/materialization.js";
import { canonicalJson, sha256Hex } from "../ir/canonical.js";
import type { HarnessIrBundle, HarnessRevision, ResolutionReport } from "../ir/index.js";
import { resolveHarness } from "../resolver/resolve.js";
import { lockCapabilitySources } from "../resolver/source-lock.js";
import {
  aggregateVariant,
  decideVerdict,
  normalizeDecisionPolicy,
  summarizeMatchedPairs,
  type CompareDecisionPolicy,
  type CompareTrialResult,
  type CompareVariant,
  type HarnessCompareVerdict,
  type TrialClassification,
  type VariantAggregate,
} from "./aggregate.js";
import { gradeReadmePackage, type ReadmeGrade } from "./grader.js";
import {
  loadHarnessCompareManifest,
  resolveHarnessCompareRuntime,
  treatmentAxisFor,
  type HarnessCompareManifest,
  type LoadedHarnessCompareManifest,
  type ResolvedHarnessCompareRuntime,
} from "./manifest.js";
import {
  createBoundedQoderPermissionCallback,
  type ToolPermissionDecision,
} from "./permissions.js";
import { createTrustedFixtureSandbox, sandboxPolicyLabel, type TrialSandbox } from "./sandbox.js";

export type {
  CompareDecisionPolicy,
  CompareStatus,
  CompareTreatmentAxis,
  CompareTrialResult,
  CompareVariant,
  HarnessCompareVerdict,
  MatchedPairSummary,
  TrialClassification,
  VariantAggregate,
} from "./aggregate.js";
export {
  DEFAULT_COMPARE_DECISION_POLICY,
  MINIMUM_MATCHED_PAIRS_FLOOR,
  aggregateVariant,
  decideVerdict,
  normalizeDecisionPolicy,
  summarizeMatchedPairs,
} from "./aggregate.js";

export interface CompareExecutorContext {
  runtime: ResolvedHarnessCompareRuntime;
  trialRoot: string;
  abortController: AbortController;
  permissionDecisions: ToolPermissionDecision[];
  expectedFiles: string[];
  traceEvents: unknown[];
}

export type CompareExecutorFactory = (context: CompareExecutorContext) => HarnessExecutor;

export interface FileEvidence {
  path: string;
  kind: "file" | "symlink";
  bytes: number;
  sha256: string;
}

export async function runHarnessComparison(options: {
  manifestPath: string;
  outputDirectory: string;
  trialCount?: number;
  executorFactory?: CompareExecutorFactory;
  /** Raises the evidence bar; the two-matched-pair floor always applies. */
  decisionPolicy?: Partial<CompareDecisionPolicy>;
}): Promise<HarnessCompareVerdict> {
  const loaded = await loadHarnessCompareManifest(options.manifestPath);
  const trialCount = options.trialCount ?? loaded.value.trials.count;
  if (!Number.isInteger(trialCount) || trialCount < 1 || trialCount > loaded.value.trials.count) {
    throw new Error(`trialCount must be between 1 and the frozen manifest count (${loaded.value.trials.count}).`);
  }
  const outputDirectory = resolve(options.outputDirectory);
  assertOutputSeparated(outputDirectory, loaded.resolved.fixture);
  await prepareEmptyOutput(outputDirectory);
  const harnessSource = await readFile(loaded.resolved.harness, "utf8");
  const prompt = await readFile(loaded.resolved.prompt, "utf8");
  const { bundle, revisions, reports } = await compileAndResolveVariants(loaded, harnessSource);
  const fixtureBefore = await snapshotDirectory(loaded.resolved.fixture);
  if (fixtureBefore.some((item) => item.kind === "symlink")) {
    throw new Error("Frozen compare fixtures may not contain symbolic links.");
  }
  const fixtureHash = sha256Hex(canonicalJson(fixtureBefore));
  const effectiveManifest = {
    ...loaded.value,
    trials: { ...loaded.value.trials, count: trialCount },
  };
  const manifestHash = sha256Hex(canonicalJson(effectiveManifest));
  const harnessHash = sha256Hex(harnessSource);
  const jobs = randomizedJobs(trialCount, loaded.value.trials.seed);
  await writeJson(join(outputDirectory, "manifest.json"), {
    ...effectiveManifest,
    evidence: { manifestHash, harnessHash, fixtureHash, executionOrder: jobs },
  });
  await writeJson(join(outputDirectory, "frozen-task.json"), {
    schemaVersion: "harness-frozen-task.v1",
    prompt,
    promptHash: sha256Hex(prompt),
    fixtureHash,
    fixtureFiles: fixtureBefore,
    expectedFiles: loaded.value.task.expectedFiles,
    graderContractHash: sha256Hex(await readFile(loaded.resolved.graderContract, "utf8")),
  });
  for (const variant of ["baseline", "candidate"] as const) {
    const variantDirectory = join(outputDirectory, variant === "baseline" ? "H0" : "H1");
    await mkdir(variantDirectory, { recursive: true });
    await writeJson(join(variantDirectory, "revision.json"), revisions[variant]);
    await writeJson(join(variantDirectory, "resolution-report.json"), reports[variant]);
    await writeJson(
      join(variantDirectory, "materialization-receipt.json"),
      prepareMaterialization(
        revisions[variant],
        bundle,
        comparisonAdapterDescriptor(resolveHarnessCompareRuntime(loaded.value, variant)),
      ),
    );
  }

  const results: CompareTrialResult[] = [];
  for (const job of jobs) {
    const harnessId = loaded.value.variants[job.variant];
    const result = await runTrial({
      loaded,
      outputDirectory,
      prompt,
      bundle,
      revision: revisions[job.variant],
      harnessId,
      variant: job.variant,
      trial: job.trial,
      executorFactory: options.executorFactory ?? defaultExecutorFactory,
    });
    results.push(result);
  }

  const fixtureAfter = await snapshotDirectory(loaded.resolved.fixture);
  if (canonicalJson(fixtureAfter) !== canonicalJson(fixtureBefore)) {
    throw new Error("Source fixture changed during comparison; refusing to produce a verdict.");
  }
  results.sort((a, b) => compareVariant(a.variant, b.variant) || a.trial - b.trial);
  const baseline = aggregateVariant(results.filter((result) => result.variant === "baseline"));
  const candidate = aggregateVariant(results.filter((result) => result.variant === "candidate"));
  const matchedPairs = summarizeMatchedPairs(results);
  const policy = normalizeDecisionPolicy(options.decisionPolicy);
  const decision = decideVerdict({ baseline, candidate, matchedPairs, policy });
  const verdict: HarnessCompareVerdict = {
    schemaVersion: "harness-compare-result.v1",
    ...decision,
    treatmentAxis: treatmentAxisFor(loaded.value),
    policy,
    manifestHash,
    fixtureHash,
    harnessHash,
    sandbox: results[0]?.sandbox ?? createTrustedFixtureSandbox().describe(),
    baseline,
    candidate,
    matchedPairs,
    trials: results,
  };
  await writeJson(join(outputDirectory, "verdict.json"), verdict);
  await writeFile(join(outputDirectory, "verdict.html"), renderVerdictHtml(verdict), "utf8");
  return verdict;
}

async function compileAndResolveVariants(
  loaded: LoadedHarnessCompareManifest,
  harnessSource: string,
): Promise<{
  bundle: HarnessIrBundle;
  revisions: Record<CompareVariant, HarnessRevision>;
  reports: Record<CompareVariant, ResolutionReport>;
}> {
  const compiled = await compileHarness([{ uri: pathToMemoryUri(loaded.resolved.harness), text: harnessSource }]);
  if (!compiled.bundle) {
    const diagnostics = compiled.diagnostics.map((item) => `${item.source}:${item.line ?? 1}: ${item.message}`).join("\n");
    throw new Error(`Harness compilation failed:\n${diagnostics}`);
  }
  // A skill source belongs to the `.harness` document that declares it, so use
  // the same document-relative convention as Harness Studio.
  // Locking is a no-op for a harness with only inline `description` skills.
  const sourceRoot = dirname(loaded.resolved.harness);
  const sourceLocks = await lockCapabilitySources(compiled.bundle, { root: sourceRoot });
  const revisions = {} as Record<CompareVariant, HarnessRevision>;
  const reports = {} as Record<CompareVariant, ResolutionReport>;
  for (const variant of ["baseline", "candidate"] as const) {
    const harnessId = loaded.value.variants[variant];
    const runtime = resolveHarnessCompareRuntime(loaded.value, variant);
    const resolved = resolveHarness(compiled.bundle, harnessId, loaded.value.runtime.host, {
      adapter: comparisonAdapterDescriptor(runtime),
      sourceLocks,
    });
    if (!resolved.revision) {
      throw new Error(`Cannot resolve ${variant} harness '${harnessId}': ${resolved.report.errors.join("; ")}`);
    }
    if (resolved.revision.target.runtime !== loaded.value.runtime.host) {
      throw new Error(
        `${variant} harness targets '${resolved.revision.target.runtime}', expected '${loaded.value.runtime.host}'.`,
      );
    }
    revisions[variant] = resolved.revision;
    reports[variant] = resolved.report;
  }
  return { bundle: compiled.bundle, revisions, reports };
}

function comparisonAdapterDescriptor(runtime: ResolvedHarnessCompareRuntime) {
  return new QoderSdkAdapter({
    profile: runtime.profile,
    tools: runtime.tools,
    allowedTools: runtime.allowedTools,
    disallowedTools: runtime.disallowedTools,
    permissionMode: runtime.permissionMode,
    canUseTool: async () => ({ behavior: "allow" }),
    maxTurns: runtime.maxTurns,
    persistSession: false,
    ...(runtime.model ? { model: runtime.model } : {}),
    enableFileCheckpointing: runtime.enableFileCheckpointing,
  }).describe();
}

async function runTrial(options: {
  loaded: LoadedHarnessCompareManifest;
  outputDirectory: string;
  prompt: string;
  bundle: HarnessIrBundle;
  revision: HarnessRevision;
  harnessId: string;
  variant: CompareVariant;
  trial: number;
  executorFactory: CompareExecutorFactory;
}): Promise<CompareTrialResult> {
  const runtime = resolveHarnessCompareRuntime(options.loaded.value, options.variant);
  const variantDirectory = options.variant === "baseline" ? "H0" : "H1";
  const artifactDirectory = join(
    options.outputDirectory,
    variantDirectory,
    `trial-${String(options.trial).padStart(3, "0")}`,
  );
  await mkdir(artifactDirectory, { recursive: true });
  const temporaryParent = await mkdtemp(join(tmpdir(), "harness-compare-"));
  const trialRoot = join(temporaryParent, "repo");
  const permissionDecisions: ToolPermissionDecision[] = [];
  const traceEvents: unknown[] = [];
  const started = Date.now();
  const sandbox = createTrustedFixtureSandbox();
  let execution: HarnessRunResult = {
    host: "qoder",
    revisionId: options.revision.revisionId,
    exitCode: 1,
    output: "",
    errorOutput: "Executor did not start.",
    warnings: [],
  };
  let infrastructureError: string | undefined;
  try {
    try {
      await cp(options.loaded.resolved.fixture, trialRoot, { recursive: true, errorOnExist: true, force: false });
      const before = await snapshotDirectory(trialRoot);
      await initializeGitRepository(trialRoot, temporaryParent, sandbox);
      const abortController = new AbortController();
      const executor = options.executorFactory({
        runtime,
        trialRoot,
        abortController,
        permissionDecisions,
        expectedFiles: options.loaded.value.task.expectedFiles,
        traceEvents,
      });
      try {
        execution = await withTimeout(
          executor.execute(options.revision, options.bundle, {
            prompt: options.prompt,
            cwd: trialRoot,
            sourceRoot: dirname(options.loaded.resolved.harness),
          }),
          runtime.timeoutMs,
          abortController,
        );
      } catch (error) {
        infrastructureError = errorMessage(error);
        execution = {
          host: "qoder",
          revisionId: options.revision.revisionId,
          exitCode: 1,
          output: "",
          errorOutput: infrastructureError,
          warnings: [],
        };
      }
      const after = await snapshotDirectory(trialRoot);
      const changedFiles = diffSnapshots(before, after);
      const patch = await capturePatch(trialRoot, sandbox);
      await writeFile(join(artifactDirectory, "prompt.txt"), options.prompt, "utf8");
      await writeFile(join(artifactDirectory, "response.txt"), execution.output, "utf8");
      await writeFile(join(artifactDirectory, "stderr.txt"), redactRoot(execution.errorOutput, trialRoot), "utf8");
      await writeFile(join(artifactDirectory, "patch.diff"), redactRoot(patch, trialRoot), "utf8");
      await writeTrace(
        join(artifactDirectory, "trace.jsonl"),
        traceEvents.length > 0 ? traceEvents : execution.trace ?? [],
        trialRoot,
      );
      await writeJson(join(artifactDirectory, "permission-decisions.json"), permissionDecisions);
      const grade = await gradeReadmePackage({
        trialRoot,
        contractPath: options.loaded.resolved.graderContract,
        changedFiles,
        expectedFiles: options.loaded.value.task.expectedFiles,
        sandbox,
      });
      await writeJson(join(artifactDirectory, "validation.json"), grade);
      const classification = classifyTrial(execution, grade, infrastructureError);
      const result: CompareTrialResult = {
        variant: options.variant,
        harnessId: options.harnessId,
        runtimeProfile: runtime.profile,
        trial: options.trial,
        classification,
        changedFiles,
        grade,
        executorExitCode: execution.exitCode,
        executorError: redactRoot(execution.errorOutput, trialRoot),
        revisionId: options.revision.revisionId,
        durationMs: Date.now() - started,
        artifactDirectory: trialArtifactPath(variantDirectory, options.trial),
        sandbox: sandbox.describe(),
        ...(execution.metrics ? { metrics: execution.metrics } : {}),
      };
      await writeJson(join(artifactDirectory, "runtime-receipt.json"), execution.runtimeReceipt ?? {
        executor: "injected-test-executor",
        permissionCallback: "none",
      });
      await writeJson(join(artifactDirectory, "sandbox-receipt.json"), result.sandbox);
      await writeJson(join(artifactDirectory, "metrics.json"), trialSummary(result));
      return result;
    } catch (error) {
      // Harness, Git, filesystem, and grader breakage is an infrastructure failure
      // for this trial, not a coding outcome, and must not discard the other trials.
      return await recordInfrastructureFailure({
        artifactDirectory,
        variantDirectory,
        harnessId: options.harnessId,
        runtimeProfile: runtime.profile,
        variant: options.variant,
        trial: options.trial,
        revisionId: options.revision.revisionId,
        durationMs: Date.now() - started,
        detail: redactRoot(errorMessage(error), trialRoot),
        permissionDecisions,
        sandbox,
      });
    }
  } finally {
    await rm(temporaryParent, { recursive: true, force: true });
  }
}

async function recordInfrastructureFailure(options: {
  artifactDirectory: string;
  variantDirectory: string;
  harnessId: string;
  runtimeProfile: string;
  variant: CompareVariant;
  trial: number;
  revisionId: string;
  durationMs: number;
  detail: string;
  permissionDecisions: ToolPermissionDecision[];
  sandbox: TrialSandbox;
}): Promise<CompareTrialResult> {
  const result: CompareTrialResult = {
    variant: options.variant,
    harnessId: options.harnessId,
    runtimeProfile: options.runtimeProfile,
    trial: options.trial,
    classification: "infrastructure_error",
    changedFiles: [],
    grade: {
      kind: "readme-package-v1",
      passed: false,
      score: 0,
      checks: [{
        id: "infrastructure",
        passed: false,
        hard: true,
        weight: 100,
        detail: options.detail,
      }],
    },
    executorExitCode: 1,
    executorError: options.detail,
    revisionId: options.revisionId,
    durationMs: options.durationMs,
    artifactDirectory: trialArtifactPath(options.variantDirectory, options.trial),
    sandbox: options.sandbox.describe(),
  };
  await writeFile(join(options.artifactDirectory, "stderr.txt"), `${options.detail}\n`, "utf8").catch(() => undefined);
  await writeJson(join(options.artifactDirectory, "validation.json"), result.grade).catch(() => undefined);
  await writeJson(join(options.artifactDirectory, "permission-decisions.json"), options.permissionDecisions)
    .catch(() => undefined);
  await writeJson(join(options.artifactDirectory, "sandbox-receipt.json"), result.sandbox)
    .catch(() => undefined);
  await writeJson(join(options.artifactDirectory, "metrics.json"), trialSummary(result)).catch(() => undefined);
  return result;
}

function trialArtifactPath(variantDirectory: string, trial: number): string {
  return `${variantDirectory}/trial-${String(trial).padStart(3, "0")}`;
}

/** Keep per-trial metrics readable; the full check list stays in validation.json. */
function trialSummary(result: CompareTrialResult): Record<string, unknown> {
  return {
    ...result,
    grade: { kind: result.grade.kind, passed: result.grade.passed, score: result.grade.score },
  };
}

function defaultExecutorFactory(context: CompareExecutorContext): HarnessExecutor {
  return new QoderSdkExecutor({
    profile: context.runtime.profile,
    tools: context.runtime.tools,
    allowedTools: context.runtime.allowedTools,
    disallowedTools: context.runtime.disallowedTools,
    permissionMode: context.runtime.permissionMode,
    canUseTool: createBoundedQoderPermissionCallback(
      context.trialRoot,
      context.permissionDecisions,
      context.expectedFiles,
    ),
    maxTurns: context.runtime.maxTurns,
    persistSession: false,
    ...(context.runtime.model ? { model: context.runtime.model } : {}),
    enableFileCheckpointing: context.runtime.enableFileCheckpointing,
    abortController: context.abortController,
    onRunEvent: (event) => context.traceEvents.push(event),
  });
}

async function prepareEmptyOutput(path: string): Promise<void> {
  try {
    const entries = await readdir(path);
    if (entries.length > 0) throw new Error(`Output directory is not empty: ${path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(path, { recursive: true });
}

function assertOutputSeparated(outputDirectory: string, fixtureDirectory: string): void {
  const outputFromFixture = relative(fixtureDirectory, outputDirectory);
  const fixtureFromOutput = relative(outputDirectory, fixtureDirectory);
  const isOwned = (value: string): boolean => value === "" || (!value.startsWith("..") && !isAbsolute(value));
  if (isOwned(outputFromFixture) || isOwned(fixtureFromOutput)) {
    throw new Error("Output directory and frozen fixture must not contain one another.");
  }
}

async function initializeGitRepository(root: string, temporaryParent: string, sandbox: TrialSandbox): Promise<void> {
  const hooks = join(temporaryParent, "empty-hooks");
  await mkdir(hooks);
  const commands: string[][] = [
    ["init", "--quiet"],
    ["-c", "core.autocrlf=false", "add", "--all"],
    [
      "-c", `core.hooksPath=${hooks}`,
      "-c", "user.name=Harness Compare",
      "-c", "user.email=harness-compare@example.invalid",
      "commit", "--quiet", "--no-gpg-sign", "-m", "frozen fixture",
    ],
  ];
  for (const args of commands) {
    const result = await sandbox.run("git", args, { cwd: root, timeoutMs: 30_000 });
    if (result.exitCode !== 0) {
      throw new Error(`Cannot initialize isolated Git fixture: ${result.stderr || result.stdout}`);
    }
  }
}

async function capturePatch(root: string, sandbox: TrialSandbox): Promise<string> {
  const untracked = await sandbox.run("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    timeoutMs: 30_000,
  });
  if (untracked.exitCode !== 0) throw new Error(`Cannot inspect untracked trial files: ${untracked.stderr}`);
  for (const path of untracked.stdout.split("\0").filter(Boolean).sort()) {
    const intent = await sandbox.run("git", ["add", "--intent-to-add", "--", path], {
      cwd: root,
      timeoutMs: 30_000,
    });
    if (intent.exitCode !== 0) throw new Error(`Cannot mark untracked file '${path}' for diff: ${intent.stderr}`);
  }
  const result = await sandbox.run("git", ["diff", "--binary", "--no-ext-diff", "--", "."], {
    cwd: root,
    timeoutMs: 30_000,
  });
  if (result.exitCode !== 0) throw new Error(`Cannot capture trial patch: ${result.stderr}`);
  return result.stdout;
}

async function snapshotDirectory(root: string): Promise<FileEvidence[]> {
  const evidence: FileEvidence[] = [];
  await visit(root, "");
  return evidence.sort((a, b) => a.path.localeCompare(b.path));

  async function visit(directory: string, relativeDirectory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (relativeDirectory === "" && entry.name === ".git") continue;
      const relativePath = portable(join(relativeDirectory, entry.name));
      const absolutePath = join(directory, entry.name);
      const metadata = await lstat(absolutePath);
      if (metadata.isDirectory()) {
        await visit(absolutePath, relativePath);
      } else if (metadata.isSymbolicLink()) {
        const target = await readlink(absolutePath);
        evidence.push({ path: relativePath, kind: "symlink", bytes: Buffer.byteLength(target), sha256: sha256Hex(target) });
      } else if (metadata.isFile()) {
        if (metadata.size > 5_000_000) {
          evidence.push({ path: relativePath, kind: "file", bytes: metadata.size, sha256: "oversize" });
        } else {
          const bytes = await readFile(absolutePath);
          evidence.push({ path: relativePath, kind: "file", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
        }
      }
    }
  }
}

function diffSnapshots(before: FileEvidence[], after: FileEvidence[]): string[] {
  const beforeByPath = new Map(before.map((item) => [item.path, item]));
  const afterByPath = new Map(after.map((item) => [item.path, item]));
  return [...new Set([...beforeByPath.keys(), ...afterByPath.keys()])]
    .filter((path) => canonicalJson(beforeByPath.get(path)) !== canonicalJson(afterByPath.get(path)))
    .sort();
}

function randomizedJobs(count: number, seed: number): Array<{ variant: CompareVariant; trial: number }> {
  const jobs: Array<{ variant: CompareVariant; trial: number }> = [];
  for (let trial = 1; trial <= count; trial += 1) {
    jobs.push({ variant: "baseline", trial }, { variant: "candidate", trial });
  }
  const random = mulberry32(seed);
  for (let index = jobs.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [jobs[index], jobs[other]] = [jobs[other], jobs[index]];
  }
  return jobs;
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function classifyTrial(
  execution: HarnessRunResult,
  grade: ReadmeGrade,
  thrownError?: string,
): TrialClassification {
  if (thrownError || (execution.exitCode !== 0 && /auth|credential|worker|runtime|spawn|ECONN|ENOTFOUND|timed out/i.test(execution.errorOutput))) {
    return "infrastructure_error";
  }
  return execution.exitCode === 0 && grade.passed ? "passed" : "failed";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, controller: AbortController): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new Error(`Qoder SDK trial timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (timedOut) {
      await Promise.race([
        promise.catch(() => undefined),
        new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000)),
      ]);
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function writeTrace(path: string, events: unknown[], trialRoot: string): Promise<void> {
  const content = events.map((event) => JSON.stringify(redactEvidenceValue(event, trialRoot))).join("\n");
  await writeFile(path, content ? `${content}\n` : "", "utf8");
}

function redactEvidenceValue(value: unknown, trialRoot: string): unknown {
  if (typeof value === "string") return redactRoot(value, trialRoot);
  if (Array.isArray(value)) return value.map((item) => redactEvidenceValue(item, trialRoot));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactEvidenceValue(item, trialRoot)]),
    );
  }
  return value;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function renderVerdictHtml(verdict: HarnessCompareVerdict): string {
  const row = (name: string, aggregate: VariantAggregate): string =>
    `<tr><th>${name}</th><td>${aggregate.passedTrials}/${aggregate.completedTrials}</td><td>${aggregate.meanScore}</td><td>${aggregate.infrastructureErrors}</td><td>$${aggregate.totalCostUsd.toFixed(4)}</td><td>$${aggregate.costPerCompletedTrialUsd.toFixed(4)}</td><td>${aggregate.totalCredits.toFixed(3)}</td></tr>`;
  const pairs = verdict.matchedPairs;
  return `<!doctype html>\n<html lang="en"><meta charset="utf-8"><title>Harness compare verdict</title>` +
    `<style>body{font:16px system-ui;max-width:900px;margin:3rem auto;padding:0 1rem}table{border-collapse:collapse}th,td{border:1px solid #bbb;padding:.5rem;text-align:left}.status{font-size:1.4rem}</style>` +
    `<body><h1>Harness compare verdict</h1><p class="status"><strong>${escapeHtml(verdict.status)}</strong>: ${escapeHtml(verdict.reason)}</p>` +
    `<p>Sandbox: <strong>${escapeHtml(sandboxPolicyLabel(verdict.sandbox))}</strong>.</p>` +
    `<p>Treatment axis <code>${escapeHtml(verdict.treatmentAxis)}</code>; matched pairs ${pairs.pairs} ` +
    `(candidate ${pairs.candidateWins}, baseline ${pairs.baselineWins}, ties ${pairs.ties}, ` +
    `mean score delta ${pairs.meanScoreDelta}); minimum required ${verdict.policy.minimumMatchedPairs}.</p>` +
    `<table><thead><tr><th>Variant</th><th>Passed</th><th>Mean score</th><th>Infra errors</th><th>Cost</th><th>Cost / completed</th><th>Credits</th></tr></thead><tbody>` +
    row("H0 baseline", verdict.baseline) + row("H1 candidate", verdict.candidate) +
    `</tbody></table><p>Manifest <code>${verdict.manifestHash}</code></p></body></html>\n`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function redactRoot(value: string, root: string): string {
  return value.replaceAll(root, "<trial-root>");
}

function portable(value: string): string {
  return value.replaceAll("\\", "/");
}

function compareVariant(a: CompareVariant, b: CompareVariant): number {
  return a === b ? 0 : a === "baseline" ? -1 : 1;
}

function pathToMemoryUri(path: string): string {
  return `memory://harness/${encodeURIComponent(basename(path))}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

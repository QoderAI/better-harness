import {
  aggregateVariant,
  decideVerdict,
  normalizeDecisionPolicy,
  summarizeMatchedPairs,
  type CompareTrialResult,
  type HarnessCompareVerdict,
  type MatchedPairSummary,
  type VariantAggregate,
} from "./aggregate.js";
import type { SandboxReceipt } from "./sandbox.js";

/**
 * Validate persisted comparison evidence before a consumer trusts its values.
 *
 * Shape checks alone let a hand-edited `verdict.json` present a legal schema with
 * invented aggregates, so every derived number is recomputed from the trial rows:
 * the rows are the evidence, the aggregates are only a summary of them.
 */
export function parseHarnessCompareVerdict(value: unknown): HarnessCompareVerdict {
  const verdict = requireRecord(value, "verdict.json");
  requireLiteral(verdict.schemaVersion, "harness-compare-result.v1", "schemaVersion");
  requireOneOf(
    verdict.status,
    ["accept", "need_more_work", "reject", "insufficient_evidence", "infrastructure_error"] as const,
    "status",
  );
  requireString(verdict.reason, "reason");
  requireOneOf(verdict.treatmentAxis, ["harness", "runtime-profile"] as const, "treatmentAxis");
  const policy = validateDecisionPolicy(verdict.policy, "policy");
  requireString(verdict.manifestHash, "manifestHash");
  requireString(verdict.fixtureHash, "fixtureHash");
  requireString(verdict.harnessHash, "harnessHash");
  validateSandboxReceipt(verdict.sandbox, "sandbox");
  const baseline = validateVariantAggregate(verdict.baseline, "baseline");
  const candidate = validateVariantAggregate(verdict.candidate, "candidate");
  const trials = requireArray(verdict.trials, "trials");
  trials.forEach((trial, index) => validateCompareTrial(trial, `trials[${index}]`));

  const rows = trials as CompareTrialResult[];
  const baselineRows = rows.filter((trial) => trial.variant === "baseline");
  const candidateRows = rows.filter((trial) => trial.variant === "candidate");
  if (baselineRows.length !== baseline.trials || candidateRows.length !== candidate.trials) {
    invalidVerdict(
      "trials must contain exactly the baseline.trials and candidate.trials entries declared by the aggregates",
    );
  }
  assertRecomputedAggregate(baseline, aggregateVariant(baselineRows), "baseline");
  assertRecomputedAggregate(candidate, aggregateVariant(candidateRows), "candidate");
  const persistedPairs = validateMatchedPairs(verdict.matchedPairs, "matchedPairs");
  const recomputedPairs = summarizeMatchedPairs(rows);
  assertRecomputedPairs(persistedPairs, recomputedPairs);
  const decision = decideVerdict({
    baseline,
    candidate,
    matchedPairs: recomputedPairs,
    policy,
  });
  if (verdict.status !== decision.status) {
    invalidVerdict(
      `status is '${String(verdict.status)}', but the trial rows and policy compute '${decision.status}'`,
    );
  }
  if (verdict.reason !== decision.reason) {
    invalidVerdict("reason does not match the decision derived from the trial rows and policy");
  }
  return value as HarnessCompareVerdict;
}

/** Every aggregate field is derived, so a mismatch means the summary was edited. */
function assertRecomputedAggregate(
  persisted: VariantAggregate,
  recomputed: VariantAggregate,
  path: string,
): void {
  for (const field of [
    "trials",
    "completedTrials",
    "infrastructureErrors",
    "passedTrials",
    "passRate",
    "meanScore",
    "totalCostUsd",
    "totalCredits",
    "costPerAttemptedTrialUsd",
    "costPerCompletedTrialUsd",
    "costPerPassedTrialUsd",
  ] as const) {
    if (Math.abs(persisted[field] - recomputed[field]) > 1e-9) {
      invalidVerdict(
        `${path}.${field} is ${persisted[field]}, but the trial rows compute ${recomputed[field]}`,
      );
    }
  }
}

function assertRecomputedPairs(persisted: MatchedPairSummary, recomputed: MatchedPairSummary): void {
  for (const field of ["pairs", "candidateWins", "baselineWins", "ties", "meanScoreDelta"] as const) {
    if (Math.abs(persisted[field] - recomputed[field]) > 1e-9) {
      invalidVerdict(
        `matchedPairs.${field} is ${persisted[field]}, but the trial rows compute ${recomputed[field]}`,
      );
    }
  }
}

function validateDecisionPolicy(value: unknown, path: string): HarnessCompareVerdict["policy"] {
  const policy = requireRecord(value, path);
  const minimumMatchedPairs = requireInteger(policy.minimumMatchedPairs, `${path}.minimumMatchedPairs`, 2);
  requireFiniteNumber(policy.maxInfrastructureErrorRatio, `${path}.maxInfrastructureErrorRatio`, 0, 0.5);
  requireFiniteNumber(policy.maxCostRatio, `${path}.maxCostRatio`, 1);
  requireFiniteNumber(policy.minimumMeanScoreGain, `${path}.minimumMeanScoreGain`, 0);
  const normalized = normalizeDecisionPolicy(policy as never);
  if (normalized.minimumMatchedPairs !== minimumMatchedPairs) {
    invalidVerdict(`${path}.minimumMatchedPairs is below the enforced floor`);
  }
  return value as HarnessCompareVerdict["policy"];
}

function validateMatchedPairs(value: unknown, path: string): MatchedPairSummary {
  const pairs = requireRecord(value, path);
  const total = requireInteger(pairs.pairs, `${path}.pairs`, 0);
  const candidateWins = requireInteger(pairs.candidateWins, `${path}.candidateWins`, 0);
  const baselineWins = requireInteger(pairs.baselineWins, `${path}.baselineWins`, 0);
  const ties = requireInteger(pairs.ties, `${path}.ties`, 0);
  requireFiniteNumber(pairs.meanScoreDelta, `${path}.meanScoreDelta`, -100, 100);
  if (candidateWins + baselineWins + ties !== total) {
    invalidVerdict(`${path}.candidateWins + baselineWins + ties must equal ${path}.pairs`);
  }
  return value as MatchedPairSummary;
}

function validateVariantAggregate(value: unknown, path: string): VariantAggregate {
  const aggregate = requireRecord(value, path);
  const trials = requireInteger(aggregate.trials, `${path}.trials`, 0);
  const completedTrials = requireInteger(aggregate.completedTrials, `${path}.completedTrials`, 0);
  const infrastructureErrors = requireInteger(
    aggregate.infrastructureErrors,
    `${path}.infrastructureErrors`,
    0,
  );
  const passedTrials = requireInteger(aggregate.passedTrials, `${path}.passedTrials`, 0);
  const passRate = requireFiniteNumber(aggregate.passRate, `${path}.passRate`, 0, 1);
  requireFiniteNumber(aggregate.meanScore, `${path}.meanScore`, 0, 100);
  requireFiniteNumber(aggregate.totalCostUsd, `${path}.totalCostUsd`, 0);
  requireFiniteNumber(aggregate.totalCredits, `${path}.totalCredits`, 0);
  for (const field of [
    "costPerAttemptedTrialUsd",
    "costPerCompletedTrialUsd",
    "costPerPassedTrialUsd",
  ] as const) {
    requireFiniteNumber(aggregate[field], `${path}.${field}`, 0);
  }
  if (completedTrials + infrastructureErrors !== trials) {
    invalidVerdict(`${path}.completedTrials + ${path}.infrastructureErrors must equal ${path}.trials`);
  }
  if (passedTrials > completedTrials) {
    invalidVerdict(`${path}.passedTrials must not exceed ${path}.completedTrials`);
  }
  const expectedPassRate = completedTrials === 0 ? 0 : passedTrials / completedTrials;
  if (Math.abs(passRate - expectedPassRate) > Number.EPSILON * 4) {
    invalidVerdict(`${path}.passRate does not match passedTrials / completedTrials`);
  }
  return value as VariantAggregate;
}

function validateCompareTrial(value: unknown, path: string): void {
  const trial = requireRecord(value, path);
  requireOneOf(trial.variant, ["baseline", "candidate"] as const, `${path}.variant`);
  requireString(trial.harnessId, `${path}.harnessId`);
  requireString(trial.runtimeProfile, `${path}.runtimeProfile`);
  requireInteger(trial.trial, `${path}.trial`, 1);
  requireOneOf(
    trial.classification,
    ["passed", "failed", "infrastructure_error"] as const,
    `${path}.classification`,
  );
  requireArray(trial.changedFiles, `${path}.changedFiles`).forEach((item, index) =>
    requireString(item, `${path}.changedFiles[${index}]`),
  );
  validateReadmeGrade(trial.grade, `${path}.grade`);
  requireInteger(trial.executorExitCode, `${path}.executorExitCode`, 0);
  requireString(trial.executorError, `${path}.executorError`, true);
  requireString(trial.revisionId, `${path}.revisionId`);
  requireFiniteNumber(trial.durationMs, `${path}.durationMs`, 0);
  requireString(trial.artifactDirectory, `${path}.artifactDirectory`);
  validateSandboxReceipt(trial.sandbox, `${path}.sandbox`);
  if (trial.metrics !== undefined) validateRunMetrics(trial.metrics, `${path}.metrics`);
}

function validateSandboxReceipt(value: unknown, path: string): SandboxReceipt {
  const receipt = requireRecord(value, path);
  requireOneOf(receipt.policy, ["trusted-fixture", "isolated"] as const, `${path}.policy`);
  requireOneOf(receipt.envPolicy, ["allowlist", "inherited"] as const, `${path}.envPolicy`);
  requireArray(receipt.envKeys, `${path}.envKeys`).forEach((item, index) =>
    requireString(item, `${path}.envKeys[${index}]`),
  );
  requireOneOf(receipt.networkPolicy, ["denied", "unverified"] as const, `${path}.networkPolicy`);
  requireOneOf(receipt.fsScope, ["trial-root", "host"] as const, `${path}.fsScope`);
  requireArray(receipt.permissionFlags, `${path}.permissionFlags`).forEach((item, index) =>
    requireString(item, `${path}.permissionFlags[${index}]`),
  );
  return value as SandboxReceipt;
}

function validateReadmeGrade(value: unknown, path: string): void {
  const grade = requireRecord(value, path);
  requireLiteral(grade.kind, "readme-package-v1", `${path}.kind`);
  requireBoolean(grade.passed, `${path}.passed`);
  requireFiniteNumber(grade.score, `${path}.score`, 0, 100);
  requireArray(grade.checks, `${path}.checks`).forEach((item, index) => {
    const checkPath = `${path}.checks[${index}]`;
    const check = requireRecord(item, checkPath);
    requireString(check.id, `${checkPath}.id`);
    requireBoolean(check.passed, `${checkPath}.passed`);
    requireBoolean(check.hard, `${checkPath}.hard`);
    requireFiniteNumber(check.weight, `${checkPath}.weight`, 0);
    requireString(check.detail, `${checkPath}.detail`, true);
    if (check.command !== undefined) validateCommandResult(check.command, `${checkPath}.command`);
  });
}

function validateCommandResult(value: unknown, path: string): void {
  const command = requireRecord(value, path);
  requireArray(command.command, `${path}.command`).forEach((item, index) =>
    requireString(item, `${path}.command[${index}]`),
  );
  requireInteger(command.exitCode, `${path}.exitCode`, 0);
  requireString(command.stdout, `${path}.stdout`, true);
  requireString(command.stderr, `${path}.stderr`, true);
  requireBoolean(command.timedOut, `${path}.timedOut`);
  requireFiniteNumber(command.durationMs, `${path}.durationMs`, 0);
}

function validateRunMetrics(value: unknown, path: string): void {
  const metrics = requireRecord(value, path);
  for (const field of ["durationMs", "durationApiMs", "costUsd", "credits"] as const) {
    if (metrics[field] !== undefined) requireFiniteNumber(metrics[field], `${path}.${field}`, 0);
  }
  if (metrics.turns !== undefined) requireInteger(metrics.turns, `${path}.turns`, 0);
  for (const field of ["usage", "modelUsage"] as const) {
    if (metrics[field] !== undefined) requireRecord(metrics[field], `${path}.${field}`);
  }
  if (metrics.permissionDenials !== undefined) requireArray(metrics.permissionDenials, `${path}.permissionDenials`);
  for (const field of ["sessionId", "stopReason", "terminalReason"] as const) {
    if (metrics[field] !== undefined) requireString(metrics[field], `${path}.${field}`, true);
  }
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalidVerdict(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalidVerdict(`${path} must be an array`);
  return value;
}

function requireString(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    invalidVerdict(`${path} must be ${allowEmpty ? "a string" : "a non-empty string"}`);
  }
  return value;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalidVerdict(`${path} must be a boolean`);
  return value;
}

function requireInteger(value: unknown, path: string, minimum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    invalidVerdict(`${path} must be an integer greater than or equal to ${minimum}`);
  }
  return value as number;
}

function requireFiniteNumber(value: unknown, path: string, minimum: number, maximum = Infinity): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    invalidVerdict(`${path} must be a finite number between ${minimum} and ${maximum}`);
  }
  return value;
}

function requireLiteral<T extends string>(value: unknown, expected: T, path: string): T {
  if (value !== expected) invalidVerdict(`${path} must equal '${expected}'`);
  return expected;
}

function requireOneOf<T extends string>(value: unknown, expected: readonly T[], path: string): T {
  if (typeof value !== "string" || !expected.includes(value as T)) {
    invalidVerdict(`${path} must be one of ${expected.map((item) => `'${item}'`).join(", ")}`);
  }
  return value as T;
}

function invalidVerdict(detail: string): never {
  throw new Error(`Invalid harness-compare-result.v1 verdict: ${detail}.`);
}

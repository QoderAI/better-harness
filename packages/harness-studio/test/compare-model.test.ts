import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { HarnessCompareVerdict } from "@qoder-ai/harness/compare";
import { CompareVerdictError, parseVerdict, summarizeVerdict } from "../src/app/compare-model.js";

export const FIXTURE_VERDICT = JSON.parse(
  await readFile(new URL("./fixtures/verdict.json", import.meta.url), "utf8"),
) as HarnessCompareVerdict;

describe("parseVerdict", () => {
  it("accepts the frozen harness-compare-result.v1 schema", () => {
    expect(parseVerdict(FIXTURE_VERDICT)).toBe(FIXTURE_VERDICT);
  });

  it("rejects other schemas and malformed documents", () => {
    expect(() => parseVerdict(null)).toThrow(CompareVerdictError);
    expect(() => parseVerdict({ schemaVersion: "harness-compare-result.v2" })).toThrow(
      /schemaVersion must equal 'harness-compare-result.v1'/,
    );
    expect(() =>
      parseVerdict({ schemaVersion: "harness-compare-result.v1", baseline: {} }),
    ).toThrow(/status must be one of/);
  });

  it("rejects malformed nested aggregates and trial grades before rendering", () => {
    expect(() => parseVerdict({
      ...FIXTURE_VERDICT,
      baseline: { ...FIXTURE_VERDICT.baseline, totalCostUsd: "not-a-number" },
    })).toThrow(/baseline.totalCostUsd/);
    expect(() => parseVerdict({
      ...FIXTURE_VERDICT,
      trials: [
        { ...FIXTURE_VERDICT.trials[0], grade: {} },
        ...FIXTURE_VERDICT.trials.slice(1),
      ],
    })).toThrow(/trials\[0\]\.grade\.kind/);
  });

  it("rejects a summary the trial rows do not support", () => {
    // The rows are the evidence; a hand-edited aggregate or pair count is not.
    expect(() => parseVerdict({
      ...FIXTURE_VERDICT,
      baseline: { ...FIXTURE_VERDICT.baseline, meanScore: 90 },
    })).toThrow(/baseline.meanScore is 90, but the trial rows compute 42/);
    expect(() => parseVerdict({
      ...FIXTURE_VERDICT,
      matchedPairs: { ...FIXTURE_VERDICT.matchedPairs, pairs: 4, candidateWins: 4 },
    })).toThrow(/matchedPairs.pairs is 4, but the trial rows compute 2/);
  });
});

describe("summarizeVerdict", () => {
  it("derives the per-variant rows and trial rows the Compare view renders", () => {
    const summary = summarizeVerdict(FIXTURE_VERDICT);

    expect(summary.status).toBe("accept");
    expect(summary.rows).toEqual([
      {
        variant: "baseline",
        label: "Baseline",
        passedTrials: 0,
        completedTrials: 2,
        passRate: 0,
        meanScore: 42,
        infrastructureErrors: 0,
        totalCostUsd: 0.011,
        costPerCompletedTrialUsd: 0.0055,
        totalCredits: 1.5,
      },
      {
        variant: "candidate",
        label: "Candidate",
        passedTrials: 2,
        completedTrials: 2,
        passRate: 1,
        meanScore: 90,
        infrastructureErrors: 0,
        totalCostUsd: 0.014,
        costPerCompletedTrialUsd: 0.007,
        totalCredits: 1.8,
      },
    ]);
    expect(summary.trials).toHaveLength(4);
    expect(summary.trials[2]).toEqual({
      variant: "candidate",
      trial: 1,
      harnessId: "readme-grounded",
      runtimeProfile: "qoder-default-v1",
      classification: "passed",
      durationMs: 74500,
      changedFiles: ["README.md"],
    });
  });

  it("carries the paired evidence and its threshold so a status stays checkable", () => {
    const summary = summarizeVerdict(FIXTURE_VERDICT);

    expect(summary.treatmentAxis).toBe("harness");
    expect(summary.evidence).toEqual({
      pairs: 2,
      candidateWins: 2,
      baselineWins: 0,
      ties: 0,
      meanScoreDelta: 48,
      minimumMatchedPairs: 2,
      costRatio: 0.007 / 0.0055,
      costWithinGuardrail: true,
      maxCostRatio: 1.3,
    });
  });

  it("preserves the verdict cost guardrail when both variants have zero cost", () => {
    const summary = summarizeVerdict({
      ...FIXTURE_VERDICT,
      baseline: { ...FIXTURE_VERDICT.baseline, costPerCompletedTrialUsd: 0 },
      candidate: { ...FIXTURE_VERDICT.candidate, costPerCompletedTrialUsd: 0 },
    });

    expect(summary.evidence.costRatio).toBeNull();
    expect(summary.evidence.costWithinGuardrail).toBe(true);
  });
});

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "vitest";

import { workspaceToQoderSlug } from "../../scripts/session-analysis/platforms/qoder.mjs";
import { buildUsageSummary } from "../../scripts/session-analysis/usage-summary.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const CLI = path.join(ROOT, "scripts", "better-harness.mjs");

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

async function writeJsonl(filePath, rows) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

test("usage summary keeps the decision boundary and removes private detail", () => {
  const summary = buildUsageSummary({
    scope: { workspace: "/Users/private/repo" },
    selection: { strategy: "all-eligible", eligibleCount: 4, analyzedCount: 4 },
    warnings: [{ code: "missing-optional-root", message: "/Users/private/.qoder is missing" }],
    insights: {
      keySignals: {
        usageEfficiency: {
          accountingMode: "host-estimated",
          coverage: {
            analyzedSessionCount: 4,
            responseCount: 7,
            usageFieldObservedCount: 5,
            nonZeroUsageCount: 3,
            modelAttributedResponseCount: 6,
            unattributedResponseCount: 1,
            exactCreditsAvailable: false,
          },
          longSessions: { longActiveCount: 2, longWallCount: 3, wallOnlyCount: 1 },
          tokenTotals: { inputTokens: 120, outputTokens: 30 },
          modelUsage: [{
            model: "example-model",
            responseCount: 6,
            usageFieldObservedCount: 5,
            nonZeroUsageCount: 3,
            tokenTotals: { inputTokens: 120, outputTokens: 30 },
          }],
          candidates: [{ id: "private-session-id" }],
          opportunities: [{ id: "review-outcomes" }],
          outcomeReview: {
            status: "required",
            reviewedCandidateCount: 0,
            comparableModelOutcomeEvidence: false,
            reason: "semantic-outcome-review-not-run",
          },
        },
      },
    },
  });

  assert.equal(summary.kind, "better-harness.session-usage-summary");
  assert.equal(summary.selection.complete, true);
  assert.equal(summary.usageEfficiency.candidateCount, 1);
  assert.equal(summary.evidenceBoundary.requiresSemanticReview, true);
  assert.deepEqual(summary.evidenceBoundary.warningCodes, ["missing-optional-root"]);
  assert.doesNotMatch(JSON.stringify(summary), /Users\/private|private-session-id|\.qoder/);
});

test("public usage summary is read-only and emits compact JSON", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-usage-summary-"));
  const workspace = path.join(root, "workspace");
  const home = path.join(root, "qoder-home");
  await mkdir(workspace, { recursive: true });
  await mkdir(home, { recursive: true });

  try {
    const before = await readdir(workspace);
    const result = runCli([
      "session-analysis",
      "usage-summary",
      "--platform", "qoder",
      "--workspace", workspace,
      "--home", home,
      "--format", "json",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.selection.eligibleCount, 0);
    assert.equal(payload.evidenceBoundary.hasEligibleSessions, false);
    assert.deepEqual(await readdir(workspace), before);
    assert.doesNotMatch(result.stdout, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const refusedPath = path.join(workspace, ".tmp-insights.json");
    const refused = runCli([
      "session-analysis",
      "usage-summary",
      "--workspace", workspace,
      "--home", home,
      "--output", refusedPath,
    ]);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /does not accept --output/);
    assert.equal(existsSync(refusedPath), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("public usage summary excludes unrelated Qoder home-only sessions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-usage-boundary-"));
  const workspace = path.join(root, "workspace");
  const otherWorkspace = path.join(root, "other-workspace");
  const home = path.join(root, "qoder-home");
  const workspaceSessionId = "workspace-session";
  const unrelatedSessionId = "unrelated-home-only";
  const slug = workspaceToQoderSlug(workspace);
  await mkdir(workspace, { recursive: true });

  await writeJsonl(path.join(home, "projects", slug, `${workspaceSessionId}.jsonl`), [
    {
      type: "model.response.completed",
      sessionId: workspaceSessionId,
      timestamp: "2026-06-18T10:00:00.000Z",
      cwd: workspace,
      model: "workspace-model",
      usage: { input_tokens: 20, output_tokens: 4 },
    },
  ]);
  await writeJsonl(path.join(home, "sessions", `${unrelatedSessionId}.jsonl`), [
    {
      type: "model.response.completed",
      sessionId: unrelatedSessionId,
      timestamp: "2026-06-18T10:01:00.000Z",
      cwd: otherWorkspace,
      model: "unrelated-model",
      usage: { input_tokens: 200, output_tokens: 40 },
    },
  ]);

  try {
    const result = runCli([
      "session-analysis",
      "usage-summary",
      "--platform", "qoder",
      "--workspace", workspace,
      "--home", home,
      "--format", "json",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.selection.eligibleCount, 1);
    assert.equal(payload.usageEfficiency.coverage.responseCount, 1);
    assert.equal(payload.usageEfficiency.coverage.nonZeroUsageCount, 1);
    assert.equal(payload.usageEfficiency.modelUsage.some((item) => item.model === "workspace-model"), true);
    assert.equal(payload.usageEfficiency.modelUsage.some((item) => item.model === "unrelated-model"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("public usage summary help exposes its no-write contract", () => {
  const result = runCli(["session-analysis", "usage-summary", "--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /bounded, read-only usage boundary/);
  assert.match(result.stdout, /never accepts\s+--output/);
});

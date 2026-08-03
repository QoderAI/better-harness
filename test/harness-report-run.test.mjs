import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ANALYZE_EVIDENCE_TOKEN_BUDGET,
  estimateEvidenceTokens,
  formatHarnessEvidence,
} from "../scripts/harness-analysis/evidence-brief.mjs";
import { analyzeHarnessEvidence } from "../scripts/harness-analysis/report-run.mjs";
import { splitTaskLoopFindings } from "../scripts/harness-analysis/task-loop-report.mjs";
import { buildTaskLoopRepositoryEvidence } from "../scripts/harness-analysis/task-loop-repository-evidence.mjs";
import { buildTaskLoopSourceCandidate } from "../scripts/harness-analysis/task-loop-source.mjs";

const cliPath = path.join(process.cwd(), "scripts", "better-harness.mjs");

async function withTempDir(name, fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), name));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function candidateSource(workspace, platform = "qoder") {
  const repositoryEvidence = buildTaskLoopRepositoryEvidence({
    trackedFiles: ["AGENTS.md", "package.json", "test/a.test.mjs"],
    packageManifest: { scripts: { test: "node --test" } },
  });
  const source = buildTaskLoopSourceCandidate({
    scope: { platform, workspace },
    selection: { strategy: "latest-n", eligibleCount: 0, analyzedCount: 0, strata: [] },
    events: [],
    repositoryEvidence: {
      ...repositoryEvidence,
      diagnosticCoverageReviews: [{
        id: "core-diagnostic-coverage",
        status: "covered",
        affectedScope: "repository-wide",
        summary: "Core diagnostics are covered by the bounded fixture.",
        evidenceRefs: [{ kind: "repository", id: "diagnostic-route" }],
      }],
    },
  });
  source.repositoryEvidence.findings.push({
    id: "fixture-task-observation-gap",
    kind: "evidence-gap",
    severity: "Medium",
    title: "Task closure lacks a complete evidence trail",
    reason: "The bounded fixture does not retain one chain from task intent through focused validation and acceptance evidence.",
    expectedOutcome: "The next task retains one reviewable chain from intent through acceptance.",
    expectedArtifact: "Rule",
    expectedOutput: ["Update the project Rule so each task records its goal, focused validation, and acceptance evidence before completion."],
    dimensionRefs: ["task-understanding", "controlled-execution", "change-validation", "reliable-delivery"],
    subdimensionRefs: ["goal-understanding", "instruction-led-start", "relevant-check", "acceptance-evidence"],
    staticEvidence: [{ kind: "repository", id: "diagnostic-route" }],
    projectionPolicy: "required",
    aiFixPrompt: "/better-harness fix this issue",
  });
  return source;
}

function candidateSourceWithUsage(workspace) {
  const source = candidateSource(workspace);
  source.manifest.selection = {
    ...source.manifest.selection,
    eligibleCount: 2,
    analyzedCount: 2,
  };
  source.sessionEvents.usageActivity = {
    schemaVersion: 1,
    dateBasis: "UTC",
    measurementBasis: "fixture",
    truncated: false,
    dates: ["2026-07-19"],
    sessions: { total: 2, starts: [2], activeMinutes: [18] },
    models: [{ name: "performance", total: 2, daily: [2] }],
    skills: [{ name: "harness", total: 1, daily: [1] }],
  };
  source.sessionEvents.usageEfficiency = {
    schemaVersion: 1,
    selection: { strategy: "all-eligible", eligibleSessionCount: 2, analyzedSessionCount: 2, complete: true },
    roles: { userThreadCandidateCount: 2, childAgentCandidateCount: 0 },
    longSessions: { activeCount: 0, wallOnlyCount: 0, longestActiveMinutes: 0 },
    accounting: {
      mode: "effort-proxy",
      responseCount: 2,
      modelAttributedResponseCount: 2,
      unattributedResponseCount: 0,
      usageFieldObservedCount: 2,
      nonZeroUsageCount: 0,
      exactCreditsAvailable: false,
    },
    modelUsage: [{ model: "performance", responseCount: 2, usageFieldObservedCount: 2, nonZeroUsageCount: 0 }],
    outcomeReview: {
      status: "not-applicable",
      reviewedCandidateCount: 0,
      comparableModelOutcomeEvidence: false,
      recommendation: "controlled-a-b-required",
    },
  };
  return source;
}

test("analyze defaults to plain-text evidence and writes nothing", async () => {
  await withTempDir("harness-analyze-text-", async (workspace) => {
    const text = await analyzeHarnessEvidence({
      workspace,
      sourceInput: candidateSource(workspace),
      language: "en",
    });

    assert.match(text, /^HARNESS ANALYSIS EVIDENCE/u);
    assert.match(text, /read-only evidence brief, not a report conclusion/u);
    assert.match(text, new RegExp(`Workspace: ${workspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(text, /1 tracked test file\(s\)/u);
    assert.match(text, /Projected report conclusions are intentionally excluded/u);
    assert.doesNotMatch(text, /Task closure lacks a complete evidence trail|Review leads:|Expected artifact:|Expected output:|AI fix prompt:|Severity:/u);
    assert.doesNotMatch(text, /(?:^|\n)\s*(?:Kind|Id):|item \d+/u);
    assert.ok(estimateEvidenceTokens(text) <= ANALYZE_EVIDENCE_TOKEN_BUDGET);
    assert.deepEqual(await readdir(workspace), []);
  });
});

test("analyze keeps high-volume evidence neutral and within its token budget", () => {
  const workspace = "/workspace/example";
  const source = candidateSource(workspace);
  source.repositoryEvidence.aiAgentPractice = {
    coverageRows: Array.from({ length: 120 }, (_, index) => ({
      surface: `Surface ${index + 1}`,
      scopes: ["Project"],
      count: 20,
      paths: Array.from({ length: 20 }, (__, pathIndex) => `rules/${index + 1}/asset-${pathIndex + 1}.md`),
    })),
  };
  source.repositoryEvidence.findings = Array.from({ length: 120 }, (_, index) => ({
    title: `PROJECTED CONCLUSION ${index + 1} MUST NOT APPEAR`,
  }));
  source.semanticFacets = Array.from({ length: 200 }, (_, index) => ({
    summary: `Bounded session observation ${index + 1} ${"evidence ".repeat(120)}`,
    evidenceRefs: [{ kind: "fixture", id: `ref-${index + 1}` }],
  }));
  source.taskEpisodes = Array.from({ length: 80 }, (_, index) => ({
    id: `episode:${String(index + 1).padStart(12, "0")}`,
    sessionCount: 1,
    startBoundary: index === 0 ? "first-retained-boundary" : "session-start",
    changeSets: [{ eventCount: index + 1 }],
    validationSets: index % 3 === 0 ? [{ eventCount: 1 }] : [],
    closure: { status: "unobserved" },
    repair: { status: "not-applicable" },
    elapsedMs: 1_000,
    toolCalls: index + 1,
    eventEvidenceCount: 10,
  }));

  const text = formatHarnessEvidence(source, { workspace, platform: "qoder", language: "en" });

  assert.ok(estimateEvidenceTokens(text) <= ANALYZE_EVIDENCE_TOKEN_BUDGET);
  assert.match(text, /first-retained-boundary/u);
  assert.match(text, /additional task episode\(s\) omitted/u);
  assert.match(text, /additional analyzer observation\(s\) omitted/u);
  assert.match(text, /additional row\(s\) omitted/u);
  assert.doesNotMatch(text, /PROJECTED CONCLUSION|Review leads|item \d+|(?:^|\n)\s*(?:Kind|Id):/u);
});

test("analyze JSON preserves exact summary facts through compact Canvas rendering", async () => {
  const workspace = "/workspace/example";
  const result = await analyzeHarnessEvidence({
    workspace,
    sourceInput: candidateSourceWithUsage(workspace),
    language: "en",
    format: "json",
  });

  assert.equal(result.kind, "better-harness.harness-analysis-evidence");
  assert.equal(result.schemaVersion, 1);
  assert.match(result.evidence, /^HARNESS ANALYSIS EVIDENCE/u);
  assert.equal(result.summaryFacts.usageActivity.sessions.total, 2);
  assert.equal(result.summaryFacts.usageEfficiency.selection.analyzedSessionCount, 2);
  assert.equal(result.summaryFacts.evidenceBoundary.manifest.platform, "qoder");
  assert.equal(Object.hasOwn(result, "findings"), false);

  const input = JSON.parse(readFileSync(
    path.join(process.cwd(), "templates", "reporting", "harness-findings.input.json"),
    "utf8",
  ));
  Object.assign(input.summary, structuredClone(result.summaryFacts));
  const split = splitTaskLoopFindings(input);
  assert.equal(split.canvas.summary.usageActivity.sessions.total, 2);
  assert.equal(split.canvas.summary.usageEfficiency.selection.eligibleSessionCount, 2);
  assert.equal(split.canvas.summary.evidenceBoundary.manifest.platform, "qoder");
  assert.equal(Object.hasOwn(split.findings.summary, "usageEfficiency"), false);
});

test("analyze can initialize machine-owned Canvas summary facts", async () => {
  await withTempDir("harness-analyze-canvas-facts-", async (workspace) => {
    const canvasPath = path.join(workspace, "run", "canvas.json");
    const result = await analyzeHarnessEvidence({
      workspace,
      sourceInput: candidateSourceWithUsage(workspace),
      language: "en",
      format: "json",
      "canvas-out": canvasPath,
    });

    assert.equal(result.canvasPath, canvasPath);
    const canvas = JSON.parse(await readFile(canvasPath, "utf8"));
    assert.equal(canvas.schemaVersion, 1);
    assert.equal(canvas.summaryFactsSchemaVersion, 1);
    assert.equal(canvas.summary.evidenceBoundary.manifest.platform, "qoder");
    assert.equal(canvas.summary.usageActivity.sessions.total, 2);
    assert.equal(canvas.summary.usageEfficiency.selection.analyzedSessionCount, 2);
    assert.deepEqual(canvas.dimensions, []);
    assert.deepEqual(canvas.findings, []);
  });
});

test("analyze Canvas output requires Qoder or Cursor JSON and the canonical filename", async () => {
  const sourceInput = candidateSourceWithUsage("/workspace/example");
  await assert.rejects(
    analyzeHarnessEvidence({
      workspace: "/workspace/example",
      sourceInput,
      "canvas-out": "/tmp/canvas.json",
    }),
    /--canvas-out requires --format json/u,
  );
  await assert.rejects(
    analyzeHarnessEvidence({
      workspace: "/workspace/example",
      sourceInput,
      platform: "codex",
      format: "json",
      "canvas-out": "/tmp/canvas.json",
    }),
    /supported for Qoder and Cursor Canvas bundles/u,
  );
  await assert.rejects(
    analyzeHarnessEvidence({
      workspace: "/workspace/example",
      sourceInput,
      format: "json",
      "canvas-out": "/tmp/usage.json",
    }),
    /must target canvas\.json/u,
  );
  await assert.rejects(
    analyzeHarnessEvidence({
      workspace: "/workspace/example",
      sourceInput,
      format: "json",
      "replace-canvas": true,
    }),
    /--replace-canvas requires --canvas-out/u,
  );
});

test("analyze Canvas output never overwrites an existing report artifact", async () => {
  await withTempDir("harness-analyze-canvas-existing-", async (workspace) => {
    const canvasPath = path.join(workspace, "canvas.json");
    await writeFile(canvasPath, "preserved\n");
    await assert.rejects(
      analyzeHarnessEvidence({
        workspace,
        sourceInput: candidateSourceWithUsage(workspace),
        format: "json",
        "canvas-out": canvasPath,
      }),
      /refuses to replace an existing file/u,
    );
    assert.equal(await readFile(canvasPath, "utf8"), "preserved\n");
  });
});

test("analyze atomically refreshes the exact Canvas when overwrite is authorized", async () => {
  await withTempDir("harness-analyze-canvas-replace-", async (workspace) => {
    const canvasPath = path.join(workspace, "run", "canvas.json");
    await analyzeHarnessEvidence({
      workspace,
      sourceInput: candidateSourceWithUsage(workspace),
      format: "json",
      "canvas-out": canvasPath,
    });
    const stale = JSON.parse(await readFile(canvasPath, "utf8"));
    stale.summary.evidenceMode = "stale-value";
    await writeFile(canvasPath, `${JSON.stringify(stale, null, 2)}\n`);

    const result = await analyzeHarnessEvidence({
      workspace,
      sourceInput: candidateSourceWithUsage(workspace),
      format: "json",
      "canvas-out": canvasPath,
      "replace-canvas": true,
    });

    assert.equal(result.canvasPath, canvasPath);
    assert.equal(result.canvasReplaced, true);
    const refreshed = JSON.parse(await readFile(canvasPath, "utf8"));
    assert.equal(refreshed.summary.evidenceMode, "session-limited");
    assert.equal(refreshed.summary.usageActivity.sessions.total, 2);
    assert.deepEqual(await readdir(path.dirname(canvasPath)), ["canvas.json"]);
  });
});

test("analyze's real evidence collector leaves an empty workspace unchanged", async () => {
  await withTempDir("harness-analyze-live-", async (workspace) => {
    const text = await analyzeHarnessEvidence({
      workspace,
      "qoder-home": path.join(workspace, "missing-qoder-home"),
      language: "en",
    });

    assert.match(text, /^HARNESS ANALYSIS EVIDENCE/u);
    assert.deepEqual(await readdir(workspace), []);
  });
});

test("analyze's real evidence collector accepts empty Claude and Cursor homes", async () => {
  for (const platform of ["claude", "cursor"]) {
    await withTempDir(`harness-analyze-live-${platform}-`, async (workspace) => {
      const text = await analyzeHarnessEvidence({
        workspace,
        platform,
        [`${platform}-home`]: path.join(workspace, `missing-${platform}-home`),
        language: "en",
      });

      assert.match(text, new RegExp(`Platform: ${platform}`, "u"));
      assert.deepEqual(await readdir(workspace), []);
    });
  }
});

test("analyze labels non-Qoder provider evidence without creating host directories", async () => {
  for (const platform of ["codex", "claude", "cursor"]) {
    await withTempDir(`harness-analyze-${platform}-`, async (workspace) => {
      const text = await analyzeHarnessEvidence({
        workspace,
        platform,
        sourceInput: candidateSource(workspace, platform),
      });

      assert.match(text, new RegExp(`Platform: ${platform}`, "u"));
      assert.doesNotMatch(text, /report\.html|report\.md|findings\.json/u);
      assert.deepEqual(await readdir(workspace), []);
    });
  }
});

test("root CLI exposes read-only formats and explicit Qoder Canvas output", () => {
  const result = spawnSync(process.execPath, [cliPath, "harness", "analyze", "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Return neutral, budgeted Harness evidence/u);
  assert.match(result.stdout, /writes no files unless/u);
  assert.match(result.stdout, /--format <text\|json>/u);
  assert.match(result.stdout, /--since <ISO timestamp>/u);
  assert.match(result.stdout, /--until <ISO timestamp>/u);
  assert.match(result.stdout, /--canvas-out <file>/u);
  assert.match(result.stdout, /--replace-canvas/u);
  assert.doesNotMatch(result.stdout, /--out|--run-dir|--json|prepare|finalize|decision|staging/iu);
});

test("root CLI writes analyzer-owned Canvas facts only when explicitly requested", async () => {
  await withTempDir("harness-analyze-canvas-cli-", async (workspace) => {
    const canvasPath = path.join(workspace, "run", "canvas.json");
    const result = spawnSync(process.execPath, [
      cliPath,
      "harness",
      "analyze",
      "--workspace", workspace,
      "--qoder-home", path.join(workspace, "missing-qoder-home"),
      "--format", "json",
      "--canvas-out", canvasPath,
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.canvasPath, canvasPath);
    const canvas = JSON.parse(await readFile(canvasPath, "utf8"));
    assert.equal(canvas.summaryFactsSchemaVersion, 1);
    assert.equal(canvas.summary.evidenceBoundary.manifest.platform, "qoder");
  });
});

test("analyze rejects an unsupported format before writing", async () => {
  await withTempDir("harness-analyze-format-", async (workspace) => {
    const result = spawnSync(process.execPath, [cliPath, "harness", "analyze", "--workspace", workspace, "--format", "yaml"], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /unsupported analyze format: yaml/u);
    assert.deepEqual(await readdir(workspace), []);
  });
});

for (const option of ["--out", "--run-dir", "--json", "--source-input"]) {
  test(`analyze rejects ${option} before writing`, async () => {
    await withTempDir("harness-analyze-option-", async (workspace) => {
      const args = [cliPath, "harness", "analyze", "--workspace", workspace, option];
      if (option !== "--json") args.push("unused");
      const result = spawnSync(process.execPath, args, { encoding: "utf8" });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, new RegExp(`unknown analyze argument: ${option}`));
      assert.deepEqual(await readdir(workspace), []);
    });
  });
}

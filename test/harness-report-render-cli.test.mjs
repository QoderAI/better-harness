import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { evaluateHtmlReport, renderHtml } from "../scripts/harness-analysis/renderers/html.mjs";
import { renderCanvasTsx } from "../scripts/harness-analysis/renderers/qoder-canvas.mjs";
import { buildTaskLoopSourceCandidate } from "../scripts/harness-analysis/task-loop-source.mjs";
import { applyEpisodeReviews } from "../scripts/harness-analysis/episode-evidence-review.mjs";

const cliPath = path.join(process.cwd(), "scripts", "better-harness.mjs");
const renderPath = path.join(process.cwd(), "scripts", "harness-analysis", "render-report.mjs");

function richAiFixPrompt(problem) {
  return `/better-harness fix this issue

${problem} in \`scripts/harness-analysis/validate-canvas.mjs\`. Update the harness validation path so the generated report can cite the result without modifying project source files.

## Validation

- Run \`node scripts/harness-analysis/validate-canvas.mjs --canvas report.canvas.tsx --findings findings.json\`
- Confirm report-quality and canvas validation pass`;
}

async function withTempDir(name, fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), name));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function sampleFindings() {
  return {
    summary: {
      projectName: "render-fixture",
      modelId: "software-fluency",
      strengths: [
        "Source and test structure are clear enough for scoped follow-up.",
        "Rules, Skills, MCP, Plugins, and Session Insights were inspected.",
      ],
      dimensions: [{
        id: "context-map",
        label: "Context Map",
        score: 62,
        summary: "Project guidance maps the main workflow, but cross-cutting ownership remains implicit.",
        findingRefs: [],
      }, {
        id: "environment-readiness",
        label: "Environment Readiness",
        score: 54,
        summary: "Build entrypoints are visible, while repeatable setup evidence is incomplete.",
        findingRefs: ["aia-workflow-evidence"],
      }, {
        id: "fast-feedback",
        label: "Fast Feedback",
        score: 58,
        summary: "Focused checks exist, but a successful runtime smoke was not observed.",
        findingRefs: ["ff-runtime-validation"],
      }, {
        id: "quality-gates",
        label: "Quality Gates",
        score: 48,
        summary: "Static checks are present, but the Canvas runtime path is not enforced as a gate.",
        findingRefs: ["ff-runtime-validation"],
      }, {
        id: "safe-change",
        label: "Change Safety",
        score: 52,
        summary: "Review guidance exists, but repeated workflow evidence and rollback checks were not observed.",
        findingRefs: ["aia-workflow-evidence"],
      }],
      aiAgentPractice: {
        inspectedSurfaces: ["Rules", "Skills", "MCP", "Plugins", "Session Insights"],
        coverageRows: [{
          surface: "Rules",
          scopes: ["Project"],
        }, {
          surface: "Skills",
        }, {
          surface: "MCP",
          scopes: ["Global"],
          count: 3,
        }, {
          surface: "Plugins",
          scopes: ["Plugin"],
          count: 0,
        }],
      },
    },
    findings: [{
      id: "ff-runtime-validation",
      title: "Runtime validation not observed",
      severity: "Medium",
      reason: "Static report files exist, but no runtime smoke result is attached. After the smoke is wired, readers can trust that the Canvas module loads before handoff instead of discovering failures later.",
      aiFixPrompt: richAiFixPrompt("Runtime validation is not observed"),
      dimensionRefs: ["fast-feedback", "quality-gates"],
    }, {
      id: "aia-workflow-evidence",
      title: "Agent workflow execution evidence is absent",
      severity: "Medium",
      reason: "Agent rules and skills were inspected, but no repeated workflow run was observed, so the practice signal remains bounded.",
      aiFixPrompt: richAiFixPrompt("Agent workflow execution evidence is absent"),
      dimensionRefs: ["environment-readiness", "safe-change"],
    }],
  };
}

function reviewedTaskLoopSource() {
  const source = buildTaskLoopSourceCandidate({
    scope: { platform: "qoder", workspace: "/tmp/render-source-project" },
    sources: [],
    selection: { strategy: "latest-n", eligibleCount: 1, analyzedCount: 1, strata: [] },
    events: [{
      sessionId: "private-session",
      timestamp: "2026-07-11T10:00:00.000Z",
      type: "tool",
      toolName: "Edit",
      filePath: "/tmp/render-source-project/src/a.ts",
      evidenceRef: { kind: "fixture", path: "/tmp/private.jsonl", line: 1 },
    }, {
      sessionId: "private-session",
      timestamp: "2026-07-11T10:00:01.000Z",
      type: "tool",
      toolName: "Bash",
      validationCategory: "node --test",
      targetPaths: ["/tmp/render-source-project/src/a.ts"],
      success: true,
      evidenceRef: { kind: "fixture", path: "/tmp/private.jsonl", line: 2 },
    }],
    projectName: "render-source-project",
    locale: "en",
  });
  applyEpisodeReviews(source, source.taskEpisodes.map((episode) => ({
    episodeRef: episode.id,
    taskUnderstanding: ["goal-understanding", "relevant-context", "scope-boundary"].map((id) => ({
      id,
      state: "Exercised",
      summary: `${id} was reviewed for the bounded render fixture`,
      evidenceRefs: episode.evidenceRefs,
    })),
    validationAssociations: episode.changeSets.flatMap((change) => episode.validationSets
      .filter((validation) => validation.status === "passed" && validation.ordinal > change.lastOrdinal)
      .map((validation) => ({
        changeSetRef: change.id,
        validationSetRef: validation.id,
        relation: "relevant-after-change",
        summary: "The focused render fixture check validates the retained change",
        evidenceRefs: validation.evidenceRefs,
      }))),
    repairReview: { state: "Unobserved" },
  })));
  source.deliveryEvidence = source.taskEpisodes
    .filter((episode) => episode.closure.status === "closed")
    .map((episode) => ({
      id: `${episode.id}:relevant-check`,
      episodeRef: episode.id,
      provider: "manual",
      kind: "validation",
      level: "relevant-focused-checks-passed",
      status: "passed",
      evidenceRefs: episode.closure.evidenceRefs,
    }));
  source.assessmentDecisions = source.assessmentDecisions.map((decision) => {
    if (decision.kind === "source-candidate") {
      return { ...decision, status: "reviewed", evidenceRefs: [{ kind: "review", id: "source" }] };
    }
    if (decision.kind === "score-review") {
      return {
        ...decision,
        status: "reviewed",
        dimensions: decision.dimensions.map((dimension) => ({
          ...dimension,
          score: dimension.id === "learning-capture" ? 59 : 35,
          confidence: "medium",
          reason: `${dimension.id} was assessed from the reviewed fixture evidence and its current boundary.`,
          readerSummary: "Reviewed evidence supports this judgment, but stronger task outcomes are still missing.",
          evidenceRefs: [{ kind: "review", id: dimension.id }],
        })),
      };
    }
    if (decision.kind !== "repository-review") return decision;
    const reviewed = (id, kind) => {
      const row = {
        id,
        status: "reviewed",
        summary: `${id} reviewed`,
        ...(new Set(["regression-protection", "spec-alignment"]).has(id) ? { evidenceState: "Unobserved" } : {}),
        evidenceRefs: [{ kind, id }],
      };
      if (!["lifecycle-repeat-detection", "loop-engineering", "later-validation"].includes(id)) return row;
      return {
        ...row,
        state: "Unobserved",
        findingRefs: [],
        ...(id === "loop-engineering" ? { mechanisms: [] } : {}),
      };
    };
    return {
      ...decision,
      status: "reviewed",
      reviewedFrameworks: decision.requiredFrameworks.map((id) => reviewed(id, "framework-review")),
      reviewedChecks: decision.requiredChecks.map((id) => reviewed(id, "repository-review")),
      reviewedSoftwareFluencyCapabilities: decision.requiredSoftwareFluencyCapabilities.map((id) => reviewed(id, "software-fluency-review")),
    };
  });
  source.repositoryEvidence.findings = [{
    id: "fixture-task-observation-gap",
    kind: "evidence-gap",
    severity: "Medium",
    title: "Task closure lacks a complete review trail",
    reason: "The bounded fixture does not retain one owner-routed chain from task intent through supported operation, focused validation, and acceptance evidence.",
    expectedOutcome: "The next fixture task retains one reviewable chain from intent through acceptance.",
    expectedArtifact: "Rule",
    expectedOutput: ["Update the project Rule so each task retains one reviewable chain from intent through accepted delivery."],
    dimensionRefs: ["task-understanding", "controlled-execution", "change-validation", "reliable-delivery"],
    subdimensionRefs: ["goal-understanding", "instruction-led-start", "relevant-check", "acceptance-evidence"],
    staticEvidence: [{ kind: "repository-review", id: "core-diagnostic-coverage" }],
    projectionPolicy: "required",
    aiFixPrompt: richAiFixPrompt("Task closure lacks a complete review trail"),
  }];
  source.repositoryEvidence.diagnosticCoverageReviews = [{
    id: "core-diagnostic-coverage",
    status: "covered",
    affectedScope: "repository-wide",
    summary: "Representative core diagnostics were reviewed and no concrete gap was confirmed.",
    evidenceRefs: [{ kind: "repository-review", id: "core-diagnostic-coverage" }],
  }];
  source.sessionEvents.usageActivity = {
    schemaVersion: 1,
    dateBasis: "UTC",
    measurementBasis: "session-starts-active-estimate-model-request-lifecycles-skill-invocations-and-reads",
    truncated: false,
    dates: ["2026-07-11"],
    sessions: { total: 1, starts: [1], activeMinutes: [1] },
    models: [],
    skills: [],
  };
  source.sessionEvents.usageEfficiency = {
    schemaVersion: 1,
    selection: { strategy: "all-eligible", eligibleSessionCount: 1, analyzedSessionCount: 1, complete: true },
    roles: { userThreadCandidateCount: 1, childAgentCandidateCount: 0 },
    longSessions: { activeCount: 0, wallOnlyCount: 0, longestActiveMinutes: 0 },
    accounting: {
      mode: "effort-proxy",
      responseCount: 0,
      modelAttributedResponseCount: 0,
      unattributedResponseCount: 0,
      usageFieldObservedCount: 0,
      nonZeroUsageCount: 0,
      exactCreditsAvailable: false,
      pricingVersion: null,
    },
    modelUsage: [],
    outcomeReview: {
      status: "not-applicable",
      reviewedCandidateCount: 0,
      comparableModelOutcomeEvidence: false,
      recommendation: "controlled-a-b-required",
    },
  };
  return source;
}

function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    ...options,
  });
}

function parseRun(stdout) {
  const payload = JSON.parse(stdout);
  assert.equal(payload.kind, "harness-report-render");
  return payload;
}

test("render command writes the authoritative Qoder Canvas template", async () => {
  await withTempDir("better-harness-render-qoder-", async (root) => {
    const findingsPath = path.join(root, "input.findings.json");
    const outDir = path.join(root, "runs");
    await writeJson(findingsPath, sampleFindings());

    const result = runNode([cliPath, "harness", "render", "--findings", findingsPath, "--mode", "qoder-canvas", "--out", outDir, "--target", root, "--language", "en", "--validate", "--json"]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = parseRun(result.stdout);
    assert.equal(["pass", "warn"].includes(payload.status), true);
    assert.deepEqual(payload.artifacts.map((artifact) => artifact.name), ["findings.json", "canvas.json", "report.canvas.tsx"]);

    const findings = JSON.parse(readFileSync(path.join(payload.runDir, "findings.json"), "utf8"));
    assert.deepEqual(Object.keys(findings).sort(), ["findings", "summary"]);
    assert.deepEqual(Object.keys(findings.findings[0]).sort(), [
      "aiFixPrompt",
      "dimensionRefs",
      "id",
      "reason",
      "severity",
      "title",
    ]);
    assert.equal(findings.summary.dimensions[1].id, "environment-readiness");
    assert.equal(findings.summary.dimensions[1].summary, "Build entrypoints are visible, while repeatable setup evidence is incomplete.");
    assert.match(findings.findings[0].reason, /readers can trust that the Canvas module loads before handoff/);
    assert.equal(Object.hasOwn(findings.findings[0], "aiFixLabel"), false);
    assert.equal(Object.hasOwn(findings.findings[0], "quickFix"), false);

    const canvas = readFileSync(path.join(payload.runDir, "report.canvas.tsx"), "utf8");
    assert.equal(existsSync(path.join(payload.runDir, "insights.canvas.tsx")), false);
    const template = readFileSync(path.join(process.cwd(), "templates", "canvas", "better-harness-insights.canvas.tsx"), "utf8");
    assert.equal(canvas, template);
    assert.equal(renderCanvasTsx(), template);
    assert.match(canvas, /import hostReportData from "\.\/findings\.json"/);
    assert.match(canvas, /import canvasData from "\.\/canvas\.json"/);
    assert.deepEqual([...canvas.matchAll(/from "\.\/([^"]+)"/g)].map((match) => match[1]), ["findings.json", "canvas.json"]);
  });
});

test("render command defaults new writes to Better Harness Qoder Canvas output", async () => {
  await withTempDir("better-harness-render-default-", async (root) => {
    const findingsPath = path.join(root, "input.findings.json");
    await writeJson(findingsPath, sampleFindings());

    const result = runNode([
      cliPath,
      "harness",
      "render",
      "--findings",
      findingsPath,
      "--target",
      root,
      "--json",
    ], { cwd: root });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = parseRun(result.stdout);
    assert.equal(payload.mode, "qoder-canvas");
    assert.equal(payload.outputLocation.requestedOut, ".qoder/better-harness");
    assert.equal(payload.outputLocation.resolvedOutDir.endsWith(path.join(".qoder", "better-harness")), true);
    assert.equal(payload.runDir.startsWith(payload.outputLocation.resolvedOutDir), true);
  });
});

test("render command rejects an unsupported mode", async () => {
  await withTempDir("better-harness-unsupported-mode-", async (root) => {
    const findingsPath = path.join(root, "input.findings.json");
    await writeJson(findingsPath, sampleFindings());

    const result = runNode([
      renderPath,
      "--findings", findingsPath,
      "--mode", "unsupported-mode",
      "--out", path.join(root, "runs"),
      "--target", root,
      "--json",
    ]);

    assert.equal(result.status, 1);
    const payload = parseRun(result.stdout);
    assert.equal(payload.error.code, "INVALID_FINDINGS");
    assert.ok(payload.error.details.some((error) => /unsupported mode: unsupported-mode/.test(error)));
  });
});

test("render command resolves a relative run directory below the requested output root", async () => {
  await withTempDir("better-harness-relative-run-", async (root) => {
    const findingsPath = path.join(root, "input.findings.json");
    const outDir = path.join(root, ".qoder", "better-harness");
    const relativeRunDir = path.join("2026-07-13", "192549-qoder");
    await writeJson(findingsPath, sampleFindings());

    const result = runNode([
      renderPath,
      "--findings", findingsPath,
      "--mode", "qoder-canvas",
      "--out", outDir,
      "--run-dir", relativeRunDir,
      "--target", root,
      "--language", "en",
      "--validate",
      "--json",
    ], { cwd: root });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = parseRun(result.stdout);
    const expectedRunDir = path.join(outDir, relativeRunDir);
    assert.equal(payload.runDir, expectedRunDir);
    assert.deepEqual(payload.outputLocation, {
      requestedOut: outDir,
      requestedRunDir: relativeRunDir,
      resolvedOutDir: outDir,
      resolvedRunDir: expectedRunDir,
      policy: "relative-below-out",
    });
    assert.equal(payload.validation.checks.find((check) => check.id === "output-location")?.status, "pass");
    assert.equal(existsSync(path.join(expectedRunDir, "findings.json")), true);
    assert.equal(existsSync(path.join(root, relativeRunDir, "findings.json")), false);
  });
});

test("render command rejects a relative run directory that escapes the output root", async () => {
  await withTempDir("better-harness-run-escape-", async (root) => {
    const findingsPath = path.join(root, "input.findings.json");
    const outDir = path.join(root, "runs");
    await writeJson(findingsPath, sampleFindings());

    const result = runNode([
      renderPath,
      "--findings", findingsPath,
      "--mode", "qoder-canvas",
      "--out", outDir,
      "--run-dir", path.join("..", "escaped"),
      "--target", root,
      "--json",
    ], { cwd: root });

    assert.equal(result.status, 1);
    const payload = parseRun(result.stdout);
    assert.equal(payload.error.code, "RUN_DIR_OUTSIDE_OUT");
    assert.equal(existsSync(path.join(root, "escaped")), false);
  });
});

test("render command finalizes a reviewed task-loop source in one validated step", async () => {
  await withTempDir("better-harness-source-render-", async (root) => {
    const sourcePath = path.join(root, "report.source.json");
    const runDir = path.join(root, "run");
    await writeJson(sourcePath, reviewedTaskLoopSource());

    const result = runNode([renderPath, "--source", sourcePath, "--mode", "qoder-canvas", "--run-dir", runDir, "--target", root, "--validate", "--json"]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = parseRun(result.stdout);
    assert.deepEqual(payload.artifacts.map((artifact) => artifact.name), ["findings.json", "canvas.json", "report.canvas.tsx"]);
    assert.equal(readFileSync(path.join(runDir, "report.canvas.tsx"), "utf8"), renderCanvasTsx());
    assert.equal(JSON.parse(readFileSync(path.join(runDir, "findings.json"), "utf8")).summary.modelId, "agent-work-loop-v4");
    assert.equal(JSON.parse(readFileSync(path.join(runDir, "canvas.json"), "utf8")).schemaVersion, 1);
  });
});

test("render command rejects extra artifacts in a canonical Canvas run directory", async () => {
  await withTempDir("better-harness-source-inside-run-", async (root) => {
    const runDir = path.join(root, "run");
    const sourcePath = path.join(runDir, "report.source.json");
    await mkdir(runDir, { recursive: true });
    await writeJson(sourcePath, reviewedTaskLoopSource());

    const result = runNode([renderPath, "--source", sourcePath, "--mode", "qoder-canvas", "--run-dir", runDir, "--target", root, "--validate", "--json"]);

    assert.equal(result.status, 1);
    const payload = parseRun(result.stdout);
    assert.equal(payload.error.code, "VALIDATION_FAILED");
    assert.ok(payload.validation.errors.some((error) => /unexpected run-directory artifact: report\.source\.json/.test(error)));
  });
});

test("render command refuses an unreviewed task-loop source", async () => {
  await withTempDir("better-harness-source-reject-", async (root) => {
    const sourcePath = path.join(root, "report.source.json");
    await writeJson(sourcePath, buildTaskLoopSourceCandidate({
      scope: { platform: "qoder", workspace: root },
      selection: { strategy: "latest-n", eligibleCount: 0, analyzedCount: 0, strata: [] },
      events: [],
      projectName: "unreviewed",
    }));
    const result = runNode([renderPath, "--source", sourcePath, "--mode", "qoder-canvas", "--run-dir", path.join(root, "run"), "--target", root, "--validate", "--json"]);
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).error.code, "UNREVIEWED_TASK_LOOP_SOURCE");
  });
});

test("Better Harness Canvas renderer emits the copyable template", () => {
  const template = readFileSync(path.join(process.cwd(), "templates", "canvas", "better-harness-insights.canvas.tsx"), "utf8");
  const rendered = renderCanvasTsx();

  assert.equal(rendered, template);
  assert.match(template, /import \{[^}]*SendToChatButton[^}]*\} from "qoder\/canvas"/s);
  assert.match(template, /import hostReportData from "\.\/findings\.json"/);
  assert.match(template, /import canvasData from "\.\/canvas\.json"/);
  assert.match(template, /function mergeCanvasObjects/);
  assert.match(template, /text=\{row\.aiFixPrompt\}/);
  assert.match(template, /taskLoopCopy\("Plan AI Fix", "规划 AI 修复"\)/);
  assert.match(template, /<Dialog\b/);
  assert.match(template, /function PracticeCoverage/);
  assert.match(template, /practiceDescription\(row\.surface\)/);
  assert.match(template, /row\.expectedOutput/);
  assert.match(template, /Expected Output/);
  assert.doesNotMatch(template, /Deliverable/);
  assert.match(template, /row\.reason/);
  assert.doesNotMatch(template, /row\.expectedOutcome|row\.expectedFileChanges/);
  assert.match(template, /row\.summary/);
  assert.match(template, /DIMENSION_SUMMARY_EXAMPLE/);
  assert.doesNotMatch(template, /How easy it is to find the right project context and owner/);
  assert.doesNotMatch(template, /aiFixLabel|quickFix|passCheck|recommendation|scoreCaveat|engineeringImplementation/);
  assert.match(template, /evidenceBoundary/);
  assert.doesNotMatch(template, /useCanvasState|report\.canvas\.tsx|chart\.canvas\.tsx|@ali|..\/canvas-sdk/);
});

test("render command writes Markdown-only artifacts", async () => {
  await withTempDir("better-harness-render-markdown-", async (root) => {
    const findingsPath = path.join(root, "input.findings.json");
    const outDir = path.join(root, "runs");
    await writeJson(findingsPath, sampleFindings());

    const result = runNode([renderPath, "--findings", findingsPath, "--mode", "markdown", "--out", outDir, "--target", root, "--language", "en", "--validate", "--json"]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = parseRun(result.stdout);
    assert.equal(payload.status, "pass");
    assert.deepEqual(payload.artifacts.map((artifact) => artifact.name), ["findings.json", "report.md"]);
    assert.equal(existsSync(path.join(payload.runDir, "report.md")), true);
    const report = readFileSync(path.join(payload.runDir, "report.md"), "utf8");
    assert.match(report, /## Harness Dimensions/);
    assert.match(report, /Why this score/);
    assert.match(report, /Project guidance maps the main workflow/);
    assert.match(report, /\| Severity \| Finding \| Reason \| Dimensions \|/);
    assert.match(report, /readers can trust that the Canvas module loads before handoff/);
    assert.match(report, /\| Surface \| Description \| Scope \| Count \| Sources \|/);
    assert.match(report, /\| Rules \| Standing project guidance[^|]+ \| Project \|/);
    assert.match(report, /\| MCP \| External tools[^|]+ \| Global \| 3 \|/);
    assert.doesNotMatch(report, /\| Plugins \|[^|]+\| Plugin \| 0 \|/);
  });
});

test("render command writes disk-openable HTML artifacts", async () => {
  await withTempDir("better-harness-render-html-", async (root) => {
    const findingsPath = path.join(root, "input.findings.json");
    const outDir = path.join(root, "runs");
    await writeJson(findingsPath, sampleFindings());

    const result = runNode([renderPath, "--findings", findingsPath, "--mode", "html", "--out", outDir, "--target", root, "--language", "en", "--validate", "--json"]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = parseRun(result.stdout);
    assert.equal(payload.status, "pass");
    assert.deepEqual(payload.artifacts.map((artifact) => artifact.name), ["findings.json", "report.md", "report.html"]);
    assert.equal(existsSync(path.join(payload.runDir, "report.html")), true);
    assert.equal(payload.validation.checks.find((check) => check.id === "html-report")?.status, "pass");
    const html = readFileSync(path.join(payload.runDir, "report.html"), "utf8");
    assert.match(html, /<main id="harness-report" data-report-mode="codex-html">/u);
    assert.match(html, /<script id="harness-report-data" type="application\/json">/u);
    assert.match(html, /data-section="fluency"/u);
    assert.match(html, /data-section="findings"/u);
    assert.match(html, /data-section="customize"/u);
    assert.match(html, /data-section="methodology"/u);
    assert.doesNotMatch(html, /<script[^>]+src=/u);
    assert.doesNotMatch(html, /<link[^>]+href=/u);
    const findingCards = html.match(/class="finding-card"/gu) ?? [];
    const findingDialogs = html.match(/data-finding-dialog-id=/gu) ?? [];
    const copyActions = html.match(/data-copy-finding=/gu) ?? [];
    const detailActions = html.match(/data-view-finding-dialog=/gu) ?? [];
    assert.equal(findingCards.length, 2);
    assert.equal(findingDialogs.length, 2);
    assert.equal(copyActions.length, 4);
    assert.equal(detailActions.length, 2);
    assert.match(html, /Copy AI Fix/u);
    assert.match(html, /View details/u);
    assert.doesNotMatch(html, /<details class="finding"/u);
    assert.doesNotMatch(html, /<details class="finding" open/u);
  });
});

test("HTML mode validates canonical compact Agent Work Loop findings without a Canvas sidecar", async () => {
  await withTempDir("better-harness-render-claude-html-", async (root) => {
    const findingsPath = path.join(process.cwd(), "templates", "reporting", "harness-findings.input.json");
    const outDir = path.join(root, ".claude", "better-harness");

    const result = runNode([
      renderPath,
      "--findings", findingsPath,
      "--mode", "html",
      "--out", outDir,
      "--target", root,
      "--validate",
      "--json",
    ]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = parseRun(result.stdout);
    assert.equal(payload.status, "pass");
    assert.equal(payload.outputLocation.resolvedOutDir, outDir);
    assert.deepEqual(payload.artifacts.map((artifact) => artifact.name), ["findings.json", "report.md", "report.html"]);
    assert.equal(payload.validation.checks.find((check) => check.id === "findings-json")?.status, "pass");
    assert.equal(payload.validation.checks.find((check) => check.id === "html-report")?.status, "pass");
    assert.equal(existsSync(path.join(payload.runDir, "canvas.json")), false);
  });
});

test("HTML mode mirrors the reviewed Agent Work Loop reader sections without Canvas runtime", async () => {
  await withTempDir("codex-harness-source-render-", async (root) => {
    const sourcePath = path.join(root, "report.source.json");
    const runDir = path.join(root, "run");
    await writeJson(sourcePath, reviewedTaskLoopSource());

    const result = runNode([renderPath, "--source", sourcePath, "--mode", "html", "--run-dir", runDir, "--target", root, "--validate", "--json"]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = parseRun(result.stdout);
    assert.equal(payload.status, "pass");
    assert.deepEqual(payload.artifacts.map((artifact) => artifact.name), ["findings.json", "report.md", "report.html"]);
    const html = readFileSync(path.join(runDir, "report.html"), "utf8");
    assert.match(html, /Five-dimension fluency/u);
    assert.match(html, /Project usage/u);
    assert.match(html, /Findings and recommendations/u);
    assert.match(html, /Agent Customize/u);
    assert.match(html, /Evidence and methodology/u);
    assert.match(html, /Session activity heatmap/u);
    assert.match(html, /data-finding-id="fixture-task-observation-gap"/u);
    assert.match(html, /reviewed dimensions/u);
    assert.doesNotMatch(html, /fluency average|流畅度均值/u);
    assert.doesNotMatch(html, /from ["']qoder\/canvas["']/u);
    assert.equal(existsSync(path.join(runDir, "canvas.json")), false);
    assert.equal(existsSync(path.join(runDir, "report.canvas.tsx")), false);
  });
});

test("HTML validator rejects incomplete finding action contracts", () => {
  const reportData = {
    ...sampleFindings(),
    language: "en",
    target: { name: "render-fixture", path: "/tmp/render-fixture" },
  };
  const html = renderHtml(reportData);
  assert.equal(evaluateHtmlReport(html, reportData).status, "pass");

  const mutations = [
    ["interaction controller", html.replace(/<script id="harness-report-interactions">[\s\S]*?<\/script>/u, "")],
    ["copy status", html.replace(/<div id="copy-status"[\s\S]*?<\/div>/u, "")],
    ["manual copy fallback", html.replace(/<dialog id="manual-copy-dialog"[\s\S]*?<\/dialog>/u, "")],
    ["finding copy action", html.replace(/<button[^>]+data-copy-finding=[\s\S]*?<\/button>/u, "")],
    ["finding detail action", html.replace(/<button[^>]+data-view-finding-dialog=[\s\S]*?<\/button>/u, "")],
    ["host bridge", html.replace(
      '<script id="harness-report-interactions">',
      '<script id="harness-report-interactions">window.openai;',
    )],
    ["host deep link", html.replace(
      '<script id="harness-report-interactions">',
      '<script id="harness-report-interactions">const unsupportedRoute="codex://prompt";',
    )],
  ];

  for (const [label, mutatedHtml] of mutations) {
    const result = evaluateHtmlReport(mutatedHtml, reportData);
    assert.equal(result.status, "fail", `${label} mutation must fail validation`);
  }
});

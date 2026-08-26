import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "vitest";

import { evaluateHtmlReport, renderHtml } from "../../scripts/harness-analysis/renderers/html.mjs";
import {
  RENDER_REPORT_PLATFORMS,
  renderReport,
  resolveReportOutputLocation,
} from "../../scripts/harness-analysis/render-report.mjs";
import { HOST_CAPABILITIES, hostIdsFor } from "../../scripts/host-support/index.mjs";
import { renderCanvasTsx } from "../../scripts/harness-analysis/renderers/qoder-canvas.mjs";
import { buildTaskLoopSourceCandidate } from "../../scripts/harness-analysis/task-loop-source.mjs";
import { applyEpisodeReviews } from "../../scripts/harness-analysis/episode-evidence-review.mjs";
import { projectTaskLoopFindings } from "../../scripts/harness-analysis/task-loop-report.mjs";

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

const RAW_PRIVACY_CANARIES = Object.freeze({
  privateHome: "/Users/private-owner/.dsh/skills/private/SKILL.md",
  offTreePosix: "/opt/private-corpus/instructions.md",
  windowsDrive: "C:\\Users\\PrivateOwner\\.dsh\\AGENTS.md",
  windowsUnc: "\\\\private-server\\private-share\\sessions\\session.jsonl",
  privateSkillBody: "PRIVATE_SKILL_BODY_CANARY_112",
  privateInstructionBody: "PRIVATE_INSTRUCTION_BODY_CANARY_112",
  credential: "sk-dsh-private-api-key-canary-112",
  symlinkRealpath: "/private/realpath/behind/workspace-link",
});

const TEMPORAL_MARKERS = Object.freeze({
  configured: "configured-not-observed",
  historical: "historical-session-observation-independent",
  forbidden: [
    "current-asset-existed-historically",
    "session-used-current-asset",
    "current-asset-influenced-session",
    "same-name-proves-historical-identity",
    "snapshots-were-atomic",
  ],
});

const APPROVED_PRIVACY_PROJECTIONS = Object.freeze([
  "<workspace>",
  "<git-root>/...",
  "~/...",
  "<path>",
]);

function dshReviewedFindings() {
  const fixture = sampleFindings();
  return {
    ...fixture,
    summary: {
      ...fixture.summary,
      strengths: [
        ...fixture.summary.strengths,
        "Reviewed paths are projected as <workspace>, <git-root>/..., ~/..., or <path>.",
      ],
    },
    findings: fixture.findings.map((finding, index) => index === 0 ? {
      ...finding,
      title: `Current asset evidence is ${TEMPORAL_MARKERS.configured}`,
      reason: `${TEMPORAL_MARKERS.configured}; ${TEMPORAL_MARKERS.historical}. The reviewed current configuration and independently observed historical Session evidence remain separate and non-causal. Reviewed locators remain <workspace>, <git-root>/..., ~/..., and <path>.`,
    } : finding),
  };
}

function assertDurableProjection(runDir) {
  const artifacts = ["findings.json", "report.md", "report.html"];
  for (const artifact of artifacts) {
    const text = readFileSync(path.join(runDir, artifact), "utf8");
    for (const [label, canary] of Object.entries(RAW_PRIVACY_CANARIES)) {
      assert.equal(text.includes(canary), false, `${artifact} leaked ${label}`);
    }
    for (const projection of APPROVED_PRIVACY_PROJECTIONS) {
      const artifactProjection = artifact === "report.html"
        ? projection.replaceAll("<", "&lt;").replaceAll(">", "&gt;")
        : projection;
      assert.equal(text.includes(artifactProjection), true, `${artifact} lost safe projection ${projection}`);
    }
    assert.equal(text.includes(TEMPORAL_MARKERS.configured), true, `${artifact} lost configured boundary`);
    assert.equal(text.includes(TEMPORAL_MARKERS.historical), true, `${artifact} lost historical boundary`);
    for (const forbidden of TEMPORAL_MARKERS.forbidden) {
      assert.equal(text.includes(forbidden), false, `${artifact} invented ${forbidden}`);
    }
  }
}

function embeddedJson(html, id) {
  const payload = html.match(new RegExp(
    `<script id="${id}" type="application/json">([\\s\\S]*?)<\\/script>`,
    "u",
  ))?.[1];
  assert.ok(payload, `missing embedded JSON payload: ${id}`);
  return JSON.parse(payload);
}

function visibleHtmlText(html) {
  return String(html)
    .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/giu, " ")
    .replace(/<[^>]+>/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
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

function git(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(result.status, 0, result.stderr);
}

async function createRenderMonorepo(root, { partial = false } = {}) {
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test User"]);
  await writeJson(path.join(root, "package.json"), {
    private: true,
    workspaces: partial ? ["packages/*", "../outside/*"] : ["packages/*"],
  });
  for (const name of ["a", "b"]) {
    await writeJson(path.join(root, "packages", name, "package.json"), { name });
  }
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "fixture"]);
}

function targetFindingData({ packageRoute = "packages/a" } = {}) {
  const data = sampleFindings();
  data.findings = data.findings.map((finding) => ({
    ...finding,
    target: {
      kind: "workspace-member",
      packageRoute,
      ownerRoute: packageRoute,
    },
  }));
  return data;
}

function taskLoopFindingsAtVersion(version) {
  const findings = projectTaskLoopFindings(reviewedTaskLoopSource(), {
    projectName: "render-source-project",
    direct: true,
  });
  findings.summary.reportContractVersion = version;
  for (const finding of findings.findings) delete finding.target;
  return findings;
}

function htmlReportDataWithActivity(dates, { language = "en", activeMinutes } = {}) {
  const source = reviewedTaskLoopSource();
  source.sessionEvents.usageActivity.dates = dates;
  source.sessionEvents.usageActivity.sessions.starts = dates.map((_, index) => index + 1);
  source.sessionEvents.usageActivity.sessions.activeMinutes = activeMinutes ?? dates.map((_, index) => (index + 1) * 5);
  const data = projectTaskLoopFindings(source, {
    projectName: "render-source-project",
    direct: true,
  });
  return {
    ...data,
    language,
    target: { name: "render-source-project", path: "/tmp/render-source-project" },
  };
}

function htmlReportDataWithLongSessions({ callCount = 12, language = "en" } = {}) {
  const data = htmlReportDataWithActivity(["2026-08-11"], { language, activeMinutes: [90] });
  const calls = Array.from({ length: callCount }, (_, index) => {
    const observed = index % 2 === 0;
    return {
      id: `T${index + 1}`,
      step: index + 1,
      toolName: ["exec_command", "apply_patch", "view_image"][index % 3],
      status: (index + 1) % 5 === 0 ? "failed" : "observed",
      durationStatus: observed ? "observed" : "unobserved",
      ...(observed ? {
        durationMs: (index + 1) * 250,
        timingSource: "transcript-pair",
      } : {}),
    };
  });
  data.summary.usageEfficiency = {
    ...data.summary.usageEfficiency,
    selection: {
      ...data.summary.usageEfficiency.selection,
      eligibleSessionCount: 6,
      analyzedSessionCount: 6,
    },
    longSessions: {
      activeCount: 2,
      wallOnlyCount: 0,
      longestActiveMinutes: 90,
      estimate: { activeThresholdMinutes: 45, gapCapMinutes: 5, idleGapMinutes: 30 },
      samples: [{
        alias: "S1",
        role: "user-thread-candidate",
        activeMinutes: 90,
        failureCount: calls.filter((call) => call.status === "failed").length,
        sessionId: "019f-codex-session-1",
        userRequest: "Inspect <script>unsafe</script> & explain the long session",
        toolTrace: {
          schemaVersion: 2,
          totalCalls: callCount,
          shownCalls: callCount,
          truncated: false,
          calls,
        },
      }, {
        alias: "S2",
        role: "child-agent-candidate",
        activeMinutes: 55,
        failureCount: 0,
        sessionId: "codex-session-2",
        userRequest: "Review the validation evidence",
      }],
    },
  };
  return data;
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`, "u"))?.[1] ?? null;
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

test("render keeps legacy v1 package findings readable without target metadata", async () => {
  await withTempDir("better-harness-render-legacy-package-", async (root) => {
    await createRenderMonorepo(root);
    const packageRoot = path.join(root, "packages", "a");
    const findingsPath = path.join(root, "legacy.findings.json");
    await writeJson(findingsPath, taskLoopFindingsAtVersion(1));

    const result = runNode([
      renderPath,
      "--findings", findingsPath,
      "--mode", "markdown",
      "--out", path.join(root, "runs"),
      "--target", packageRoot,
      "--json",
    ]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = parseRun(result.stdout);
    assert.equal(payload.status, "pass");
  });
});

test("render requires target metadata for the new contract in a package workspace", async () => {
  await withTempDir("better-harness-render-new-package-", async (root) => {
    await createRenderMonorepo(root);
    const findingsPath = path.join(root, "current.findings.json");
    await writeJson(findingsPath, taskLoopFindingsAtVersion(26));

    const result = runNode([
      renderPath,
      "--findings", findingsPath,
      "--mode", "markdown",
      "--out", path.join(root, "runs"),
      "--target", path.join(root, "packages", "a"),
      "--json",
    ]);

    assert.equal(result.status, 1);
    const payload = parseRun(result.stdout);
    assert.equal(payload.error.code, "INVALID_FINDINGS");
    assert.ok(payload.error.details.some((error) =>
      /findings\[0\]\.target is required for this workspace target/u.test(error)));
  });
});

test("render rejects structured target metadata without an explicit target workspace", async () => {
  await withTempDir("better-harness-render-target-required-", async (root) => {
    const findingsPath = path.join(root, "target.findings.json");
    await writeJson(findingsPath, targetFindingData());

    const result = runNode([
      renderPath,
      "--findings", findingsPath,
      "--mode", "markdown",
      "--out", path.join(root, "runs"),
      "--json",
    ]);

    assert.equal(result.status, 1);
    assert.equal(parseRun(result.stdout).error.code, "MISSING_RENDER_TARGET");
  });
});

test("render rejects structured target metadata when topology discovery is partial", async () => {
  await withTempDir("better-harness-render-target-partial-", async (root) => {
    await createRenderMonorepo(root, { partial: true });
    const findingsPath = path.join(root, "target.findings.json");
    await writeJson(findingsPath, targetFindingData());

    const result = runNode([
      renderPath,
      "--findings", findingsPath,
      "--mode", "markdown",
      "--out", path.join(root, "runs"),
      "--target", path.join(root, "packages", "a"),
      "--json",
    ]);

    assert.equal(result.status, 1);
    assert.equal(parseRun(result.stdout).error.code, "RENDER_WORKSPACE_TOPOLOGY_INCOMPLETE");
  });
});

test("render canonicalizes both target and frozen topology workspace identities", async () => {
  await withTempDir("better-harness-render-target-alias-", async (root) => {
    await createRenderMonorepo(root);
    const packageRoot = path.join(root, "packages", "a");
    const packageLink = path.join(root, "package-a-link");
    const findingsPath = path.join(root, "target.findings.json");
    await symlink(packageRoot, packageLink, "dir");
    await writeJson(findingsPath, targetFindingData());

    await assert.rejects(
      () => renderReport({
        findings: findingsPath,
        mode: "markdown",
        out: path.join(root, "runs"),
        target: packageRoot,
        topology: {
          status: "partial",
          requestedWorkspace: packageLink,
          target: { kind: "workspace-member" },
        },
      }),
      (error) => error.code === "RENDER_WORKSPACE_TOPOLOGY_INCOMPLETE",
    );
  });
});

test("render rejects structured target metadata for a different package", async () => {
  await withTempDir("better-harness-render-target-mismatch-", async (root) => {
    await createRenderMonorepo(root);
    const findingsPath = path.join(root, "target.findings.json");
    await writeJson(findingsPath, targetFindingData({ packageRoute: "packages/a" }));

    const result = runNode([
      renderPath,
      "--findings", findingsPath,
      "--mode", "markdown",
      "--out", path.join(root, "runs"),
      "--target", path.join(root, "packages", "b"),
      "--json",
    ]);

    assert.equal(result.status, 1);
    const payload = parseRun(result.stdout);
    assert.equal(payload.error.code, "INVALID_FINDINGS");
    assert.ok(payload.error.details.some((error) => /packageRoute does not match/u.test(error)));
  });
});

test("render accepts and preserves structured target metadata for the selected package", async () => {
  await withTempDir("better-harness-render-target-match-", async (root) => {
    await createRenderMonorepo(root);
    const findingsPath = path.join(root, "target.findings.json");
    const outDir = path.join(root, "runs");
    await writeJson(findingsPath, targetFindingData({ packageRoute: "packages/a" }));

    const result = runNode([
      renderPath,
      "--findings", findingsPath,
      "--mode", "markdown",
      "--out", outDir,
      "--target", path.join(root, "packages", "a"),
      "--json",
    ]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = parseRun(result.stdout);
    const rendered = JSON.parse(readFileSync(path.join(payload.runDir, "findings.json"), "utf8"));
    assert.deepEqual(rendered.findings[0].target, {
      kind: "workspace-member",
      packageRoute: "packages/a",
      ownerRoute: "packages/a",
    });
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

test("generic DSH output-location expectations preserve native containment without host rewrites", () => {
  const target = path.join(process.cwd(), "target with 空格");
  const out = path.join(target, ".dsh", "better-harness");
  const contained = resolveReportOutputLocation({ out, "run-dir": path.join("run with 空格", "receipt") });
  assert.equal(contained.runDir, path.join(out, "run with 空格", "receipt"));
  assert.equal(contained.policy, "relative-below-out");
  assert.throws(
    () => resolveReportOutputLocation({
      out,
      "run-dir": path.join("..", "better-harness-sibling", "receipt"),
    }),
    (error) => error.code === "RUN_DIR_OUTSIDE_OUT",
  );

  const absolute = path.join(target, "caller-selected", "absolute run");
  assert.deepEqual(resolveReportOutputLocation({ out, "run-dir": absolute }), {
    requestedOut: out,
    requestedRunDir: absolute,
    outDir: out,
    runDir: absolute,
    policy: "exact-absolute-run-dir",
  });

});

test.skipIf(process.platform !== "win32")(
  "actual Better Harness resolver preserves DSH drive and UNC output contracts on Windows",
  () => {
    const cases = [
      {
        name: "drive",
        target: "C:\\work with 空格\\项目",
        expectedOut: "C:\\work with 空格\\项目\\.dsh\\better-harness",
        absoluteRun: "D:\\caller-selected\\absolute run",
      },
      {
        name: "UNC",
        target: "\\\\server\\share with 空格\\项目",
        expectedOut: "\\\\server\\share with 空格\\项目\\.dsh\\better-harness",
        absoluteRun: "\\\\other-server\\reports\\absolute run",
      },
    ];

    for (const current of cases) {
      const out = path.join(current.target, ".dsh", "better-harness");
      const contained = resolveReportOutputLocation({
        out,
        "run-dir": path.join("run with 空格", "receipt"),
      });
      assert.equal(contained.outDir, current.expectedOut, `${current.name} resolved out`);
      assert.equal(
        contained.runDir,
        path.join(current.expectedOut, "run with 空格", "receipt"),
        `${current.name} contained run`,
      );
      assert.equal(contained.policy, "relative-below-out");
      for (const runDir of [
        path.join("..", "escaped", "receipt"),
        path.join("..", "better-harness-sibling", "receipt"),
      ]) {
        assert.throws(
          () => resolveReportOutputLocation({ out, "run-dir": runDir }),
          (error) => error.code === "RUN_DIR_OUTSIDE_OUT",
          `${current.name} rejects ${runDir}`,
        );
      }
      assert.deepEqual(resolveReportOutputLocation({
        out,
        "run-dir": current.absoluteRun,
      }), {
        requestedOut: out,
        requestedRunDir: current.absoluteRun,
        outDir: current.expectedOut,
        runDir: current.absoluteRun,
        policy: "exact-absolute-run-dir",
      });
    }
  },
);

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

    const reviewed = JSON.parse(readFileSync(path.join(payload.runDir, "findings.json"), "utf8"));
    assert.doesNotMatch(
      readFileSync(path.join(payload.runDir, "findings.json"), "utf8"),
      /better-harness-fix-output/u,
    );
    assert.doesNotMatch(
      readFileSync(path.join(payload.runDir, "report.md"), "utf8"),
      /better-harness-fix-output/u,
    );
    const actions = embeddedJson(html, "harness-report-actions");
    const interactionData = embeddedJson(html, "harness-report-data");
    assert.deepEqual(actions.findings.map((row) => row.id), reviewed.findings.map((row) => row.id));
    assert.deepEqual(interactionData.findings, reviewed.findings.map((finding) => ({
      id: finding.id,
      aiFixPrompt: finding.aiFixPrompt,
    })));
    assert.deepEqual(actions.findings, reviewed.findings.map((finding) => ({
      id: finding.id,
      expectedRevision: 0,
    })));
    assert.deepEqual(Object.keys(actions).sort(), ["findings", "reportRoute"]);
    assert.deepEqual(Object.keys(interactionData), ["findings"]);
    for (const finding of interactionData.findings) {
      assert.deepEqual(Object.keys(finding).sort(), ["aiFixPrompt", "id"]);
    }
    assert.equal(
      actions.reportRoute,
      path.relative(root, path.join(payload.runDir, "report.html")).replace(/\\/gu, "/"),
    );
    assert.equal(path.isAbsolute(actions.reportRoute), false);
    assert.doesNotMatch(actions.reportRoute, /\.staging-/u);
    assert.equal(Object.hasOwn(interactionData, "target"), false);
    assert.equal(Object.hasOwn(interactionData, "dataPath"), false);
  });
});

test("DSH portable HTML preserves reviewed privacy projections and temporal boundaries across every artifact", async () => {
  await withTempDir("better-harness-portable-projection-", async (root) => {
    const target = path.join(root, "portable target with 空格");
    const findingsPath = path.join(root, "reviewed.findings.json");
    await mkdir(target, { recursive: true });
    const reviewed = dshReviewedFindings();
    await writeJson(findingsPath, reviewed);
    for (const canary of Object.values(RAW_PRIVACY_CANARIES)) {
      assert.equal(JSON.stringify(reviewed).includes(canary), false, "reviewed input must already be projected");
    }

    const result = runNode([
      renderPath,
      "--findings", findingsPath,
      "--mode", "html",
      "--platform", "dsh",
      "--target", target,
      "--validate",
      "--json",
    ], { cwd: target });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = parseRun(result.stdout);
    assert.equal(payload.mode, "html");
    assert.deepEqual(payload.artifacts.map((artifact) => artifact.name), [
      "findings.json",
      "report.md",
      "report.html",
    ]);
    assertDurableProjection(payload.runDir);
  });
});

test("portable invalid artifact-set failure preserves a prior run and creates no staging state", async () => {
  await withTempDir("better-harness-portable-preservation-", async (root) => {
    const findingsPath = path.join(root, "reviewed.findings.json");
    const runDir = path.join(root, "runs", "completed-run");
    const previous = Object.fromEntries([
      ["findings.json", "PREVIOUS_FINDINGS\n"],
      ["report.md", "PREVIOUS_MARKDOWN\n"],
      ["report.html", "PREVIOUS_HTML\n"],
    ]);
    await writeJson(findingsPath, sampleFindings());
    await mkdir(runDir, { recursive: true });
    for (const [name, content] of Object.entries(previous)) {
      await writeFile(path.join(runDir, name), content);
    }
    await writeFile(path.join(runDir, "unexpected.txt"), "UNEXPECTED\n");

    const result = runNode([
      renderPath,
      "--findings", findingsPath,
      "--mode", "html",
      "--out", path.dirname(runDir),
      "--run-dir", runDir,
      "--target", root,
      "--validate",
      "--json",
    ]);

    assert.equal(result.status, 1, result.stderr || result.stdout);
    const payload = parseRun(result.stdout);
    assert.equal(payload.error.code, "VALIDATION_FAILED");
    for (const [name, content] of Object.entries(previous)) {
      assert.equal(readFileSync(path.join(runDir, name), "utf8"), content);
    }
    assert.equal(readFileSync(path.join(runDir, "unexpected.txt"), "utf8"), "UNEXPECTED\n");
    const parentNames = await readdir(path.dirname(runDir));
    assert.equal(parentNames.some((name) => name.includes(".staging-") || name.includes(".backup-")), false);
  });
});

test("portable publication failure rolls back to the prior completed run", async () => {
  await withTempDir("better-harness-portable-rollback-", async (root) => {
    const findingsPath = path.join(root, "reviewed.findings.json");
    const runDir = path.join(root, "runs", "completed-run");
    const previous = Object.fromEntries([
      ["findings.json", "PREVIOUS_FINDINGS\n"],
      ["report.md", "PREVIOUS_MARKDOWN\n"],
      ["report.html", "PREVIOUS_HTML\n"],
    ]);
    await writeJson(findingsPath, sampleFindings());
    await mkdir(runDir, { recursive: true });
    for (const [name, content] of Object.entries(previous)) {
      await writeFile(path.join(runDir, name), content);
    }

    const injector = path.join(
      process.cwd(),
      "test",
      "reporting",
      "fixtures",
      "fail-report-publication.mjs",
    );
    const result = runNode([
      "--import", pathToFileURL(injector).href,
      renderPath,
      "--findings", findingsPath,
      "--mode", "html",
      "--out", path.dirname(runDir),
      "--run-dir", runDir,
      "--target", root,
      "--validate",
      "--json",
    ], {
      env: {
        ...process.env,
        BETTER_HARNESS_FAIL_PUBLISH_TARGET: runDir,
      },
    });

    assert.equal(result.status, 1, result.stderr || result.stdout);
    const payload = parseRun(result.stdout);
    assert.equal(payload.error.code, "PUBLISH_FAILED");
    for (const [name, content] of Object.entries(previous)) {
      assert.equal(readFileSync(path.join(runDir, name), "utf8"), content);
    }
    const parentNames = await readdir(path.dirname(runDir));
    assert.equal(parentNames.some((name) => name.includes(".staging-") || name.includes(".backup-")), false);
  });
});

test("portable publication and restoration failure reports PUBLISH_ROLLBACK_FAILED", async () => {
  await withTempDir("better-harness-portable-rollback-failure-", async (root) => {
    const findingsPath = path.join(root, "reviewed.findings.json");
    const runDir = path.join(root, "runs", "completed-run");
    const previous = Object.fromEntries([
      ["findings.json", "PREVIOUS_FINDINGS\n"],
      ["report.md", "PREVIOUS_MARKDOWN\n"],
      ["report.html", "PREVIOUS_HTML\n"],
    ]);
    await writeJson(findingsPath, sampleFindings());
    await mkdir(runDir, { recursive: true });
    for (const [name, content] of Object.entries(previous)) {
      await writeFile(path.join(runDir, name), content);
    }

    const injector = path.join(
      process.cwd(),
      "test",
      "reporting",
      "fixtures",
      "fail-report-publication.mjs",
    );
    const result = runNode([
      "--import", pathToFileURL(injector).href,
      renderPath,
      "--findings", findingsPath,
      "--mode", "html",
      "--out", path.dirname(runDir),
      "--run-dir", runDir,
      "--target", root,
      "--validate",
      "--json",
    ], {
      env: {
        ...process.env,
        BETTER_HARNESS_FAIL_PUBLISH_TARGET: runDir,
        BETTER_HARNESS_FAIL_ROLLBACK_TARGET: runDir,
      },
    });

    assert.equal(result.status, 1, result.stderr || result.stdout);
    const payload = parseRun(result.stdout);
    assert.equal(payload.error.code, "PUBLISH_ROLLBACK_FAILED");
    assert.equal(Object.hasOwn(payload, "artifacts"), false);
    assert.equal(existsSync(runDir), false, "failed restoration must not be reported as preserved");
    const parentNames = await readdir(path.dirname(runDir));
    assert.equal(parentNames.some((name) => name.includes(".staging-")), false);
    assert.equal(parentNames.some((name) => name.includes(".backup-")), true);
  });
});

test("portable HTML Session population stays consistent across generated artifacts", async () => {
  await withTempDir("better-harness-portable-session-population-", async (root) => {
    // Given: reviewed portable data with a canonical 2/2 Session population and
    // no optional usage census or legacy at-a-glance projection.
    const reviewed = projectTaskLoopFindings(reviewedTaskLoopSource(), {
      projectName: "render-source-project",
      direct: true,
    });
    reviewed.summary.evidenceBoundary.manifest.platform = "dsh";
    reviewed.summary.evidenceBoundary.manifest.selection = {
      strategy: "all-eligible",
      eligibleCount: 2,
      analyzedCount: 2,
      confidence: "High",
    };
    reviewed.summary.dimensions = reviewed.summary.dimensions.map((dimension) => {
      const compact = { ...dimension };
      delete compact.subdimensions;
      return compact;
    });
    delete reviewed.summary.atAGlance;
    delete reviewed.summary.usageActivity;
    delete reviewed.summary.usageEfficiency;

    const findingsPath = path.join(root, "reviewed.findings.json");
    await writeJson(findingsPath, reviewed);

    // When: every affected portable host routes the same reviewed input through
    // the public renderer.
    for (const host of ["dsh", "codex", "grok", "kimi", "workbuddy"]) {
      const runDir = path.join(root, `run-${host}`);
      const result = runNode([
        renderPath,
        "--findings", findingsPath,
        "--mode", "html",
        "--platform", host,
        "--target", root,
        "--run-dir", runDir,
        "--validate",
        "--json",
      ], { cwd: root });

      // Then: JSON, Markdown, and both visible HTML surfaces use the same
      // canonical reviewed population without a host-specific renderer branch.
      assert.equal(result.status, 0, `${host}: ${result.stderr || result.stdout}`);
      const findings = JSON.parse(readFileSync(path.join(runDir, "findings.json"), "utf8"));
      const markdown = readFileSync(path.join(runDir, "report.md"), "utf8");
      const html = readFileSync(path.join(runDir, "report.html"), "utf8");
      assert.deepEqual(findings.summary.evidenceBoundary.manifest.selection, {
        strategy: "all-eligible",
        eligibleCount: 2,
        analyzedCount: 2,
        confidence: "High",
      }, host);
      assert.match(markdown, /Session selection: all-eligible; 2 sessions analyzed of 2 eligible sessions; High confidence/u, host);
      assert.match(html, /<span>Sessions analyzed<\/span>\s*<strong>2 \/ 2<\/strong>\s*<small>High<\/small>/u, host);
      assert.match(html, /<span>Sampling<\/span><strong>2 \/ 2<\/strong>/u, host);
      assert.match(html, /<span>Confidence<\/span><strong>High<\/strong>/u, host);
    }
  });
});

test("DSH reuses portable HTML report data, target root, and exact artifact contract", async () => {
  await withTempDir("better-harness-dsh-portable-", async (root) => {
    const target = path.join(root, "DSH target with 空格");
    const findingsPath = path.join(root, "reviewed.findings.json");
    await mkdir(target, { recursive: true });
    await writeJson(findingsPath, dshReviewedFindings());

    const result = runNode([
      renderPath,
      "--findings", findingsPath,
      "--mode", "html",
      "--platform", "dsh",
      "--target", target,
      "--validate",
      "--json",
    ], { cwd: target });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = parseRun(result.stdout);
    const canonicalTarget = await realpath(target);
    const expectedOut = path.join(canonicalTarget, ".dsh", "better-harness");
    assert.equal(payload.mode, "html");
    assert.deepEqual({
      requestedOut: payload.outputLocation.requestedOut,
      requestedRunDir: payload.outputLocation.requestedRunDir,
      resolvedRunDir: payload.outputLocation.resolvedRunDir,
      policy: payload.outputLocation.policy,
    }, {
      requestedOut: ".dsh/better-harness",
      requestedRunDir: null,
      resolvedRunDir: payload.runDir,
      policy: "allocate-below-out",
    });
    assert.equal(
      await realpath(payload.outputLocation.resolvedOutDir),
      await realpath(expectedOut),
      "default DSH root must resolve to the target-local Better Harness root",
    );
    assert.equal(path.dirname(path.dirname(payload.runDir)), payload.outputLocation.resolvedOutDir);
    assert.deepEqual(payload.artifacts.map((artifact) => artifact.name), [
      "findings.json",
      "report.md",
      "report.html",
    ]);
    assertDurableProjection(payload.runDir);
  });
});

test("generated DSH HTML uses host-neutral visible copy in both locales", async () => {
  await withTempDir("better-harness-dsh-portable-copy-", async (root) => {
    const findingsPath = path.join(root, "reviewed.findings.json");
    await writeJson(findingsPath, dshReviewedFindings());

    for (const row of [{
      language: "en",
      eyebrow: "Harness Insights · Portable HTML",
      footer: "Generated from one reviewed Harness source · self-contained portable HTML",
      copySuccess: "Copied. Paste into your coding agent input.",
      oldCopySuccess: "Copied. Paste into the Codex input.",
    }, {
      language: "zh-CN",
      eyebrow: "Harness 洞察 · 便携式 HTML",
      footer: "由同一份已复核 Harness source 生成 · 自包含便携式 HTML",
      copySuccess: "已复制，请粘贴到当前 Coding Agent 输入框。",
      oldCopySuccess: "已复制，请粘贴到 Codex 输入框。",
    }]) {
      const result = runNode([
        renderPath,
        "--findings", findingsPath,
        "--mode", "html",
        "--platform", "dsh",
        "--target", root,
        "--run-dir", `copy-${row.language}`,
        "--language", row.language,
        "--validate",
        "--json",
      ], { cwd: root });

      assert.equal(result.status, 0, `${row.language}: ${result.stderr || result.stdout}`);
      const payload = parseRun(result.stdout);
      const html = readFileSync(path.join(payload.runDir, "report.html"), "utf8");
      const visibleText = visibleHtmlText(html);
      assert.equal(visibleText.includes(row.eyebrow), true, row.language);
      assert.equal(visibleText.includes(row.footer), true, row.language);
      assert.equal(visibleText.includes("Codex"), false, row.language);
      assert.equal(html.includes(row.copySuccess), true, row.language);
      assert.equal(html.includes(row.oldCopySuccess), false, row.language);
    }
  });
});

test("render routes html output by host id and fails closed on unknown platforms", async () => {
  await withTempDir("better-harness-render-platform-", async (root) => {
    const findingsPath = path.join(root, "input.findings.json");
    await writeJson(findingsPath, sampleFindings());

    for (const platform of ["grok", "kimi", "workbuddy", "codex"]) {
      const routed = runNode(
        [renderPath, "--findings", findingsPath, "--mode", "html", "--platform", platform, "--target", root, "--json"],
        { cwd: root },
      );
      assert.equal(routed.status, 0, `${platform}: ${routed.stderr || routed.stdout}`);
      const payload = parseRun(routed.stdout);
      assert.equal(payload.outputLocation.requestedOut, `.${platform}/better-harness`);
      assert.equal(payload.runDir.includes(path.join(`.${platform}`, "better-harness")), true);
      const html = readFileSync(path.join(payload.runDir, "report.html"), "utf8");
      const visibleText = visibleHtmlText(html);
      assert.equal(visibleText.includes("Harness Insights · Portable HTML"), true, platform);
      assert.equal(visibleText.includes("Codex HTML"), false, platform);
      assert.equal(html.includes("Paste into the Codex input"), false, platform);
    }

    const rejected = runNode(
      [renderPath, "--findings", findingsPath, "--mode", "html", "--platform", "grock", "--target", root, "--json"],
      { cwd: root },
    );
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /unsupported render platform: grock/u);

    // Help must stay usable even with an invalid platform so agents can self-correct.
    const help = runNode([renderPath, "--help", "--platform", "grock"], { cwd: root });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /Usage: better-harness harness render/u);
  });
});

test("render platform allowlist follows report-rendering capability rather than session support", () => {
  assert.deepEqual([...RENDER_REPORT_PLATFORMS], hostIdsFor(HOST_CAPABILITIES.REPORT_RENDERING));
  assert.equal(RENDER_REPORT_PLATFORMS.includes("dsh"), true);
});

test("HTML relative action metadata carries the finding's current repair revision", () => {
  const reportData = {
    ...sampleFindings(),
    language: "en",
    target: { name: "render-fixture", path: "/tmp/render-fixture" },
  };
  reportData.findings = reportData.findings.map((finding, index) => ({
    ...finding,
    ...(index === 0 ? { actualOutputRevision: 3 } : {}),
  }));
  const html = renderHtml(reportData, {
    findingsPath: "/tmp/render-fixture/run/findings.json",
  });
  const action = embeddedJson(html, "harness-report-actions").findings[0];

  assert.deepEqual(action, {
    id: reportData.findings[0].id,
    expectedRevision: 3,
  });
});

test("HTML context-free rendering keeps raw prompt compatibility without local paths", () => {
  const reportData = {
    ...sampleFindings(),
    language: "en",
    target: { name: "render-fixture", path: "/tmp/render-fixture" },
  };

  const html = renderHtml(reportData);

  assert.deepEqual(embeddedJson(html, "harness-report-actions"), {
    reportRoute: null,
    findings: [],
  });
  assert.deepEqual(
    embeddedJson(html, "harness-report-data").findings.map((finding) => finding.id),
    reportData.findings.map((finding) => finding.id),
  );
  assert.equal(evaluateHtmlReport(html, reportData).status, "pass");
});

test("HTML omits Copy controls and action metadata for empty AI fix prompts", () => {
  const fixture = sampleFindings();
  const reportData = {
    ...fixture,
    language: "en",
    target: { name: "render-fixture", path: "/tmp/render-fixture" },
    findings: fixture.findings.map((finding, index) => (
      index === 0 ? { ...finding, aiFixPrompt: "  \n" } : finding
    )),
  };
  const actionContext = { findingsPath: "/tmp/render-fixture/run/findings.json" };

  const html = renderHtml(reportData, actionContext);
  const actions = embeddedJson(html, "harness-report-actions");
  const interactionData = embeddedJson(html, "harness-report-data");

  assert.equal((html.match(/data-copy-finding=/gu) ?? []).length, 2);
  assert.equal((html.match(/data-view-finding-dialog=/gu) ?? []).length, 2);
  assert.deepEqual(actions.findings.map((finding) => finding.id), [reportData.findings[1].id]);
  assert.deepEqual(interactionData.findings.map((finding) => finding.id), [reportData.findings[1].id]);
  assert.equal(evaluateHtmlReport(html, reportData, actionContext).status, "pass");
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
    assert.equal(existsSync(path.join(runDir, "canvas.json")), false);
    assert.equal(existsSync(path.join(runDir, "report.canvas.tsx")), false);
  });
});

test("HTML activity chart binds every short-range UTC date to its horizontal grid column", () => {
  const dates = ["2026-07-11", "2026-07-12", "2026-07-13", "2026-07-14"];
  const reportData = htmlReportDataWithActivity(dates);

  const html = renderHtml(reportData);
  const cells = html.match(/<span class="heat-cell [^"]+"[^>]*>/gu) ?? [];
  const ticks = html.match(/<span class="heat-tick[^"]*"[^>]*>/gu) ?? [];

  assert.equal(cells.length, 4);
  assert.deepEqual(cells.map((tag) => attribute(tag, "data-date")), dates);
  assert.deepEqual(cells.map((tag) => attribute(tag, "style")), [
    "grid-column:1",
    "grid-column:2",
    "grid-column:3",
    "grid-column:4",
  ]);
  assert.deepEqual(ticks.map((tag) => attribute(tag, "data-date")), dates);
  assert.deepEqual(ticks.map((tag) => attribute(tag, "style")), cells.map((tag) => attribute(tag, "style")));
  assert.ok(ticks.every((tag) => attribute(tag, "class") === "heat-tick"));
  for (const [index, cell] of cells.entries()) {
    assert.equal(attribute(cell, "title"), `${dates[index]}: ${(index + 1) * 5} active minutes`);
    assert.equal(attribute(cell, "aria-label"), attribute(cell, "title"));
  }
  assert.equal(evaluateHtmlReport(html, reportData).status, "pass");
});

test("HTML activity chart keeps sparse long-range ticks bound to their source columns", () => {
  const dates = Array.from({ length: 30 }, (_, index) => `2026-07-${String(index + 1).padStart(2, "0")}`);
  const reportData = htmlReportDataWithActivity(dates);

  const html = renderHtml(reportData);
  const cells = html.match(/<span class="heat-cell [^"]+"[^>]*>/gu) ?? [];
  const ticks = html.match(/<span class="heat-tick[^"]*"[^>]*>/gu) ?? [];

  assert.equal(cells.length, 30);
  assert.deepEqual(ticks.map((tag) => [attribute(tag, "data-date"), attribute(tag, "style")]), [
    [dates[0], "grid-column:1"],
    [dates[7], "grid-column:8"],
    [dates[14], "grid-column:15"],
    [dates[21], "grid-column:22"],
    [dates[29], "grid-column:30"],
  ]);
  assert.equal(evaluateHtmlReport(html, reportData).status, "pass");
});

test("HTML activity chart preserves empty, localized, accessible, and self-contained output", () => {
  const emptyData = htmlReportDataWithActivity([], { activeMinutes: [] });
  const emptyHtml = renderHtml(emptyData);
  assert.match(emptyHtml, /class="heatmap-empty" role="img"/u);
  assert.doesNotMatch(emptyHtml, /class="heat-cell|class="heat-axis/u);
  assert.equal(evaluateHtmlReport(emptyHtml, emptyData).status, "pass");

  const chineseData = htmlReportDataWithActivity(["2026-07-11"], { language: "zh", activeMinutes: [15] });
  const chineseHtml = renderHtml(chineseData);
  const chineseCell = chineseHtml.match(/<span class="heat-cell [^"]+"[^>]*>/u)?.[0] ?? "";
  assert.equal(attribute(chineseCell, "data-date"), "2026-07-11");
  assert.match(attribute(chineseCell, "title") ?? "", /^2026-07-11:/u);
  assert.match(attribute(chineseCell, "title") ?? "", /15/u);
  assert.equal(attribute(chineseCell, "aria-label"), attribute(chineseCell, "title"));
  assert.doesNotMatch(chineseHtml, /<link\b|<script[^>]+\bsrc=|fetch\s*\(/iu);
  assert.equal(evaluateHtmlReport(chineseHtml, chineseData).status, "pass");
});

test("Codex HTML renders accessible collapsed long-session swimlane traces without host runtime dependencies", () => {
  const reportData = htmlReportDataWithLongSessions();
  const html = renderHtml(reportData);
  const details = html.match(/<details class="tool-trace-details"[^>]*>/gu) ?? [];
  const points = html.match(/<circle class="tool-trace-point[^>]*>[\s\S]*?<\/circle>/gu) ?? [];

  assert.equal((html.match(/data-long-session-alias=/gu) ?? []).length, 2);
  assert.equal(details.length, 2);
  assert.ok(details.every((tag) => !/\bopen\b/u.test(tag)));
  assert.equal((html.match(/data-tool-trace-chart=/gu) ?? []).length, 1);
  assert.equal(points.length, 12);
  assert.equal((html.match(/class="tool-trace-point failed"/gu) ?? []).length, 2);
  assert.ok(points.every((tag) => /tabindex="0"/u.test(tag) && /aria-label="[^"]+"/u.test(tag) && /<title>/u.test(tag)));
  assert.match(html, /<svg class="tool-trace-svg"[^>]+role="img"[^>]+aria-label="S1 tool calls by tool, sequence, and observed latency"/u);
  assert.match(html, /<desc>Bubble area represents observed latency/u);
  assert.match(html, /data-session-locator="019f-codex-session-1"/u);
  assert.match(html, /Inspect &lt;script&gt;unsafe&lt;\/script&gt; &amp; explain the long session/u);
  assert.doesNotMatch(html, /<script>unsafe<\/script>|(?:codex|chatgpt):\/\/|qoder\/canvas/iu);
  assert.equal(evaluateHtmlReport(html, reportData).status, "pass");
});

test("Codex HTML keeps complete wide traces contained and validates exact reviewed points", () => {
  const reportData = htmlReportDataWithLongSessions({ callCount: 125 });
  const html = renderHtml(reportData);

  assert.equal((html.match(/data-trace-call-id=/gu) ?? []).length, 125);
  assert.equal(evaluateHtmlReport(html, reportData).status, "pass");

  const missingPoint = html.replace(/<circle class="tool-trace-point[^>]*>[\s\S]*?<\/circle>/u, "");
  const missingPointResult = evaluateHtmlReport(missingPoint, reportData);
  assert.equal(missingPointResult.status, "fail");
  assert.ok(missingPointResult.errors.some((error) => /tool-trace point count 124/u.test(error)));

  const hostLinked = html.replace("</footer>", "<a href=\"codex://session/private\">open</a></footer>");
  const hostLinkedResult = evaluateHtmlReport(hostLinked, reportData);
  assert.equal(hostLinkedResult.status, "fail");
  assert.ok(hostLinkedResult.errors.some((error) => /forbidden host deep link/u.test(error)));
});

test("HTML dimension progressbar semantics stay complete and score-bound", () => {
  // Given: a canonical reviewed report with five fluency dimensions.
  const reportData = {
    ...sampleFindings(),
    language: "en",
    target: { name: "render-fixture", path: "/tmp/render-fixture" },
  };

  // When: the report is rendered and its dimension progressbars are inspected.
  const html = renderHtml(reportData);
  const progressbars = html.match(/<div class="track" role="progressbar"[^>]*>/gu) ?? [];

  // Then: every displayed rounded score has one complete semantic contract.
  assert.equal(progressbars.length, reportData.summary.dimensions.length);
  for (const dimension of reportData.summary.dimensions) {
    const score = Math.round(dimension.score);
    assert.ok(progressbars.includes(
      `<div class="track" role="progressbar" aria-label="${dimension.label} ${score} of 100" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${score}">`,
    ));
  }
  assert.equal(evaluateHtmlReport(html, reportData).status, "pass");

  const firstProgressbar = progressbars[0] ?? "";
  const firstProgressbarMarkup = html.match(/<div class="track" role="progressbar"[^>]*><i[^>]*><\/i><\/div>/u)?.[0] ?? "";
  assert.notEqual(firstProgressbarMarkup, "");
  const mutateFirstProgressbar = (pattern, replacement) => html.replace(
    firstProgressbar,
    firstProgressbar.replace(pattern, replacement),
  );
  const mutations = [
    ["missing progressbar", html.replace(firstProgressbarMarkup, "")],
    ["extra progressbar", html.replace(firstProgressbarMarkup, `${firstProgressbarMarkup}${firstProgressbarMarkup}`)],
    ["missing role", mutateFirstProgressbar(' role="progressbar"', "")],
    ["invalid role", mutateFirstProgressbar('role="progressbar"', 'role="meter"')],
    ["missing label", mutateFirstProgressbar(/ aria-label="[^"]+"/u, "")],
    ["invalid label", mutateFirstProgressbar(/aria-label="[^"]+"/u, 'aria-label=""')],
    ["invalid minimum", mutateFirstProgressbar('aria-valuemin="0"', 'aria-valuemin="1"')],
    ["invalid maximum", mutateFirstProgressbar('aria-valuemax="100"', 'aria-valuemax="99"')],
    ["invalid current value", mutateFirstProgressbar(/aria-valuenow="[^"]+"/u, 'aria-valuenow="invalid"')],
    ["score mismatch", mutateFirstProgressbar('aria-valuenow="62"', 'aria-valuenow="61"')],
  ];

  for (const [label, mutatedHtml] of mutations) {
    assert.equal(
      evaluateHtmlReport(mutatedHtml, reportData).status,
      "fail",
      `${label} mutation must fail validation`,
    );
  }
});

test("HTML evidence episode coverage preserves canonical summary facts and legacy fallback", () => {
  // Given: machine-owned summary facts and a conflicting legacy projection.
  const fixture = sampleFindings();
  const reportData = {
    ...fixture,
    language: "en",
    target: { name: "render-fixture", path: "/tmp/render-fixture" },
    summary: {
      ...fixture.summary,
      evidenceBoundary: {
        episodeCoverage: {
          episodeCount: 14,
          editedEpisodeCount: 12,
        },
      },
      atAGlance: {
        coverage: {
          episodeCount: 1,
          editedEpisodeCount: 1,
        },
      },
    },
  };

  // When: canonical and legacy reports are rendered.
  const canonicalHtml = renderHtml(reportData);
  const legacyHtml = renderHtml({
    ...reportData,
    summary: {
      ...reportData.summary,
      evidenceBoundary: undefined,
      atAGlance: {
        coverage: {
          episodeCount: 7,
          editedEpisodeCount: 5,
        },
      },
    },
  });

  // Then: machine facts win, while legacy-only input remains readable.
  assert.match(canonicalHtml, /<span>Task episodes<\/span><strong>14<\/strong>/u);
  assert.match(canonicalHtml, /<span>Edited episodes<\/span><strong>12<\/strong>/u);
  assert.match(legacyHtml, /<span>Task episodes<\/span><strong>7<\/strong>/u);
  assert.match(legacyHtml, /<span>Edited episodes<\/span><strong>5<\/strong>/u);
});

test("portable HTML Session population distinguishes valid zero from unavailable data", () => {
  const fixture = sampleFindings();
  const reportData = {
    ...fixture,
    language: "en",
    target: { name: "render-fixture", path: "/tmp/render-fixture" },
  };

  const zeroHtml = renderHtml({
    ...reportData,
    summary: {
      ...reportData.summary,
      evidenceBoundary: {
        manifest: {
          selection: {
            strategy: "all-eligible",
            eligibleCount: 0,
            analyzedCount: 0,
            confidence: "Low",
          },
        },
      },
    },
  });
  const unavailableHtml = renderHtml(reportData);

  assert.match(zeroHtml, /<span>Sessions analyzed<\/span>\s*<strong>0 \/ 0<\/strong>\s*<small>Low<\/small>/u);
  assert.match(zeroHtml, /<span>Sampling<\/span><strong>0 \/ 0<\/strong>/u);
  assert.match(unavailableHtml, /<span>Sessions analyzed<\/span>\s*<strong>N\/A<\/strong>/u);
  assert.match(unavailableHtml, /<span>Sampling<\/span><strong>N\/A<\/strong>/u);
});

test("HTML CJK phrase breaking emits bounded deterministic markup without changing report data", () => {
  // Given: reviewed phrases plus escaping, long-token, path, URL, and mixed-Latin boundaries.
  const fixture = sampleFindings();
  const reportData = {
    ...fixture,
    language: "zh-CN",
    target: { name: "render-fixture", path: "/tmp/render-fixture" },
    summary: {
      ...fixture.summary,
      overview: "同一证据包给出两套互相冲突的口径，并保留 recommendedReads 与 app/api/example.py。",
      dimensions: fixture.summary.dimensions.map((dimension, index) => ({
        ...dimension,
        label: ["任务理解", "可控执行", "改动验证", "可靠交付", "经验沉淀"][index],
        summary: index === 1
          ? "项目具有工作入口，但画像没有投影这些命令，代理仍需猜测验证路线。"
          : dimension.summary,
      })),
    },
    findings: fixture.findings.map((finding, index) => ({
      ...finding,
      title: index === 0 ? "同一证据包给出相反结论" : "项目画像漏掉工作入口",
      reason: index === 0
        ? "安全<script>与命令：https://example.com/复核/very-long-token"
        : `${finding.reason} 超长连续汉字测试文本边界仍可读取`,
    })),
  };

  // When: the Chinese and English documents are rendered through the same HTML renderer.
  const chineseHtml = renderHtml(reportData);
  const englishHtml = renderHtml({ ...reportData, language: "en" });

  // Then: ordinary Chinese word segments receive bounded keep-together markup.
  assert.match(chineseHtml, /<html lang="zh-CN" class="no-js">/u);
  for (const phrase of ["口径", "入口", "结论", "命令"]) {
    assert.match(chineseHtml, new RegExp(`<span class="cjk-phrase">${phrase}</span>`, "u"));
  }
  const markedPhrases = [...chineseHtml.matchAll(/<span class="cjk-phrase">([^<]+)<\/span>/gu)];
  assert.ok(markedPhrases.length > 4);
  for (const [, phrase] of markedPhrases) {
    assert.match(phrase, /^\p{Script=Han}{2,8}$/u);
    assert.ok([...phrase].length <= 8);
  }
  const metricMarkup = chineseHtml.match(/<div class="metric">([\s\S]*?)<\/div>/u)?.[1] ?? "";
  const scoreOrbitMarkup = chineseHtml.match(/<div class="score-orbit">([\s\S]*?)<\/div>/u)?.[1] ?? "";
  const evidenceMarkup = chineseHtml.match(/<div class="evidence-grid">([\s\S]*?)<\/div>/u)?.[1] ?? "";
  for (const surfaceMarkup of [metricMarkup, scoreOrbitMarkup, evidenceMarkup]) {
    assert.match(surfaceMarkup, /<span>[\s\S]*?<span class="cjk-phrase">/u);
  }
  assert.match(chineseHtml, /<span class="cjk-phrase">安全<\/span>&lt;script&gt;/u);
  assert.doesNotMatch(chineseHtml, /安全<script>/u);

  // And: English output and nonvisual report surfaces do not gain phrase markup.
  assert.match(englishHtml, /<html lang="en" class="no-js">/u);
  assert.doesNotMatch(englishHtml, /<span class="cjk-phrase">/u);
  assert.doesNotMatch(chineseHtml, /aria-label="[^"]*<span class="cjk-phrase">/u);
  assert.doesNotMatch(chineseHtml, /<script id="harness-report-data" type="application\/json">[\s\S]*?<span class="cjk-phrase">/u);

  // And: unsupported runtimes fall back to escaped readable text.
  const segmenter = Intl.Segmenter;
  let fallbackHtml;
  try {
    Intl.Segmenter = undefined;
    fallbackHtml = renderHtml(reportData);
  } finally {
    Intl.Segmenter = segmenter;
  }
  assert.doesNotMatch(fallbackHtml, /<span class="cjk-phrase">/u);
  assert.match(fallbackHtml, /安全&lt;script&gt;与命令/u);
});

test("HTML validator rejects incomplete finding action contracts", () => {
  const reportData = {
    ...sampleFindings(),
    language: "en",
    target: { name: "render-fixture", path: "/tmp/render-fixture" },
  };
  const actionContext = { findingsPath: "/tmp/render-fixture/run/findings.json" };
  const html = renderHtml(reportData, actionContext);
  assert.equal(evaluateHtmlReport(html, reportData, actionContext).status, "pass");

  const mutations = [
    ["interaction controller", html.replace(/<script id="harness-report-interactions">[\s\S]*?<\/script>/u, "")],
    ["finding action payload", html.replace(/<script id="harness-report-actions"[\s\S]*?<\/script>/u, "")],
    ["interaction data payload", html.replace(/<script id="harness-report-data"[\s\S]*?<\/script>/u, "")],
    ["cross-bound finding action payload", html.replace(
      '"id":"ff-runtime-validation","expectedRevision"',
      '"id":"aia-workflow-evidence","expectedRevision"',
    )],
    ["stale finding action revision", html.replace(
      '"expectedRevision":0',
      '"expectedRevision":7',
    )],
    ["absolute report route", html.replace(
      /"reportRoute":"[^"]+"/u,
      '"reportRoute":"C:/private/report.html"',
    )],
    ["escaping report route", html.replace(
      /"reportRoute":"[^"]+"/u,
      '"reportRoute":"../report.html"',
    )],
    ["cross-bound interaction data", html.replace(
      '"id":"ff-runtime-validation","aiFixPrompt"',
      '"id":"aia-workflow-evidence","aiFixPrompt"',
    )],
    ["copy status", html.replace(/<div id="copy-status"[\s\S]*?<\/div>/u, "")],
    ["manual copy fallback", html.replace(/<dialog id="manual-copy-dialog"[\s\S]*?<\/dialog>/u, "")],
    ["finding copy action", html.replace(/<button[^>]+data-copy-finding=[\s\S]*?<\/button>/u, "")],
    ["finding detail action", html.replace(/<button[^>]+data-view-finding-dialog=[\s\S]*?<\/button>/u, "")],
    ["cross-bound finding copy action", html.replace(
      'data-copy-finding="ff-runtime-validation"',
      'data-copy-finding="aia-workflow-evidence"',
    )],
    ["cross-bound finding dialog", html.replace(
      'data-finding-dialog-id="ff-runtime-validation"',
      'data-finding-dialog-id="aia-workflow-evidence"',
    )],
    ["mismatched finding detail action", html.replace(
      'data-view-finding-dialog="finding-dialog-1"',
      'data-view-finding-dialog="finding-dialog-2"',
    )],
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
    const result = evaluateHtmlReport(mutatedHtml, reportData, actionContext);
    assert.equal(result.status, "fail", `${label} mutation must fail validation`);
  }
});

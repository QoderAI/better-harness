import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { runInNewContext } from "node:vm";

import { analyzeCanvasModuleBoundaries } from "../scripts/harness-analysis/canvas-module-boundaries.mjs";
import { validateHarnessCanvasArtifacts } from "../scripts/harness-analysis/validate-canvas.mjs";

const execFileAsync = promisify(execFile);

const richAiFixPrompt = `/better-harness fix this issue

The Canvas runtime under /tmp/fixture-project is missing preview health and module-load validation. Add the runtime validation path while keeping generated eval artifacts untouched.

Keep the change limited to /tmp/fixture-project and directly related files.

## Validation

- Run \`node scripts/harness-analysis/validate-canvas.mjs --canvas insights.canvas.tsx\`
- Confirm preview health and module load pass`;

const richSchedulePrompt = "/schedule create a recurring /better-harness follow-up for /tmp/fixture-project. Recheck the low score weekly, run node scripts/harness-analysis/validate-canvas.mjs --canvas <run>/insights.canvas.tsx, and stop when score is >= 60 for two runs or after four runs.";

async function withTempDir(name, fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), name));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeFixture(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

async function writeSdkDeclarations(root) {
  const declarationsPath = path.join(root, "sdk", "index.d.ts");
  await writeFixture(
    declarationsPath,
`export { AreaChart, BarChart, Button, Callout, Card, CardBody, CardHeader, CollapsibleSection, Divider, Fluency, Grid, H1, H2, IconButton, ImprovementKataCard, LineChart, MetricsGrid, Progress, RiskHeatmap, Row, Stack, Table, Tag, Text } from "./core-primitives.js";
export { Dialog, SendToChatButton, useCanvasAction } from "./core-primitives.js";
`,
  );
  return declarationsPath;
}

function validCanvas() {
  return `import { SendToChatButton, Stack, Text } from "qoder/canvas";
import reportData from "./findings.json";

const report = reportData;

export default function Report() {
  const findings = report.findings ?? [];
  return (
    <Stack gap={16}>
      <Text>{report.summary?.projectName}</Text>
      <Text>{report.summary?.dimensions?.[0]?.label}</Text>
      <Text>{findings[0]?.title}</Text>
      <Text>{findings[0]?.reason}</Text>
      <SendToChatButton text={findings[0]?.aiFixPrompt} options={{ submit: false }}>
        AI Fix
      </SendToChatButton>
    </Stack>
  );
}
`;
}

function validFindingsJson() {
  return {
    summary: {
      projectName: "fixture-project",
      modelId: "software-fluency",
      strengths: [
        "Project guidance and local validation files are visible.",
      ],
      dimensions: [{
        id: "context-map",
        label: "Context Map",
        score: 72,
        summary: "Project guidance maps the main workflow, but cross-cutting ownership remains implicit.",
        findingRefs: [],
      }, {
        id: "environment-readiness",
        label: "Environment Readiness",
        score: 68,
        summary: "Setup and build entrypoints are visible, while reset evidence is incomplete.",
        findingRefs: [],
      }, {
        id: "fast-feedback",
        label: "Fast Feedback",
        score: 42,
        summary: "Local checks exist, but a repeatable runtime smoke path is not visible.",
        findingRefs: ["ff-runtime-validation"],
      }, {
        id: "quality-gates",
        label: "Quality Gates",
        score: 48,
        summary: "Static checks exist, but runtime validation is not enforced as a gate.",
        findingRefs: ["ff-runtime-validation"],
      }, {
        id: "safe-change",
        label: "Change Safety",
        score: 54,
        summary: "Review guidance is present, but the low score has no proven reassessment loop.",
        findingRefs: ["cs-schedule-follow-up"],
      }],
      aiAgentPractice: {
        inspectedSurfaces: ["Rules", "Skills"],
        coverageRows: [{
          surface: "Rules",
          count: 1,
          scopes: ["Project"],
          paths: ["AGENTS.md"],
        }],
      },
    },
    findings: [{
      id: "ff-runtime-validation",
      title: "Runtime validation needs a visible gate",
      severity: "High",
      reason: "Local validation exists, but the report does not show a repeatable runtime smoke path, so readers cannot tell whether Canvas output actually loads.",
      aiFixPrompt: richAiFixPrompt,
      dimensionRefs: ["fast-feedback", "quality-gates"],
    }, {
      id: "cs-schedule-follow-up",
      title: "Low score needs a follow-up cadence",
      severity: "Medium",
      reason: "The score is below the ready threshold, so the project needs a bounded reassessment loop instead of a one-time report.",
      aiFixPrompt: richSchedulePrompt,
      dimensionRefs: ["safe-change"],
    }],
  };
}

function findingsJsonText(payload = validFindingsJson()) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

test("Canvas module boundary parser handles compact, escaped, and nested import syntax", () => {
  const staticAnalysis = analyzeCanvasModuleBoundaries([
    String.raw`import"\x6eode:fs";`,
    'import{x}from"node:path";',
    'import/* ; " */"node:child_process";',
    'import"./findings.json\'evil";',
    'export*from"node:os";',
  ].join("\n"));
  assert.equal(staticAnalysis.syntaxError, false);
  assert.deepEqual(staticAnalysis.staticSources, [
    "node:fs",
    "node:path",
    "node:child_process",
    "./findings.json'evil",
    "node:os",
  ]);
  assert.deepEqual(staticAnalysis.reexports, ["node:os"]);

  assert.equal(analyzeCanvasModuleBoundaries('const direct = () => import/* boundary */("node:https");').dynamicImport, true);
  assert.equal(analyzeCanvasModuleBoundaries('const nested = () => `${import("node:url")}`;').dynamicImport, true);
  const copyOnly = analyzeCanvasModuleBoundaries('const copy = "import\\\"node:fs\\\""; const pattern = /import\\(/;');
  assert.equal(copyOnly.dynamicImport, false);
  assert.deepEqual(copyOnly.staticSources, []);

  const jsxText = analyzeCanvasModuleBoundaries('const view = <Text>don\'t import("node:fs")</Text>;');
  assert.equal(jsxText.syntaxError, false);
  assert.equal(jsxText.dynamicImport, false);
  assert.equal(analyzeCanvasModuleBoundaries('const view = <Text>{import("node:url")}</Text>;').dynamicImport, true);
  assert.equal(analyzeCanvasModuleBoundaries('import type { Text } from "qoder/canvas";').imports[0]?.defaultImport, null);
});

test("validates Canvas artifacts using the new findings schema", async () => {
  await withTempDir("better-harness-canvas-validation-", async (root) => {
    const canvasPath = path.join(root, "insights.canvas.tsx");
    const findingsPath = path.join(root, "findings.json");
    const sdkDeclarationsPath = await writeSdkDeclarations(root);

    await writeFixture(canvasPath, validCanvas());
    await writeFixture(findingsPath, findingsJsonText());

    const result = await validateHarnessCanvasArtifacts({
      canvasPath,
      findingsPath,
      sdkDeclarationsPath,
      preview: false,
      repoRoot: root,
    });

    assert.equal(result.status, "pass", JSON.stringify(result.errors, null, 2));
    assert.equal(result.checks.find((check) => check.id === "findings-json")?.status, "pass");
  });
});

test("rejects suggestions on the legacy software-fluency contract", async () => {
  await withTempDir("better-harness-canvas-legacy-suggestion-", async (root) => {
    const canvasPath = path.join(root, "insights.canvas.tsx");
    const findingsPath = path.join(root, "findings.json");
    const sdkDeclarationsPath = await writeSdkDeclarations(root);
    const payload = validFindingsJson();
    payload.summary.suggestions = [{
      id: "unsupported-legacy-suggestion",
      kind: "try-existing",
      title: "Unsupported legacy suggestion",
      reason: "Legacy reports do not own the reconciled suggestion evidence gate.",
      confidence: "Low",
      owner: "Harness reviewers",
      nextStep: "Use the Agent Work Loop contract instead.",
      validation: "Confirm the legacy validator rejects this field.",
    }];

    await writeFixture(canvasPath, validCanvas());
    await writeFixture(findingsPath, findingsJsonText(payload));

    const result = await validateHarnessCanvasArtifacts({
      canvasPath,
      findingsPath,
      sdkDeclarationsPath,
      preview: false,
      repoRoot: root,
    });

    const findingsCheck = result.checks.find((check) => check.id === "findings-json");
    assert.equal(findingsCheck?.status, "fail");
    assert.ok(findingsCheck?.errors.some((error) => /summary has unsupported field: suggestions/.test(error)));
  });
});

test("rejects finding-only action fields on suggestions", async () => {
  await withTempDir("better-harness-canvas-suggestion-validation-", async (root) => {
    const canvasPath = path.join(root, "insights.canvas.tsx");
    const findingsPath = path.join(root, "findings.json");
    const sdkDeclarationsPath = await writeSdkDeclarations(root);
    const payload = JSON.parse(await readFile(
      path.join(process.cwd(), "templates", "reporting", "harness-findings.input.json"),
      "utf8",
    ));
    payload.summary.suggestions = [{
      id: "historical-try-existing",
      kind: "try-existing",
      title: "Try an existing bounded owner",
      reason: "Historical v25 reports may contain an advisory suggestion.",
      confidence: "Low",
      owner: "Harness reviewers",
      nextStep: "Exercise the existing owner once.",
      validation: "Confirm the bounded result.",
      aiFixPrompt: "/better-harness fix this issue",
    }];

    await writeFixture(canvasPath, validCanvas());
    await writeFixture(findingsPath, findingsJsonText(payload));
    await writeFixture(path.join(root, "canvas.json"), `${JSON.stringify({
      schemaVersion: 1,
      summary: {},
      dimensions: payload.summary.dimensions.map((row) => ({ id: row.id })),
      findings: payload.findings.map((row) => ({ id: row.id })),
    }, null, 2)}\n`);

    const result = await validateHarnessCanvasArtifacts({
      canvasPath,
      findingsPath,
      sdkDeclarationsPath,
      preview: false,
      repoRoot: root,
    });

    const findingsCheck = result.checks.find((check) => check.id === "findings-json");
    assert.equal(findingsCheck?.status, "fail");
    assert.ok(findingsCheck?.errors.some((error) => /suggestions\[0\] has unsupported field: aiFixPrompt/.test(error)));
  });
});

test("rejects side-effect and dynamic imports from AI-authored Canvas", async () => {
  await withTempDir("better-harness-canvas-import-boundary-", async (root) => {
    const canvasPath = path.join(root, "insights.canvas.tsx");
    const findingsPath = path.join(root, "findings.json");
    const canvasDataPath = path.join(root, "canvas.json");
    const sdkDeclarationsPath = await writeSdkDeclarations(root);
    const hostileImports = String.raw`import"\x6eode:fs";
import{x}from"node:path";
import/* ; \" */"node:child_process";
import*as CanvasRuntime from"qoder/canvas";
import React from"react";
import canvasData from"./canvas.json";
import"./findings.json'evil";
export*from"node:os";`;
    const dynamicImports = 'const loadNodePath = () => import /* direct */ ("node:https");\nconst loadFromTemplate = () => `${import("node:url")}`;\n';
    const canvas = `${hostileImports}\n${validCanvas()}\n${dynamicImports}`;

    await writeFixture(canvasPath, canvas);
    await writeFixture(findingsPath, findingsJsonText());
    await writeFixture(canvasDataPath, '{"schemaVersion":1,"summary":{},"dimensions":[],"findings":[]}\n');

    const result = await validateHarnessCanvasArtifacts({
      canvasPath,
      findingsPath,
      canvasDataPath,
      sdkDeclarationsPath,
      preview: false,
      repoRoot: root,
    });

    const runtime = result.checks.find((check) => check.id === "runtime-boundaries");
    assert.equal(runtime?.status, "fail");
    assert.ok(runtime?.errors.some((error) => /forbidden import source: node:fs/.test(error)));
    assert.ok(runtime?.errors.some((error) => /forbidden import source: node:path/.test(error)));
    assert.ok(runtime?.errors.some((error) => /forbidden import source: node:child_process/.test(error)));
    assert.ok(runtime?.errors.some((error) => /forbidden import source: react/.test(error)));
    assert.ok(runtime?.errors.some((error) => /forbidden import source: \.\/findings\.json'evil/.test(error)));
    assert.ok(runtime?.errors.some((error) => /must not re-export modules: node:os/.test(error)));
    assert.ok(runtime?.errors.some((error) => /qoder\/canvas must use named imports/.test(error)));
    assert.ok(runtime?.errors.some((error) => /forbidden runtime API: dynamic import/.test(error)));
  });
});

test("full validator accepts a safe non-identical Qoder Canvas composition", async () => {
  await withTempDir("better-harness-canvas-authored-composition-", async (root) => {
    const canvasPath = path.join(root, "report.canvas.tsx");
    const findingsPath = path.join(root, "findings.json");
    const canvasDataPath = path.join(root, "canvas.json");
    const sdkDeclarationsPath = await writeSdkDeclarations(root);
    const scaffold = await readFile(path.resolve("templates/canvas/better-harness-insights.canvas.tsx"), "utf8");
    const composed = scaffold.replace(
      '<Stack gap={24} style={taskLoopPageStyle}>',
      '<Stack gap={28} style={taskLoopPageStyle}>',
    );
    assert.notEqual(composed, scaffold);

    await writeFixture(canvasPath, composed);
    await writeFixture(findingsPath, findingsJsonText());
    await writeFixture(canvasDataPath, '{"schemaVersion":1,"summary":{},"dimensions":[],"findings":[]}\n');

    const result = await validateHarnessCanvasArtifacts({
      canvasPath,
      findingsPath,
      canvasDataPath,
      sdkDeclarationsPath,
      preview: false,
      repoRoot: root,
    });

    assert.equal(result.status, "pass", JSON.stringify(result.errors, null, 2));
    for (const checkId of ["canvas-quality", "canvas-findings-source", "runtime-boundaries", "tsx-transform", "findings-json"]) {
      assert.equal(result.checks.find((check) => check.id === checkId)?.status, "pass", checkId);
    }
    assert.equal(result.checks.some((check) => check.id === "canonical-canvas-template"), false);
  });
});

test("Codex Canvas validation does not probe Qoder SharedClientCache declarations", async () => {
  await withTempDir("better-harness-canvas-validation-codex-host-", async (root) => {
    const canvasPath = path.join(root, "report.canvas.tsx");
    const findingsPath = path.join(root, "findings.json");
    const canvasDataPath = path.join(root, "canvas.json");
    const qoderHome = path.join(root, "qoder-shared-client-cache");
    const qoderDeclarations = path.join(qoderHome, "canvas", "sdk", "index.d.ts");

    await writeFixture(canvasPath, validCanvas());
    await writeFixture(findingsPath, findingsJsonText());
    await writeFixture(canvasDataPath, JSON.stringify({
      schemaVersion: 1,
      summary: {
        evidenceBoundary: { manifest: { platform: "codex" } },
      },
      dimensions: [],
      findings: [],
    }));
    await writeFixture(qoderDeclarations, 'export { SendToChatButton, Stack, Text } from "./core.js";\n');

    const result = await validateHarnessCanvasArtifacts({
      canvasPath,
      findingsPath,
      canvasDataPath,
      preview: false,
      repoRoot: root,
      env: { ...process.env, QODER_HOME: qoderHome },
    });

    assert.equal(result.platform, "codex");
    assert.equal(result.sdkDeclarationsPath, path.join(root, "node_modules", "qoder", "canvas", "index.d.ts"));
    assert.equal(result.sdkDeclarationsPath.startsWith(qoderHome), false);
    const runtime = result.checks.find((check) => check.id === "runtime-boundaries");
    assert.equal(runtime?.status, "warn");
    assert.ok(runtime?.warnings.some((warning) => /SDK declarations not found/.test(warning)));
    assert.doesNotMatch(JSON.stringify(runtime), /qoder-shared-client-cache/);
  });
});

test("validates the shipped Better Harness Canvas template", async () => {
  await withTempDir("better-harness-canvas-validation-template-", async (root) => {
    const canvasPath = path.join(root, "insights.canvas.tsx");
    const findingsPath = path.join(root, "findings.json");
    const canvasDataPath = path.join(root, "canvas.json");
    const sdkDeclarationsPath = await writeSdkDeclarations(root);
    const template = await readFile(path.resolve("templates/canvas/better-harness-insights.canvas.tsx"), "utf8");

    assert.match(template, /<AreaChart/);
    assert.doesNotMatch(template, /<LineChart/);
    assert.match(template, /<RiskHeatmap/);
    assert.doesNotMatch(template, /TaskLoopOverview/);
    assert.doesNotMatch(template, /<ImprovementKataCard/);
    assert.match(template, /<Table/);
    assert.match(template, /<Callout/);
    assert.match(template, /<Card/);
    assert.match(template, /function PracticeSourceCard/);
    assert.match(template, /<Grid columns=\{3\} minColumnWidth=\{260\}/);
    assert.doesNotMatch(template, /TaskLoopPracticeDetailRows/);
    assert.match(template, /practiceDescription\(row\.surface\)/);
    assert.doesNotMatch(template, /practiceEvaluation/);
    assert.match(template, /row\.reason/);
    assert.match(template, /defaultOpen=\{false\}/);
    assert.doesNotMatch(template, /const (?:cardStyle|openingStyle|dividerStyle)/);
    assert.doesNotMatch(template, /<div\b/);
    assert.match(template, /row\.expectedOutput/);
    assert.match(template, /Expected Output/);
    assert.doesNotMatch(template, /Deliverable/);
    assert.doesNotMatch(template, /After this is done/);
    assert.doesNotMatch(template, /row\.expectedOutcome|row\.expectedFileChanges/);
    assert.match(template, /Project usage/);
    assert.match(template, /summary\?\.usageActivity/);
    assert.match(template, /summary\?\.usageEfficiency/);
    assert.match(template, /function taskLoopMeasurementBoundaryText/);
    assert.match(template, /Usage unavailable/);
    assert.match(template, /Session measurement context was not supplied/);
    const evidenceDetails = template.slice(
      template.indexOf("function TaskLoopEvidenceDetails"),
      template.indexOf("function TaskLoopEvidenceBoundary"),
    );
    const usageBoundaryMethodology = template.slice(
      template.indexOf("function TaskLoopUsageMethodology"),
      template.indexOf("function usageTrendLeader"),
    );
    assert.doesNotMatch(evidenceDetails, /\?\? 0/);
    assert.doesNotMatch(usageBoundaryMethodology, /\?\? 0/);
    const evidenceBoundary = template.slice(
      template.indexOf("function TaskLoopEvidenceBoundary"),
      template.indexOf("function TaskLoopReport"),
    );
    assert.doesNotMatch(evidenceBoundary, /\?\? 0/);
    assert.match(template, /textValue\(report\.summary\?\.overview\)/);
    assert.match(template, /Estimated active-long/);
    assert.match(template, /TaskLoopLongSessionReview/);
    assert.doesNotMatch(template, /sample\.(?:sessionRef|userInputSummary|rawSessionId)/);
    assert.match(template, /Review \$\{pendingCount\} sessions/);
    assert.match(template, /controlled A\/B/);
    assert.doesNotMatch(template, /TaskLoopEvidenceScore|Work-stage coverage/);
    assert.doesNotMatch(template, /TaskLoopTopDecision|Highest-priority improvement/);
    assert.doesNotMatch(template, /TaskLoopSummary|TaskLoopReaderSummary|taskLoopDecisionColumns|taskLoopDimensionExtreme/);
    assert.match(template, /TaskLoopReportHeader/);
    assert.match(template, /Representative project or global Memory note files/);
    assert.doesNotMatch(template, /function hasIdeCanvasBridge/);
    assert.doesNotMatch(template, /__aicodingCanvasBridge/);
    assert.doesNotMatch(template, /useCanvasAction/);
    assert.doesNotMatch(template, /aicoding\.canvas\.openHarnessInsights/);
    assert.doesNotMatch(template, /Handoff to Better Harness|到 Better Harness 处理/);
    const reportHeader = template.slice(
      template.indexOf("function TaskLoopReportHeader"),
      template.indexOf("function TaskLoopFluency"),
    );
    assert.match(reportHeader, /<H1>\{projectName\(\)\}<\/H1>/);
    assert.doesNotMatch(reportHeader, /<Button\b|onClick=/);
    assert.match(reportHeader, /textValue\(report\.summary\?\.overview\)/);
    assert.match(reportHeader, /practice source types/);
    assert.doesNotMatch(template, /TaskLoopScoreOverview/);
    assert.doesNotMatch(template, /<Progress/);
    assert.doesNotMatch(template, /reportContractVersion\s*(?:===|!==|==|!=)/);
    assert.doesNotMatch(template, /schemaVersion\s*(?:===|!==|==|!=)/);
    assert.doesNotMatch(template, /TASK_LOOP_DIMENSION_LABELS/);
    assert.match(template, /dimensionLabel\(id, list\(report\.summary\?\.dimensions\)\)/);
    assert.match(template, /row\.id !== "learning-capture"/);
    assert.match(template, /taskLoopCopy\("dimensions", "个维度"\)/);
    assert.doesNotMatch(template, /LEARNING_LOOP_STAGE_NUMBERS/);
    assert.doesNotMatch(template, /Longitudinal boundary|Longitudinal state|Completed stage/);
    assert.doesNotMatch(template, /纵向边界|纵向状态|已完成阶段/);
    assert.doesNotMatch(template, /适应式演进|经验工程化|适应性改进/);
    const fluency = template.slice(
      template.indexOf("function TaskLoopFluency"),
      template.indexOf("function practiceCount"),
    );
    assert.match(fluency, /Agent Work Loop/);
    assert.match(fluency, /height=\{180\}/);
    assert.match(fluency, /tooltip=\{\(_stage, index\) => dimensionFluencyTooltip\(dimensions\[index\]\)\}/);
    assert.doesNotMatch(fluency, /Scores locate improvement opportunities|分数用于定位改进机会/);
    assert.doesNotMatch(fluency, /<Card\b|<CardBody\b/);
    assert.doesNotMatch(fluency, /<CollapsibleSection/);
    assert.doesNotMatch(template, /TaskLoopDimensionDetails/);
    assert.doesNotMatch(template, /row\.scoreReason|row\.scoreConfidence/);
    assert.match(template, /TaskLoopProjectUsage/);
    const projectUsage = template.slice(
      template.indexOf("function TaskLoopProjectUsage"),
      template.indexOf("function TaskLoopUsageMethodology"),
    );
    assert.doesNotMatch(projectUsage, /<Card\b|<CardHeader\b|<CardBody\b/);
    assert.doesNotMatch(projectUsage, /activeDays|active days|个活跃日|sessionOverview|Project activity|项目活动/);
    assert.match(projectUsage, /<TaskLoopActivityHeatmap/);
    const projectUsageHeadingStart = template.indexOf('<H2>{taskLoopCopy("Project usage"');
    const projectUsageHeading = template.slice(
      projectUsageHeadingStart,
      template.indexOf("<TaskLoopProjectUsage", projectUsageHeadingStart + 1),
    );
    assert.doesNotMatch(projectUsageHeading, /<IconButton\b/);
    assert.doesNotMatch(template, /usageCoverageInfo|taskLoopUsageCoverageInfo/);
    assert.match(template, /TaskLoopUsageTrends/);
    assert.match(template, /Model session trend/);
    assert.match(template, /model-session observations/);
    assert.match(template, /Model-attributed responses/);
    assert.match(template, /Non-zero usage records/);
    assert.match(template, /TaskLoopModelUsageTable/);
    assert.match(template, /const pageStyle = \{ maxWidth: 960,/);
    assert.match(template, /const taskLoopPageStyle = \{ \.\.\.pageStyle, padding: 20 \}/);
    assert.doesNotMatch(template, /maxWidth: 1200/);
    assert.match(template, /const taskLoopReaderCopyStyle = \{ maxWidth: 940 \}/);
    assert.match(template, /<Grid columns=\{3\} minColumnWidth=\{260\} gap=\{12\} align="start">/);
    assert.match(template, /overflowWrap: "anywhere", textAlign: "right"/);
    assert.match(template, /userThreadCandidateCount/);
    assert.match(template, /exactCreditsAvailable/);
    assert.match(template, /TaskLoopSessionInsights/);
    assert.match(template, /semanticFacets\?\.entries/);
    const longSessionReview = template.slice(
      template.indexOf("function TaskLoopLongSessionReview"),
      template.indexOf("function TaskLoopProjectUsage"),
    );
    assert.match(longSessionReview, /<Stack gap=\{0\}>/);
    assert.match(longSessionReview, /samples\.map/);
    assert.match(longSessionReview, /Review \$\{pendingCount\} sessions/);
    assert.match(longSessionReview, /Estimated active time/);
    assert.equal((longSessionReview.match(/sample\.sessionRef/g) ?? []).length, 0);
    assert.doesNotMatch(longSessionReview, /sample\.(?:userInputSummary|rawSessionId)/);
    assert.doesNotMatch(longSessionReview, /<Grid\b|<Callout\b/);
    const usageMethodology = template.slice(
      template.indexOf("function TaskLoopUsageMethodology"),
      template.indexOf("function usageTrendLeader"),
    );
    assert.doesNotMatch(usageMethodology, /TaskLoopLongSessionReview/);
    const sessionInsightColumns = template.slice(
      template.indexOf("function taskLoopSessionInsightColumns"),
      template.indexOf("function taskLoopSessionInsightDetail"),
    );
    assert.doesNotMatch(sessionInsightColumns, /key: "status"/);
    const sessionInsightsDialog = template.slice(
      template.indexOf("function TaskLoopSessionInsightsDialog"),
      template.indexOf("function TaskLoopSessionInsights()"),
    );
    const sessionInsights = template.slice(
      template.indexOf("function TaskLoopSessionInsights()"),
      template.indexOf("function TaskLoopFindingDialog"),
    );
    assert.match(sessionInsightsDialog, /<Dialog\b/);
    assert.match(sessionInsightsDialog, /density="compact"/);
    assert.match(sessionInsightsDialog, /View all/);
    assert.match(sessionInsights, /representativeEntries/);
    assert.match(sessionInsights, /evidenceCount/);
    assert.match(sessionInsights, /<Grid columns=\{3\} minColumnWidth=\{220\} gap=\{8\} align="stretch">/);
    assert.match(sessionInsights, /<CardBody style=\{\{ padding: 12, height: 142 \}\}>/);
    assert.match(sessionInsights, /WebkitLineClamp: 2/);
    assert.match(sessionInsights, /marginTop: "auto"/);
    assert.doesNotMatch(sessionInsights, /fontSize: 22|padding: "13px 0"/);
    assert.match(template, /slice\(0, 3\)/);
    assert.match(template, /TaskLoopFindingCards/);
    const findingCards = template.slice(
      template.indexOf("function TaskLoopFindingCards"),
      template.indexOf("function TaskLoopEvidenceBoundary"),
    );
    assert.match(findingCards, /<Grid\b/);
    assert.match(findingCards, /columns=\{3\}/);
    assert.match(findingCards, /minColumnWidth=\{300\}/);
    assert.match(findingCards, /align="stretch"/);
    assert.doesNotMatch(template, /findingEvidenceCounts|findingEvidenceReferences|Finding ID|Details and evidence/);
    const findingDialog = template.slice(
      template.indexOf("function TaskLoopFindingDialog"),
      template.indexOf("function TaskLoopFindingCard"),
    );
    const findingCard = template.slice(
      template.indexOf("function TaskLoopFindingCard"),
      template.indexOf("function TaskLoopFindingCards"),
    );
    assert.match(findingCard, /Plan AI Fix/);
    assert.equal((findingCard.match(/WebkitLineClamp: 2/g) ?? []).length, 2);
    assert.match(findingCard, /<CardBody style=\{\{ padding: 14, height: 190 \}\}>/);
    assert.match(findingCard, /style=\{\{ height: "100%" \}\}/);
    assert.match(findingCard, /style=\{\{ marginTop: "auto" \}\}/);
    assert.match(findingCard, /variant="secondary"/);
    assert.match(findingCard, /<TaskLoopFindingDialog row=\{row\}/);
    assert.ok(findingCard.indexOf("SendToChatButton") < findingCard.indexOf("TaskLoopFindingDialog"));
    assert.doesNotMatch(findingCard, /<CollapsibleSection\b/);
    assert.doesNotMatch(findingCard, /<CardHeader\b/);
    assert.doesNotMatch(findingCard, /minHeight: 220|EvidenceReferenceList|evidenceBridge|subdimensionRefs/);
    assert.match(findingDialog, /<Dialog\b/);
    assert.match(findingDialog, /trigger=\{\([\s\S]*<Button variant="ghost">[\s\S]*View details/);
    assert.match(findingDialog, /title=\{row\.title \?\? row\.id\}/);
    assert.doesNotMatch(findingDialog, /description=\{row\.title\}/);
    assert.match(findingDialog, /closeLabel=\{taskLoopCopy\("Close", "关闭"\)\}/);
    assert.match(findingDialog, /Cause[\s\S]*row\.reason[\s\S]*Expected Output[\s\S]*expectedOutput\.map/);
    assert.match(findingDialog, /maxWidth=\{880\}/);
    assert.match(findingDialog, /footer=\{\([\s\S]*Plan AI Fix/);
    assert.doesNotMatch(findingDialog, />\s*\{row\.aiFixPrompt\}\s*</);
    assert.doesNotMatch(findingDialog, /Fix instructions|修复指令/);
    const suggestionComponents = template.slice(
      template.indexOf("function taskLoopSuggestionKindLabel"),
      template.indexOf("function taskLoopDeliveryOutcomeLabel"),
    );
    assert.match(suggestionComponents, /function TaskLoopSuggestionCards/);
    assert.match(suggestionComponents, /minColumnWidth=\{280\}/);
    assert.match(suggestionComponents, /Review suggestion/);
    assert.match(suggestionComponents, /Why this is worth trying/);
    assert.match(suggestionComponents, /row\.nextStep/);
    assert.match(suggestionComponents, /row\.validation/);
    assert.doesNotMatch(suggestionComponents, /SendToChatButton|aiFixPrompt|Plan AI Fix/);
    assert.doesNotMatch(template, /<dialog\b|\bdocument\b|showModal|taskLoopFindingBackdropClick/);
    assert.match(template, /TaskLoopPracticeTable/);
    assert.match(template, /taskLoopCopy\("Agent Customize", "Agent 自定义"\)/);
    assert.match(template, /taskLoopCopy\("Coverage", "覆盖范围"\)/);
    const agentAssets = template.slice(
      template.indexOf("function practiceScopeCell"),
      template.indexOf("function TaskLoopActivityHeatmap"),
    );
    assert.match(agentAssets, /taskLoopPracticeColumns/);
    assert.match(agentAssets, /TaskLoopPracticeTable/);
    assert.match(agentAssets, /PracticeSurfaceIcon/);
    assert.match(agentAssets, /Representative source/);
    assert.match(agentAssets, /View \$\{remaining\.length\} more locations/);
    assert.match(agentAssets, /defaultOpen=\{false\}/);
    assert.match(agentAssets, /<Table\b/);
    assert.match(agentAssets, /density="compact"/);
    assert.match(agentAssets, /renderDetail=\{practiceSourceDetail\}/);
    assert.doesNotMatch(agentAssets, /TaskLoopAgentAssets|TaskLoopDetectedAssetRow|TaskLoopCoverageSummary|Detected assets|fontSize: 30/);
    assert.doesNotMatch(template, /minWidth: 650/);
    assert.match(template, /364 \* 86_400_000/);
    assert.match(template, /weekCount = 53/);
    assert.match(template, /cellSize=\{16\}[\s\S]*columnWidth=\{16\}/);
    assert.match(template, /columnWidth=\{16\}[\s\S]*responsive[\s\S]*minCellSize=\{8\}[\s\S]*minGap=\{2\}[\s\S]*initialScrollPosition="end"/);
    assert.match(template, /ariaLabel: taskLoopCopy\(`\$\{dateKey\}: no observed activity`/);
    assert.match(template, /ariaLabel: taskLoopCopy\(`\$\{date\}: \$\{formatActivityMinutes\(active\)\}`/);
    assert.match(template, /rgba\(24, 115, 63, 0\.9\)/);
    assert.match(template, /border: "transparent"/);
    assert.match(template, /Daily activity \(active minutes\)/);
    assert.match(template, /valueFormatter=\{\(value\) => formatActivityMinutes\(value\)\}/);
    const fluencyTooltip = template.slice(
      template.indexOf("function dimensionFluencyTooltip"),
      template.indexOf("function severityTone"),
    );
    assert.match(fluencyTooltip, /const \[title, \.\.\.rows\] = splitFluencyTooltipReason\(fluencyReason\(row\)\)/);
    assert.doesNotMatch(fluencyTooltip, /subtitle|taskLoopDimensionLabel|stage\.score/);
    assert.doesNotMatch(template, /paths\.join\(" · "\)/);
    assert.match(template, /<AreaChart[\s\S]*height=\{190\}[\s\S]*showYAxis[\s\S]*legendPosition="bottom"/);
    const usageTrend = template.slice(
      template.indexOf("function TaskLoopUsageTrend"),
      template.indexOf("function TaskLoopUsageTrends"),
    );
    assert.match(usageTrend, /<CardBody\b/);
    assert.match(usageTrend, /fontSize: 16/);
    assert.match(usageTrend, /tone="secondary"/);
    assert.match(usageTrend, /tone="tertiary"/);
    assert.match(usageTrend, /leaderDescription/);
    assert.doesNotMatch(usageTrend, /<CardHeader\b|trailing=/);
    const readerOrder = [
      "<TaskLoopReportHeader",
      "<TaskLoopFluency",
      "<TaskLoopProjectUsage",
      "<TaskLoopFindingCards",
      "<TaskLoopSuggestionCards",
      "<TaskLoopPracticeTable",
      "<TaskLoopUsageTrends",
      "<TaskLoopEvidenceBoundary",
    ].map((marker) => template.indexOf(marker));
    assert.ok(readerOrder.every((offset) => offset >= 0));
    assert.deepEqual([...readerOrder].sort((left, right) => left - right), readerOrder);
    assert.doesNotMatch(template, /\bconst\s+window\s*=/);
    assert.match(template, /session-insight:session-usage-efficiency/);
    assert.match(template, /session-insight:session-complexity/);
    assert.match(template, /row\.scopes/);
    assert.match(template, /visiblePracticePaths\(row\.paths\)/);
    const evidenceFact = template.slice(
      template.indexOf("function TaskLoopEvidenceFact"),
      template.indexOf("function TaskLoopEvidenceDetails"),
    );
    const evidenceDecisionBrief = template.slice(
      template.indexOf("function TaskLoopEvidenceBoundary"),
      template.indexOf("function TaskLoopReport", template.indexOf("function TaskLoopEvidenceBoundary") + 1),
    );
    assert.match(evidenceFact, /<Card size="sm">/);
    assert.match(evidenceFact, /<Tag size="sm" tone=\{tone\}>\{value\}<\/Tag>/);
    assert.doesNotMatch(evidenceFact, /fontSize: 22|borderLeft|divided/);
    assert.match(evidenceDecisionBrief, /Evidence and methodology/);
    assert.match(evidenceDecisionBrief, /fontSize: 20/);
    assert.equal((evidenceDecisionBrief.match(/defaultOpen=\{false\}/g) ?? []).length, 1);
    assert.match(evidenceDecisionBrief, /<Callout[\s\S]{0,180}tone="warning"/);
    assert.match(evidenceDecisionBrief, /padding: "10px 12px"/);
    assert.match(evidenceDecisionBrief, /<Grid columns=\{3\} minColumnWidth=\{180\} gap=\{8\} align="stretch">/);
    assert.match(evidenceDecisionBrief, /Sampling confidence/);
    assert.match(evidenceDecisionBrief, /Source gaps/);
    assert.match(evidenceDecisionBrief, /Delivery outcome/);
    assert.match(evidenceDecisionBrief, /TaskLoopLongSessionReview/);
    assert.match(evidenceDecisionBrief, /TaskLoopSessionInsights/);
    assert.match(evidenceDecisionBrief, /View measurement and model details/);
    assert.match(evidenceDecisionBrief, /TaskLoopEvidenceDetails/);

    await writeFixture(canvasPath, template);
    await writeFixture(findingsPath, findingsJsonText());
    await writeFixture(canvasDataPath, '{"schemaVersion":1,"summary":{},"dimensions":[],"findings":[]}\n');

    const result = await validateHarnessCanvasArtifacts({
      canvasPath,
      findingsPath,
      sdkDeclarationsPath,
      preview: false,
      repoRoot: root,
    });

    assert.equal(result.status, "pass", JSON.stringify(result.errors, null, 2));
    assert.equal(result.checks.find((check) => check.id === "canvas-quality")?.status, "pass");
    assert.equal(result.checks.find((check) => check.id === "findings-json")?.status, "pass");
  });
});

test("Canvas merge keeps future-version sidecar capabilities visible", async () => {
  const template = await readFile(path.resolve("templates/canvas/better-harness-insights.canvas.tsx"), "utf8");
  const helperSource = template.slice(
    template.indexOf("function mergeCanvasRows"),
    template.indexOf("const report = mergeCanvasReport"),
  );
  const mergeCanvasReport = runInNewContext(`${helperSource}\nmergeCanvasReport;`);
  const host = {
    summary: {
      modelId: "future-agent-work-loop",
      reportContractVersion: 999,
      dimensions: [{ id: "task-understanding", score: 70 }],
      suggestions: [{ id: "suggestion-1", title: "A host-owned suggestion" }],
    },
    findings: [{ id: "finding-1", title: "A reviewed finding" }],
  };
  const detail = {
    schemaVersion: 1000,
    summary: {
      usageActivity: { schemaVersion: 1001, sessions: { total: 982 } },
      usageEfficiency: { schemaVersion: 1002, selection: { analyzedSessionCount: 982, complete: true } },
    },
    dimensions: [{ id: "task-understanding", evidenceBridge: { state: "exercised" } }],
    findings: [{ id: "finding-1", evidenceBridge: { state: "exercised" } }],
  };

  const merged = mergeCanvasReport(host, detail);
  assert.equal(merged.summary.usageActivity.sessions.total, 982);
  assert.equal(merged.summary.usageEfficiency.selection.analyzedSessionCount, 982);
  assert.equal(merged.summary.dimensions[0].evidenceBridge.state, "exercised");
  assert.deepEqual(merged.summary.suggestions, host.summary.suggestions);
  assert.equal(merged.findings[0].evidenceBridge.state, "exercised");
});

test("validate-canvas CLI resolves relative run paths", async () => {
  await withTempDir("better-harness-canvas-validation-cli-", async (root) => {
    const sdkDeclarationsPath = await writeSdkDeclarations(root);
    await writeFixture(path.join(root, "insights.canvas.tsx"), validCanvas());
    await writeFixture(path.join(root, "findings.json"), findingsJsonText());

    const { stdout } = await execFileAsync(process.execPath, [
      path.resolve("scripts/harness-analysis/validate-canvas.mjs"),
      "--canvas",
      "insights.canvas.tsx",
      "--findings",
      "findings.json",
      "--sdk-declarations",
      sdkDeclarationsPath,
      "--json",
    ], { cwd: root });

    const payload = JSON.parse(stdout);
    const realRoot = await realpath(root);
    assert.equal(payload.status, "pass", JSON.stringify(payload.errors, null, 2));
    assert.equal(await realpath(payload.canvasPath), path.join(realRoot, "insights.canvas.tsx"));
    assert.equal(await realpath(payload.findingsPath), path.join(realRoot, "findings.json"));
  });
});

test("installed-like Canvas validation resolves its transform runtime from --sdk-root", async () => {
  await withTempDir("better-harness-installed-canvas-validation-", async (root) => {
    const installedRoot = path.join(root, "installed-plugin");
    const installedAnalysis = path.join(installedRoot, "scripts", "harness-analysis");
    const sdkRoot = path.join(root, "canvas-sdk");
    const sdkDeclarationsPath = path.join(sdkRoot, "types", "index.d.ts");
    const directRun = path.join(root, "direct-run");
    const directCanvasPath = path.join(directRun, "insights.canvas.tsx");
    const directFindingsPath = path.join(directRun, "findings.json");
    const validatePath = path.join(installedAnalysis, "validate-canvas.mjs");
    const renderPath = path.join(installedAnalysis, "render-report.mjs");

    await cp(path.resolve("scripts/harness-analysis"), installedAnalysis, { recursive: true });
    await cp(path.resolve("scripts/agent-guardrails"), path.join(installedRoot, "scripts", "agent-guardrails"), { recursive: true });
    await cp(path.resolve("scripts/coding-agent-practices/asset-eval"), path.join(installedRoot, "scripts", "coding-agent-practices", "asset-eval"), { recursive: true });
    await cp(path.resolve("scripts/coding-agent-practices/checkup"), path.join(installedRoot, "scripts", "coding-agent-practices", "checkup"), { recursive: true });
    await cp(path.resolve("scripts/session-analysis"), path.join(installedRoot, "scripts", "session-analysis"), { recursive: true });
    await cp(path.resolve("templates/canvas"), path.join(installedRoot, "templates", "canvas"), { recursive: true });
    await writeFixture(path.join(sdkRoot, "package.json"), '{"name":"fixture-canvas-sdk"}\n');
    await writeFixture(sdkDeclarationsPath, 'export { AreaChart, BarChart, Button, Callout, Card, CardBody, CardHeader, CollapsibleSection, Dialog, Divider, Fluency, Grid, IconButton, ImprovementKataCard, LineChart, MetricsGrid, Progress, RiskHeatmap, Row, SendToChatButton, Stack, Table, Tag, Text, useCanvasAction } from "./core.js";\n');
    await writeFixture(path.join(sdkRoot, "node_modules", "esbuild-wasm", "package.json"), '{"main":"index.cjs"}\n');
    await writeFixture(
      path.join(sdkRoot, "node_modules", "esbuild-wasm", "index.cjs"),
      'exports.transformSync = () => ({ code: "sdk-owned transform", map: "" });\n',
    );
    await writeFixture(directCanvasPath, validCanvas());
    await writeFixture(directFindingsPath, findingsJsonText());

    const environment = { ...process.env, NODE_PATH: "" };
    const executableValidatePath = await realpath(validatePath);
    const executableRenderPath = await realpath(renderPath);
    const direct = await execFileAsync(process.execPath, [
      executableValidatePath,
      "--canvas",
      directCanvasPath,
      "--findings",
      directFindingsPath,
      "--repo-root",
      directRun,
      "--sdk-root",
      sdkRoot,
      "--sdk-declarations",
      sdkDeclarationsPath,
      "--json",
    ], { env: environment });
    assert.equal(JSON.parse(direct.stdout).status, "pass", direct.stdout);

    const renderRun = path.join(root, "render-run");
    const rendered = await execFileAsync(process.execPath, [
      executableRenderPath,
      "--findings",
      directFindingsPath,
      "--mode",
      "qoder-canvas",
      "--run-dir",
      renderRun,
      "--target",
      root,
      "--sdk-root",
      sdkRoot,
      "--sdk-declarations",
      sdkDeclarationsPath,
      "--validate",
      "--json",
    ], { env: environment });
    assert.equal(JSON.parse(rendered.stdout).status, "pass", rendered.stdout);
  });
});

test("rejects unsupported legacy findings fields", async () => {
  await withTempDir("better-harness-canvas-validation-legacy-fields-", async (root) => {
    const canvasPath = path.join(root, "insights.canvas.tsx");
    const findingsPath = path.join(root, "findings.json");
    const sdkDeclarationsPath = await writeSdkDeclarations(root);
    const findings = validFindingsJson();

    findings.summary.scoreCaveat = "old field";
    findings.summary.dimensions[0].confidence = "High";
    findings.summary.dimensions[0].summary = "";
    findings.summary.dimensions[1].summary = "Example: describe why this score was assigned.";
    findings.summary.aiAgentPractice.coverageRows[0].evidence = "old field";
    findings.summary.aiAgentPractice.coverageRows[0].status = "Present";
    findings.summary.aiAgentPractice.coverageRows[0].reason = "Legacy observation.";
    findings.summary.aiAgentPractice.coverageRows[0].evaluation = { summary: "Legacy evaluation." };
    findings.findings[0].domain = "engineering-implementation";
    findings.findings[0].evidence = "old field";
    findings.findings[0].recommendation = "old field";
    findings.findings[0].passCheck = "old field";
    findings.findings[0].aiFixLabel = "old field";
    findings.findings[0].quickFix = true;

    await writeFixture(canvasPath, validCanvas());
    await writeFixture(findingsPath, findingsJsonText(findings));

    const result = await validateHarnessCanvasArtifacts({
      canvasPath,
      findingsPath,
      sdkDeclarationsPath,
      preview: false,
      repoRoot: root,
    });

    assert.equal(result.checks.find((check) => check.id === "findings-json")?.status, "fail");
    assert.ok(result.errors.some((error) => /summary has unsupported field: scoreCaveat/i.test(error)));
    assert.ok(result.errors.some((error) => /summary score row 0 has unsupported field: confidence/i.test(error)));
    assert.ok(result.errors.some((error) => /summary score row 0 missing summary/i.test(error)));
    assert.ok(result.errors.some((error) => /summary score row 1 summary must be project-specific/i.test(error)));
    assert.ok(result.errors.some((error) => /coverageRows\[0\] has unsupported field: evidence/i.test(error)));
    assert.ok(result.errors.some((error) => /coverageRows\[0\] has unsupported field: status/i.test(error)));
    assert.ok(result.errors.some((error) => /coverageRows\[0\] has unsupported field: reason/i.test(error)));
    assert.ok(result.errors.some((error) => /coverageRows\[0\] has unsupported field: evaluation/i.test(error)));
    assert.ok(result.errors.some((error) => /findings\[0\] has unsupported field: domain/i.test(error)));
    assert.ok(result.errors.some((error) => /findings\[0\] has unsupported field: aiFixLabel/i.test(error)));
    assert.ok(result.errors.some((error) => /findings\[0\] has unsupported field: quickFix/i.test(error)));
  });
});

test("requires complete AI Fix prompts", async () => {
  await withTempDir("better-harness-canvas-validation-ai-fix-", async (root) => {
    const canvasPath = path.join(root, "insights.canvas.tsx");
    const findingsPath = path.join(root, "findings.json");
    const sdkDeclarationsPath = await writeSdkDeclarations(root);
    const findings = validFindingsJson();

    findings.findings[0].aiFixPrompt = "Draft fix plan";
    findings.findings[1].aiFixPrompt = "/schedule recheck this later";

    await writeFixture(canvasPath, validCanvas());
    await writeFixture(findingsPath, findingsJsonText(findings));

    const result = await validateHarnessCanvasArtifacts({
      canvasPath,
      findingsPath,
      sdkDeclarationsPath,
      preview: false,
      repoRoot: root,
    });

    assert.equal(result.checks.find((check) => check.id === "findings-json")?.status, "fail");
    assert.ok(result.errors.some((error) => /aiFixPrompt must start with \/better-harness or \/schedule/i.test(error)));
    assert.ok(result.errors.some((error) => /schedule aiFixPrompt missing \/better-harness/i.test(error)));
    assert.ok(result.errors.some((error) => /schedule aiFixPrompt missing stop condition/i.test(error)));

    findings.findings[0].aiFixPrompt = `${richAiFixPrompt}\n\n- E1: inspect the linked evidence first.`;
    findings.findings[1].aiFixPrompt = richSchedulePrompt;
    await writeFixture(findingsPath, findingsJsonText(findings));
    const aliasResult = await validateHarnessCanvasArtifacts({
      canvasPath,
      findingsPath,
      sdkDeclarationsPath,
      preview: false,
      repoRoot: root,
    });
    assert.ok(aliasResult.errors.some((error) => /synthetic numbered aliases/i.test(error)));
  });
});

test("rejects bad dimension links", async () => {
  await withTempDir("better-harness-canvas-validation-dimensions-", async (root) => {
    const canvasPath = path.join(root, "insights.canvas.tsx");
    const findingsPath = path.join(root, "findings.json");
    const sdkDeclarationsPath = await writeSdkDeclarations(root);
    const findings = validFindingsJson();

    findings.findings[0].dimensionRefs = ["ci-cd"];
    findings.summary.dimensions[2].findingRefs = [];

    await writeFixture(canvasPath, validCanvas());
    await writeFixture(findingsPath, findingsJsonText(findings));

    const result = await validateHarnessCanvasArtifacts({
      canvasPath,
      findingsPath,
      sdkDeclarationsPath,
      preview: false,
      repoRoot: root,
    });

    assert.equal(result.checks.find((check) => check.id === "findings-json")?.status, "fail");
    assert.ok(result.errors.some((error) => /dimensionRefs contains unknown dimension id: ci-cd/i.test(error)));
  });
});

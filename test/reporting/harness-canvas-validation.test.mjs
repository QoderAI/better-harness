import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { promisify } from "node:util";

import { analyzeCanvasModuleBoundaries } from "../../scripts/harness-analysis/canvas-module-boundaries.mjs";
import { validateHarnessCanvasArtifacts } from "../../scripts/harness-analysis/validate-canvas.mjs";

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
    await cp(path.resolve("scripts/host-support"), path.join(installedRoot, "scripts", "host-support"), { recursive: true });
    await cp(path.resolve("scripts/agent-guardrails"), path.join(installedRoot, "scripts", "agent-guardrails"), { recursive: true });
    await cp(path.resolve("scripts/core-change-watch"), path.join(installedRoot, "scripts", "core-change-watch"), { recursive: true });
    await cp(path.resolve("scripts/coding-agent-practices/asset-eval"), path.join(installedRoot, "scripts", "coding-agent-practices", "asset-eval"), { recursive: true });
    await cp(path.resolve("scripts/coding-agent-practices/checkup"), path.join(installedRoot, "scripts", "coding-agent-practices", "checkup"), { recursive: true });
    await cp(path.resolve("scripts/session-analysis"), path.join(installedRoot, "scripts", "session-analysis"), { recursive: true });
    await cp(path.resolve("scripts/workspace-topology"), path.join(installedRoot, "scripts", "workspace-topology"), { recursive: true });
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

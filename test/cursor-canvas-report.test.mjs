import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { renderCursorCanvasTsx } from "../scripts/harness-analysis/renderers/cursor-canvas.mjs";
import {
  projectTaskLoopReportFacts,
  reconcileTaskLoopFindingLinks,
  splitTaskLoopFindings,
  taskLoopCanvasFromSummaryFacts,
  validateTaskLoopCanvasSplit,
} from "../scripts/harness-analysis/task-loop-report.mjs";
import { buildTaskLoopRepositoryEvidence } from "../scripts/harness-analysis/task-loop-repository-evidence.mjs";
import { buildTaskLoopSourceCandidate } from "../scripts/harness-analysis/task-loop-source.mjs";
import { validateCursorCanvasArtifacts } from "../scripts/harness-analysis/validate-cursor-canvas.mjs";
import {
  CursorSessionAnalyzer,
  readCursorContextUsage,
  workspaceToCursorSlugVariants,
} from "../scripts/session-analysis/platforms/cursor.mjs";

const cliPath = path.join(process.cwd(), "scripts", "better-harness.mjs");
const RAW_ITEM_TEXT = "RAW-PROMPT-TEXT-THAT-MUST-NOT-BE-RETAINED";

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

function canvasesDir(cursorHome, workspace) {
  return path.join(cursorHome, "projects", workspaceToCursorSlugVariants(workspace)[0], "canvases");
}

function nativeSnapshot(workspace, outsidePath) {
  return {
    contextUsage: {
      contextWindowSize: 300_000,
      totalTokensUsed: 60_000,
      composerId: "composer-1",
      contextWindowLabel: "300K",
      categories: [
        { id: "rules", label: "Rules", tokens: 1_000, color: "green" },
        { id: "mcp", label: "MCP", tokens: 2_000, color: "pink" },
        { id: "unused", label: "Unused", tokens: 0, color: "gray" },
      ],
      items: [
        {
          id: "native:rules:1",
          parentId: "group:rules",
          categoryId: "rules",
          label: path.join(workspace, "AGENTS.md"),
          text: RAW_ITEM_TEXT,
          estimatedTokens: 500,
          characterCount: 2_000,
          source: { kind: "file", path: path.join(workspace, "AGENTS.md"), label: "AGENTS" },
        },
        {
          id: "native:mcp:1",
          categoryId: "mcp",
          label: "app-control",
          text: RAW_ITEM_TEXT,
          estimatedTokens: 300,
          characterCount: 1_200,
          source: { kind: "file", path: outsidePath, label: "Outside" },
        },
        {
          id: "native:rules:2",
          categoryId: "rules",
          label: path.join(outsidePath, "deep", "reference.md"),
          estimatedTokens: 10,
          characterCount: 40,
        },
      ],
    },
  };
}

async function cursorScope(cursorHome, workspace) {
  return new CursorSessionAnalyzer().resolveScope({ workspace, home: cursorHome });
}

function reviewedFindingsInput(contextUsage) {
  const input = JSON.parse(readFileSync(
    path.join(process.cwd(), "templates", "reporting", "harness-findings.input.json"),
    "utf8",
  ));
  if (contextUsage) input.summary.contextUsage = contextUsage;
  // Mirror the render pipeline, which reconciles finding links before splitting.
  return reconcileTaskLoopFindingLinks(input);
}

function observedContextUsage(overrides = {}) {
  return {
    schemaVersion: 1,
    status: "observed",
    evidence: "cursor-native-context-usage-canvas",
    capturedAt: "2026-07-30T00:00:00.000Z",
    totalTokensUsed: 60_000,
    contextWindowSize: 300_000,
    percentFull: 20,
    categories: [{ id: "rules", label: "Rules", estimatedTokens: 1_000 }],
    items: [{ id: "item-1", categoryId: "rules", label: "AGENTS", estimatedTokens: 500, characterCount: 2_000 }],
    coverage: { snapshotCount: 1, itemCount: 1, sourceItemCount: 1, truncated: false, rawTextOmitted: true },
    actions: { openAgentId: "composer-1" },
    ...overrides,
  };
}

test("Cursor context usage projects bounded native evidence and omits raw item text", async () => {
  await withTempDir("cursor-context-usage-observed-", async (root) => {
    const workspace = path.join(root, "workspace");
    const outside = path.join(root, "other-repo");
    const cursorHome = path.join(root, ".cursor");
    await mkdir(workspace, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeJson(
      path.join(canvasesDir(cursorHome, workspace), "context-usage-abc.canvas.data.json"),
      nativeSnapshot(workspace, outside),
    );

    const usage = await readCursorContextUsage(await cursorScope(cursorHome, workspace));

    assert.equal(usage.status, "observed");
    assert.equal(usage.schemaVersion, 1);
    assert.equal(usage.evidence, "cursor-native-context-usage-canvas");
    assert.equal(usage.totalTokensUsed, 60_000);
    assert.equal(usage.contextWindowSize, 300_000);
    assert.equal(usage.percentFull, 20);
    assert.equal(usage.actions.openAgentId, "composer-1");

    assert.deepEqual(usage.categories.map((category) => category.id), ["rules", "mcp"]);
    assert.equal(usage.items.length, 3);
    assert.deepEqual(usage.items.map((item) => item.id), ["item-1", "item-2", "item-3"]);
    assert.deepEqual(usage.coverage, {
      itemCount: 3,
      sourceItemCount: 3,
      truncated: false,
      rawTextOmitted: true,
      snapshotCount: 1,
    });

    const serialized = JSON.stringify(usage);
    assert.doesNotMatch(serialized, new RegExp(RAW_ITEM_TEXT, "u"), "raw native item text must never be retained");
    assert.equal(serialized.includes("\"text\":"), false);
    assert.equal(serialized.includes("\"parentId\""), false, "unresolvable native hierarchy must not be carried as dead data");
    assert.equal(usage.items.every((item) => !path.isAbsolute(item.label)), true);
  });
});

test("Cursor context usage admits only workspace-local file sources", async () => {
  await withTempDir("cursor-context-usage-sources-", async (root) => {
    const workspace = path.join(root, "workspace");
    const outside = path.join(root, "other-repo");
    const cursorHome = path.join(root, ".cursor");
    await mkdir(workspace, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeJson(
      path.join(canvasesDir(cursorHome, workspace), "context-usage-abc.canvas.data.json"),
      nativeSnapshot(workspace, outside),
    );

    const usage = await readCursorContextUsage(await cursorScope(cursorHome, workspace));
    const [insideItem, outsideItem, labelOnlyItem] = usage.items;

    assert.deepEqual(insideItem.source, {
      kind: "file",
      path: path.join(workspace, "AGENTS.md"),
      label: "AGENTS",
    });
    assert.equal(insideItem.label, "AGENTS");
    assert.equal(Object.hasOwn(outsideItem, "source"), false, "a file outside the workspace must not become an openFile target");
    assert.equal(outsideItem.label, "app-control");
    assert.equal(Object.hasOwn(labelOnlyItem, "source"), false);
    assert.equal(labelOnlyItem.label, "deep/reference.md", "an absolute label must collapse to bounded parent/base text");
  });
});

test("Cursor context usage reports unobserved without inventing zero usage", async () => {
  await withTempDir("cursor-context-usage-unobserved-", async (root) => {
    const workspace = path.join(root, "workspace");
    const cursorHome = path.join(root, ".cursor");
    await mkdir(workspace, { recursive: true });
    await mkdir(canvasesDir(cursorHome, workspace), { recursive: true });

    const usage = await readCursorContextUsage(await cursorScope(cursorHome, workspace));

    assert.equal(usage.status, "unobserved");
    assert.deepEqual(usage.categories, []);
    assert.deepEqual(usage.items, []);
    assert.equal(usage.coverage.snapshotCount, 0);
    assert.equal(usage.coverage.rawTextOmitted, true);
    assert.equal(usage.actions.openAgentId, null);
    assert.equal(Object.hasOwn(usage, "totalTokensUsed"), false);
    assert.equal(Object.hasOwn(usage, "percentFull"), false);
  });
});

test("Cursor context usage fails closed on a malformed native snapshot", async () => {
  await withTempDir("cursor-context-usage-malformed-", async (root) => {
    const workspace = path.join(root, "workspace");
    const cursorHome = path.join(root, ".cursor");
    await mkdir(workspace, { recursive: true });
    const canvases = canvasesDir(cursorHome, workspace);
    await writeFile(path.join(await mkdirp(canvases), "context-usage-broken.canvas.data.json"), "{ not json");
    await writeJson(path.join(canvases, "context-usage-zero.canvas.data.json"), {
      contextUsage: { contextWindowSize: 0, totalTokensUsed: 0, categories: [], items: [] },
    });

    const usage = await readCursorContextUsage(await cursorScope(cursorHome, workspace));

    assert.equal(usage.status, "unobserved");
    assert.equal(usage.coverage.snapshotCount, 2, "unusable snapshots stay visible as inspected candidates");
    assert.deepEqual(usage.items, []);
  });

  async function mkdirp(dir) {
    await mkdir(dir, { recursive: true });
    return dir;
  }
});

test("Cursor context-usage source presence tracks a snapshot file, not its parent directory", async () => {
  await withTempDir("cursor-context-usage-root-", async (root) => {
    const workspace = path.join(root, "workspace");
    const cursorHome = path.join(root, ".cursor");
    await mkdir(workspace, { recursive: true });
    const canvases = canvasesDir(cursorHome, workspace);
    await mkdir(canvases, { recursive: true });

    const analyzer = new CursorSessionAnalyzer();
    const scope = await cursorScope(cursorHome, workspace);
    const emptyRoots = await analyzer.discoverSourceRoots(scope);
    const emptyRoot = emptyRoots.find((entry) => entry.id === "cursor-context-usage");

    assert.equal(emptyRoot.optional, true);
    assert.equal(emptyRoot.workspaceScoped, true);
    assert.equal(emptyRoot.exists, false, "an empty canvases directory is not Context Usage evidence");
    assert.equal(emptyRoot.path, canvases);

    const snapshotPath = path.join(canvases, "context-usage-abc.canvas.data.json");
    await writeJson(snapshotPath, nativeSnapshot(workspace, path.join(root, "other-repo")));
    const populatedRoots = await analyzer.discoverSourceRoots(scope);
    const populatedRoot = populatedRoots.find((entry) => entry.id === "cursor-context-usage");

    assert.equal(populatedRoot.exists, true);
    assert.equal(populatedRoot.path, snapshotPath, "the source path names the observed snapshot");
  });
});

test("Canvas split validation bounds the Context Usage contract", () => {
  const split = splitTaskLoopFindings(reviewedFindingsInput(observedContextUsage()));
  assert.equal(Object.hasOwn(split.findings.summary, "contextUsage"), false);
  assert.deepEqual(validateTaskLoopCanvasSplit(split.findings, split.canvas), []);

  const withDeadHierarchy = structuredClone(split.canvas);
  withDeadHierarchy.summary.contextUsage.items[0].parentId = "item-0";
  assert.match(
    validateTaskLoopCanvasSplit(split.findings, withDeadHierarchy).join("; "),
    /contextUsage\.items\[0\] has unsupported field: parentId/u,
  );

  const withRawText = structuredClone(split.canvas);
  withRawText.summary.contextUsage.items[0].text = RAW_ITEM_TEXT;
  assert.match(
    validateTaskLoopCanvasSplit(split.findings, withRawText).join("; "),
    /contextUsage\.items\[0\] has unsupported field: text/u,
  );

  const withoutOmissionClaim = structuredClone(split.canvas);
  withoutOmissionClaim.summary.contextUsage.coverage.rawTextOmitted = false;
  assert.match(
    validateTaskLoopCanvasSplit(split.findings, withoutOmissionClaim).join("; "),
    /contextUsage\.coverage\.rawTextOmitted must be true/u,
  );

  const unobservedWithClaims = structuredClone(split.canvas);
  unobservedWithClaims.summary.contextUsage.status = "unobserved";
  assert.match(
    validateTaskLoopCanvasSplit(split.findings, unobservedWithClaims).join("; "),
    /unobserved snapshots must not contain category or item claims/u,
  );

  const relativeSource = structuredClone(split.canvas);
  relativeSource.summary.contextUsage.items[0].source = { kind: "file", path: "AGENTS.md" };
  assert.match(
    validateTaskLoopCanvasSplit(split.findings, relativeSource).join("; "),
    /contextUsage\.items\[0\]\.source must identify an absolute local file/u,
  );
});

test("Cursor Canvas renderer embeds the merged report behind the public SDK surface", () => {
  const split = splitTaskLoopFindings(reviewedFindingsInput(observedContextUsage()));
  const source = renderCursorCanvasTsx({
    summary: { ...split.findings.summary, ...split.canvas.summary },
    findings: split.findings.findings,
    target: "/workspace/example",
  });

  assert.equal(source.includes("__BETTER_HARNESS_REPORT__"), false, "the data placeholder must be replaced");
  assert.match(source, /from "cursor\/canvas"/u);
  assert.equal(source.includes("qoder/canvas"), false);
  assert.match(source, /"contextUsage":\{"schemaVersion":1,"status":"observed"/u);
  for (const section of ["FluencyDimensions", "ProjectUsage", "AgentPractice", "ContextWindow", "Findings", "EvidenceAndMethodology"]) {
    assert.match(source, new RegExp(`function ${section}`, "u"));
  }
  for (const action of ["newComposerChat", "openFile", "openAgent"]) {
    assert.match(source, new RegExp(`type: "${action}"`, "u"));
  }
});

test("Cursor Canvas validation passes a rendered bundle and rejects a foreign SDK import", async () => {
  await withTempDir("cursor-canvas-validate-", async (root) => {
    const split = splitTaskLoopFindings(reviewedFindingsInput(observedContextUsage()));
    const canvasPath = path.join(root, "report.canvas.tsx");
    const findingsPath = path.join(root, "findings.json");
    const canvasDataPath = path.join(root, "canvas.json");
    await writeJson(findingsPath, split.findings);
    await writeJson(canvasDataPath, split.canvas);
    const source = renderCursorCanvasTsx({
      summary: { ...split.findings.summary, ...split.canvas.summary },
      findings: split.findings.findings,
      target: "/workspace/example",
    });
    await writeFile(canvasPath, source);

    const passing = await validateCursorCanvasArtifacts({ canvasPath, findingsPath, canvasDataPath });
    assert.equal(passing.status, "pass", passing.errors.join("; "));
    assert.deepEqual(passing.checks.map((entry) => entry.id), [
      "cursor-canvas-inputs",
      "cursor-canvas-data",
      "cursor-canvas-boundaries",
      "cursor-canvas-content",
      "cursor-canvas-transform",
    ]);
    const dataCheck = passing.checks.find((entry) => entry.id === "cursor-canvas-data");
    assert.equal(dataCheck.summary.contextUsageStatus, "observed");

    await writeFile(canvasPath, source.replace("cursor/canvas", "qoder/canvas"));
    const failing = await validateCursorCanvasArtifacts({ canvasPath, findingsPath, canvasDataPath });
    assert.equal(failing.status, "fail");
    assert.match(failing.errors.join("; "), /must not import qoder\/canvas/u);
    assert.match(failing.errors.join("; "), /must import cursor\/canvas/u);
  });
});

// Build the analyzer-owned companion the way the Cursor scan does: source
// candidate -> exact summary facts -> canvas.json.
function analyzerCanvasWithContextUsage(workspace) {
  const repositoryEvidence = buildTaskLoopRepositoryEvidence({
    trackedFiles: ["AGENTS.md", "package.json", "test/a.test.mjs"],
    packageManifest: { scripts: { test: "node --test" } },
  });
  const source = buildTaskLoopSourceCandidate({
    scope: { platform: "cursor", workspace },
    selection: { strategy: "latest-n", eligibleCount: 0, analyzedCount: 0, strata: [] },
    events: [],
    repositoryEvidence,
    contextUsage: observedContextUsage(),
  });
  return taskLoopCanvasFromSummaryFacts(projectTaskLoopReportFacts(source));
}

test("render --mode cursor-canvas merges analyzer Context Usage into exactly three artifacts", async () => {
  await withTempDir("cursor-canvas-render-", async (root) => {
    const target = path.join(root, "workspace");
    await mkdir(target, { recursive: true });
    const runInput = path.join(root, "input");
    const split = splitTaskLoopFindings(reviewedFindingsInput());
    await writeJson(path.join(runInput, "findings.json"), split.findings);
    await writeJson(path.join(runInput, "canvas.json"), analyzerCanvasWithContextUsage(target));

    const outRoot = path.join(root, "out");
    const result = spawnSync(process.execPath, [
      cliPath, "harness", "render",
      "--findings", path.join(runInput, "findings.json"),
      "--mode", "cursor-canvas",
      "--out", outRoot,
      "--run-dir", "run-1",
      "--target", target,
      "--validate",
      "--json",
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.validation.status, "pass", JSON.stringify(payload.validation.errors));
    assert.deepEqual(payload.artifacts.map((entry) => entry.name).sort(), [
      "canvas.json",
      "findings.json",
      "report.canvas.tsx",
    ]);
    assert.deepEqual(
      (await readdir(path.join(outRoot, "run-1"))).sort(),
      ["canvas.json", "findings.json", "report.canvas.tsx"],
    );

    const merged = JSON.parse(readFileSync(path.join(outRoot, "run-1", "canvas.json"), "utf8"));
    assert.equal(merged.summary.contextUsage.status, "observed");
    assert.equal(merged.summary.contextUsage.totalTokensUsed, 60_000);
    const tsx = readFileSync(path.join(outRoot, "run-1", "report.canvas.tsx"), "utf8");
    assert.match(tsx, /"contextUsage":\{"schemaVersion":1,"status":"observed"/u);
    assert.equal(tsx.includes("__BETTER_HARNESS_REPORT__"), false);
  });
});

test("render rejects a Cursor Canvas mode that is not part of the mode contract", () => {
  const result = spawnSync(process.execPath, [
    cliPath, "harness", "render",
    "--findings", path.join(process.cwd(), "templates", "reporting", "harness-findings.input.json"),
    "--mode", "cursor-canvas-legacy",
    "--out", path.join(os.tmpdir(), "cursor-canvas-unsupported"),
    "--target", process.cwd(),
    "--json",
  ], { encoding: "utf8" });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /cursor-canvas/u);
});

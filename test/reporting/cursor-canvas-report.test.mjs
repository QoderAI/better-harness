import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "vitest";

import { renderCursorCanvasTsx } from "../../scripts/harness-analysis/renderers/cursor-canvas.mjs";
import {
  projectTaskLoopReportFacts,
  reconcileTaskLoopFindingLinks,
  splitTaskLoopFindings,
  taskLoopCanvasFromSummaryFacts,
  validateTaskLoopCanvasSplit,
} from "../../scripts/harness-analysis/task-loop-report.mjs";
import { buildTaskLoopRepositoryEvidence } from "../../scripts/harness-analysis/task-loop-repository-evidence.mjs";
import { buildTaskLoopSourceCandidate } from "../../scripts/harness-analysis/task-loop-source.mjs";
import { validateCursorCanvasArtifacts } from "../../scripts/harness-analysis/validate-cursor-canvas.mjs";
import {
  CursorSessionAnalyzer,
  defaultCursorStateDbPath,
  readCursorContextUsage,
  workspaceToCursorSlugVariants,
} from "../../scripts/session-analysis/platforms/cursor.mjs";

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

async function writeCursorStateDb(filePath, { composers = [], models = [] } = {}) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  try {
    db.exec(`
      create table cursorDiskKV (key text primary key, value text);
      create table composerHeaders (
        composerId text primary key,
        workspaceId text,
        createdAt integer,
        lastUpdatedAt integer,
        value text
      );
      create table ItemTable (key text primary key, value text);
    `);
    db.prepare("insert into ItemTable (key, value) values (?, ?)").run(
      "src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl.persistentStorage.applicationUser",
      JSON.stringify({ availableDefaultModels2: models }),
    );
    const insertData = db.prepare("insert into cursorDiskKV (key, value) values (?, ?)");
    const insertHeader = db.prepare(`
      insert into composerHeaders (composerId, workspaceId, createdAt, lastUpdatedAt, value)
      values (?, ?, ?, ?, ?)
    `);
    for (const composer of composers) {
      insertData.run(`composerData:${composer.id}`, JSON.stringify(composer.data));
      insertHeader.run(
        composer.id,
        composer.workspaceId ?? "workspace-id",
        composer.createdAt,
        composer.lastUpdatedAt,
        JSON.stringify({
          composerId: composer.id,
          workspaceIdentifier: { uri: { fsPath: composer.workspace } },
        }),
      );
    }
  } finally {
    db.close();
  }
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

test("Cursor composer state reproduces the current native breakdown and model-catalog window", async () => {
  await withTempDir("cursor-composer-context-", async (root) => {
    const workspace = path.join(root, "workspace");
    const otherWorkspace = path.join(root, "other-workspace");
    const cursorHome = path.join(root, ".cursor");
    const stateDbPath = path.join(root, "Cursor", "User", "globalStorage", "state.vscdb");
    const sessionId = "6c6b3fe1-6ba5-4f39-93c4-364535eb78c0";
    const promptSecret = "RAW-COMPOSER-PROMPT-MUST-NOT-LEAK";
    await mkdir(workspace, { recursive: true });
    await writeCursorStateDb(stateDbPath, {
      models: [{ name: "grok-4.6", contextTokenLimit: 256_000 }],
      composers: [
        {
          id: "other-composer",
          workspace: otherWorkspace,
          createdAt: Date.parse("2026-07-02T13:10:00.000Z"),
          lastUpdatedAt: Date.parse("2026-07-02T13:12:00.000Z"),
          data: {
            modelConfig: { modelName: "grok-4.6" },
            promptTokenBreakdown: { totalUsedTokens: 199_999, maxTokens: 200_000, categories: [] },
          },
        },
        {
          id: sessionId,
          workspace,
          createdAt: Date.parse("2026-07-02T11:50:12.000Z"),
          lastUpdatedAt: Date.parse("2026-07-02T13:01:01.027Z"),
          data: {
            modelConfig: { modelName: "grok-4.6" },
            contextUsagePercent: 61.384,
            promptTokenBreakdown: {
              totalUsedTokens: 122_768,
              maxTokens: 200_000,
              categories: [
                { id: "system_prompt", label: "System prompt", estimatedTokens: 822 },
                { id: "tools", label: "Tool definitions", estimatedTokens: 14_143 },
                { id: "rules", label: "Rules", estimatedTokens: 6_851 },
                { id: "skills", label: "Skills", estimatedTokens: 6_635 },
                { id: "mcp", label: "MCP", estimatedTokens: 4_983 },
                { id: "subagents", label: "Subagent definitions", estimatedTokens: 1_440 },
                { id: "summarized_conversation", label: "Summarized conversation", estimatedTokens: 0 },
                { id: "conversation", label: "Conversation", estimatedTokens: 87_894 },
              ],
            },
            promptContextUsageTree: { nodes: [{ text: promptSecret, estimatedTokens: 122_768 }] },
          },
        },
      ],
    });

    const analyzer = new CursorSessionAnalyzer();
    const scope = await analyzer.resolveScope({ workspace, home: cursorHome, stateDbPath, sessionId });
    const usage = await readCursorContextUsage(scope);

    assert.equal(usage.status, "observed");
    assert.equal(usage.evidence, "cursor-native-composer-state");
    assert.equal(usage.actions.openAgentId, sessionId);
    assert.equal(usage.capturedAt, "2026-07-02T13:01:01.027Z");
    assert.equal(usage.totalTokensUsed, 122_768);
    assert.equal(usage.contextWindowSize, 256_000, "the current model catalog wins over composer maxTokens");
    assert.equal(usage.percentFull, 48);
    assert.deepEqual(usage.categories.map((category) => category.id), [
      "system_prompt", "tools", "rules", "skills", "mcp", "subagents", "conversation",
    ]);
    assert.equal(usage.categories.reduce((sum, category) => sum + category.estimatedTokens, 0), 122_768);
    assert.deepEqual(usage.items, []);
    assert.equal(JSON.stringify(usage).includes(promptSecret), false);
    assert.equal(JSON.stringify(usage).includes(workspace), false);
    assert.equal(JSON.stringify(usage).includes(stateDbPath), false);
  });
});

test("Cursor state database paths use target-platform path semantics", () => {
  assert.equal(
    defaultCursorStateDbPath({ platform: "darwin", homedir: "/Users/example", env: {} }),
    "/Users/example/Library/Application Support/Cursor/User/globalStorage/state.vscdb",
  );
  assert.equal(
    defaultCursorStateDbPath({ platform: "linux", homedir: "/home/example", env: { XDG_CONFIG_HOME: "/config" } }),
    "/config/Cursor/User/globalStorage/state.vscdb",
  );
  assert.equal(
    defaultCursorStateDbPath({ platform: "win32", homedir: "C:\\Users\\example", env: { APPDATA: "D:\\Profiles\\Roaming" } }),
    "D:\\Profiles\\Roaming\\Cursor\\User\\globalStorage\\state.vscdb",
  );
});

test("Cursor Session discovery prefers composer state and excludes an older Canvas", async () => {
  await withTempDir("cursor-composer-precedence-", async (root) => {
    const workspace = path.join(root, "workspace");
    const cursorHome = path.join(root, ".cursor");
    const stateDbPath = path.join(root, "Cursor", "User", "globalStorage", "state.vscdb");
    const sessionId = "77777777-7777-4777-8777-777777777777";
    const slug = workspaceToCursorSlugVariants(workspace)[0];
    await writeJson(
      path.join(cursorHome, "projects", slug, "agent-transcripts", sessionId, `${sessionId}.jsonl`),
      { role: "user", message: { content: [{ type: "text", text: "Inspect usage" }] } },
    );
    const canvasPath = path.join(canvasesDir(cursorHome, workspace), "context-usage-old.canvas.data.json");
    await writeJson(canvasPath, {
      contextUsage: {
        composerId: sessionId,
        totalTokensUsed: 56_860,
        contextWindowSize: 300_000,
        categories: [{ id: "conversation", label: "Conversation", tokens: 7_532 }],
        items: [],
      },
    });
    await utimes(canvasPath, new Date("2026-07-02T11:51:30.000Z"), new Date("2026-07-02T11:51:30.000Z"));
    await writeCursorStateDb(stateDbPath, {
      models: [{ name: "grok-4.6", contextTokenLimit: 256_000 }],
      composers: [{
        id: sessionId,
        workspace,
        createdAt: Date.parse("2026-07-02T11:50:12.000Z"),
        lastUpdatedAt: Date.parse("2026-07-02T13:01:01.027Z"),
        data: {
          modelConfig: { modelName: "grok-4.6" },
          promptTokenBreakdown: {
            totalUsedTokens: 122_768,
            maxTokens: 200_000,
            categories: [{ id: "conversation", label: "Conversation", estimatedTokens: 122_768 }],
          },
        },
      }],
    });

    const analyzer = new CursorSessionAnalyzer();
    const scope = await analyzer.resolveScope({ workspace, home: cursorHome, stateDbPath });
    const roots = await analyzer.discoverSourceRoots(scope);
    const sessions = await analyzer.discoverSessions(scope, roots);
    const session = sessions.find((candidate) => candidate.sessionId === sessionId);
    const events = await analyzer.readSession(session, scope, {});
    const contexts = events.filter((event) => event.type === "context.usage");

    assert.deepEqual(session.sourceKinds.filter((kind) => kind.includes("context") || kind.includes("composer")), [
      "cursor-composer-state",
    ]);
    assert.equal(contexts.length, 1);
    assert.equal(contexts[0].sourceKind, "cursor-composer-state");
    assert.deepEqual(contexts[0].currentContextUsage, {
      usedTokens: 122_768,
      windowTokens: 256_000,
      percentFull: 48,
      basis: "host-context-snapshot",
      source: "cursor-native-composer-state",
      rawTextOmitted: true,
    });
  });
});

test("Cursor Session discovery does not present an older Canvas as current context", async () => {
  await withTempDir("cursor-canvas-stale-", async (root) => {
    const workspace = path.join(root, "workspace");
    const cursorHome = path.join(root, ".cursor");
    const sessionId = "88888888-8888-4888-8888-888888888888";
    const slug = workspaceToCursorSlugVariants(workspace)[0];
    await writeJson(
      path.join(cursorHome, "projects", slug, "agent-transcripts", sessionId, `${sessionId}.jsonl`),
      { role: "user", message: { content: [{ type: "text", text: "Continue after snapshot" }] } },
    );
    const canvasPath = path.join(canvasesDir(cursorHome, workspace), "context-usage-stale.canvas.data.json");
    await writeJson(canvasPath, {
      contextUsage: {
        composerId: sessionId,
        totalTokensUsed: 56_860,
        contextWindowSize: 300_000,
        categories: [{ id: "conversation", label: "Conversation", tokens: 56_860 }],
        items: [],
      },
    });
    await utimes(canvasPath, new Date("2026-07-02T11:51:30.000Z"), new Date("2026-07-02T11:51:30.000Z"));
    await writeJson(path.join(cursorHome, "chats", "hash", sessionId, "meta.json"), {
      schemaVersion: 1,
      cwd: workspace,
      createdAtMs: Date.parse("2026-07-02T11:50:12.000Z"),
      updatedAtMs: Date.parse("2026-07-02T13:01:01.027Z"),
      hasConversation: true,
    });

    const analyzer = new CursorSessionAnalyzer();
    const scope = await analyzer.resolveScope({ workspace, home: cursorHome });
    const roots = await analyzer.discoverSourceRoots(scope);
    const sessions = await analyzer.discoverSessions(scope, roots);
    const session = sessions.find((candidate) => candidate.sessionId === sessionId);
    const events = await analyzer.readSession(session, scope, {});

    assert.equal(session.sourceKinds.includes("cursor-context-usage-canvas"), false);
    assert.equal(events.some((event) => event.type === "context.usage"), false);
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

test("Cursor context usage never borrows a Canvas from another requested Session", async () => {
  await withTempDir("cursor-context-usage-session-isolation-", async (root) => {
    const workspace = path.join(root, "workspace");
    const cursorHome = path.join(root, ".cursor");
    await mkdir(workspace, { recursive: true });
    await writeJson(
      path.join(canvasesDir(cursorHome, workspace), "context-usage-other.canvas.data.json"),
      {
        contextUsage: {
          composerId: "other-session",
          totalTokensUsed: 60_000,
          contextWindowSize: 256_000,
          categories: [{ id: "conversation", label: "Conversation", tokens: 60_000 }],
          items: [],
        },
      },
    );

    const analyzer = new CursorSessionAnalyzer();
    const scope = await analyzer.resolveScope({
      workspace,
      home: cursorHome,
      sessionId: "requested-session",
    });
    const usage = await readCursorContextUsage(scope);

    assert.equal(usage.status, "unobserved");
    assert.equal(usage.actions.openAgentId, null);
    assert.deepEqual(usage.categories, []);
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

  const composerState = splitTaskLoopFindings(reviewedFindingsInput(observedContextUsage({
    evidence: "cursor-native-composer-state",
    items: [],
    coverage: { snapshotCount: 1, itemCount: 0, sourceItemCount: 0, truncated: false, rawTextOmitted: true },
  })));
  assert.deepEqual(validateTaskLoopCanvasSplit(composerState.findings, composerState.canvas), []);
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

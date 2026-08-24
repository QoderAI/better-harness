import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { onTestFinished, test } from "vitest";

import {
  ASSET_BASELINE_KIND,
  MAX_BASELINE_FINDINGS,
  MAX_BASELINE_OWNER_ROUTES,
  collectAssetBaseline,
  formatAssetBaselineMarkdown,
} from "../../scripts/coding-agent-practices/asset-baseline.mjs";

const cliPath = path.resolve("scripts/better-harness.mjs");

async function temporaryWorkspace(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  const workspace = path.join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  return { root, workspace };
}

function emptyBaselineDependencies(onRawInventory = () => {}) {
  return {
    collectRawInventory: async (options) => {
      onRawInventory(options);
      return {};
    },
    runLint: async () => ({ kind: "agent-lint", profile: "agent-assets-review", summary: {}, findings: [] }),
    collectPublicInventory: async (options) => ({
      scope: {
        platform: options.provider,
        includeUserHome: options.includeUserHome,
        includeMemories: options.includeMemories,
      },
      summary: { practiceCoverageRows: [] },
      surfaces: [],
      memories: { included: options.includeMemories, categories: [] },
      warnings: [],
    }),
    reviewIntegrity: () => ({
      kind: "asset-integrity-review",
      profile: "asset-integrity-review",
      status: "reviewed",
      summary: { findingCount: 0 },
      findings: [],
    }),
  };
}

function findings(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `finding-${String(index).padStart(2, "0")}`,
    severity: index % 3 === 0 ? "warning" : "advisory",
    assetKind: "skill",
    assetName: `skill-${index}`,
    evidence: `bounded evidence ${index}`,
    recommendation: `large repair prose that must not enter the compact envelope ${index}`,
  }));
}

test("asset baseline shares one inventory snapshot and emits compact AI envelopes", async () => {
  const rawInventory = { marker: "shared-raw-inventory" };
  let rawCalls = 0;
  let rawOptions;
  let lintOptions;
  let inventoryOptions;
  let lintInventory;
  let publicInventory;
  const { workspace } = await temporaryWorkspace("better-harness-baseline-project-");
  const result = await collectAssetBaseline({
    provider: "codex",
    workspace,
    cwd: workspace,
    includeMemories: true,
    language: "en",
  }, {
    collectRawInventory: async (options) => {
      rawCalls += 1;
      rawOptions = options;
      return rawInventory;
    },
    runLint: async (options) => {
      lintOptions = options;
      lintInventory = options.inventory;
      return {
        kind: "agent-lint",
        profile: "agent-assets-review",
        summary: { findings: 20, errors: 0, warnings: 7, advisories: 13 },
        graph: { privateAndLarge: true },
        assetInventory: { provider: "codex", summary: { skills: 20 } },
        findings: findings(20),
      };
    },
    collectPublicInventory: async (options) => {
      inventoryOptions = options;
      publicInventory = options.inventory;
      return {
        scope: { platform: "codex", includeUserHome: false },
        summary: {
          total: 4,
          practiceCoverageRows: [{ surface: "Skills", scopes: ["Project"], count: 1, paths: ["skills/review/SKILL.md"] }],
        },
        surfaces: [
          {
            type: "skills",
            scope: "workspace",
            items: [{ name: "review", scope: "workspace", path: path.join(options.workspace, "skills/review/SKILL.md") }],
          },
          {
            type: "plugins",
            scope: "plugin",
            items: [{ name: "delivery", scope: "plugin", version: "1.0.0" }],
          },
          {
            type: "agents",
            scope: "plugin",
            items: Array.from({ length: 30 }, (_, index) => ({ name: `agent-${index}`, scope: "plugin" })),
          },
        ],
        memories: {
          included: true,
          contentPolicy: "raw-memory-content-not-read",
          categories: [
            { category: ".git", count: 50, titleEntries: [] },
            { category: "project", count: 2, titleEntries: [{ title: "private title only", path: "one.md" }] },
          ],
        },
        warnings: [],
      };
    },
    reviewIntegrity: () => ({
      kind: "asset-integrity-review",
      profile: "asset-integrity-review",
      status: "reviewed",
      contentPolicy: "memory-title-and-path-metadata-only",
      summary: { findingCount: 20 },
      findings: findings(20),
    }),
  });

  const canonicalWorkspace = await realpath(workspace);
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.scope.cwd, canonicalWorkspace);
  assert.equal(rawCalls, 1);
  assert.equal(rawOptions.cwd, canonicalWorkspace);
  assert.equal(lintOptions.cwd, canonicalWorkspace);
  assert.equal(inventoryOptions.cwd, canonicalWorkspace);
  assert.equal(lintInventory, rawInventory);
  assert.equal(publicInventory, rawInventory);
  assert.equal(result.kind, ASSET_BASELINE_KIND);
  assert.equal(result.status, "partial");
  assert.equal(result.diagnostics.sharedInventorySnapshot, true);
  assert.equal(result.diagnostics.compact, true);
  assert.equal(result.envelopes.lint.data.findings.items.length, MAX_BASELINE_FINDINGS);
  assert.equal(result.envelopes.lint.data.findings.omitted, 4);
  assert.equal(result.envelopes.lint.data.findings.truncated, true);
  assert.equal(result.envelopes.integrity.data.findings.omitted, 4);
  assert.deepEqual(result.envelopes.inventory.data.ownerRoutes.items[0], {
    kind: "skills",
    scope: "workspace",
    name: "review",
    route: "skills/review/SKILL.md",
  });
  assert.equal(result.envelopes.inventory.data.memories.titleCount, 1);
  assert.deepEqual(result.envelopes.inventory.data.memories.categories, [{ category: "project", count: 1 }]);
  assert.equal(result.envelopes.inventory.data.ownerRoutes.items.some((item) => item.kind === "plugins"), true);
  assert.equal(result.envelopes.inventory.data.ownerRoutes.items.some((item) => item.kind === "agents"), true);
  assert.equal(result.envelopes.inventory.data.ownerRoutes.omitted, 16);
  assert.equal(result.envelopes.inventory.data.ownerRoutes.truncated, true);
  assert.deepEqual(result.diagnostics.truncatedStages, [
    "lint-findings",
    "integrity-findings",
  ]);
  assert.deepEqual(result.diagnostics.sampledStages, ["inventory-owner-routes"]);
  assert.equal(Object.hasOwn(result.envelopes.inventory.data.summary, "practiceCoverageRows"), false);
  const serialized = JSON.stringify(result);
  assert.ok(Buffer.byteLength(serialized) < 12_000, "fixture baseline must stay compact for AI reading");
  assert.doesNotMatch(serialized, /privateAndLarge|large repair prose|recommendation/u);
  assert.doesNotMatch(serialized, /private title only/u);
});

test("DeepSeek Harness baseline freezes cwd and exposes only compact configured provenance", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-dsh-baseline-"));
  onTestFinished(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const repository = path.join(root, "repository");
  const workspace = path.join(repository, "packages", "api");
  const cwd = path.join(workspace, "src");
  const dshHome = path.join(root, "isolated-dsh-home");
  const skillDirectory = path.join(repository, ".dsh", "skills", "project-review");
  await mkdir(path.join(repository, ".git"), { recursive: true });
  await mkdir(cwd, { recursive: true });
  await mkdir(dshHome, { recursive: true });
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(path.join(repository, "AGENTS.md"), "repository instruction canary\n", "utf8");
  await writeFile(path.join(workspace, "AGENTS.md"), "workspace instruction canary\n", "utf8");
  await writeFile(path.join(cwd, "AGENTS.local.md"), "nested instruction canary\n", "utf8");
  await writeFile(
    path.join(skillDirectory, "SKILL.md"),
    "---\nname: project-review\ndescription: Project review skill\n---\nsecret skill body canary\n",
    "utf8",
  );

  const result = await collectAssetBaseline({
    provider: "dsh",
    workspace,
    cwd,
    dshHome,
    includeUserHome: false,
  });

  assert.equal(result.schemaVersion, 2);
  assert.deepEqual(result.scope, {
    provider: "dsh",
    workspace: await realpath(workspace),
    cwd: await realpath(cwd),
    includeUserHome: false,
    includeMemories: false,
  });
  const { collectedAt, ...configuredSnapshot } = result.configuredSnapshot;
  assert.equal(typeof collectedAt, "string");
  assert.deepEqual(configuredSnapshot, {
    evidenceKind: "configured-not-observed",
    configurationSource: "caller-overrides",
    userHomeCollection: "not-authorized",
    instructionCollection: "enabled",
    qualification: {
      provider: "dsh",
      version: "0.1.1-rc.2",
      sourceSha: "b150a551b8d465e31e418e1b2eaf5e79bbb7d28e",
    },
    runtimeResolution: {
      cordis: false,
      profile: false,
      preset: false,
      runtimeSkills: false,
    },
  });
  assert.equal(result.status, "complete");
  assert.ok(result.envelopes.inventory.data.coverageRows.length >= 2);
  assert.match(JSON.stringify(result), /AGENTS\.local\.md/u);
  assert.doesNotMatch(
    JSON.stringify(result),
    /instruction canary|secret skill body canary|configurationDigest|contentDigest|shadowedSkills|skippedSkills|instructionDecisions|symlinkTarget/u,
  );
});

test("asset baseline canonicalizes direct configured scope before inventory collection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-baseline-cwd-"));
  const workspace = path.join(root, "workspace");
  const dotted = path.join(workspace, "..valid-child", "nested");
  const outside = path.join(root, "outside");
  const escape = path.join(workspace, "escape");
  try {
    await Promise.all([mkdir(dotted, { recursive: true }), mkdir(outside)]);
    await symlink(outside, escape, "dir");

    let received;
    const omitted = await collectAssetBaseline(
      { provider: "codex", workspace },
      emptyBaselineDependencies((options) => { received = options; }),
    );
    assert.equal(omitted.scope.workspace, await realpath(workspace));
    assert.equal(omitted.scope.cwd, omitted.scope.workspace);
    assert.equal(received.cwd, omitted.scope.cwd);

    const nested = await collectAssetBaseline(
      { provider: "codex", workspace, cwd: dotted },
      emptyBaselineDependencies((options) => { received = options; }),
    );
    assert.equal(nested.scope.cwd, await realpath(dotted));
    assert.equal(received.cwd, nested.scope.cwd);

    for (const cwd of [outside, escape, path.join(workspace, "missing")]) {
      await assert.rejects(
        collectAssetBaseline({ provider: "codex", workspace, cwd }, emptyBaselineDependencies()),
        (error) => error?.code === (cwd.endsWith("missing")
          ? "INVALID_CONFIGURED_CWD"
          : "CONFIGURED_CWD_OUTSIDE_WORKSPACE"),
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("DSH baseline never advertises unsupported Memory collection", async () => {
  const { workspace } = await temporaryWorkspace("better-harness-dsh-memory-scope-");
  const defaults = await collectAssetBaseline(
    { provider: "dsh", workspace },
    emptyBaselineDependencies(),
  );
  const explicitFalse = await collectAssetBaseline(
    { provider: "dsh", workspace, includeMemories: false },
    emptyBaselineDependencies(),
  );
  assert.equal(defaults.scope.includeMemories, false);
  assert.equal(explicitFalse.scope.includeMemories, false);
  await assert.rejects(
    collectAssetBaseline(
      { provider: "dsh", workspace, includeMemories: true },
      emptyBaselineDependencies(),
    ),
    (error) => error?.code === "UNSUPPORTED_DSH_MEMORY_COLLECTION",
  );

  const codex = await collectAssetBaseline(
    { provider: "codex", workspace, includeMemories: true },
    emptyBaselineDependencies(),
  );
  assert.equal(codex.scope.includeMemories, true);
});

test("asset baseline compacts finding, coverage, owner, and free-text paths to stable locators", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-baseline-locators-"));
  onTestFinished(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const gitRoot = path.join(root, "repository");
  const workspace = path.join(gitRoot, "packages", "api");
  const userHome = path.join(root, "synthetic-home");
  const outside = path.join(root, "outside", "private.txt");
  const escape = path.join(workspace, "escape-to-outside");
  await mkdir(workspace, { recursive: true });
  await mkdir(userHome, { recursive: true });
  await mkdir(path.dirname(outside), { recursive: true });
  await writeFile(outside, "synthetic off-tree content\n", "utf8");
  await symlink(outside, escape, "file");

  const rawInventory = (selectedWorkspace) => ({
    provider: "codex",
    workspace: selectedWorkspace,
    plugins: [],
    manage: {
      plugins: [], mcps: [], skills: [], subagents: [], rules: [], commands: [], hooks: [],
    },
    diagnostics: {},
  });
  const pathSamples = [
    workspace,
    path.join(workspace, "skill.md"),
    path.join(gitRoot, "AGENTS.md"),
    path.join(userHome, "skills", "global", "SKILL.md"),
    outside,
    escape,
  ];
  const result = await collectAssetBaseline({
    provider: "codex",
    workspace,
    cwd: workspace,
    codexHome: path.join(userHome, ".codex"),
    includeUserHome: true,
    topology: {
      requestedWorkspace: workspace,
      workspace,
      gitRoot,
      target: { kind: "workspace-member", workspace },
    },
  }, {
    homeDirectory: () => userHome,
    collectRawInventory: async (options) => rawInventory(options.workspace),
    runLint: async () => ({
      kind: "agent-lint",
      profile: "agent-assets-review",
      summary: { findings: pathSamples.length },
      findings: pathSamples.map((file, index) => ({
        id: `path-${index}`,
        severity: "warning",
        file,
        evidence: `bounded source ${file}`,
      })),
    }),
    collectPublicInventory: async () => ({
      scope: { platform: "codex", includeUserHome: true },
      summary: {
        practiceCoverageRows: [{ surface: "Rules", scopes: ["Project"], count: 5, paths: pathSamples }],
      },
      surfaces: [{
        type: "rules",
        scope: "workspace",
        items: pathSamples.map((file, index) => ({ name: `rule-${index}`, scope: "workspace", path: file })),
      }],
      memories: { included: false, categories: [] },
      warnings: [],
    }),
    reviewIntegrity: () => ({
      kind: "asset-integrity-review",
      profile: "asset-integrity-review",
      status: "reviewed",
      summary: { findingCount: pathSamples.length },
      findings: pathSamples.map((file, index) => ({
        id: `integrity-path-${index}`,
        severity: "warning",
        file,
        why: `bounded integrity source ${file}`,
      })),
    }),
  });

  const expectedLocators = [
    "<workspace>",
    "<workspace>/skill.md",
    "<git-root>/AGENTS.md",
    "~/skills/global/SKILL.md",
    "<path>",
    "<path>",
  ];
  assert.deepEqual(
    result.envelopes.lint.data.findings.items.map((finding) => finding.file),
    expectedLocators,
  );
  assert.deepEqual(
    result.envelopes.integrity.data.findings.items.map((finding) => finding.file),
    expectedLocators,
  );
  assert.deepEqual(result.envelopes.inventory.data.coverageRows[0].paths, expectedLocators);
  assert.equal(
    result.envelopes.inventory.data.ownerRoutes.items.every((route) =>
      !path.isAbsolute(route.route ?? "<path>")),
    true,
  );
  assert.equal(JSON.stringify(result.envelopes).includes(root), false);
});

test("asset baseline preserves partial stage failures without hiding healthy envelopes", async () => {
  const result = await collectAssetBaseline({ provider: "cursor", workspace: "." }, {
    collectRawInventory: async () => ({}),
    runLint: async () => ({ kind: "agent-lint", profile: "agent-assets-review", summary: {}, findings: [] }),
    collectPublicInventory: async () => {
      throw new Error("inventory adapter unavailable");
    },
  });

  assert.equal(result.status, "partial");
  assert.equal(result.envelopes.lint.status, "available");
  assert.equal(result.envelopes.inventory.status, "unavailable");
  assert.equal(result.envelopes.integrity.status, "unavailable");
  assert.match(result.envelopes.inventory.error.code, /INVENTORY_UNAVAILABLE/);
  const markdown = formatAssetBaselineMarkdown(result);
  assert.match(markdown, /lint: available/);
  assert.match(markdown, /inventory: unavailable/);
});

test("failed raw inventory never fabricates configuredSnapshot", async () => {
  const result = await collectAssetBaseline({ provider: "codex", workspace: "." }, {
    collectRawInventory: async () => {
      throw Object.assign(new Error("synthetic inventory failure"), { code: "SYNTHETIC_FAILURE" });
    },
  });

  assert.equal(result.status, "failed");
  assert.equal(Object.hasOwn(result, "configuredSnapshot"), false);
  assert.equal(result.diagnostics.sharedInventorySnapshot, false);
});

test("asset baseline samples the latest 16 owner routes with explicit freshness coverage", async () => {
  const { workspace } = await temporaryWorkspace("better-harness-latest-owner-routes-");
  const observedAt = new Date("2026-08-03T08:00:00.000Z");
  const modifiedBase = Date.parse("2026-08-01T00:00:00.000Z");
  let activeStats = 0;
  let maxActiveStats = 0;
  const items = Array.from({ length: 40 }, (_, index) => ({
    name: `skill-${String(index).padStart(2, "0")}`,
    scope: "workspace",
    path: path.join(workspace, `skill-${String(index).padStart(2, "0")}.md`),
  }));
  const result = await collectAssetBaseline({ provider: "codex", workspace }, {
    now: () => observedAt,
    stat: async (filePath) => {
      activeStats += 1;
      maxActiveStats = Math.max(maxActiveStats, activeStats);
      await new Promise((resolve) => setImmediate(resolve));
      activeStats -= 1;
      return { mtime: new Date(modifiedBase + Number(path.basename(filePath).match(/\d+/u)?.[0]) * 1_000) };
    },
    collectRawInventory: async () => ({}),
    runLint: async () => ({ kind: "agent-lint", profile: "agent-assets-review", summary: {}, findings: [] }),
    collectPublicInventory: async () => ({
      scope: { platform: "codex", includeUserHome: false },
      summary: {},
      surfaces: [{ type: "skills", scope: "workspace", items }],
      memories: { included: false, categories: [] },
      warnings: [],
    }),
    reviewIntegrity: () => ({
      kind: "asset-integrity-review",
      profile: "asset-integrity-review",
      status: "reviewed",
      summary: { findingCount: 0 },
      findings: [],
    }),
  });

  const routes = result.envelopes.inventory.data.ownerRoutes;
  assert.equal(result.status, "complete");
  assert.equal(routes.items.length, MAX_BASELINE_OWNER_ROUTES);
  assert.deepEqual(routes.items.map((item) => item.name),
    Array.from({ length: 16 }, (_, index) => `skill-${String(39 - index).padStart(2, "0")}`));
  assert.equal(routes.items[0].modifiedAt, new Date(modifiedBase + 39_000).toISOString());
  assert.equal(routes.total, 40);
  assert.equal(routes.omitted, 24);
  assert.equal(routes.truncated, true);
  assert.deepEqual(routes.selection, {
    strategy: "latest-modified",
    limit: 16,
    observedAt: observedAt.toISOString(),
    timestampSource: "filesystem-mtime",
    timestamped: 40,
    untimestamped: 0,
  });
  assert.ok(maxActiveStats > 1 && maxActiveStats <= 32);
  assert.deepEqual(result.diagnostics.truncatedStages, []);
  assert.deepEqual(result.diagnostics.sampledStages, ["inventory-owner-routes"]);
});

test("Qoder asset baseline includes selected-project Memory titles by default", async () => {
  let publicOptions;
  const { workspace } = await temporaryWorkspace("better-harness-qoder-project-");
  const result = await collectAssetBaseline({ provider: "qoder", workspace }, {
    collectRawInventory: async () => ({}),
    runLint: async () => ({ kind: "agent-lint", profile: "agent-assets-review", summary: {}, findings: [] }),
    collectPublicInventory: async (options) => {
      publicOptions = options;
      return {
        scope: { platform: "qoder", includeUserHome: false, includeMemories: true },
        summary: { practiceCoverageRows: [] },
        surfaces: [],
        memories: { included: true, contentPolicy: "raw-memory-content-not-read", categories: [] },
        warnings: [],
      };
    },
    reviewIntegrity: () => ({
      kind: "asset-integrity-review",
      profile: "asset-integrity-review",
      status: "reviewed",
      contentPolicy: "memory-title-and-path-metadata-only",
      summary: { findingCount: 0 },
      findings: [],
    }),
  });

  assert.equal(result.scope.includeMemories, true);
  assert.equal(result.scope.includeUserHome, false);
  assert.equal(publicOptions.includeMemories, true);
  assert.equal(publicOptions.includeUserHome, false);
});

test("asset baseline is discoverable through the Better Harness CLI", () => {
  const help = spawnSync(process.execPath, [
    cliPath,
    "coding-agent-practices",
    "asset-baseline",
    "--help",
  ], { encoding: "utf8" });

  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Collect one compact, read-only AI evidence envelope/);
  assert.match(help.stdout, /--include-memories/);
  assert.match(help.stdout, /--include-user-home/);
});

test("asset baseline CLI emits compact single-line JSON from a real project fixture", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-asset-baseline-"));
  const workspace = path.join(root, "project");
  const qoderHome = path.join(root, "qoder-home");
  const skillFile = path.join(workspace, ".qoder", "skills", "review", "SKILL.md");
  try {
    await mkdir(path.dirname(skillFile), { recursive: true });
    await mkdir(qoderHome, { recursive: true });
    await writeFile(skillFile, "---\nname: review\ndescription: Review a bounded project change.\n---\n\n# Review\n");
    const result = spawnSync(process.execPath, [
      cliPath,
      "coding-agent-practices",
      "asset-baseline",
      "qoder",
      "--workspace",
      workspace,
      "--qoder-home",
      qoderHome,
      "--json",
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim().split("\n").length, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.kind, ASSET_BASELINE_KIND);
    assert.equal(payload.scope.includeMemories, true);
    assert.equal(payload.scope.includeUserHome, false);
    assert.equal(payload.envelopes.inventory.data.ownerRoutes.items.some((item) =>
      item.kind === "skills" && item.name === "review"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Claude asset baseline completes from a native project fixture", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-asset-baseline-claude-"));
  const workspace = path.join(root, "project");
  const claudeHome = path.join(root, ".claude-home");
  const claudeStatePath = path.join(root, ".claude.json");
  try {
    await mkdir(claudeHome, { recursive: true });
    await writeFile(claudeStatePath, "{}\n");
    await mkdir(path.join(workspace, ".claude", "skills", "review"), { recursive: true });
    await writeFile(path.join(workspace, "CLAUDE.md"), "# Claude project\n\nRun npm test.\n");
    await writeFile(
      path.join(workspace, ".claude", "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Review a bounded Claude project change.\n---\n",
    );

    const result = await collectAssetBaseline({
      provider: "claude",
      workspace,
      claudeHome,
      claudeStatePath,
      includeUserHome: false,
    });

    assert.equal(result.status, "complete");
    assert.equal(result.scope.provider, "claude");
    assert.equal(result.envelopes.inventory.status, "available");
    assert.equal(result.envelopes.lint.data.assetInventory.summary.skills, 1);
    assert.equal(result.envelopes.inventory.data.ownerRoutes.items.some((item) =>
      item.kind === "skills" && item.name === "review"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Claude asset baseline treats its designated config root as bounded project scope", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-asset-baseline-claude-home-"));
  const workspace = path.join(root, ".claude");
  const claudeStatePath = path.join(root, ".claude.json");
  const containedPluginId = "contained@fixture-marketplace";
  const escapingPluginId = "escaping@fixture-marketplace";
  const containedPluginRoot = path.join(workspace, "plugins", "cache", "fixture-marketplace", "contained", "1.0.0");
  const escapingPluginRoot = path.join(root, "outside-plugin");
  try {
    await mkdir(path.join(workspace, "skills", "review"), { recursive: true });
    await mkdir(path.join(workspace, "commands"), { recursive: true });
    await mkdir(path.join(containedPluginRoot, ".claude-plugin"), { recursive: true });
    await mkdir(path.join(escapingPluginRoot, ".claude-plugin"), { recursive: true });
    await writeFile(
      path.join(workspace, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Review the designated Claude config workspace.\n---\n",
    );
    await writeFile(path.join(workspace, "commands", "project-check.md"), "# Project Check\n");
    await writeFile(path.join(workspace, "CLAUDE.md"), "# Claude config project\n\nRun the focused tests.\n");
    await writeFile(path.join(workspace, "settings.json"), `${JSON.stringify({
      enabledPlugins: {
        [containedPluginId]: true,
        [escapingPluginId]: true,
      },
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "node hooks/check.mjs" }] }],
      },
    }, null, 2)}\n`);
    await writeFile(path.join(containedPluginRoot, ".claude-plugin", "plugin.json"), `${JSON.stringify({
      name: "contained",
      version: "1.0.0",
    }, null, 2)}\n`);
    await writeFile(path.join(escapingPluginRoot, ".claude-plugin", "plugin.json"), `${JSON.stringify({
      name: "escaping",
      version: "1.0.0",
    }, null, 2)}\n`);
    await mkdir(path.join(workspace, "plugins"), { recursive: true });
    await writeFile(path.join(workspace, "plugins", "installed_plugins.json"), `${JSON.stringify({
      version: 2,
      plugins: {
        [containedPluginId]: [{ scope: "user", installPath: containedPluginRoot, version: "1.0.0" }],
        [escapingPluginId]: [{ scope: "user", installPath: escapingPluginRoot, version: "1.0.0" }],
      },
    }, null, 2)}\n`);
    await writeFile(claudeStatePath, `${JSON.stringify({
      mcpServers: {
        outsideState: { command: "node", args: ["outside-state-server.mjs"] },
      },
    }, null, 2)}\n`);

    const result = await collectAssetBaseline({
      provider: "claude",
      workspace,
      claudeHome: workspace,
      claudeStatePath,
      includeUserHome: false,
    });

    assert.equal(result.status, "complete");
    assert.equal(result.scope.includeUserHome, false);
    assert.deepEqual(result.envelopes.lint.data.assetInventory.summary, {
      skills: 1,
      mcps: 0,
      commands: 1,
      hooks: 1,
      rules: 1,
      agents: 0,
      plugins: 1,
    });
    const ownerRoutes = result.envelopes.inventory.data.ownerRoutes.items;
    assert.equal(ownerRoutes.some((item) => item.kind === "skills" && item.name === "review"), true);
    assert.equal(ownerRoutes.some((item) => item.kind === "commands" && item.name === "project-check"), true);
    assert.equal(ownerRoutes.some((item) => item.kind === "hooks"), true);
    assert.equal(ownerRoutes.some((item) => item.kind === "plugins" && item.name === "Contained"), true);
    assert.equal(JSON.stringify(result).includes("escaping"), false);
    assert.equal(JSON.stringify(result).includes("outsideState"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Qwen asset baseline completes from a native project fixture", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-asset-baseline-qwen-"));
  const workspace = path.join(root, "project");
  const qwenHome = path.join(root, ".qwen-home");
  try {
    await mkdir(qwenHome, { recursive: true });
    await mkdir(path.join(workspace, ".qwen", "skills", "review"), { recursive: true });
    await writeFile(path.join(workspace, "QWEN.md"), "# Qwen project\n\nRun npm test.\n");
    await writeFile(
      path.join(workspace, ".qwen", "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Review a bounded Qwen project change.\n---\n",
    );

    const result = await collectAssetBaseline({
      provider: "qwen",
      workspace,
      qwenHome,
      includeUserHome: false,
    });

    assert.equal(result.status, "complete");
    assert.equal(result.scope.provider, "qwen");
    assert.equal(result.envelopes.inventory.status, "available");
    assert.equal(result.envelopes.lint.data.assetInventory.summary.skills, 1);
    assert.equal(result.envelopes.inventory.data.ownerRoutes.items.some((item) =>
      item.kind === "skills" && item.name === "review"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("package asset baseline preserves root and intermediate assets as inherited owners", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-asset-monorepo-"));
  const workspace = path.join(root, "packages", "app");
  const qoderHome = path.join(root, "qoder-home");
  try {
    await mkdir(qoderHome, { recursive: true });
    await mkdir(path.join(root, ".agents", "skills", "root-review"), { recursive: true });
    await mkdir(path.join(workspace, ".qoder", "skills", "local-review"), { recursive: true });
    await writeFile(path.join(root, "AGENTS.md"), "# Root instructions\n");
    await writeFile(path.join(root, "packages", "AGENTS.md"), "# Packages instructions\n");
    await writeFile(path.join(workspace, "AGENTS.md"), "# App instructions\n");
    await writeFile(
      path.join(root, ".agents", "skills", "root-review", "SKILL.md"),
      "---\nname: root-review\ndescription: Review the repository contract.\n---\n",
    );
    await writeFile(
      path.join(workspace, ".qoder", "skills", "local-review", "SKILL.md"),
      "---\nname: local-review\ndescription: Review the package contract.\n---\n",
    );
    const topology = {
      kind: "better-harness.workspace-topology",
      schemaVersion: 1,
      status: "complete",
      requestedWorkspace: workspace,
      gitRoot: root,
      target: {
        kind: "workspace-member",
        route: "packages/app",
        memberRoute: "packages/app",
        memberMatch: "exact",
      },
      members: {
        items: [{
          route: "packages/app",
          kind: "manifest",
          discoveredBy: ["package.json#workspaces"],
          manifestRoute: "package.json",
        }],
        total: 1,
        omitted: 0,
        truncated: false,
      },
      instructionScopes: {
        items: [
          { route: "AGENTS.md", provider: "qoder", activation: "effective" },
          { route: "packages/AGENTS.md", provider: "qoder", activation: "candidate" },
          { route: "packages/app/AGENTS.md", provider: "qoder", activation: "candidate" },
        ],
        total: 3,
        omitted: 0,
        truncated: false,
      },
      discovery: {
        inventoryMode: "git",
        ignoreMode: "git-index",
        tracked: 5,
        untracked: 0,
        scanned: 5,
        omitted: 0,
        truncated: false,
        warnings: [],
      },
    };

    const result = await collectAssetBaseline({
      provider: "qoder",
      workspace,
      qoderHome,
      topology,
      includeUserHome: false,
    });

    assert.equal(result.status, "complete");
    assert.equal(result.diagnostics.inheritedWorkspaceCount, 2);
    const owners = result.envelopes.inventory.data.ownerRoutes.items;
    assert.ok(owners.some((item) =>
      item.kind === "skills"
      && item.scope === "project"
      && item.name === "local-review"
      && item.route === ".qoder/skills/local-review/SKILL.md"));
    assert.ok(owners.some((item) =>
      item.kind === "skills"
      && item.scope === "inherited"
      && item.name === "root-review"
      && item.route === ".agents/skills/root-review/SKILL.md"
      && item.effectiveTarget === "packages/app"));
    const lintEntrypoints = result.envelopes.lint.data.assetInventory;
    assert.ok(lintEntrypoints);
    assert.ok(result.envelopes.lint.data.summary.entrypoints >= 3);
    assert.ok(result.envelopes.inventory.data.coverageRows.some((row) =>
      row.surface === "Skills" && row.scopes.includes("Inherited")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Pi asset baseline completes from a native project fixture", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-asset-baseline-pi-"));
  const workspace = path.join(root, "project");
  const piHome = path.join(root, ".pi-home", ".pi", "agent");
  try {
    await mkdir(piHome, { recursive: true });
    await mkdir(path.join(workspace, ".pi", "skills", "review"), { recursive: true });
    await writeFile(path.join(workspace, "AGENTS.md"), "# Pi project\n\nRun npm test.\n");
    await writeFile(
      path.join(workspace, ".pi", "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Review a bounded Pi project change.\n---\n",
    );

    const result = await collectAssetBaseline({
      provider: "pi",
      workspace,
      piHome,
      includeUserHome: false,
    });

    assert.equal(result.status, "complete");
    assert.equal(result.scope.provider, "pi");
    assert.equal(result.envelopes.inventory.status, "available");
    assert.equal(result.envelopes.lint.data.assetInventory.summary.skills, 1);
    assert.equal(result.envelopes.inventory.data.ownerRoutes.items.some((item) =>
      item.kind === "skills" && item.name === "review"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Kimi asset baseline completes from a native project fixture", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-asset-baseline-kimi-"));
  const workspace = path.join(root, "project");
  const kimiHome = path.join(root, ".kimi-home");
  try {
    await mkdir(kimiHome, { recursive: true });
    await mkdir(path.join(workspace, ".kimi-code", "skills", "review"), { recursive: true });
    await writeFile(path.join(workspace, "AGENTS.md"), "# Kimi project\n\nRun npm test.\n");
    await writeFile(
      path.join(workspace, ".kimi-code", "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Review a bounded Kimi project change.\n---\n",
    );

    const result = await collectAssetBaseline({
      provider: "kimi",
      workspace,
      kimiHome,
      includeUserHome: false,
    });

    assert.equal(result.status, "complete");
    assert.equal(result.scope.provider, "kimi");
    assert.equal(result.envelopes.inventory.status, "available");
    assert.equal(result.envelopes.lint.data.assetInventory.summary.skills, 1);
    assert.equal(result.envelopes.inventory.data.ownerRoutes.items.some((item) =>
      item.kind === "skills" && item.name === "review"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("WorkBuddy asset baseline completes from a native project fixture", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-asset-baseline-workbuddy-"));
  const workspace = path.join(root, "project");
  const workbuddyHome = path.join(root, ".workbuddy");
  try {
    await mkdir(workbuddyHome, { recursive: true });
    await mkdir(path.join(workspace, ".workbuddy", "skills", "review"), { recursive: true });
    await writeFile(path.join(workspace, "AGENTS.md"), "# WorkBuddy project\n\nRun npm test.\n");
    await writeFile(
      path.join(workspace, ".workbuddy", "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Review a bounded WorkBuddy project change.\n---\n",
    );

    const result = await collectAssetBaseline({
      provider: "workbuddy",
      workspace,
      workbuddyHome,
      includeUserHome: false,
    });

    assert.equal(result.status, "complete");
    assert.equal(result.scope.provider, "workbuddy");
    assert.equal(result.envelopes.inventory.status, "available");
    assert.equal(result.envelopes.lint.data.assetInventory.summary.skills, 1);
    assert.equal(result.envelopes.inventory.data.ownerRoutes.items.some((item) =>
      item.kind === "skills" && item.name === "review"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

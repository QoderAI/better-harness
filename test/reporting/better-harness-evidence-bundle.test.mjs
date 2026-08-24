import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  EVIDENCE_BUNDLE_KIND,
  collectEvidenceBundle,
  freezeEvidenceBundleContext,
} from "../../scripts/harness-analysis/evidence-bundle/index.mjs";
import { availableLane } from "../../scripts/harness-analysis/evidence-bundle/contract.mjs";
import {
  collectSessionEvidence,
  collectSessionPopulation,
} from "../../scripts/harness-analysis/evidence-bundle/session-evidence.mjs";
import { workspaceToClaudeSlugVariants } from "../../scripts/session-analysis/platforms/claude.mjs";
import { collectAgentCustomize } from "../../scripts/harness-analysis/evidence-bundle/agent-customize.mjs";
import { collectProjectHarness } from "../../scripts/harness-analysis/evidence-bundle/project-harness.mjs";
import { EVIDENCE_BUNDLE_HELP } from "../../scripts/harness-analysis/evidence-bundle/cli.mjs";
import { collectAssetBaseline } from "../../scripts/coding-agent-practices/asset-baseline.mjs";

const NOW = new Date("2026-07-24T08:00:00.000Z");

const POPULATION_BINDING = Object.freeze({
  schemaVersion: 1,
  kind: "session-population-binding",
  scopeFingerprint: "1111111111111111",
  policyFingerprint: "2222222222222222",
  omission: {
    exactIdentityAvailable: true,
    activeSessions: 1,
    homeSessionOnly: 0,
    recencyInference: "disabled-frozen-until",
  },
  eligible: { count: 1, fingerprint: "3333333333333333" },
});

const SESSION_SELECTION_BINDING = Object.freeze({
  schemaVersion: 1,
  kind: "session-selection-binding",
  parentPopulationFingerprint: POPULATION_BINDING.eligible.fingerprint,
  strategy: "all-eligible",
  selected: { count: 1, fingerprint: "3333333333333333" },
  projectionPolicyFingerprint: "4444444444444444",
});

const LEAD_SELECTION_BINDING = Object.freeze({
  ...SESSION_SELECTION_BINDING,
  strategy: "stratified",
  projectionPolicyFingerprint: "5555555555555555",
});

function sessionFacts(overrides = {}) {
  return {
    kind: "session-core-facts",
    candidates: [],
    scope: { eligibleSessions: 1, selectedSessions: 1 },
    admission: {
      taskEpisodes: 1,
      candidateEpisodes: 1,
      distinctRequests: 1,
      emittedCandidates: 1,
    },
    omitted: {
      noRequest: 0,
      selfAnalysis: 0,
      lowSignal: 0,
      duplicateRequests: 0,
      candidateBudget: 0,
      activeSessions: 1,
      homeSessionOnly: 0,
    },
    populationBinding: POPULATION_BINDING,
    selectionBinding: SESSION_SELECTION_BINDING,
    admissionBinding: {
      schemaVersion: 1,
      kind: "session-admission-binding",
      projectionPolicyFingerprint: SESSION_SELECTION_BINDING.projectionPolicyFingerprint,
      taskEpisodes: 1,
      candidateEpisodes: 1,
      distinctRequests: 1,
      emittedCandidates: 1,
      noRequest: 0,
      selfAnalysis: 0,
      lowSignal: 0,
      duplicateRequests: 0,
      candidateBudget: 0,
    },
    ...overrides,
  };
}

function leadEvidence(overrides = {}) {
  return {
    evidence: "bounded",
    summaryFacts: {
      evidenceBoundary: {
        manifest: { selection: { eligibleCount: 1, analyzedCount: 1 } },
        episodeCoverage: { episodeCount: 0 },
      },
    },
    sessionBinding: {
      population: POPULATION_BINDING,
      selection: LEAD_SELECTION_BINDING,
      admission: {
        schemaVersion: 1,
        kind: "lead-admission-binding",
        projectedEpisodes: 1,
        admittedEpisodes: 0,
        zeroSignalDiscardedEpisodes: 1,
        retainedTaskEpisodes: 0,
        projectionPolicyFingerprint: LEAD_SELECTION_BINDING.projectionPolicyFingerprint,
      },
    },
    ...overrides,
  };
}

function validAssetBaseline(context, overrides = {}) {
  return {
    kind: "agent-asset-baseline",
    schemaVersion: 2,
    status: "complete",
    scope: {
      provider: context.provider,
      workspace: context.workspace,
      cwd: context.cwd,
      includeUserHome: context.authority.includeUserHome,
      includeMemories: context.authority.includeMemories,
    },
    ...(context.provider === "dsh" ? {
      configuredSnapshot: {
        collectedAt: "2026-07-24T07:00:00.000Z",
        evidenceKind: "configured-not-observed",
        configurationSource: "qualified-defaults",
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
      },
    } : {}),
    envelopes: {
      lint: { status: "available", data: {} },
      inventory: { status: "available", data: {} },
      integrity: { status: "available", data: {} },
    },
    diagnostics: {},
    ...overrides,
  };
}

test("evidence-bundle help advertises qualified hosts, cwd, and isolated home overrides", () => {
  assert.match(EVIDENCE_BUNDLE_HELP, /workbuddy/u);
  assert.match(EVIDENCE_BUNDLE_HELP, /grok/u);
  assert.match(EVIDENCE_BUNDLE_HELP, /dsh/u);
  assert.match(EVIDENCE_BUNDLE_HELP, /--cwd <path>/u);
  assert.match(EVIDENCE_BUNDLE_HELP, /--workbuddy-home <dir>/u);
  assert.match(EVIDENCE_BUNDLE_HELP, /--grok-home <dir>/u);
  assert.match(EVIDENCE_BUNDLE_HELP, /--dsh-home <dir>/u);
});

function topologyResolution(workspace = ".", status = "complete") {
  const absolute = path.resolve(workspace);
  const topology = Object.freeze({
    kind: "better-harness.workspace-topology",
    schemaVersion: 1,
    status,
    requestedWorkspace: absolute,
    gitRoot: absolute,
    target: {
      kind: "repo-root",
      route: ".",
      memberRoute: null,
      memberMatch: "none",
    },
    members: { items: [], total: 0, omitted: 0, truncated: false },
    instructionScopes: { items: [], total: 0, omitted: 0, truncated: false },
    discovery: {
      inventoryMode: "git",
      ignoreMode: "git-index",
      tracked: 1,
      untracked: 0,
      scanned: 1,
      omitted: 0,
      truncated: status !== "complete",
      warnings: status === "complete" ? [] : [{ code: "inventory-truncated" }],
    },
  });
  return Object.freeze({
    topology,
    analysisScope: Object.freeze({ kind: "repo", route: ".", pathspecs: Object.freeze([]) }),
    inventory: Object.freeze({ items: Object.freeze([]) }),
  });
}

function dependencies(overrides = {}) {
  const population = Object.freeze({
    sessions: Object.freeze([{ sessionId: "eligible-session" }]),
    binding: POPULATION_BINDING,
  });
  return {
    now: () => NOW,
    resolveWorkspaceTopology: async ({ workspace }) => topologyResolution(workspace),
    collectSessionPopulation: async () => population,
    collectSessionEvidence: async (_context, _options, received) => {
      assert.equal(received.sessionPopulation, population);
      return availableLane(sessionFacts());
    },
    collectProjectHarness: async () => availableLane({ kind: "core-change-watch-evidence-pack" }),
    collectAgentCustomize: async () => availableLane({ kind: "agent-asset-baseline", status: "complete" }),
    analyzeHarnessEvidence: async () => leadEvidence(),
    ...overrides,
  };
}

test("evidence bundle freezes the three canonical lane names and normal scope", async () => {
  const result = await collectEvidenceBundle({
    workspace: ".",
    platform: "codex",
    language: "zh-CN",
    depth: "normal",
    "include-user-home": true,
  }, dependencies());

  assert.equal(result.kind, EVIDENCE_BUNDLE_KIND);
  assert.equal(result.schemaVersion, 3);
  assert.equal(result.status, "complete");
  assert.deepEqual(Object.keys(result.lanes), ["sessionEvidence", "projectHarness", "agentCustomize"]);
  assert.equal(result.context.provider, "codex");
  assert.equal(result.context.cwd, await realpath("."));
  assert.equal(result.context.depth, "normal");
  assert.equal(result.context.evidenceLimit, 5);
  assert.deepEqual(result.context.window, {
    since: "2026-06-24T08:00:00.000Z",
    until: "2026-07-24T08:00:00.000Z",
  });
  assert.equal(result.context.authority.includeUserHome, true);
  assert.equal(result.context.authority.includeMemories, false);
  assert.equal(result.context.topology.target.kind, "repo-root");
  assert.deepEqual(result.context.analysisScope, { kind: "repo", route: ".", pathspecs: [] });
  assert.equal(result.diagnostics.collectionMode, "frozen-context-multi-owner");
});

test("evidence bundle v3 freezes canonical default, nested, and aliased cwd identity", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-bundle-cwd-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  const nested = path.join(workspace, "packages", "api", "src with space", "\u5b50\u76ee\u5f55");
  const alias = path.join(workspace, "cwd-alias");
  await mkdir(nested, { recursive: true });
  await symlink(nested, alias, "dir");

  const omitted = freezeEvidenceBundleContext({ workspace }, NOW);
  const explicitWorkspace = freezeEvidenceBundleContext({ workspace, cwd: workspace }, NOW);
  const explicitNested = freezeEvidenceBundleContext({ workspace, cwd: nested }, NOW);
  const aliasedNested = freezeEvidenceBundleContext({ workspace, cwd: alias }, NOW);

  assert.equal(omitted.cwd, await realpath(workspace));
  assert.equal(explicitWorkspace.cwd, omitted.cwd);
  assert.equal(explicitNested.cwd, await realpath(nested));
  assert.equal(aliasedNested.cwd, explicitNested.cwd);
  assert.notEqual(explicitNested.cwd, omitted.cwd);
});

test("evidence bundle cwd validation fails closed before configured collection", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-bundle-cwd-invalid-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  const outside = path.join(root, "outside");
  const file = path.join(workspace, "not-a-directory.txt");
  const escape = path.join(workspace, "escape");
  await mkdir(workspace, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(file, "not a directory\n");
  await symlink(outside, escape, "dir");

  for (const cwd of ["", `${workspace}\u0000invalid`, path.join(workspace, "missing"), file]) {
    assert.throws(
      () => freezeEvidenceBundleContext({ workspace, cwd }, NOW),
      (error) => error?.code === "INVALID_CONFIGURED_CWD",
      cwd || "blank cwd",
    );
  }
  for (const cwd of [outside, escape]) {
    assert.throws(
      () => freezeEvidenceBundleContext({ workspace, cwd }, NOW),
      (error) => error?.code === "CONFIGURED_CWD_OUTSIDE_WORKSPACE",
      cwd,
    );
  }
});

test("evidence bundle resolves topology once and shares the frozen binding with every consumer", async () => {
  let resolutions = 0;
  let canonicalTopology;
  const received = [];
  const result = await collectEvidenceBundle({ workspace: ".", depth: "normal" }, dependencies({
    resolveWorkspaceTopology: async ({ workspace }) => {
      resolutions += 1;
      const resolution = topologyResolution(workspace);
      canonicalTopology = resolution.topology;
      return resolution;
    },
    collectSessionEvidence: async (context) => {
      received.push(context.topology);
      return availableLane(sessionFacts());
    },
    collectProjectHarness: async (context) => {
      received.push(context.topology);
      return availableLane({ kind: "core-change-watch-evidence-pack" });
    },
    collectAgentCustomize: async (context) => {
      received.push(context.topology);
      return availableLane({ kind: "agent-asset-baseline", status: "complete" });
    },
    analyzeHarnessEvidence: async (options) => {
      received.push(options.topology);
      return leadEvidence();
    },
  }));

  assert.equal(result.status, "complete");
  assert.equal(resolutions, 1);
  assert.equal(received.length, 4);
  assert.ok(received.every((topology) => topology === canonicalTopology));
});

test("topology truncation fails normal bundles and lowers quick bundles to partial", async () => {
  const partialResolver = async ({ workspace }) => topologyResolution(workspace, "partial");
  const normal = await collectEvidenceBundle({ workspace: ".", depth: "normal" }, dependencies({
    resolveWorkspaceTopology: partialResolver,
  }));
  const quick = await collectEvidenceBundle({ workspace: ".", depth: "quick" }, dependencies({
    resolveWorkspaceTopology: partialResolver,
  }));

  assert.equal(normal.status, "failed");
  assert.equal(quick.status, "partial");
  assert.equal(normal.diagnostics.topologyIncomplete, true);
  assert.equal(normal.diagnostics.topologyStatus, "partial");
});

test("evidence bundle rejects a frozen topology for a different workspace", () => {
  const resolution = topologyResolution(".");
  const mismatched = structuredClone(resolution.topology);
  mismatched.requestedWorkspace = path.resolve("different-workspace");
  assert.throws(() => freezeEvidenceBundleContext({
    workspace: ".",
    topology: mismatched,
    analysisScope: resolution.analysisScope,
  }, NOW), (error) => error?.code === "INVALID_WORKSPACE_TOPOLOGY"
    && /target\.route must resolve from gitRoot to requestedWorkspace/u.test(error.message));
});

test("evidence bundle rejects analysis pathspecs that are not derived from the frozen topology", () => {
  const resolution = topologyResolution(".");
  assert.throws(() => freezeEvidenceBundleContext({
    workspace: ".",
    topology: resolution.topology,
    analysisScope: {
      kind: "repo",
      route: ".",
      pathspecs: [":(top,literal)scripts"],
    },
  }, NOW), (error) => error?.code === "EVIDENCE_ANALYSIS_SCOPE_MISMATCH");
});

test("normal bundles fail closed and redact collector error details", async () => {
  const result = await collectEvidenceBundle({ workspace: ".", depth: "normal" }, dependencies({
    collectProjectHarness: async () => {
      throw Object.assign(new Error("private path /Users/example/secret"), { code: "PROJECT_SCAN_FAILED" });
    },
  }));

  assert.equal(result.status, "failed");
  assert.equal(result.lanes.projectHarness.status, "unavailable");
  assert.equal(result.lanes.projectHarness.error.code, "PROJECT_SCAN_FAILED");
  assert.equal(result.lanes.projectHarness.error.message, "project-harness evidence is unavailable");
  assert.doesNotMatch(JSON.stringify(result), /Users\/example|secret/);
});

test("scoped Git coverage failure makes the project lane unavailable and fails normal bundles", async () => {
  const normalDependencies = dependencies({
    buildEvidencePack: async () => {
      throw Object.assign(new Error("fatal: bad revision with private path"), {
        code: "GIT_COMMAND_FAILED",
      });
    },
  });
  delete normalDependencies.collectProjectHarness;
  const result = await collectEvidenceBundle({ workspace: ".", depth: "normal" }, normalDependencies);

  assert.equal(result.status, "failed");
  assert.equal(result.lanes.projectHarness.status, "unavailable");
  assert.equal(result.lanes.projectHarness.error.code, "GIT_COMMAND_FAILED");
  assert.equal(result.lanes.projectHarness.error.message, "project-harness evidence is unavailable");
  assert.ok(result.diagnostics.unavailableLanes.includes("projectHarness"));
});

test("quick bundles retain an explicit partial lane without failing the lead", async () => {
  const result = await collectEvidenceBundle({ workspace: ".", depth: "quick" }, dependencies({
    collectAgentCustomize: async () => ({ status: "partial", data: { kind: "agent-asset-baseline" } }),
  }));

  assert.equal(result.status, "partial");
  assert.deepEqual(result.diagnostics.requiredLanes, []);
  assert.deepEqual(result.diagnostics.incompleteLanes, ["agentCustomize"]);
  assert.deepEqual(result.diagnostics.partialLanes, ["agentCustomize"]);
  assert.deepEqual(result.diagnostics.unavailableLanes, []);
  assert.equal(result.lead.status, "available");
});

test("Qoder keeps project Memory title metadata in the default bundle authority", () => {
  const context = freezeEvidenceBundleContext({ workspace: ".", platform: "qoder" }, NOW);
  assert.equal(context.authority.includeMemories, true);
  assert.equal(context.authority.includeUserHome, false);
});

test("session lane uses all eligible facts with the frozen limit and window", async () => {
  let received;
  const context = freezeEvidenceBundleContext({
    workspace: ".",
    depth: "quick",
    since: "2026-07-20T00:00:00Z",
    until: "2026-07-24T00:00:00Z",
  }, NOW);
  const lane = await collectSessionEvidence(context, {}, {
    createAnalyzer: async () => ({
      analyze: async (options) => {
        received = options;
        return { kind: "session-core-facts", candidates: [] };
      },
    }),
  });

  assert.equal(lane.status, "available");
  assert.equal(received.command, "facts");
  assert.equal(received.selection, "all-eligible");
  assert.equal(received.limit, 3);
  assert.equal(received.since, "2026-07-20T00:00:00.000Z");
  assert.equal(received.until, "2026-07-24T00:00:00.000Z");
  assert.equal(Object.hasOwn(received, "cwd"), false);
});

test("agentCustomize forwards frozen cwd to Asset Baseline", async () => {
  const canonicalCwd = await realpath(".");
  const context = {
    ...freezeEvidenceBundleContext({ workspace: ".", platform: "codex" }, NOW),
    cwd: canonicalCwd,
  };
  let received;
  const lane = await collectAgentCustomize(context, {}, {
    collectAssetBaseline: async (options) => {
      received = options;
      return validAssetBaseline(context);
    },
  });

  assert.equal(lane.status, "available");
  assert.equal(received.cwd, canonicalCwd);
});

test("agentCustomize rejects malformed Asset Baseline v2 contracts", async () => {
  const context = freezeEvidenceBundleContext({ workspace: ".", platform: "dsh" }, NOW);
  const cases = [
    ["schemaVersion 1", (value) => { value.schemaVersion = 1; }],
    ["unknown schemaVersion", (value) => { value.schemaVersion = 99; }],
    ["invalid status", (value) => { value.status = "mystery"; }],
    ["missing scope", (value) => { delete value.scope; }],
    ["wrong provider", (value) => { value.scope.provider = "codex"; }],
    ["missing cwd", (value) => { delete value.scope.cwd; }],
    ["malformed lint envelope", (value) => { value.envelopes.lint = { status: "available" }; }],
    ["missing configuredSnapshot", (value) => { delete value.configuredSnapshot; }],
    ["malformed configuredSnapshot", (value) => { value.configuredSnapshot.qualification.provider = "codex"; }],
  ];

  for (const [name, mutate] of cases) {
    const candidate = structuredClone(validAssetBaseline(context));
    mutate(candidate);
    const lane = await collectAgentCustomize(context, {}, {
      collectAssetBaseline: async () => candidate,
    });
    assert.equal(lane.status, "unavailable", name);
    assert.equal(lane.error.code, "INVALID_AGENT_CUSTOMIZE_EVIDENCE", name);
  }
});

test("agentCustomize preserves valid partial and failed Baseline v2 semantics", async () => {
  const context = freezeEvidenceBundleContext({ workspace: ".", platform: "dsh" }, NOW);
  const partial = validAssetBaseline(context, {
    status: "partial",
    envelopes: {
      lint: { status: "available", data: {} },
      inventory: { status: "unavailable", error: { code: "INVENTORY_UNAVAILABLE", message: "bounded" } },
      integrity: { status: "unavailable", error: { code: "INTEGRITY_UNAVAILABLE", message: "bounded" } },
    },
  });
  const failed = validAssetBaseline(context, {
    status: "failed",
    configuredSnapshot: undefined,
    envelopes: {
      lint: { status: "unavailable", error: { code: "LINT_UNAVAILABLE", message: "bounded" } },
      inventory: { status: "unavailable", error: { code: "INVENTORY_UNAVAILABLE", message: "bounded" } },
      integrity: { status: "unavailable", error: { code: "INTEGRITY_UNAVAILABLE", message: "bounded" } },
    },
  });

  const partialLane = await collectAgentCustomize(context, {}, {
    collectAssetBaseline: async () => partial,
  });
  const failedLane = await collectAgentCustomize(context, {}, {
    collectAssetBaseline: async () => failed,
  });
  assert.equal(partialLane.status, "partial");
  assert.equal(failedLane.status, "unavailable");
  assert.equal(failedLane.error.code, "AGENT_CUSTOMIZE_BASELINE_FAILED");
});

function dshRawInventory() {
  return {
    provider: "dsh",
    generatedAt: "2026-07-24T07:00:00.000Z",
    diagnostics: {
      evidenceKind: "configured-not-observed",
      configurationSource: "qualified-defaults",
      userHomeCollection: "not-authorized",
      instructionCollection: "enabled",
      qualifiedDshVersion: "0.1.1-rc.2",
      qualifiedDshSourceSha: "b150a551b8d465e31e418e1b2eaf5e79bbb7d28e",
    },
  };
}

function healthyBaselineStages() {
  return {
    collectRawInventory: async () => dshRawInventory(),
    runLint: async () => ({
      kind: "agent-lint",
      profile: "agent-assets-review",
      summary: {},
      findings: [],
    }),
    collectPublicInventory: async () => ({
      scope: { platform: "dsh" },
      summary: {},
      surfaces: [],
      memories: { included: false, categories: [] },
      warnings: [],
    }),
    reviewIntegrity: () => ({
      kind: "agent-asset-integrity",
      profile: "agent-assets-review",
      status: "reviewed",
      contentPolicy: "metadata-only",
      summary: {},
      findings: [],
    }),
  };
}

const NESTED_BASELINE_ERROR_CASES = [
  {
    name: "failed raw inventory with a spaced POSIX path",
    privatePath: "/Users/example/private project/raw inventory.json",
    stages: ["lint", "inventory", "integrity"],
    configure: (message) => ({
      ...healthyBaselineStages(),
      collectRawInventory: async () => { throw new Error(message); },
    }),
  },
  {
    name: "partial lint with a Windows drive path",
    privatePath: "C:\\Users\\example\\private folder\\lint.json",
    stages: ["lint"],
    configure: (message) => ({
      ...healthyBaselineStages(),
      runLint: async () => { throw new Error(message); },
    }),
  },
  {
    name: "partial inventory with a spaced POSIX path",
    privatePath: "/Users/example/private project/inventory.json",
    stages: ["inventory"],
    configure: (message) => ({
      ...healthyBaselineStages(),
      collectPublicInventory: async () => { throw new Error(message); },
    }),
  },
  {
    name: "partial integrity with a UNC path",
    privatePath: "\\\\server\\private share\\integrity.json",
    stages: ["integrity"],
    configure: (message) => ({
      ...healthyBaselineStages(),
      reviewIntegrity: () => { throw new Error(message); },
    }),
  },
];

for (const current of NESTED_BASELINE_ERROR_CASES) {
  test(`serialized Bundle sanitizes ${current.name}`, async () => {
    const safeContext = "stage context remains available";
    const message = `collector could not inspect '${current.privatePath}' while ${safeContext}`;
    const result = await collectEvidenceBundle({
      workspace: ".",
      cwd: ".",
      platform: "dsh",
      depth: "quick",
    }, dependencies({
      collectAgentCustomize: undefined,
      collectAssetBaseline: (options) => collectAssetBaseline(options, current.configure(message)),
    }));
    const serialized = JSON.stringify(result);

    assert.equal(serialized.includes(current.privatePath), false);
    assert.match(serialized, /<path>/u);
    assert.match(serialized, /stage context remains available/u);
    for (const stage of current.stages) {
      assert.equal(result.lanes.agentCustomize.data.envelopes[stage].status, "unavailable");
      assert.match(result.lanes.agentCustomize.data.envelopes[stage].error.code, /_UNAVAILABLE$/u);
    }
    assert.doesNotMatch(
      serialized,
      /PRIVATE_SKILL_SECRET_X|PRIVATE_INSTRUCTION_SECRET_Y|sk-test-secret-credential|configuredDigest|symlinkTargetRealpath/u,
    );
    assert.doesNotMatch(
      serialized,
      /existedAtSessionTime|usedInSession|influencedSession|sameHistoricalAsset|historicalAbsence/u,
    );
  });
}

test("lead receives configured cwd while Project Harness remains on its generic Git scope", async () => {
  const canonicalCwd = await realpath(".");
  let leadOptions;
  const bundle = await collectEvidenceBundle({
    workspace: ".",
    cwd: ".",
    platform: "codex",
  }, dependencies({
    analyzeHarnessEvidence: async (options) => {
      leadOptions = options;
      return leadEvidence();
    },
  }));

  assert.equal(bundle.context.cwd, canonicalCwd);
  assert.equal(leadOptions.cwd, canonicalCwd);

  const context = {
    ...bundle.context,
    cwd: path.join(canonicalCwd, "configured-nested-cwd"),
  };
  let projectOptions;
  const projectLane = await collectProjectHarness(context, {}, {
    buildEvidencePack: async (options) => {
      projectOptions = options;
      return { kind: "core-change-watch-evidence-pack", status: "ok" };
    },
  });
  assert.equal(projectLane.status, "available");
  assert.equal(projectOptions.cwd, context.topology.gitRoot);
  assert.notEqual(projectOptions.cwd, context.cwd);
  assert.equal(Object.hasOwn(projectOptions, "configuredCwd"), false);
});

test("DSH bundle composes all lanes without merging current configuration into historical observation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-dsh-bundle-"));
  try {
    const workspace = path.join(root, "workspace");
    const cwd = path.join(workspace, "src");
    await mkdir(cwd, { recursive: true });
    const safeRequestSummary = "PRIVATE_ORDINARY_PROSE_X api_key=<redacted> <path>";
    const currentConfiguredAt = "2026-07-24T07:00:00.000Z";
    let leadOptions;
    const result = await collectEvidenceBundle({
      workspace,
      cwd,
      platform: "dsh",
      depth: "normal",
    }, dependencies({
      collectSessionEvidence: async () => availableLane(sessionFacts({
        candidates: [{
          timestamp: "2026-07-01T07:00:00.000Z",
          request: { summary: safeRequestSummary },
          configuredSkills: [],
          observedSkills: [],
        }],
      })),
      collectAgentCustomize: async () => availableLane({
        kind: "agent-asset-baseline",
        schemaVersion: 2,
        status: "complete",
        scope: {
          provider: "dsh",
          workspace,
          cwd,
          includeUserHome: false,
          includeMemories: false,
        },
        configuredSnapshot: {
          collectedAt: currentConfiguredAt,
          evidenceKind: "configured-not-observed",
        },
        envelopes: {
          lint: { status: "available", data: {} },
          inventory: { status: "available", data: { coverageRows: [] } },
          integrity: { status: "available", data: {} },
        },
      }),
      analyzeHarnessEvidence: async (options) => {
        leadOptions = options;
        return leadEvidence();
      },
    }));

    assert.equal(result.schemaVersion, 3);
    assert.equal(result.status, "complete");
    assert.equal(result.context.provider, "dsh");
    assert.equal(result.context.cwd, await realpath(cwd));
    assert.deepEqual(
      Object.fromEntries(Object.entries(result.lanes).map(([name, lane]) => [name, lane.status])),
      { sessionEvidence: "available", projectHarness: "available", agentCustomize: "available" },
    );
    assert.equal(result.lead.status, "available");
    assert.equal(leadOptions.cwd, result.context.cwd);
    assert.equal(result.diagnostics.collectionMode, "frozen-context-multi-owner");
    assert.equal(result.lanes.agentCustomize.data.configuredSnapshot.collectedAt, currentConfiguredAt);
    assert.equal(result.lanes.sessionEvidence.data.candidates[0].configuredSkills.length, 0);
    assert.equal(result.lanes.sessionEvidence.data.candidates[0].observedSkills.length, 0);
    const serialized = JSON.stringify(result);
    assert.match(serialized, /PRIVATE_ORDINARY_PROSE_X/u);
    assert.doesNotMatch(serialized, /sk-test-secret-credential|\/Users\/synthetic-private-home/u);
    assert.doesNotMatch(
      serialized,
      /existedAtSessionTime|usedInSession|influencedSession|sameHistoricalAsset|historicalAbsence/u,
    );
    assert.doesNotMatch(
      serialized,
      /PRIVATE_SKILL_SECRET_X|PRIVATE_INSTRUCTION_SECRET_Y|configuredDigest|symlinkTargetRealpath/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("DSH preserves the existing normal and quick Bundle completeness matrix", async () => {
  const cases = [
    { name: "normal complete", depth: "normal", overrides: {}, expected: "complete" },
    {
      name: "normal specialist partial",
      depth: "normal",
      overrides: { collectAgentCustomize: async () => ({ status: "partial", data: { kind: "agent-asset-baseline" } }) },
      expected: "failed",
    },
    {
      name: "normal topology partial",
      depth: "normal",
      overrides: { resolveWorkspaceTopology: async ({ workspace }) => topologyResolution(workspace, "partial") },
      expected: "failed",
    },
    {
      name: "normal lead unavailable",
      depth: "normal",
      overrides: { analyzeHarnessEvidence: async () => { throw Object.assign(new Error("lead failed"), { code: "LEAD_FAILED" }); } },
      expected: "failed",
    },
    { name: "quick complete", depth: "quick", overrides: {}, expected: "complete" },
    {
      name: "quick specialist partial",
      depth: "quick",
      overrides: { collectAgentCustomize: async () => ({ status: "partial", data: { kind: "agent-asset-baseline" } }) },
      expected: "partial",
    },
    {
      name: "quick topology partial",
      depth: "quick",
      overrides: { resolveWorkspaceTopology: async ({ workspace }) => topologyResolution(workspace, "partial") },
      expected: "partial",
    },
    {
      name: "quick lead unavailable",
      depth: "quick",
      overrides: { analyzeHarnessEvidence: async () => { throw Object.assign(new Error("lead failed"), { code: "LEAD_FAILED" }); } },
      expected: "failed",
    },
  ];

  for (const current of cases) {
    const result = await collectEvidenceBundle({
      workspace: ".",
      platform: "dsh",
      depth: current.depth,
    }, dependencies(current.overrides));
    assert.equal(result.status, current.expected, current.name);
  }
});

test("session lane preserves empty coverage but lowers incomplete Cursor coverage", async () => {
  const context = freezeEvidenceBundleContext({
    workspace: ".",
    platform: "cursor",
    depth: "normal",
  }, NOW);
  const collect = (status) => collectSessionEvidence(context, {}, {
    createAnalyzer: async () => ({
      analyze: async () => ({
        kind: "session-core-facts",
        candidates: [],
        sourceCoverage: { status },
      }),
    }),
  });

  assert.equal((await collect("absent")).status, "available");
  assert.equal((await collect("out-of-window")).status, "available");
  assert.equal((await collect("observed")).status, "available");
  assert.equal((await collect("unobserved")).status, "partial");
  assert.equal((await collect("partial")).status, "partial");
});

test("normal evidence bundle fails closed on partial Cursor Session coverage", async () => {
  const result = await collectEvidenceBundle({
    workspace: ".",
    platform: "cursor",
    depth: "normal",
  }, dependencies({
    collectSessionEvidence: async () => ({
      status: "partial",
      data: { kind: "session-core-facts", candidates: [], sourceCoverage: { status: "unobserved" } },
    }),
  }));

  assert.equal(result.status, "failed");
  assert.deepEqual(result.diagnostics.partialLanes, ["sessionEvidence"]);
  assert.deepEqual(result.diagnostics.incompleteLanes, ["sessionEvidence"]);
});

test("Claude agentCustomize lane routes the provider and isolated config paths", async () => {
  const context = freezeEvidenceBundleContext({
    workspace: ".",
    platform: "claude",
    depth: "quick",
    "include-user-home": true,
  }, NOW);
  let received;
  const lane = await collectAgentCustomize(context, {
    "claude-home": "/tmp/fixture-claude-home",
    "claude-state": "/tmp/fixture-claude-state.json",
  }, {
    collectAssetBaseline: async (options) => {
      received = options;
      return validAssetBaseline(context);
    },
  });

  assert.equal(lane.status, "available");
  assert.equal(received.provider, "claude");
  assert.equal(received["claude-home"], "/tmp/fixture-claude-home");
  assert.equal(received["claude-state"], "/tmp/fixture-claude-state.json");
  assert.equal(received["include-user-home"], true);
});

test("normal agentCustomize evidence accepts a disclosed latest-route sample", async () => {
  const context = freezeEvidenceBundleContext({
    workspace: ".",
    platform: "codex",
    depth: "normal",
    "include-user-home": true,
  }, NOW);
  const baseline = validAssetBaseline(context, {
    envelopes: {
      lint: { status: "available", data: {} },
      inventory: {
        status: "available",
        data: {
          ownerRoutes: {
            items: Array.from({ length: 16 }, (_, index) => ({ name: `asset-${index}` })),
            total: 55,
            omitted: 39,
            truncated: true,
            selection: { strategy: "latest-modified", limit: 16 },
          },
        },
      },
      integrity: { status: "available", data: {} },
    },
    diagnostics: { truncatedStages: [], sampledStages: ["inventory-owner-routes"] },
  });
  const lane = await collectAgentCustomize(context, {}, {
    collectAssetBaseline: async () => baseline,
  });

  assert.equal(lane.status, "available");
  assert.equal(lane.data, baseline);
});

test("Qwen agentCustomize lane routes the provider and isolated config paths", async () => {
  const context = freezeEvidenceBundleContext({
    workspace: ".",
    platform: "qwen",
    depth: "quick",
    "include-user-home": true,
  }, NOW);
  let received;
  const lane = await collectAgentCustomize(context, {
    "qwen-home": "/tmp/fixture-qwen-home",
  }, {
    collectAssetBaseline: async (options) => {
      received = options;
      return validAssetBaseline(context);
    },
  });

  assert.equal(lane.status, "available");
  assert.equal(received.provider, "qwen");
  assert.equal(received["qwen-home"], "/tmp/fixture-qwen-home");
  assert.equal(received["include-user-home"], true);
});

test("Pi agentCustomize lane routes the provider and isolated config paths", async () => {
  const context = freezeEvidenceBundleContext({
    workspace: ".",
    platform: "pi",
    depth: "quick",
    "include-user-home": true,
  }, NOW);
  let received;
  const lane = await collectAgentCustomize(context, {
    "pi-home": "/tmp/fixture-pi-home",
  }, {
    collectAssetBaseline: async (options) => {
      received = options;
      return validAssetBaseline(context);
    },
  });

  assert.equal(lane.status, "available");
  assert.equal(received.provider, "pi");
  assert.equal(received["pi-home"], "/tmp/fixture-pi-home");
  assert.equal(received["include-user-home"], true);
});

test("Kimi agentCustomize lane routes the provider and isolated config paths", async () => {
  const context = freezeEvidenceBundleContext({
    workspace: ".",
    platform: "kimi",
    depth: "quick",
    "include-user-home": true,
  }, NOW);
  let received;
  const lane = await collectAgentCustomize(context, {
    "kimi-home": "/tmp/fixture-kimi-home",
  }, {
    collectAssetBaseline: async (options) => {
      received = options;
      return validAssetBaseline(context);
    },
  });

  assert.equal(lane.status, "available");
  assert.equal(received.provider, "kimi");
  assert.equal(received["kimi-home"], "/tmp/fixture-kimi-home");
  assert.equal(received["include-user-home"], true);
});


test("shared Session population excludes the active session before both lanes hydrate", async () => {
  const population = Object.freeze({
    sessions: Object.freeze([{ sessionId: "eligible-session" }]),
    binding: POPULATION_BINDING,
  });
  let lanePopulation;
  let leadPopulation;
  const result = await collectEvidenceBundle({
    workspace: ".",
    platform: "codex",
    depth: "normal",
  }, dependencies({
    collectSessionPopulation: async () => population,
    collectSessionEvidence: async (_context, _options, received) => {
      lanePopulation = received.sessionPopulation;
      return availableLane(sessionFacts());
    },
    analyzeHarnessEvidence: async (options) => {
      leadPopulation = options.sessionPopulation;
      return leadEvidence();
    },
  }));

  assert.equal(lanePopulation, population);
  assert.equal(leadPopulation, population);
  assert.equal(result.status, "complete");
  assert.equal(result.diagnostics.sessionPopulationBinding.status, "bound");
  assert.equal(result.diagnostics.sessionPopulationBinding.population.eligible.count, 1);
  assert.doesNotMatch(JSON.stringify(result), /eligible-session/u);
});

test("Session population conflict fails closed with a redacted stable code", async () => {
  const result = await collectEvidenceBundle({ workspace: ".", platform: "codex" }, dependencies({
    analyzeHarnessEvidence: async () => leadEvidence({
      sessionBinding: {
        ...leadEvidence().sessionBinding,
        population: {
          ...POPULATION_BINDING,
          eligible: { count: 2, fingerprint: "6666666666666666" },
        },
      },
    }),
  }));

  assert.equal(result.status, "failed");
  assert.equal(result.lead.status, "unavailable");
  assert.equal(result.lead.error.code, "SESSION_POPULATION_BINDING_MISMATCH");
  assert.equal(result.diagnostics.sessionPopulationBinding.status, "conflict");
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /eligible-session/u);
  assert.doesNotMatch(serialized, /"sessionId"/u);
});

test("Session population conflict rejects lead counts that contradict its binding", async () => {
  const result = await collectEvidenceBundle({ workspace: ".", platform: "codex" }, dependencies({
    analyzeHarnessEvidence: async () => leadEvidence({
      summaryFacts: {
        evidenceBoundary: {
          manifest: { selection: { eligibleCount: 2, analyzedCount: 1 } },
          episodeCoverage: { episodeCount: 0 },
        },
      },
    }),
  }));

  assert.equal(result.status, "failed");
  assert.equal(result.lead.error.code, "SESSION_POPULATION_BINDING_MISMATCH");
  assert.equal(result.diagnostics.sessionPopulationBinding.status, "conflict");
});

test("Session facts reject counts that contradict the shared all-eligible population", async () => {
  await assert.rejects(
    collectSessionEvidence(freezeEvidenceBundleContext({ workspace: ".", platform: "codex" }, NOW), {}, {
      sessionPopulation: {
        sessions: [{ sessionId: "eligible-session" }],
        binding: POPULATION_BINDING,
      },
      createAnalyzer: async () => ({
        analyze: async () => sessionFacts({
          scope: { eligibleSessions: 1, selectedSessions: 0 },
        }),
      }),
    }),
    (error) => error?.code === "SESSION_POPULATION_BINDING_MISMATCH",
  );
});

test("Claude population freeze and Session facts agree under one frozen topology", async () => {
  const fixture = await realpath(await mkdtemp(path.join(os.tmpdir(), "evidence-bundle-claude-binding-")));
  try {
    const workspace = path.join(fixture, "workspace");
    const elsewhere = path.join(fixture, "elsewhere");
    const home = path.join(fixture, ".claude");
    await mkdir(workspace, { recursive: true });
    const projectRoot = path.join(home, "projects", workspaceToClaudeSlugVariants(workspace)[0]);
    await mkdir(projectRoot, { recursive: true });
    const row = (sessionId, cwd, second) => JSON.stringify({
      type: "user",
      sessionId,
      cwd,
      timestamp: `2026-07-20T10:00:0${second}.000Z`,
      message: { role: "user", content: [{ type: "text", text: "Inspect the selected workspace" }] },
    });
    await writeFile(
      path.join(projectRoot, "clean-private.jsonl"),
      `${row("clean-private", workspace, 0)}\n${row("clean-private", workspace, 1)}\n`,
    );
    await writeFile(
      path.join(projectRoot, "conflict-private.jsonl"),
      `${row("conflict-private", workspace, 0)}\n${row("conflict-private", elsewhere, 1)}\n`,
    );
    const resolution = topologyResolution(workspace);
    const context = freezeEvidenceBundleContext({
      workspace,
      platform: "claude",
      depth: "normal",
      since: "2026-07-01T00:00:00.000Z",
      until: "2026-07-24T08:00:00.000Z",
      topology: resolution.topology,
      analysisScope: resolution.analysisScope,
    }, NOW);
    const options = { "claude-home": home };

    const population = await collectSessionPopulation(context, options);
    assert.equal(population.binding.eligible.count, 1);

    const lane = await collectSessionEvidence(context, options, { sessionPopulation: population });
    assert.equal(lane.status, "available");
    assert.equal(lane.data.scope.eligibleSessions, population.binding.eligible.count);
    assert.equal(lane.data.scope.selectedSessions, population.binding.eligible.count);
    assert.doesNotMatch(JSON.stringify(lane.data), /clean-private|conflict-private/u);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("zero-signal Episode admission remains valid inside one bound population", async () => {
  const result = await collectEvidenceBundle({ workspace: ".", platform: "codex" }, dependencies());

  assert.equal(result.status, "complete");
  assert.equal(result.lead.status, "available");
  assert.deepEqual(result.diagnostics.sessionPopulationBinding.episodes, {
    comparison: "not-comparable-selection-or-policy",
    sessionTaskEpisodes: 1,
    leadProjectedEpisodes: 1,
    leadRetainedEpisodes: 0,
    leadZeroSignalDiscardedEpisodes: 1,
  });
});


test("WorkBuddy agentCustomize lane routes the provider and isolated config paths", async () => {
  const context = freezeEvidenceBundleContext({
    workspace: ".",
    platform: "workbuddy",
    depth: "quick",
    "include-user-home": true,
  }, NOW);
  let received;
  const lane = await collectAgentCustomize(context, {
    "workbuddy-home": "/tmp/fixture-workbuddy-home",
  }, {
    collectAssetBaseline: async (options) => {
      received = options;
      return validAssetBaseline(context);
    },
  });

  assert.equal(lane.status, "available");
  assert.equal(received.provider, "workbuddy");
  assert.equal(received["workbuddy-home"], "/tmp/fixture-workbuddy-home");
  assert.equal(received["include-user-home"], true);
});

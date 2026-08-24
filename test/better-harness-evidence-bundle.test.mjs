import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EVIDENCE_BUNDLE_KIND,
  collectEvidenceBundle,
  freezeEvidenceBundleContext,
} from "../scripts/harness-analysis/evidence-bundle/index.mjs";
import { availableLane } from "../scripts/harness-analysis/evidence-bundle/contract.mjs";
import {
  collectSessionEvidence,
  collectSessionPopulation,
} from "../scripts/harness-analysis/evidence-bundle/session-evidence.mjs";
import { workspaceToClaudeSlugVariants } from "../scripts/session-analysis/platforms/claude.mjs";
import { collectAgentCustomize } from "../scripts/harness-analysis/evidence-bundle/agent-customize.mjs";
import { EVIDENCE_BUNDLE_HELP } from "../scripts/harness-analysis/evidence-bundle/cli.mjs";

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

test("evidence-bundle help advertises WorkBuddy and its isolated home override", () => {
  assert.match(EVIDENCE_BUNDLE_HELP, /pi, kimi, workbuddy, or grok/u);
  assert.match(EVIDENCE_BUNDLE_HELP, /--workbuddy-home <dir>/u);
  assert.match(EVIDENCE_BUNDLE_HELP, /--grok-home <dir>/u);
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
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.status, "complete");
  assert.deepEqual(Object.keys(result.lanes), ["sessionEvidence", "projectHarness", "agentCustomize"]);
  assert.equal(result.context.provider, "codex");
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

test("asset provider unsupported capabilities reach the frozen bundle coverage boundary", async () => {
  const result = await collectEvidenceBundle({ workspace: ".", platform: "pi", depth: "quick" }, dependencies({
    collectSessionEvidence: async () => availableLane(sessionFacts({
      providerCoverage: {
        provider: "pi",
        status: "observed",
        configured: true,
        enabled: true,
        observed: true,
        verified: true,
        unsupported: [],
        unavailable: [],
        sourceCoverage: { status: "observed" },
      },
    })),
    collectAgentCustomize: async () => availableLane({
      kind: "agent-asset-baseline",
      status: "complete",
      envelopes: {
        inventory: { status: "available", data: { unsupported: ["pi runtime registration", "pi runtime registration"] } },
      },
    }),
  }));

  assert.equal(result.status, "complete");
  assert.deepEqual(result.diagnostics.unsupportedCapabilities, ["pi runtime registration"]);
  assert.deepEqual(result.diagnostics.providerCoverage.unsupportedCapabilities, ["pi runtime registration"]);
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
      return { kind: "agent-asset-baseline", status: "complete" };
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
  const baseline = {
    kind: "agent-asset-baseline",
    status: "complete",
    envelopes: {
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
    },
    diagnostics: { truncatedStages: [], sampledStages: ["inventory-owner-routes"] },
  };
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
      return { kind: "agent-asset-baseline", status: "complete" };
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
      return { kind: "agent-asset-baseline", status: "complete" };
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
      return { kind: "agent-asset-baseline", status: "complete" };
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
      return { kind: "agent-asset-baseline", status: "complete" };
    },
  });

  assert.equal(lane.status, "available");
  assert.equal(received.provider, "workbuddy");
  assert.equal(received["workbuddy-home"], "/tmp/fixture-workbuddy-home");
  assert.equal(received["include-user-home"], true);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  EVIDENCE_BUNDLE_KIND,
  collectEvidenceBundle,
  freezeEvidenceBundleContext,
} from "../scripts/harness-analysis/evidence-bundle/index.mjs";
import { availableLane } from "../scripts/harness-analysis/evidence-bundle/contract.mjs";
import { collectSessionEvidence } from "../scripts/harness-analysis/evidence-bundle/session-evidence.mjs";
import { collectAgentCustomize } from "../scripts/harness-analysis/evidence-bundle/agent-customize.mjs";

const NOW = new Date("2026-07-24T08:00:00.000Z");

function dependencies(overrides = {}) {
  return {
    now: () => NOW,
    collectSessionEvidence: async () => availableLane({ kind: "session-core-facts", candidates: [] }),
    collectProjectHarness: async () => availableLane({ kind: "core-change-watch-evidence-pack" }),
    collectAgentCustomize: async () => availableLane({ kind: "agent-asset-baseline", status: "complete" }),
    analyzeHarnessEvidence: async () => ({ evidence: "bounded", summaryFacts: { dimensions: [] } }),
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
  assert.equal(result.schemaVersion, 1);
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
  assert.equal(result.diagnostics.collectionMode, "frozen-context-multi-owner");
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

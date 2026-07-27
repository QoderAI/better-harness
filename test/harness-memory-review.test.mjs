import assert from "node:assert/strict";
import test from "node:test";

import { validateHarnessReportSource } from "../scripts/harness-analysis/report-source.mjs";
import {
  buildTaskLoopSourceCandidate,
  projectMemoryScan,
  projectMemorySessionActivity,
} from "../scripts/harness-analysis/task-loop-source.mjs";

function candidate({ platform = "qoder", topTools = [], topFunctionCalls = [], memoryInventory } = {}) {
  return buildTaskLoopSourceCandidate({
    scope: { platform, workspace: "/tmp/project" },
    selection: { strategy: "stratified", eligibleCount: 2, analyzedCount: 2, strata: [] },
    events: [{
      sessionId: "session-1",
      timestamp: "2026-07-13T10:00:00.000Z",
      type: "tool",
      toolName: "Edit",
      filePath: "/tmp/project/src/a.ts",
      evidenceRef: { kind: "fixture", id: "edit-1" },
    }, {
      sessionId: "session-1",
      timestamp: "2026-07-13T10:00:01.000Z",
      type: "tool",
      toolName: "Bash",
      validationCategory: "node --test",
      targetPaths: ["/tmp/project/src/a.ts"],
      success: true,
      evidenceRef: { kind: "fixture", id: "validation-1" },
    }],
    insights: { keySignals: { topTools, topFunctionCalls } },
    repositoryEvidence: {
      aiAgentPractice: {
        coverageRows: [{ surface: "Rules", scopes: ["Project"], count: 1, paths: ["AGENTS.md"] }],
      },
      diagnosticCoverageReviews: [{
        id: "core-diagnostic-coverage",
        status: "covered",
        affectedScope: "core/**",
        summary: "The bounded core diagnostic route was reviewed.",
        evidenceRefs: [{ kind: "review", id: "core-diagnostics" }],
      }],
    },
    memoryInventory,
  });
}

test("Memory activity in selected Skill sessions is preserved independently from inventory", () => {
  assert.deepEqual(projectMemorySessionActivity({
    keySignals: {
      topSkills: [{ name: "harness", count: 2 }],
      topTools: [
        { name: "search_memory", count: 2 },
        { name: "mcp__quest__search_memory", count: 1 },
        { name: "update_memory", count: 1 },
        { name: "Skill", count: 4 },
      ],
    },
  }), [
    { name: "retrieve", count: 3 },
    { name: "write", count: 1 },
  ]);

  assert.deepEqual(projectMemorySessionActivity({
    keySignals: { topFunctionCalls: [{ name: "SearchMemory", count: 2 }] },
  }), [{ name: "retrieve", count: 2 }]);
});

test("Memory metadata scan states do not collapse into an empty path list", () => {
  assert.deepEqual(projectMemoryScan({
    included: true,
    categories: [{ category: "project", count: 2 }],
  }, "qoder"), {
    status: "scanned-present",
    provider: "qoder",
    candidateCount: 2,
    contentPolicy: "metadata-only",
  });
  assert.equal(projectMemoryScan({ included: true, categories: [] }, "qoder").status, "scanned-empty");
  assert.equal(projectMemoryScan({ included: false, categories: [] }, "codex").status, "not-scanned");
  assert.equal(projectMemoryScan(undefined, "qoder"), null);
});

test("missing or empty Memory coverage remains a metadata boundary, not a finding", () => {
  for (const memoryInventory of [
    { included: false, categories: [] },
    { included: true, categories: [] },
  ]) {
    const source = candidate({ memoryInventory });
    const diagnostics = source.repositoryEvidence.learningCaptureDiagnostics;
    assert.ok(["not-scanned", "scanned-empty"].includes(diagnostics.signals.memoryScan.status));
    assert.equal(source.repositoryEvidence.findings?.some((row) => row.id === "memory-coverage-route-gap") ?? false, false);
    assert.doesNotMatch(JSON.stringify(source), /memory query|result title|private memory body/i);
    assert.deepEqual(validateHarnessReportSource(source), []);
  }
});

test("observed Memory retrieval suppresses the scanned-empty enablement finding", () => {
  const source = candidate({
    topTools: [{ name: "search_memory", count: 2 }],
    memoryInventory: { included: true, categories: [] },
  });
  const diagnostics = source.repositoryEvidence.learningCaptureDiagnostics;

  assert.deepEqual(diagnostics.signals.memoryActivity, [{ name: "retrieve", count: 2 }]);
  assert.equal(diagnostics.signals.memoryScan.status, "scanned-empty");
  assert.equal(source.repositoryEvidence.findings?.some((row) => row.id === "memory-coverage-route-gap") ?? false, false);
  assert.deepEqual(validateHarnessReportSource(source), []);
});

test("Memory signal validation rejects private or unsupported packet fields", () => {
  const source = candidate({ memoryInventory: { included: true, categories: [] } });
  source.repositoryEvidence.learningCaptureDiagnostics.signals.memoryScan.query = "private query";
  source.repositoryEvidence.learningCaptureDiagnostics.signals.memoryActivity = [{ name: "inject", count: 1 }];
  source.repositoryEvidence.learningCaptureDiagnostics.signals.memories = ["~/.qoder/memories/account/projects/demo/project_introduction"];

  const errors = validateHarnessReportSource(source);
  assert.ok(errors.some((error) => error.includes("memoryScan has unsupported field: query")));
  assert.ok(errors.some((error) => error.includes("memoryActivity contains an unsupported activity")));
  assert.ok(errors.some((error) => error.includes("signals.memories must contain only project-relative or home-relative paths to .md files")));
});

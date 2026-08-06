import assert from "node:assert/strict";
import test from "node:test";

import { createHarnessReportSource, validateHarnessReportSource } from "../scripts/harness-analysis/report-source.mjs";
import { buildObservationManifest } from "../scripts/session-analysis/observation-manifest.mjs";

function manifest() {
  return buildObservationManifest({
    scope: { platform: "qoder", workspace: "/workspace/example" },
    eligibleCount: 10,
    analyzedCount: 10,
    selectionStrategy: "all-eligible",
    adapterVersion: "qoder-v2",
  });
}

test("report source fixes the v3 evidence domains without raw transcript fields", () => {
  const source = createHarnessReportSource({
    manifest: manifest(),
    repositoryEvidence: { rulesPresent: true },
    sessionEvents: { eventCount: 12 },
    taskEpisodes: [{ id: "episode-1", sessionCount: 1, continuation: "session-bounded" }],
    deliveryEvidence: [{
      id: "delivery-1",
      episodeRef: "episode-1",
      level: "relevant-focused-checks-passed",
      status: "passed",
      evidenceRefs: [{ kind: "fixture", line: 4 }],
    }],
    semanticFacets: [],
    interventionLedger: [],
    evidenceRefs: [{ kind: "fixture", line: 4 }],
    assessmentDecisions: [{ kind: "radius", status: "unobserved" }],
  });

  assert.equal(source.kind, "harness-report-source");
  assert.equal(source.schemaVersion, 3);
  assert.deepEqual(validateHarnessReportSource(source), []);
});

test("report source v3 validates bounded permission summaries and retires event arrays", () => {
  const source = createHarnessReportSource({
    manifest: manifest(),
    sessionEvents: {
      permissionSummary: {
        observed: 2,
        routineAllowed: 1,
        prompted: 1,
        denied: 0,
        escalated: 0,
        protectedActions: 1,
      },
    },
    taskEpisodes: [{
      id: "episode-1",
      sessionCount: 1,
      continuation: "session-bounded",
      permissionSummary: {
        prompted: 1,
        denied: 0,
        escalated: 0,
        protectedActions: 1,
        evidenceRefs: [{ kind: "fixture", id: "permission-1" }],
      },
    }],
  });
  assert.deepEqual(validateHarnessReportSource(source), []);

  const malformed = structuredClone(source);
  malformed.sessionEvents.permissionSummary.observed = 9;
  malformed.taskEpisodes[0].permissionDecisions = [{ decision: "allowed" }];
  malformed.taskEpisodes[0].permissionSummary.evidenceRefs = Array.from({ length: 4 }, (_, index) => ({
    kind: "fixture",
    id: `permission-${index + 1}`,
  }));
  const errors = validateHarnessReportSource(malformed).join("; ");
  assert.match(errors, /observed must equal routineAllowed plus protectedActions/u);
  assert.match(errors, /permissionDecisions is retired/u);
  assert.match(errors, /at most three references/u);
});

test("report source rejects unsafe raw content, unsupported delivery grades, and guessed continuation", () => {
  const source = {
    schemaVersion: 2,
    kind: "harness-report-source",
    manifest: manifest(),
    repositoryEvidence: { rawPrompt: "private request" },
    sessionEvents: {},
    taskEpisodes: [{ id: "episode-1", sessionCount: 2, continuation: "session-bounded" }],
    deliveryEvidence: [{ id: "delivery-1", level: "completed" }],
    semanticFacets: [],
    interventionLedger: [],
    evidenceRefs: [],
    assessmentDecisions: [],
  };

  const errors = validateHarnessReportSource(source);
  assert.ok(errors.some((error) => error.includes("rawPrompt")));
  assert.ok(errors.some((error) => error.includes("unsupported level")));
  assert.ok(errors.some((error) => error.includes("without explicit continuation")));
});

test("report source accepts only versioned, privacy-safe semantic facets", () => {
  const source = createHarnessReportSource({
    manifest: manifest(),
    semanticFacets: [{
      id: "goal-1",
      schemaVersion: 1,
      kind: "goal-workflow",
      status: "candidate",
      labels: ["refactor"],
      summary: "A bounded refactor workflow was inferred from redacted evidence.",
      evidenceRefs: [{ kind: "fixture", line: 8 }],
      modelVersion: "facet-fixture-v1",
    }],
  });
  assert.equal(source.semanticFacets[0].kind, "goal-workflow");

  const invalid = { ...source, semanticFacets: [{
    id: "bad-1",
    schemaVersion: 1,
    kind: "goal-workflow",
    status: "candidate",
    labels: ["refactor"],
    evidenceRefs: [],
    rawPrompt: "private request",
  }] };
  assert.ok(validateHarnessReportSource(invalid).some((error) => error.includes("rawPrompt")));
});

test("report source preserves provider unsupported capabilities and rejects unknown coverage fields", () => {
  const source = createHarnessReportSource({
    manifest: buildObservationManifest({
      scope: { platform: "pi", workspace: "/workspace/example" },
      eligibleCount: 1,
      analyzedCount: 1,
      selectionStrategy: "all-eligible",
      providerCoverage: {
        provider: "pi",
        status: "observed",
        configured: true,
        enabled: true,
        observed: true,
        verified: true,
        unsupported: [],
        unsupportedCapabilities: ["native MCP inventory"],
        unavailable: [],
        sourceCoverage: { status: "observed" },
      },
    }),
  });
  assert.deepEqual(validateHarnessReportSource(source), []);
  assert.deepEqual(source.manifest.providerCoverage.unsupportedCapabilities, ["native MCP inventory"]);

  const malformed = structuredClone(source);
  malformed.manifest.providerCoverage.extra = true;
  assert.ok(validateHarnessReportSource(malformed).some((error) => error.includes("providerCoverage has unsupported field: extra")));
});

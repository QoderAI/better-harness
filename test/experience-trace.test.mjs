import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createHarnessReportSource } from "../scripts/harness-analysis/report-source.mjs";
import { buildObservationManifest } from "../scripts/session-analysis/observation-manifest.mjs";
import {
  createExperienceTrace,
  projectQoderReportSource,
} from "../scripts/experience-trace/project-source.mjs";
import {
  experienceTraceValidationDocument,
  parseAndValidateExperienceTraceJsonl,
} from "../scripts/experience-trace/contract.mjs";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const NO_SESSION_FIXTURE = path.join(TEST_DIR, "..", "docs", "specs", "fixtures", "lc03-no-session-v1.jsonl");
const EPISODE_REF = "episode:111111111111";
const TASK_KEY = "task-key-00000001";
const WORKSPACE_KEY = "workspace-key-00000001";
const RUN_KEY = "run-key-00000001";
const PRIVATE_SENTINEL = "private-trace-sentinel-do-not-emit";

function source({
  noSession = false,
  warnings = ["missing-optional-root"],
  validationSets = [
    {
      category: "node --test",
      status: "passed",
      ordinal: 7,
      checkIdentity: "check:111111111111111111111111",
      targetKeys: ["aaaaaaaaaaaaaaaaaaaa"],
    },
  ],
} = {}) {
  const manifest = buildObservationManifest({
    scope: { platform: "qoder", workspace: "/workspace/private-project" },
    sources: [{
      id: "qoder-fixture",
      kind: "project-jsonl",
      enabled: true,
      exists: true,
      optional: false,
      workspaceScoped: true,
    }],
    warnings: warnings.map((code) => ({ code })),
    eligibleCount: noSession ? 0 : 10,
    analyzedCount: noSession ? 0 : 10,
    selectionStrategy: "all-eligible",
  });
  manifest.sources.fingerprint = "0123456789abcdef";

  return createHarnessReportSource({
    manifest,
    repositoryEvidence: {},
    sessionEvents: noSession ? {} : {
      permissionSummary: {
        observed: 1,
        routineAllowed: 0,
        prompted: 1,
        denied: 0,
        escalated: 0,
        protectedActions: 1,
      },
    },
    taskEpisodes: noSession ? [] : [{
      id: EPISODE_REF,
      sessionCount: 1,
      continuation: "session-bounded",
      startBoundary: "session-start",
      toolCalls: 3,
      changeSets: [{
        eventCount: 2,
        firstOrdinal: 1,
        lastOrdinal: 3,
        targetKeys: ["bbbbbbbbbbbbbbbbbbbb", "aaaaaaaaaaaaaaaaaaaa"],
      }],
      validationSets,
      permissionSummary: {
        prompted: 1,
        denied: 0,
        escalated: 0,
        protectedActions: 1,
        evidenceRefs: [{ kind: "fixture", id: "permission-private-path" }],
      },
      closure: { status: "closed", evidenceRefs: [] },
      repair: { status: "review-required", evidenceRefs: [] },
    }],
    deliveryEvidence: [],
    semanticFacets: [],
    interventionLedger: [],
    evidenceRefs: [],
    assessmentDecisions: [],
  });
}

function create(sourceValue, options = {}) {
  return createExperienceTrace(sourceValue, {
    taskKey: TASK_KEY,
    workspaceKey: WORKSPACE_KEY,
    runKey: RUN_KEY,
    episodeRef: EPISODE_REF,
    ...options,
  });
}

function assertCode(callback, code) {
  assert.throws(callback, (error) => error?.code === code && error.message === code);
}

test("Episode projection is deterministic, canonical, and round-trips through the contract", () => {
  const reportSource = source();
  const first = create(reportSource);
  const second = create(reportSource);

  assert.equal(first.jsonl, second.jsonl);
  assert.deepEqual(parseAndValidateExperienceTraceJsonl(first.jsonl), first.records);
  assert.deepEqual(experienceTraceValidationDocument(first.records), {
    kind: "better-harness.experience-trace.validation",
    schemaVersion: 1,
    valid: true,
    traceId: first.records[0].traceId,
    streamStatus: "complete",
    evidenceStatus: "partial",
    recordCount: first.records.length,
    eventCount: first.records.length - 2,
    traceDigest: first.records.at(-1).traceDigest,
  });
  assert.equal(first.records[0].binding.task.provenance, "caller-asserted");
  assert.equal(first.records[0].binding.episode.ref, EPISODE_REF);
});

test("explicit no-session output matches the normative JSONL fixture", async () => {
  const reportSource = source({ noSession: true, warnings: [] });
  const result = createExperienceTrace(reportSource, {
    taskKey: TASK_KEY,
    workspaceKey: WORKSPACE_KEY,
    runKey: RUN_KEY,
    noSessionEvidence: true,
  });
  const fixture = await readFile(NO_SESSION_FIXTURE, "utf8");

  assert.equal(result.jsonl, fixture);
  assert.equal(result.records.at(-1).evidenceStatus, "unavailable");
  assert.equal(result.records.filter((record) => record.kind.endsWith(".event")).length, 10);
});

test("no-session mode ignores unrelated retained Episodes instead of guessing one", () => {
  const result = createExperienceTrace(source(), {
    taskKey: TASK_KEY,
    workspaceKey: WORKSPACE_KEY,
    runKey: RUN_KEY,
    noSessionEvidence: true,
  });

  assert.equal(result.records[0].binding.episode.ref, null);
  assert.equal(result.records.at(-1).evidenceStatus, "unavailable");
  assert.doesNotMatch(result.jsonl, new RegExp(EPISODE_REF, "u"));
  assert.equal(result.records.filter((record) => record.eventType === "task-episode").length, 0);
});

test("validation references follow normalized ordinal order and sets canonicalize", () => {
  const reportSource = source({
    warnings: ["partial-secret-scan-coverage", "missing-optional-root", "partial-secret-scan-coverage"],
    validationSets: [
      {
        category: "npm test",
        status: "failed",
        ordinal: 9,
        checkIdentity: "check:999999999999999999999999",
        targetKeys: ["ffffffffffffffffffff", "aaaaaaaaaaaaaaaaaaaa", "ffffffffffffffffffff"],
      },
      {
        category: "node --test",
        status: "passed",
        ordinal: 2,
        checkIdentity: "check:222222222222222222222222",
        targetKeys: ["cccccccccccccccccccc", "bbbbbbbbbbbbbbbbbbbb"],
      },
    ],
  });
  const result = create(reportSource);
  const validationEvents = result.records.filter((record) => record.eventType === "validation-observation");

  assert.deepEqual(validationEvents.map((record) => [record.evidenceRef, record.payload.sourceOrdinal]), [
    ["source:validation:1", 2],
    ["source:validation:2", 9],
  ]);
  assert.deepEqual(validationEvents[1].payload.targetKeys, ["aaaaaaaaaaaaaaaaaaaa", "ffffffffffffffffffff"]);
  assert.deepEqual(result.records[0].selection.warningCodes, [
    "missing-optional-root",
    "partial-secret-scan-coverage",
  ]);
});

test("marker failures use the documented combined-failure precedence", () => {
  const invalidKind = source();
  invalidKind.schemaVersion = 99;
  invalidKind.kind = "not-a-report-source";
  invalidKind.manifest.scope.platform = "codex";
  assertCode(() => projectQoderReportSource(invalidKind, { episodeRef: EPISODE_REF }), "INVALID_REPORT_SOURCE");

  const unsupportedVersion = source();
  unsupportedVersion.schemaVersion = 99;
  unsupportedVersion.manifest.scope.platform = "codex";
  assertCode(() => projectQoderReportSource(unsupportedVersion, { episodeRef: EPISODE_REF }), "UNSUPPORTED_TRACE_SOURCE_VERSION");

  const unsupportedPlatform = source();
  unsupportedPlatform.manifest.scope.platform = "codex";
  assertCode(() => projectQoderReportSource(unsupportedPlatform, { episodeRef: EPISODE_REF }), "UNSUPPORTED_TRACE_PLATFORM");
});

test("source markers take precedence over direct-call selection errors", () => {
  const unsupportedVersion = source();
  unsupportedVersion.schemaVersion = 99;

  assertCode(
    () => projectQoderReportSource(unsupportedVersion, { episodeRef: "not-an-episode-ref" }),
    "UNSUPPORTED_TRACE_SOURCE_VERSION",
  );
});

test("unknown warnings and invalid projected fields fail without leaking their values", () => {
  const unknownWarning = source({ warnings: [PRIVATE_SENTINEL] });
  assert.throws(
    () => projectQoderReportSource(unknownWarning, { episodeRef: EPISODE_REF }),
    (error) => error?.code === "INVALID_REPORT_SOURCE" && !error.message.includes(PRIVATE_SENTINEL),
  );

  const missingToolCalls = source();
  delete missingToolCalls.taskEpisodes[0].toolCalls;
  assertCode(() => projectQoderReportSource(missingToolCalls, { episodeRef: EPISODE_REF }), "INVALID_REPORT_SOURCE");

  const tooManyChanges = source();
  tooManyChanges.taskEpisodes[0].changeSets = Array.from({ length: 17 }, () => ({
    eventCount: 0,
    firstOrdinal: 0,
    lastOrdinal: 0,
    targetKeys: [],
  }));
  assertCode(() => projectQoderReportSource(tooManyChanges, { episodeRef: EPISODE_REF }), "INVALID_REPORT_SOURCE");

  const tooManyTargets = source();
  tooManyTargets.taskEpisodes[0].changeSets[0].targetKeys = Array.from(
    { length: 13 },
    (_, index) => `${index.toString(16).padStart(20, "0")}`,
  );
  assertCode(() => projectQoderReportSource(tooManyTargets, { episodeRef: EPISODE_REF }), "INVALID_REPORT_SOURCE");

  const duplicateOrdinal = source({
    validationSets: [
      {
        category: "node --test",
        status: "passed",
        ordinal: 1,
        checkIdentity: "check:111111111111111111111111",
        targetKeys: [],
      },
      {
        category: "npm test",
        status: "failed",
        ordinal: 1,
        checkIdentity: "check:222222222222222222222222",
        targetKeys: [],
      },
    ],
  });
  assertCode(() => projectQoderReportSource(duplicateOrdinal, { episodeRef: EPISODE_REF }), "INVALID_REPORT_SOURCE");
});

test("unrelated nested source content never enters an allowlist projection", () => {
  const reportSource = source();
  reportSource.taskEpisodes[0].unrelatedDebug = {
    opaquePrivateValue: PRIVATE_SENTINEL,
    nested: { value: PRIVATE_SENTINEL },
  };

  const result = create(reportSource);
  assert.doesNotMatch(result.jsonl, new RegExp(PRIVATE_SENTINEL, "u"));
  assert.doesNotMatch(JSON.stringify(result.records), /permission-private-path/u);
});

test("deep source input fails at the iterative preflight boundary", () => {
  const reportSource = source();
  let cursor = reportSource.taskEpisodes[0];
  for (let index = 0; index <= 64; index += 1) {
    cursor.nested = {};
    cursor = cursor.nested;
  }
  assertCode(() => projectQoderReportSource(reportSource, { episodeRef: EPISODE_REF }), "INVALID_REPORT_SOURCE");
});

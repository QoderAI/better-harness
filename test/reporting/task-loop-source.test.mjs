import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { buildCheckupScan } from "../../scripts/coding-agent-practices/checkup/scan.mjs";
import { freezeSessionPopulation } from "../../scripts/session-analysis/session-population.mjs";
import {
  bindSessionWorkspaceCwds,
  sessionWorkspaceCwds,
} from "../../scripts/session-analysis/provider-runner.mjs";
import {
  buildHarnessReviewPacket,
  validateHarnessReviewPacket,
} from "../../scripts/harness-analysis/report-review-packet.mjs";
import { applyEpisodeReviews } from "../../scripts/harness-analysis/episode-evidence-review.mjs";
import {
  LEARNING_CAPTURE_FINDING_POLICY,
  validateHarnessReportSource,
} from "../../scripts/harness-analysis/report-source.mjs";
import {
  LEARNING_CAPTURE_REVIEWED_SCORE_FLOOR,
} from "../../scripts/harness-analysis/fluency-dimensions.mjs";
import { projectTaskLoopFindings, validateTaskLoopFindings } from "../../scripts/harness-analysis/task-loop-report.mjs";
import { buildTaskLoopRepositoryEvidence } from "../../scripts/harness-analysis/task-loop-repository-evidence.mjs";
import {
  buildTaskLoopSourceCandidate,
  createTaskLoopSourceFromSessions,
  assertStandardUsageComplete,
  collectTaskLoopPracticeInventory,
  collectTrackedSensitiveConfigFiles,
  mergeUsageCensusInsights,
  loadCustomizationCheckupScan,
  normalizeReaderLocale,
  projectPracticeCoverageRows,
  projectMemoryScan,
  projectSessionUsageSummary,
  standardUsageEnabled,
} from "../../scripts/harness-analysis/task-loop-source.mjs";

test("Codex task-loop inventory scans only authorized Memory metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-codex-task-loop-memory-"));
  const workspace = path.join(root, "workspace");
  const codexHome = path.join(root, ".codex");
  const memoryPath = path.join(codexHome, "memories", "MEMORY.md");
  try {
    await mkdir(workspace, { recursive: true });
    await mkdir(path.dirname(memoryPath), { recursive: true });
    await writeFile(memoryPath, "private Codex memory body must never appear\n");
    await writeFile(path.join(codexHome, "config.toml"), "[features]\nmemories = true\n");

    const notAuthorized = await collectTaskLoopPracticeInventory({
      workspace,
      codexHome,
    }, "codex");
    assert.deepEqual(projectMemoryScan(notAuthorized.memories, "codex"), {
      status: "not-scanned",
      provider: "codex",
      candidateCount: 0,
      contentPolicy: "metadata-only",
    });

    const authorized = await collectTaskLoopPracticeInventory({
      workspace,
      codexHome,
      includeGlobalCapabilities: true,
    }, "codex");
    assert.deepEqual(projectMemoryScan(authorized.memories, "codex"), {
      status: "scanned-present",
      provider: "codex",
      candidateCount: 1,
      contentPolicy: "metadata-only",
    });
    assert.equal(authorized.memories.contentPolicy, "raw-memory-content-not-read");
    assert.doesNotMatch(JSON.stringify(authorized), /private Codex memory body/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("DSH task-loop recollects current configured practice with frozen cwd and closed authority", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-dsh-task-loop-"));
  const repository = path.join(root, "repository");
  const workspace = path.join(repository, "packages", "api");
  const cwd = path.join(workspace, "src");
  const dshHome = path.join(root, "isolated-dsh-home");
  try {
    await mkdir(path.join(repository, ".git"), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await mkdir(path.join(repository, ".dsh", "skills", "current-review"), { recursive: true });
    await mkdir(path.join(dshHome, "skills", "private-user"), { recursive: true });
    await writeFile(path.join(workspace, "AGENTS.md"), "PRIVATE_INSTRUCTION_SECRET_Y\n");
    await writeFile(path.join(cwd, "AGENTS.local.md"), "nested local instruction\n");
    await writeFile(
      path.join(repository, ".dsh", "skills", "current-review", "SKILL.md"),
      "---\nname: current-review\ndescription: Current review\n---\nPRIVATE_SKILL_SECRET_X\n",
    );
    await writeFile(
      path.join(dshHome, "skills", "private-user", "SKILL.md"),
      "---\nname: private-user\ndescription: Private user skill\n---\nUSER_HOME_CANARY\n",
    );

    const options = {
      workspace,
      cwd,
      dshHome,
      includeGlobalCapabilities: false,
    };
    const first = await collectTaskLoopPracticeInventory(options, "dsh");
    const second = await collectTaskLoopPracticeInventory(options, "dsh");
    const canonicalWorkspace = await realpath(workspace);
    const canonicalCwd = await realpath(cwd);

    assert.ok(first);
    assert.notEqual(first, second);
    assert.equal(first.scope.platform, "dsh");
    assert.equal(first.scope.workspace, canonicalWorkspace);
    assert.equal(first.scope.cwd, canonicalCwd);
    assert.equal(first.scope.includeUserHome, false);
    assert.deepEqual(
      first.summary.practiceCoverageRows.map((row) => row.surface),
      ["Rules", "Skills"],
    );
    assert.ok(first.surfaces.some((surface) =>
      surface.type === "rules"
      && surface.items.some((item) => item.path === path.join(canonicalCwd, "AGENTS.local.md"))));
    const serialized = JSON.stringify(first);
    assert.doesNotMatch(serialized, /PRIVATE_SKILL_SECRET_X|PRIVATE_INSTRUCTION_SECRET_Y|USER_HOME_CANARY/u);
    for (const forbiddenClaim of [
      "existedAtSessionTime",
      "usedInSession",
      "influencedSession",
      "historicalAbsence",
      "sameHistoricalAsset",
    ]) {
      assert.equal(serialized.includes(forbiddenClaim), false);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("explicit Checkup scan files bridge into sanitized durable report evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-checkup-source-"));
  const scanPath = path.join(root, "checkup.scan.json");
  try {
    const scan = buildCheckupScan({
      inventory: {
        plugins: [],
        manage: {
          skills: [{
            kind: "skill", name: "unused-review", scope: "project", sourceLabel: "fixture",
            installedAt: "2026-01-01T00:00:00.000Z", enabled: true,
          }],
          mcps: [], hooks: [], rules: [], commands: [], subagents: [],
        },
      },
      sessionResult: {
        sources: [{ id: "fixture", kind: "project-jsonl", exists: true, enabled: true, workspaceScoped: true }],
        selection: { strategy: "all-eligible", eligibleCount: 5, analyzedCount: 5 },
        facets: { sessionCount: 5, analyzedSessionCount: 5, topSkills: [], topHooks: [], topTools: [] },
      },
      options: {
        provider: "qoder",
        workspace: "/workspace/private-project",
        workspaceLabel: "private-project",
        now: "2026-07-13T00:00:00.000Z",
      },
    });
    await writeFile(scanPath, `${JSON.stringify(scan, null, 2)}\n`);

    const evidence = await loadCustomizationCheckupScan(scanPath, {
      provider: "qoder",
      workspace: "/workspace/private-project",
    });

    assert.equal(evidence.phase, "report-evidence");
    assert.equal(evidence.findings.length, 1);
    assert.equal(evidence.findings[0].status, "candidate");
    assert.equal("configuredInventory" in evidence, false);
    await assert.rejects(
      loadCustomizationCheckupScan(scanPath, { provider: "codex", workspace: "/workspace/private-project" }),
      /does not match report platform/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function event({
  sessionId = "session-private-a",
  timestamp,
  type = "tool",
  toolName,
  filePath,
  targetPaths,
  validationCategory,
  success,
  ...rest
} = {}) {
  return {
    sessionId,
    timestamp,
    type,
    toolName,
    filePath,
    targetPaths,
    validationCategory,
    success,
    evidenceRef: {
      kind: "fixture-event",
      path: "/Users/example/private-project/src/secret.ts",
      line: rest.line ?? 1,
      type,
    },
    ...rest,
  };
}

function candidate(events, insights = {}, options = {}) {
  return buildTaskLoopSourceCandidate({
    scope: {
      platform: "qoder",
      workspace: "/Users/example/private-project",
      until: "2026-07-10T16:46:07Z",
    },
    sources: [{
      id: "qoder-projects",
      kind: "project-jsonl",
      path: "/Users/example/.qoder/projects/private-project",
      enabled: true,
      exists: true,
      optional: true,
      workspaceScoped: true,
    }],
    warnings: [{ code: "missing-optional-root" }],
    selection: {
      strategy: "stratified",
      eligibleCount: 9,
      analyzedCount: 3,
      strata: ["time"],
    },
    events,
    projectName: "private-project",
    locale: "zh-CN",
    insights,
    ...options,
  });
}

test("routine permission volume stays aggregate and does not retain permission-only Episodes", () => {
  const start = Date.parse("2026-07-10T10:00:00.000Z");
  const events = Array.from({ length: 171 }, (_, index) => event({
    sessionId: `session-${Math.floor(index / 50) + 1}`,
    timestamp: new Date(start + index * 1_000).toISOString(),
    toolName: "Bash",
    lifecyclePhase: "pre",
    toolInvocationId: `tool-${index + 1}`,
    permissionDecision: "allowed",
    permissionMode: index % 2 === 0 ? "unknown" : "default",
    line: index + 1,
  }));

  const source = candidate(events);
  const packet = buildHarnessReviewPacket(source);
  assert.deepEqual(source.sessionEvents.permissionSummary, {
    observed: 171,
    routineAllowed: 171,
    prompted: 0,
    denied: 0,
    escalated: 0,
    protectedActions: 0,
  });
  assert.equal(source.taskEpisodes.length, 0);
  assert.equal(source.sessionEvents.discardedEpisodeCount, 4);
  assert.equal(JSON.stringify(source).includes("permissionDecisions"), false);
  assert.equal(packet.allowedEvidenceRefs.some((reference) => reference.kind === "fixture-event"), false);
});

test("real permission boundaries retain one bounded Episode summary and packet evidence", () => {
  const source = candidate([
    event({ timestamp: "2026-07-10T10:00:00.000Z", toolName: "Bash", permissionDecision: "asked", line: 1 }),
    event({ timestamp: "2026-07-10T10:00:01.000Z", toolName: "Bash", permissionDecision: "denied", line: 2 }),
    event({ timestamp: "2026-07-10T10:00:02.000Z", toolName: "Bash", permissionDecision: "allowed", permissionMode: "bypassPermissions", line: 3 }),
    event({ timestamp: "2026-07-10T10:00:03.000Z", toolName: "Bash", protectedAction: true, line: 4 }),
  ]);
  const packet = buildHarnessReviewPacket(source);
  const permissionRefs = packet.allowedEvidenceRefs.filter((reference) => reference.id.includes("permission-summary"));

  assert.equal(source.taskEpisodes.length, 1);
  assert.deepEqual(source.sessionEvents.permissionSummary, {
    observed: 4,
    routineAllowed: 0,
    prompted: 1,
    denied: 1,
    escalated: 1,
    protectedActions: 4,
  });
  assert.deepEqual(source.taskEpisodes[0].permissionSummary, {
    prompted: 1,
    denied: 1,
    escalated: 1,
    protectedActions: 4,
    evidenceRefs: [
      { kind: "fixture-event", id: `${source.taskEpisodes[0].id}-permission-summary-1`, type: "tool", line: 1 },
      { kind: "fixture-event", id: `${source.taskEpisodes[0].id}-permission-summary-2`, type: "tool", line: 2 },
      { kind: "fixture-event", id: `${source.taskEpisodes[0].id}-permission-summary-3`, type: "tool", line: 3 },
    ],
  });
  assert.equal(permissionRefs.length, 3);
});

function reviewed(source) {
  const reviewedSource = structuredClone(source);
  applyEpisodeReviews(reviewedSource, reviewedSource.taskEpisodes.map((episode) => ({
    episodeRef: episode.id,
    taskUnderstanding: ["goal-understanding", "relevant-context", "scope-boundary"].map((id) => ({
      id,
      state: "Exercised",
      summary: `${id} was reviewed for this bounded task episode`,
      evidenceRefs: episode.evidenceRefs,
    })),
    validationAssociations: episode.changeSets.flatMap((change) => episode.validationSets
      .filter((validation) => validation.status === "passed"
        && validation.ordinal > change.lastOrdinal
        && change.targetKeys.some((target) => validation.targetKeys.includes(target)))
      .slice(0, 1)
      .map((validation) => ({
        changeSetRef: change.id,
        validationSetRef: validation.id,
        relation: "relevant-after-change",
        summary: "The retained validation directly checks the bounded change set",
        evidenceRefs: validation.evidenceRefs,
      }))),
    repairReview: { state: "Unobserved" },
  })));
  reviewedSource.deliveryEvidence = reviewedSource.taskEpisodes
    .filter((episode) => episode.closure.status === "closed")
    .map((episode) => ({
      id: `${episode.id}:relevant-check`,
      episodeRef: episode.id,
      provider: "manual",
      kind: "validation",
      level: "relevant-focused-checks-passed",
      status: "passed",
      evidenceRefs: episode.closure.evidenceRefs,
    }));
  return {
    ...reviewedSource,
    repositoryEvidence: {
      ...reviewedSource.repositoryEvidence,
      diagnosticCoverageReviews: [{
        id: "core-diagnostic-coverage",
        status: "covered",
        affectedScope: "repository-wide",
        summary: "Representative core diagnostics were reviewed and no concrete gap was confirmed.",
        evidenceRefs: [{ kind: "repository-review", id: "core-diagnostic-coverage" }],
      }],
    },
    assessmentDecisions: reviewedSource.assessmentDecisions.map((decision) =>
      decision.kind === "source-candidate"
        ? { ...decision, status: "reviewed", evidenceRefs: [{ kind: "session-selection", id: "bounded-selection" }] }
        : decision.kind === "repository-review"
          ? {
              ...decision,
              status: "reviewed",
              reviewedFrameworks: decision.requiredFrameworks.map((id) => ({
                id,
                status: "reviewed",
                summary: `${id} walkthrough reviewed`,
                evidenceRefs: [{ kind: "repository-review", id }],
              })),
              reviewedChecks: decision.requiredChecks.map((id) => {
                const row = {
                  id,
                  status: "reviewed",
                  summary: `${id} check reviewed`,
                  ...(["regression-protection", "spec-alignment"].includes(id) ? { evidenceState: "Unobserved" } : {}),
                  evidenceRefs: [{ kind: "repository-review", id }],
                };
                if (!["lifecycle-repeat-detection", "loop-engineering", "later-validation"].includes(id)) return row;
                return {
                  ...row,
                  state: "Unobserved",
                  findingRefs: [],
                  ...(id === "loop-engineering" ? { mechanisms: [] } : {}),
                };
              }),
              reviewedSoftwareFluencyCapabilities: decision.requiredSoftwareFluencyCapabilities.map((id) => ({
                id,
                status: "reviewed",
                summary: `${id} capability reviewed`,
                evidenceRefs: [{ kind: "software-fluency-review", id }],
              })),
            }
          : decision.kind === "score-review"
            ? {
                ...decision,
                status: "reviewed",
                dimensions: decision.dimensions.map((row) => ({
                  ...row,
                  score: row.id === "learning-capture" ? LEARNING_CAPTURE_REVIEWED_SCORE_FLOOR : 35,
                  confidence: "medium",
                  reason: `${row.id} was reviewed against its three checks and current evidence boundary.`,
                  readerSummary: "当前证据支持这一判断，但仍缺少更强的任务结果。",
                  evidenceRefs: [{ kind: "score-review", id: row.id }],
                })),
              }
          : decision),
  };
}

test("reader locale aliases normalize before source projection", () => {
  assert.equal(normalizeReaderLocale("zh"), "zh-CN");
  assert.equal(normalizeReaderLocale("zh_CN"), "zh-CN");
  assert.equal(normalizeReaderLocale("en-US"), "en");

  const source = buildTaskLoopSourceCandidate({ locale: "zh", projectName: "中文项目" });
  assert.equal(source.repositoryEvidence.locale, "zh-CN");
});

test("source generation keeps usage opt-in and rejects incomplete requested census", () => {
  assert.equal(standardUsageEnabled(), false);
  assert.equal(standardUsageEnabled({ "include-usage": true }), true);
  assert.equal(standardUsageEnabled({ "include-usage": false }), false);
  assert.equal(standardUsageEnabled({ includeUsage: false }), false);

  assert.doesNotThrow(() => assertStandardUsageComplete({ sessionEvents: {} }, { eligibleCount: 0 }));
  assert.doesNotThrow(() => assertStandardUsageComplete({ sessionEvents: {} }, { eligibleCount: 2 }, false));
  assert.doesNotThrow(() => assertStandardUsageComplete({
    sessionEvents: {
      usageActivity: { sessions: { total: 2 } },
      usageEfficiency: {
        selection: {
          strategy: "all-eligible",
          eligibleSessionCount: 2,
          analyzedSessionCount: 2,
          complete: true,
        },
      },
    },
  }, { eligibleCount: 2 }));
  assert.throws(
    () => assertStandardUsageComplete({ sessionEvents: { usageActivity: {} } }, { eligibleCount: 2 }),
    /standard usage census is incomplete: missing usageEfficiency/,
  );
  assert.throws(
    () => assertStandardUsageComplete({
      sessionEvents: {
        usageActivity: { sessions: { total: 40 } },
        usageEfficiency: {
          selection: {
            strategy: "all-eligible",
            eligibleSessionCount: 932,
            analyzedSessionCount: 40,
            complete: false,
          },
        },
      },
    }, { eligibleCount: 932 }),
    /standard usage census population mismatch: expected 932\/932 all-eligible sessions/,
  );
});

test("requested usage reuses one frozen population without rediscovery and emits its lead selection binding", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-frozen-usage-"));
  const workspace = path.join(root, "workspace");
  const calls = [];
  const initialSessions = ["session-a", "session-b"].map((sessionId) =>
    bindSessionWorkspaceCwds({
      sessionId,
      firstSeen: "2026-07-17T08:00:00.000Z",
      lastSeen: "2026-07-17T08:05:00.000Z",
      sourceKinds: ["fixture"],
      sourceRefs: [{ kind: "project-session", path: "/fixture/session.jsonl" }],
    }, [workspace]));
  const activity = {
    schemaVersion: 1,
    dateBasis: "UTC",
    measurementBasis: "fixture",
    truncated: false,
    dates: ["2026-07-17"],
    sessions: { total: 2, starts: [2], activeMinutes: [10] },
    models: [],
    skills: [],
  };
  const usageEfficiency = {
    coverage: {
      analyzedSessionCount: 2,
      responseCount: 0,
      modelAttributedResponseCount: 0,
      unattributedResponseCount: 0,
      usageFieldObservedCount: 0,
      nonZeroUsageCount: 0,
      exactCreditsAvailable: false,
      userThreadCandidateCount: 2,
      childAgentCandidateCount: 0,
    },
    longSessions: { longActiveCount: 0, wallOnlyCount: 0 },
    thresholds: {},
    accountingMode: "effort-proxy",
    modelUsage: [],
    candidates: [],
    outcomeReview: {
      status: "not-applicable",
      reviewedCandidateCount: 0,
      comparableModelOutcomeEvidence: false,
    },
    activity,
  };
  const analyzer = {
    async analyze(options) {
      calls.push({
        command: options.command,
        until: options.until,
        piHome: options.piHome,
        inventory: options.sessionInventory?.map((session) => session.sessionId) ?? null,
        workspaceCwds: options.sessionInventory?.map(sessionWorkspaceCwds) ?? null,
      });
      if (options.command === "sources") {
        return {
          scope: { platform: "qoder", workspace, until: options.until },
          sources: [],
          warnings: [],
          sessions: initialSessions,
        };
      }
      const sessions = options.sessionInventory ?? [...initialSessions, { sessionId: "late-session" }];
      return {
        sessions,
        selection: {
          strategy: options.selection === "all-eligible" ? "all-eligible" : "stratified",
          eligibleCount: sessions.length,
          analyzedCount: sessions.length,
          strata: [],
        },
        insights: {
          cards: [],
          sample: { analyzedSessionCount: sessions.length, confidence: "Low" },
          keySignals: { usageEfficiency },
        },
      };
    },
    async resolveScope(options) {
      return {
        platform: "qoder",
        workspace,
        until: options.until,
        untilTime: Date.parse(options.until),
        sinceTime: null,
        includeGlobalCapabilities: false,
      };
    },
    async readSession() {
      return [];
    },
  };
  try {
    await mkdir(workspace, { recursive: true });
    const sessionPopulation = freezeSessionPopulation({
      scope: {
        platform: "qoder",
        workspace,
        until: "2026-07-17T09:00:00.000Z",
      },
      sessions: initialSessions,
      suppliedUntil: true,
    });
    const { source, selection, sessionBinding } = await createTaskLoopSourceFromSessions({
      analyzer,
      platform: "qoder",
      workspace,
      snapshotUntil: "2026-07-17T09:00:00.000Z",
      includeUsage: true,
      sessionPopulation,
      qoderHome: path.join(root, ".qoder"),
      piHome: path.join(root, ".pi", "agent"),
      practiceInventory: { summary: { practiceCoverageRows: [] }, memories: { included: false, categories: [] } },
    });
    assert.equal(selection.eligibleCount, 2);
    assert.equal(source.sessionEvents.usageActivity.sessions.total, 2);
    assert.equal(source.sessionEvents.usageEfficiency.selection.eligibleSessionCount, 2);
    assert.equal(sessionBinding.population.eligible.count, 2);
    assert.equal(sessionBinding.selection.parentPopulationFingerprint, sessionPopulation.binding.eligible.fingerprint);
    assert.equal(sessionBinding.admission.projectedEpisodes, sessionBinding.admission.admittedEpisodes
      + sessionBinding.admission.zeroSignalDiscardedEpisodes);
    assert.equal(new Set(calls.map((call) => call.until)).size, 1);
    assert.ok(calls.every((call) => call.piHome === path.join(root, ".pi", "agent")));
    assert.equal(calls.filter((call) => call.command === "sources").length, 0);
    assert.deepEqual(calls.filter((call) => call.command === "insights").map((call) => call.inventory), [
      ["session-a", "session-b"],
      ["session-a", "session-b"],
    ]);
    assert.deepEqual(calls.filter((call) => call.command === "insights").map((call) => call.workspaceCwds), [
      [[workspace], [workspace]],
      [[workspace], [workspace]],
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tracked credential scan includes common dotfiles and rejects links outside the workspace", async () => {
  const workspace = "/workspace/project";
  const trackedFiles = [
    ".env",
    ".env.local",
    ".npmrc",
    ".pypirc",
    "config.yaml",
    "package-lock.json",
    "linked.json",
    "junction/config.json",
  ];
  const fsApi = {
    lstat: async (target) => ({
      isSymbolicLink: () => target.endsWith("linked.json"),
      isFile: () => true,
    }),
    realpath: async (target) => target.replaceAll("\\", "/").endsWith("junction/config.json")
      ? "/outside/config.json"
      : target,
  };

  const coverage = await collectTrackedSensitiveConfigFiles(workspace, trackedFiles, fsApi);

  assert.deepEqual(coverage.files, [".env", ".env.local", ".npmrc", ".pypirc", "config.yaml"]);
  assert.equal(coverage.candidateCount, 7);
  assert.equal(coverage.skippedCount, 2);
  assert.equal(coverage.errorCount, 0);
  assert.equal(coverage.truncated, false);
});

test("tracked credential scan reports bounded truncation instead of silently dropping files", async () => {
  const workspace = "/workspace/project";
  const trackedFiles = Array.from({ length: 2_001 }, (_, index) => `config/${String(index).padStart(4, "0")}.yaml`);
  const fsApi = {
    lstat: async () => ({ isSymbolicLink: () => false, isFile: () => true }),
    realpath: async (target) => target,
  };

  const coverage = await collectTrackedSensitiveConfigFiles(workspace, trackedFiles, fsApi);

  assert.equal(coverage.files.length, 2_000);
  assert.equal(coverage.candidateCount, 2_001);
  assert.equal(coverage.truncated, true);
});

test("default practice projection keeps effective global hooks and installed plugins", () => {
  const inventory = {
    summary: {
      practiceCoverageRows: [
        { surface: "Rules", scopes: ["Project"], count: 1 },
        { surface: "Hooks", scopes: ["Global"], count: 11 },
        { surface: "Plugins", scopes: ["Plugin"], count: 10 },
        { surface: "Skills", scopes: ["Inherited"], count: 2 },
        { surface: "MCP", scopes: ["Global"], count: 3 },
        { surface: "Skills", scopes: ["Global"], count: 20 },
        { surface: "Memories", scopes: ["Project"], count: 4 },
      ],
    },
  };

  assert.deepEqual(
    projectPracticeCoverageRows(inventory).map((row) => row.surface),
    ["Rules", "Hooks", "Plugins", "Skills", "Memories", "Custom Agents"],
  );
  const customAgents = projectPracticeCoverageRows(inventory).find((row) => row.surface === "Custom Agents");
  assert.deepEqual(customAgents, { surface: "Custom Agents", scopes: ["Project"], count: 0, paths: [] });
  assert.equal(projectPracticeCoverageRows(inventory, true).length, 8);
});

test("session source bridge projects only relevant change validation", () => {
  const source = candidate([
    event({ timestamp: "2026-07-10T10:00:00.000Z", type: "user" }),
    event({
      timestamp: "2026-07-10T10:00:01.000Z",
      toolName: "Edit",
      filePath: "/Users/example/private-project/src/secret.ts",
    }),
    event({
      timestamp: "2026-07-10T10:00:02.000Z",
      toolName: "Bash",
      validationCategory: "node --test",
      targetPaths: ["/Users/example/private-project/src/secret.ts"],
      success: true,
    }),
  ]);
  assert.throws(
    () => projectTaskLoopFindings(source),
    (error) => error?.code === "UNREVIEWED_TASK_LOOP_SOURCE",
  );
  const findings = projectTaskLoopFindings(reviewed(source));
  const verification = findings.summary.dimensions.find((dimension) => dimension.id === "change-validation");
  const relevantCheck = verification.subdimensions.find((subdimension) => subdimension.id === "relevant-check");
  const repair = verification.subdimensions.find((subdimension) => subdimension.id === "failure-repair");
  const orientation = findings.summary.dimensions.find((dimension) => dimension.id === "task-understanding");
  const execution = findings.summary.dimensions.find((dimension) => dimension.id === "controlled-execution");
  const delivery = findings.summary.dimensions.find((dimension) => dimension.id === "reliable-delivery");

  assert.deepEqual(validateHarnessReportSource(source), []);
  assert.equal(source.repositoryEvidence.locale, "zh-CN");
  assert.deepEqual(
    source.assessmentDecisions.find((row) => row.kind === "repository-review")?.requiredFrameworks,
    ["coding-agent-practices", "software-fluency"],
  );
  assert.deepEqual(
    source.assessmentDecisions.find((row) => row.kind === "repository-review")?.requiredChecks,
    [
      "scoped-instructions-and-task-routes",
      "setup-run-and-debug-route",
      "core-diagnostic-coverage",
      "tests-and-post-edit-validation",
      "hooks-permissions-and-safety-controls",
      "acceptance-recovery-and-release-path",
      "lifecycle-repeat-detection",
      "loop-engineering",
      "later-validation",
    ],
  );
  assert.deepEqual(source.assessmentDecisions.find((row) => row.kind === "source-candidate")?.evidenceRefs, []);
  assert.equal(source.assessmentDecisions.find((row) => row.kind === "score-review")?.status, "requires-review");
  assert.equal(source.assessmentDecisions.find((row) => row.kind === "score-review")?.modelId, "agent-work-loop-v4");
  assert.equal(source.assessmentDecisions.find((row) => row.kind === "score-review")?.calibration, "agent-work-loop-ai-v2");
  assert.equal(source.assessmentDecisions.find((row) => row.kind === "score-review")?.dimensions.length, 5);
  assert.ok(source.assessmentDecisions.find((row) => row.kind === "score-review")?.dimensions.every((row) => row.score === null));
  assert.deepEqual(
    source.assessmentDecisions.find((row) => row.kind === "repository-review")?.reviewedFrameworks.map((row) => [row.id, row.status]),
    [["coding-agent-practices", "requires-review"], ["software-fluency", "requires-review"]],
  );
  assert.deepEqual(
    source.assessmentDecisions.find((row) => row.kind === "repository-review")?.reviewedChecks.map((row) => row.status),
    ["requires-review", "requires-review", "requires-review", "requires-review", "requires-review", "requires-review", "requires-review", "requires-review", "requires-review"],
  );
  assert.equal(source.repositoryEvidence.diagnosticCoverageReviews[0].status, "review-required");
  assert.equal(source.repositoryEvidence.learningCaptureDiagnostics.learningCaptureSchemaVersion, 1);
  assert.deepEqual(
    source.assessmentDecisions.find((row) => row.kind === "repository-review")?.requiredSoftwareFluencyCapabilities,
    ["context-map", "environment-readiness", "fast-feedback", "quality-gates", "safe-change"],
  );
  assert.deepEqual(
    source.assessmentDecisions.find((row) => row.kind === "repository-review")?.reviewedSoftwareFluencyCapabilities.map((row) => row.status),
    ["requires-review", "requires-review", "requires-review", "requires-review", "requires-review"],
  );
  assert.equal(orientation.label, "任务理解");
  assert.equal(verification.label, "改动验证");
  assert.equal(relevantCheck.label, "相关验证");
  assert.equal(source.taskEpisodes.length, 1);
  assert.equal(source.deliveryEvidence.length, 0);
  assert.equal(verification.level, "Outcome-supported");
  assert.equal(relevantCheck.level, "Outcome-supported");
  assert.equal(repair.level, null);
  assert.equal(orientation.level, "Exercised");
  assert.equal(execution.level, null);
  assert.equal(delivery.level, null);
  assert.deepEqual(validateTaskLoopFindings(findings), []);
  assert.equal(source.taskEpisodes[0].targetKeys.length, 1);
  assert.match(source.taskEpisodes[0].targetKeys[0], /^[a-f0-9]{20}$/);

  const serialized = JSON.stringify(source);
  assert.doesNotMatch(serialized, /session-private-a/);
  assert.doesNotMatch(serialized, /\/Users\/example/);
  assert.doesNotMatch(serialized, /secret\.ts/);
});

test("task-loop projection rejects accepted or evidence-incomplete review decisions", () => {
  const source = candidate([], {
    sample: { analyzedSessionCount: 1 },
    cards: [],
  });
  source.assessmentDecisions = source.assessmentDecisions.map((decision) =>
    ["source-candidate", "repository-review"].includes(decision.kind)
      ? { ...decision, status: "accepted", reviewedAt: "2026-07-10T12:00:00.000Z" }
      : decision);
  assert.throws(
    () => projectTaskLoopFindings(source),
    (error) => error?.code === "UNREVIEWED_TASK_LOOP_SOURCE",
  );

  const incomplete = reviewed(candidate([], { sample: { analyzedSessionCount: 1 }, cards: [] }));
  incomplete.assessmentDecisions = incomplete.assessmentDecisions.map((decision) =>
    decision.kind === "repository-review"
      ? {
          ...decision,
          reviewedChecks: decision.reviewedChecks.filter((row) => row.id !== "acceptance-recovery-and-release-path"),
        }
      : decision);
  assert.throws(
    () => projectTaskLoopFindings(incomplete),
    (error) => error?.code === "INCOMPLETE_TASK_LOOP_REVIEW"
      && error.errors.some((message) => message.includes("acceptance-recovery-and-release-path")),
  );

  const missingFramework = reviewed(candidate([], { sample: { analyzedSessionCount: 1 }, cards: [] }));
  missingFramework.assessmentDecisions = missingFramework.assessmentDecisions.map((decision) =>
    decision.kind === "repository-review"
      ? { ...decision, reviewedFrameworks: decision.reviewedFrameworks.filter((row) => row.id !== "software-fluency") }
      : decision);
  assert.throws(
    () => projectTaskLoopFindings(missingFramework),
    (error) => error?.code === "INCOMPLETE_TASK_LOOP_REVIEW"
      && error.errors.some((message) => message.includes("software-fluency")),
  );

  const missingCapability = reviewed(candidate([], { sample: { analyzedSessionCount: 1 }, cards: [] }));
  missingCapability.assessmentDecisions = missingCapability.assessmentDecisions.map((decision) =>
    decision.kind === "repository-review"
      ? { ...decision, reviewedSoftwareFluencyCapabilities: decision.reviewedSoftwareFluencyCapabilities.slice(0, -1) }
      : decision);
  assert.throws(
    () => projectTaskLoopFindings(missingCapability),
    (error) => error?.code === "INCOMPLETE_TASK_LOOP_REVIEW"
      && error.errors.some((message) => message.includes("safe-change")),
  );
});

test("session source bridge leaves unrelated validation and delivery unobserved", () => {
  const source = candidate([
    event({
      timestamp: "2026-07-10T10:00:01.000Z",
      toolName: "Edit",
      filePath: "/Users/example/private-project/src/a.ts",
    }),
    event({
      timestamp: "2026-07-10T10:00:02.000Z",
      toolName: "Bash",
      validationCategory: "node --test",
      targetPaths: ["/Users/example/private-project/src/b.ts"],
      success: true,
    }),
  ]);
  assert.equal(source.deliveryEvidence.length, 0);
  const findings = projectTaskLoopFindings(reviewed(source));
  const validation = findings.summary.dimensions.find((dimension) => dimension.id === "change-validation");
  assert.equal(source.taskEpisodes[0].closure.status, "unobserved");
  assert.equal(validation.subdimensions.find((row) => row.id === "relevant-check").level, null);
});

test("lifecycle intent alone does not exercise Task Understanding", () => {
  const source = candidate([
    event({ timestamp: "2026-07-10T10:00:00.000Z", type: "user", userText: "/spec-review inspect the contract" }),
    event({ timestamp: "2026-07-10T10:00:01.000Z", toolName: "Edit", filePath: "/Users/example/private-project/src/a.ts" }),
    event({
      timestamp: "2026-07-10T10:00:02.000Z",
      toolName: "Bash",
      validationCategory: "node --test",
      targetPaths: ["/Users/example/private-project/src/a.ts"],
      success: true,
    }),
  ]);
  assert.match(source.taskEpisodes[0].taskRoute, /^lifecycle:/u);
  const reviewedSource = reviewed(source);
  delete reviewedSource.taskEpisodes[0].taskUnderstanding;
  const report = projectTaskLoopFindings(reviewedSource);
  const taskUnderstanding = report.summary.dimensions.find((dimension) => dimension.id === "task-understanding");
  assert.equal(taskUnderstanding.level, null);
  assert.ok(taskUnderstanding.subdimensions.every((row) => row.level === null));
});

test("session source bridge carries redacted Insights cards into the review packet", () => {
  const source = candidate([], {
    sample: { analyzedSessionCount: 40 },
    cards: [{
      id: "post-edit-validation",
      finding: "Observed 10 edit events without later validation.",
      behaviorChange: "Review bounded episodes before reporting a verification gap.",
      confidence: "Medium",
      evidenceRefs: [{
        kind: "project-jsonl",
        path: "/Users/example/private-project/raw-session.jsonl",
        line: 9,
        type: "user",
      }],
    }],
  });

  assert.equal(source.semanticFacets.length, 1);
  assert.equal(source.semanticFacets[0].kind, "rework-correction");
  assert.equal(source.semanticFacets[0].status, "candidate");
  assert.equal(source.assessmentDecisions.find((row) => row.kind === "session-insights")?.cardCount, 1);
  assert.deepEqual(validateHarnessReportSource(source), []);
  assert.doesNotMatch(JSON.stringify(source), /raw-session|\/Users\/example/);
});

test("session source bridge preserves bounded Skill and friction signals for Learning Capture review", () => {
  const source = candidate([], {
    sample: { analyzedSessionCount: 12 },
    keySignals: {
      topSkills: [{ name: "harness", count: 4 }],
      inferredSkillReads: [{ name: "canvas", count: 2 }],
      friction: [{ name: "failed-event", count: 7 }, { name: "failed-event", count: 3 }],
    },
  }, {
    repositoryEvidence: {
      aiAgentPractice: {
        coverageRows: [
          { surface: "Skills", paths: [".agents/skills/review/SKILL.md"] },
          { surface: "Memories", paths: ["MEMORY.md"] },
        ],
      },
    },
  });

  assert.deepEqual(source.repositoryEvidence.learningCaptureDiagnostics.signals, {
    observedSkills: [],
    unscopedObservedSkills: [{ name: "harness", count: 4 }],
    apparentSkillReads: [{ name: "canvas", count: 2 }],
    configuredSkills: [".agents/skills/review/SKILL.md"],
    memories: ["MEMORY.md"],
    frictionSignals: [{ name: "failed-event", count: 10 }],
    priorInterventionCount: 0,
  });
  assert.deepEqual(validateHarnessReportSource(source), []);
});

test("spec review path reaches a configured Skill trial through the source and review packet", () => {
  const skillPath = ".agents/skills/spec-review/SKILL.md";
  const repositoryEvidence = buildTaskLoopRepositoryEvidence({
    trackedFiles: ["AGENTS.md", skillPath],
    fileContents: {
      "AGENTS.md": `Use [Spec Review](${skillPath}) before implementation.`,
      [skillPath]: `---
name: spec-review
description: Use when reviewing a specification before implementation.
---
# Spec Review
## When to use
Review the spec before implementation.
## Workflow
1. Inspect scope and acceptance criteria.
2. Record evidence-backed findings.
## Output
Produce a specification review report.
## Validation
Verify every finding has an evidence reference.
`,
    },
  });
  const source = candidate([
    event({
      type: "user",
      timestamp: "2026-07-15T08:00:00.000Z",
      userText: "Review docs/specs/checkout.md before implementation.",
    }),
  ], {}, { repositoryEvidence });
  const packet = buildHarnessReviewPacket(source);
  const handoff = source.repositoryEvidence.workflowDemandDiagnostics.currentHandoffs[0];
  const repositoryReview = source.assessmentDecisions.find((decision) => decision.kind === "repository-review");

  assert.equal(source.taskEpisodes.length, 1);
  assert.equal(source.sessionEvents.discardedEpisodeCount, 0);
  assert.equal(source.taskEpisodes[0].lifecycleSignals[0].intent, "specification-review");
  assert.equal(handoff.intent, "spec-review");
  assert.deepEqual(handoff.primaryReview, { dimensionId: "task-understanding", checkId: "goal-understanding" });
  assert.equal(handoff.ownerReview.action, "try-configured");
  assert.deepEqual(handoff.ownerReview.candidateSkillIds, ["spec-review"]);
  assert.equal(source.repositoryEvidence.workflowDemandDiagnostics.repeatedCandidates.length, 0);
  assert.equal(repositoryReview.learningCaptureFindingPolicy, LEARNING_CAPTURE_FINDING_POLICY);
  assert.equal(packet.required.learningCaptureFindingPolicy, LEARNING_CAPTURE_FINDING_POLICY);
  assert.ok(packet.allowedEvidenceRefs.some((reference) =>
    reference.kind === "task-episode" && reference.id === source.taskEpisodes[0].id));
  assert.deepEqual(validateHarnessReportSource(source), []);
  assert.doesNotMatch(JSON.stringify(source), /docs\/specs|checkout\.md|\/Users\/example|session-private/u);

  const legacySource = structuredClone(source);
  delete legacySource.assessmentDecisions.find((decision) => decision.kind === "repository-review")
    .learningCaptureFindingPolicy;
  const legacyPacket = buildHarnessReviewPacket(legacySource);
  assert.equal("learningCaptureFindingPolicy" in legacyPacket.required, false);
  assert.deepEqual(validateHarnessReviewPacket(legacySource, legacyPacket), []);

  const inventedCoverage = structuredClone(source);
  inventedCoverage.repositoryEvidence.workflowDemandDiagnostics.currentHandoffs[0]
    .ownerReview.action = "covered-observed";
  assert.match(
    validateHarnessReportSource(inventedCoverage).join("; "),
    /ownerReview does not match recomputed coverage ladder|do not match deterministic input recomputation/u,
  );
});

test("fine-grained debug, release, and branch demand reaches the matching configured Skill", () => {
  const skillPaths = [
    ".agents/skills/systematic-debugging/SKILL.md",
    ".agents/skills/release-delivery/SKILL.md",
    ".agents/skills/branch-completion/SKILL.md",
  ];
  const skill = ({ name, description, workflow, output }) => `---
name: ${name}
description: ${description}
---
# ${name}
## When to use
${description}
## Workflow
${workflow}
## Output
${output}
## Validation
Verify the bounded workflow result before completion.
`;
  const repositoryEvidence = buildTaskLoopRepositoryEvidence({
    trackedFiles: ["AGENTS.md", ...skillPaths],
    fileContents: {
      "AGENTS.md": skillPaths.map((skillPath) => `Use [${skillPath}](${skillPath}) when its trigger matches.`).join("\n"),
      [skillPaths[0]]: skill({
        name: "systematic-debugging",
        description: "Use when debugging a bug, failure, or failing test.",
        workflow: "Reproduce the failure and isolate the root cause before repair.",
        output: "Produce a bounded diagnosis and verified repair.",
      }),
      [skillPaths[1]]: skill({
        name: "release-delivery",
        description: "Use when releasing or delivering a change.",
        workflow: "Prepare and verify the release artifact before delivery.",
        output: "Produce a reviewed release handoff.",
      }),
      [skillPaths[2]]: skill({
        name: "branch-completion",
        description: "Use when completing a branch or checking merge readiness.",
        workflow: "Inspect branch state, verification, and merge readiness.",
        output: "Produce a delivery-ready branch handoff.",
      }),
    },
  });
  const cases = [
    ["Debug the failing test.", "debugging", "systematic-debugging"],
    ["Release the change.", "release-delivery", "release-delivery"],
    ["Complete this branch.", "branch-completion", "branch-completion"],
  ];

  for (const [userText, intent, skillId] of cases) {
    const source = candidate([
      event({ type: "user", timestamp: "2026-07-15T08:00:00.000Z", userText }),
    ], {}, { repositoryEvidence });
    const handoff = source.repositoryEvidence.workflowDemandDiagnostics.currentHandoffs[0];
    assert.equal(handoff.intent, intent, userText);
    assert.equal(handoff.ownerReview.action, "try-configured", userText);
    assert.deepEqual(handoff.ownerReview.candidateSkillIds, [skillId], userText);
    assert.deepEqual(handoff.ownerReview.candidateCapabilityIds, [], userText);
    assert.deepEqual(validateHarnessReportSource(source), [], userText);
  }
});

test("Qoder review demand recommends the bounded built-in before Skill creation", () => {
  const source = candidate([
    event({
      type: "user",
      timestamp: "2026-07-15T08:00:00.000Z",
      userText: "Review this PR before merge.",
    }),
  ]);
  const handoff = source.repositoryEvidence.workflowDemandDiagnostics.currentHandoffs[0];

  assert.equal(source.taskEpisodes[0].lifecycleSignals[0].host, "qoder");
  assert.equal(handoff.intent, "review-acceptance");
  assert.equal(handoff.ownerReview.action, "try-built-in");
  assert.equal(handoff.ownerReview.candidateOwner, "Built-in");
  assert.deepEqual(handoff.ownerReview.candidateCapabilityIds, ["qoder-ultra-review"]);
  assert.deepEqual(handoff.ownerReview.candidateSkillIds, []);
  assert.deepEqual(validateHarnessReportSource(source), []);
  assert.doesNotMatch(JSON.stringify(source), /Review this PR|\/Users\/example|session-private/u);
});

test("distinct read-only issue patrol episodes produce one repeated planning candidate", () => {
  const source = candidate([
    event({
      type: "user",
      sessionId: "private-issue-session-a",
      timestamp: "2026-07-14T08:00:00.000Z",
      userText: "/issue-triage --label agent-ready",
    }),
    event({
      type: "user",
      sessionId: "private-issue-session-b",
      timestamp: "2026-07-15T08:00:00.000Z",
      userText: "/issue-triage --label agent-ready",
    }),
  ]);
  const diagnostics = source.repositoryEvidence.workflowDemandDiagnostics;

  assert.equal(source.taskEpisodes.length, 2);
  assert.equal(diagnostics.currentHandoffs[0].intent, "issue-triage");
  assert.equal(diagnostics.currentHandoffs[0].family, "specification-planning");
  assert.equal(diagnostics.repeatedCandidates.length, 1);
  assert.equal(diagnostics.repeatedCandidates[0].intent, "issue-triage");
  assert.equal(diagnostics.repeatedCandidates[0].evidenceWindow.distinctEpisodeCount, 2);
  assert.deepEqual(diagnostics.repeatedCandidates[0].sourceEpisodes, source.taskEpisodes.map((episode) => episode.id));
  assert.deepEqual(validateHarnessReportSource(source), []);
  assert.doesNotMatch(JSON.stringify(source), /agent-ready|private-issue-session/u);

  const detached = structuredClone(source);
  const repeated = detached.repositoryEvidence.workflowDemandDiagnostics.repeatedCandidates[0];
  const originalEpisode = repeated.sourceEpisodes[0];
  const missingEpisode = "episode:missing-workflow-demand";
  repeated.sourceEpisodes[0] = missingEpisode;
  repeated.evidenceWindow.episodeRefs[0] = missingEpisode;
  repeated.evidenceRefs = repeated.evidenceRefs.map((reference) =>
    reference.kind === "task-episode" && reference.id === originalEpisode
      ? { ...reference, id: missingEpisode }
      : reference);
  assert.match(validateHarnessReportSource(detached).join("; "), /references unknown task episodes/u);
});

test("provider-shaped bounded no-match reviews require one evidence-bound fallback finding", () => {
  for (const platform of ["qoder", "codex", "claude", "cursor"]) {
    const source = candidate([
      event({
        type: "user",
        sessionId: `${platform}-private-issue-a`,
        timestamp: "2026-07-14T08:00:00.000Z",
        userText: "/issue-triage --label private-agent-ready",
      }),
      event({
        type: "user",
        sessionId: `${platform}-private-issue-b`,
        timestamp: "2026-07-15T08:00:00.000Z",
        userText: "/issue-triage --label private-agent-ready",
      }),
    ], {}, {
      scope: {
        platform,
        workspace: `/Users/example/${platform}-private-project`,
        until: "2026-07-15T09:00:00.000Z",
      },
      selection: {
        strategy: "all-eligible",
        eligibleCount: 2,
        analyzedCount: 2,
        strata: [],
      },
    });
    const reviewedSource = reviewed(source);
    const lead = reviewedSource.repositoryEvidence.workflowDemandDiagnostics.repeatedCandidates[0];

    assert.equal(reviewedSource.manifest.scope.platform, platform);
    assert.equal(reviewedSource.taskEpisodes.length, 2);
    assert.ok(lead);
    assert.equal(reviewedSource.repositoryEvidence.learningCaptureDiagnostics.recurringIssueCandidates.length, 0);
    assert.throws(
      () => projectTaskLoopFindings(reviewedSource),
      /requires a lifecycle-repeat-detection finding for a bounded window without an accepted supported match or a reviewed adequate clean result/u,
    );

    const finding = {
      id: `${platform}-learning-capture-no-match-gap`,
      kind: "evidence-gap",
      severity: "Medium",
      title: "重复生命周期需求没有可复核的学习归属",
      reason: "两个有界任务到达同一生命周期需求，但没有受支持的学习候选或充分的干净窗口结论。",
      expectedOutcome: "重复需求保留一项有证据约束的最佳实践结论，以及明确的匹配候选或证据缺口。",
      expectedArtifact: "Workflow",
      expectedOutput: ["更新 Learning Capture 工作流，使重复需求保留有证据约束的匹配候选或证据缺口结论。"],
      dimensionRefs: ["learning-capture"],
      subdimensionRefs: ["lifecycle-repeat-detection"],
      staticEvidence: [{ kind: "workflow-demand", id: lead.id }],
      aiFixPrompt: "/better-harness 修复这个问题\n\n更新 `scripts/harness-analysis/report-source.mjs` 负责的 Learning Capture 工作流，使重复需求保留有证据约束的匹配候选或证据缺口结论。\n\n## 验证\n\n- 重新运行有界 Learning Capture fixture\n- 确认非干净窗口保留已匹配候选或已链接 Finding",
    };
    reviewedSource.repositoryEvidence.findings = [
      ...(reviewedSource.repositoryEvidence.findings ?? []),
      finding,
    ];
    reviewedSource.assessmentDecisions.find((decision) => decision.kind === "repository-review")
      .reviewedChecks.find((row) => row.id === "lifecycle-repeat-detection")
      .findingRefs = [finding.id];

    const projected = projectTaskLoopFindings(reviewedSource);
    assert.ok(projected.findings.some((row) => row.id === finding.id));
    assert.equal(
      projected.summary.dimensions.find((row) => row.id === "learning-capture").score,
      LEARNING_CAPTURE_REVIEWED_SCORE_FLOOR,
    );
    assert.doesNotMatch(
      JSON.stringify({ source, projected }),
      /private-agent-ready|private-issue|\/Users\/example/u,
    );
  }
});

test("source projection keeps a newer non-demand episode from reviving an older lifecycle handoff", () => {
  const source = candidate([
    event({
      type: "user",
      sessionId: "private-old-demand",
      timestamp: "2026-07-14T08:00:00.000Z",
      userText: "Review the spec.",
    }),
    event({
      type: "tool",
      toolName: "Edit",
      sessionId: "private-current-change",
      timestamp: "2026-07-15T08:00:00.000Z",
      filePath: "/Users/example/private-project/src/current.ts",
    }),
  ]);
  const diagnostics = source.repositoryEvidence.workflowDemandDiagnostics;
  const current = source.taskEpisodes.find((episode) => episode.id === source.sessionEvents.currentEpisodeRef);

  assert.equal(source.taskEpisodes.length, 2);
  assert.ok(current);
  assert.equal(current.lifecycleSignals.length, 0);
  assert.equal(source.sessionEvents.currentEpisodeRef, current.id);
  assert.equal(diagnostics.currentHandoffs.length, 0);
  assert.equal(diagnostics.repeatedCandidates.length, 0);
  assert.deepEqual(validateHarnessReportSource(source), []);
});

test("cross-source copies of one prompt cannot manufacture repeated work", () => {
  const userText = "/spec review checkout";
  const source = candidate([
    event({
      type: "UserPromptSubmit",
      timestamp: "2026-07-15T08:00:00.000Z",
      userText,
      evidenceRef: { kind: "hook-audit", line: 4, type: "UserPromptSubmit" },
    }),
    event({
      type: "user",
      timestamp: "2026-07-15T08:00:00.100Z",
      userText,
      evidenceRef: { kind: "conversation", line: 8, type: "user" },
    }),
  ]);

  assert.equal(source.taskEpisodes.length, 1);
  assert.equal(source.repositoryEvidence.workflowDemandDiagnostics.currentHandoffs.length, 1);
  assert.equal(source.repositoryEvidence.workflowDemandDiagnostics.repeatedCandidates.length, 0);
  assert.deepEqual(validateHarnessReportSource(source), []);
  assert.doesNotMatch(JSON.stringify(source), /review checkout|session-private/u);
});

test("session source bridge emits learning-loop candidates and coverage reason codes", () => {
  const learningSignal = {
    patternId: "recurring-correction",
    normalizedSignature: "generated-files-do-not-edit",
    taskFamily: "repository-change",
    repoArea: "generated-output",
    frictionType: "user-correction",
    userCorrection: true,
    asset: {
      kind: "Rule",
      ref: "/Users/example/private-project/.qoder/rules/generated-output.md",
      scope: "project",
      currentTruthRefs: [{ kind: "spec", id: "generated-output-boundary" }],
    },
    fieldProvenance: {
      normalizedSignature: "ai-reviewed",
      taskFamily: "ai-reviewed",
      repoArea: "ai-reviewed",
      frictionType: "ai-reviewed",
      userCorrection: "ai-reviewed",
    },
  };
  const source = candidate([
    event({
      sessionId: "private-session-a",
      timestamp: "2026-07-10T10:00:00Z",
      toolName: "Edit",
      filePath: "/Users/example/private-project/generated/a.ts",
      learningSignal,
    }),
    event({
      sessionId: "private-session-b",
      timestamp: "2026-07-10T11:00:00Z",
      toolName: "Edit",
      filePath: "/Users/example/private-project/generated/b.ts",
      learningSignal,
    }),
  ]);
  const learningCapture = source.repositoryEvidence.learningCaptureDiagnostics;

  assert.equal(learningCapture.learningCaptureSchemaVersion, 1);
  assert.equal(learningCapture.episodeRecords.length, 2);
  assert.equal(learningCapture.recurringIssueCandidates.length, 1);
  assert.equal(learningCapture.recurringIssueCandidates[0].patternId, "recurring-correction");
  assert.match(learningCapture.recurringIssueCandidates[0].asset?.ref ?? "", /^asset-[a-f0-9]{16}$/);
  assert.equal(learningCapture.coverage.patternDetection, "candidate-found");
  assert.equal(learningCapture.coverage.effectiveness, "pending-no-later-window");
  assert.deepEqual(validateHarnessReportSource(source), []);
  assert.doesNotMatch(JSON.stringify(learningCapture), /private-session|\/Users\/example/);
});

test("reviewed learning-loop candidates require an owner-aligned no-match finding before projection", () => {
  const events = Array.from({ length: 9 }, (_, index) => ["a", "b"].map((suffix) => event({
    sessionId: `private-loop-${index}-${suffix}`,
    timestamp: `2026-07-10T${String(10 + index).padStart(2, "0")}:00:00Z`,
    toolName: "Edit",
    filePath: `/Users/example/private-project/src/route-${index}-${suffix}.ts`,
    learningSignal: {
      patternId: "repeated-rediscovery",
      normalizedSignature: `repeatable-route-${index}`,
      taskFamily: "repository-change",
      repoArea: `route-${index}`,
      frictionType: "repeated-rediscovery",
      procedural: index % 2 === 0,
      fieldProvenance: {
        normalizedSignature: "ai-reviewed",
        taskFamily: "ai-reviewed",
        repoArea: "ai-reviewed",
        frictionType: "ai-reviewed",
      },
    },
  }))).flat();
  const source = reviewed(candidate(events, {}, {
    repositoryEvidence: {
      dimensions: {
        "task-understanding": { present: [{ kind: "repository", id: "task-route" }] },
      },
    },
  }));
  assert.throws(
    () => projectTaskLoopFindings(source),
    /requires a lifecycle-repeat-detection finding for a bounded window without an accepted supported match or a reviewed adequate clean result/u,
  );

  const finding = {
    id: "learning-capture-candidate-review-gap",
    kind: "evidence-gap",
    severity: "Medium",
    title: "重复学习候选缺少已接受的复核结论",
    reason: "有界来源包含重复学习候选，但生命周期机会检测尚未接受受支持的匹配，也没有保留充分的干净窗口结论。",
    expectedOutcome: "复核窗口保留一项有证据约束的候选结论，以及最小的后续归属或需要更多证据的明确结果。",
    expectedArtifact: "Workflow",
    expectedOutput: ["更新 Learning Capture 工作流，使重复候选保留已接受且有证据约束的结论和最小归属的后续动作。"],
    dimensionRefs: ["learning-capture"],
    subdimensionRefs: ["lifecycle-repeat-detection"],
    staticEvidence: [{ kind: "session-selection", id: "bounded-selection" }],
    aiFixPrompt: "/better-harness 修复这个问题\n\n更新 `scripts/harness-analysis/report-source.mjs` 负责的 Learning Capture 工作流，使重复候选保留已接受且有证据约束的结论和最小归属的后续动作。\n\n## 验证\n\n- 重新运行有界 Learning Capture fixture\n- 确认每个非干净候选窗口都保留已接受的匹配或已链接的证据缺口 Finding",
  };
  source.repositoryEvidence.findings = [...(source.repositoryEvidence.findings ?? []), finding];
  source.assessmentDecisions.find((decision) => decision.kind === "repository-review")
    .reviewedChecks.find((row) => row.id === "lifecycle-repeat-detection")
    .findingRefs = [finding.id];
  const findings = projectTaskLoopFindings(source);
  const learning = findings.findings.filter((row) => row.dimensionRefs.includes("learning-capture"));

  assert.equal(source.repositoryEvidence.learningCaptureDiagnostics.recurringIssueCandidates.length, 9);
  assert.equal(learning.length, 1);
  assert.equal(learning[0].id, finding.id);
  assert.deepEqual(validateTaskLoopFindings(findings), []);
});

test("session source bridge keeps raw session ids only for the private review handoff", () => {
  const source = candidate([], {
    sample: { analyzedSessionCount: 6, confidence: "High" },
    keySignals: {
      usageEfficiency: {
        accountingMode: "effort-proxy",
        coverage: {
          analyzedSessionCount: 6,
          responseCount: 12,
          modelAttributedResponseCount: 12,
        },
        longSessions: { longActiveCount: 2, wallOnlyCount: 1 },
        modelUsage: [
          { model: "performance", responseCount: 4 },
          { model: "ultimate", responseCount: 8 },
        ],
        candidates: [{
          id: "private-session-id",
          activeMs: 95 * 60_000,
          role: "user-thread-candidate",
          failureCount: 2,
          userInputSummary: "Review the report generation path",
          toolTrace: {
            schemaVersion: 2,
            totalCalls: 3,
            shownCalls: 2,
            truncated: true,
            calls: [
              { id: "ignored", step: 1, toolName: "Read", status: "observed", durationStatus: "observed", durationMs: 1250.4, timingSource: "transcript-pair", commandText: "private" },
              { id: "ignored", step: 3, toolName: "Bash", status: "failed", durationStatus: "unobserved", filePath: "/Users/example/private.ts" },
            ],
          },
          candidateReasons: ["active-long"],
          evidenceRefs: [{ kind: "project-jsonl", path: "/Users/example/private-session.jsonl" }],
        }],
        activity: {
          schemaVersion: 1,
          dateBasis: "UTC",
          measurementBasis: "session-starts-active-estimate-model-responses-skill-invocations-and-reads",
          truncated: false,
          dates: ["2026-07-10"],
          sessions: { total: 6, starts: [6], activeMinutes: [95] },
          models: [{ name: "ultimate", total: 8, daily: [8] }],
          skills: [{ name: "skill-creator", total: 2, daily: [2] }],
        },
      },
    },
  }, { includeUsage: true });
  const facet = source.semanticFacets.find((row) => row.id === "session-insight:session-usage-efficiency");

  assert.ok(facet);
  assert.match(facet.summary, /本次分析覆盖 6 个会话/);
  assert.match(facet.summary, /2 个达到活跃长会话阈值，最长约 95 分钟/);
  assert.match(facet.summary, /另有 1 个长跨度主要来自暂停或恢复/);
  assert.doesNotMatch(facet.summary, /最常观察到的模型|8 次响应|67%/);
  assert.match(facet.summary, /不能据此推断模型偏好、质量或节省/);
  assert.match(facet.summary, /token 或 credit 证据不足/);
  assert.equal(facet.summary.match(/。/gu)?.length, 2);
  assert.doesNotMatch(JSON.stringify(source), /private-session\.jsonl|\/Users\/example/);
  assert.equal(source.assessmentDecisions.find((row) => row.kind === "session-insights")?.cardCount, 1);
  assert.equal(source.sessionEvents.usageActivity.sessions.total, 6);
  assert.deepEqual(source.sessionEvents.usageActivity.skills[0].daily, [2]);
  assert.deepEqual(source.repositoryEvidence.learningCaptureDiagnostics.signals.observedSkills, []);
  assert.deepEqual(source.repositoryEvidence.learningCaptureDiagnostics.signals.unscopedObservedSkills, [{ name: "skill-creator", count: 2 }]);
  assert.deepEqual(source.sessionEvents.usageEfficiency.selection, {
    strategy: "all-eligible",
    eligibleSessionCount: 9,
    analyzedSessionCount: 6,
    complete: false,
  });
  assert.equal(source.sessionEvents.usageEfficiency.schemaVersion, 2);
  assert.equal(source.sessionEvents.usageEfficiency.longSessions.activeCount, 2);
  assert.equal(source.sessionEvents.usageEfficiency.longSessions.wallOnlyCount, 1);
  assert.equal(source.sessionEvents.usageEfficiency.longSessions.longestActiveMinutes, 95);
  assert.equal(source.sessionEvents.usageEfficiency.longSessions.activeRatio, 0.3333);
  assert.deepEqual(source.sessionEvents.usageEfficiency.longSessions.estimate, {
    method: "capped-event-gap",
    activeThresholdMinutes: 45,
    gapCapMinutes: 5,
    idleGapMinutes: 30,
  });
  const sample = source.sessionEvents.usageEfficiency.longSessions.samples[0];
  assert.equal(sample.alias, "S1");
  assert.equal(sample.rawSessionId, "private-session-id");
  assert.match(sample.sessionRef, /^qsr1-[a-f0-9]{24}$/u);
  assert.equal(sample.role, "user-thread-candidate");
  assert.equal(sample.activeMinutes, 95);
  assert.equal(sample.failureCount, 2);
  assert.equal(sample.userInputSummary, "Review the report generation path");
  assert.deepEqual(sample.toolTrace, {
    schemaVersion: 2,
    totalCalls: 3,
    shownCalls: 2,
    truncated: true,
    calls: [
      { id: "T1", step: 1, toolName: "Read", status: "observed", durationStatus: "observed", durationMs: 1250, timingSource: "transcript-pair" },
      { id: "T3", step: 3, toolName: "Bash", status: "failed", durationStatus: "unobserved" },
    ],
  });
  assert.equal(source.sessionEvents.usageEfficiency.accounting.mode, "effort-proxy");
  assert.equal(source.sessionEvents.usageEfficiency.accounting.modelAttributedResponseCount, 12);
  assert.equal(source.sessionEvents.usageEfficiency.accounting.unattributedResponseCount, 0);
  assert.equal(source.sessionEvents.usageEfficiency.outcomeReview.recommendation, "controlled-a-b-required");
  assert.deepEqual(validateHarnessReportSource(source), []);
});

test("usage census replaces only sampled usage and adds scoped review references", () => {
  const sample = {
    sample: { analyzedSessionCount: 3, confidence: "Medium" },
    cards: [{ id: "post-edit-validation", finding: "sample finding" }],
    keySignals: { usageEfficiency: { coverage: { analyzedSessionCount: 3 } } },
  };
  const censusUsage = {
    accountingMode: "effort-proxy",
    coverage: {
      analyzedSessionCount: 9,
      userThreadCandidateCount: 7,
      childAgentCandidateCount: 2,
      responseCount: 4,
      usageFieldObservedCount: 4,
      nonZeroUsageCount: 0,
      exactCreditsAvailable: false,
    },
    longSessions: { longActiveCount: 3, wallOnlyCount: 1 },
    modelUsage: [{ model: "ultimate", responseCount: 4, usageFieldObservedCount: 4, nonZeroUsageCount: 0 }],
    activity: {
      sessions: { total: 9 },
      models: [{ name: "ultimate", total: 4, daily: [4] }],
      skills: [{ name: "skill-creator", total: 7, daily: [7] }],
    },
    candidates: [{ id: "private-id", activeMs: 3_600_000, candidateReasons: ["active-long"] }],
    outcomeReview: { status: "required", reviewedCandidateCount: 0, comparableModelOutcomeEvidence: false },
  };
  const merged = mergeUsageCensusInsights(sample, { keySignals: { usageEfficiency: censusUsage } });
  const projected = projectSessionUsageSummary(merged.keySignals.usageEfficiency, 9);

  assert.equal(merged.sample.analyzedSessionCount, 3);
  assert.equal(merged.cards[0].id, "post-edit-validation");
  assert.equal(merged.keySignals.usageEfficiency.coverage.analyzedSessionCount, 9);
  assert.equal(merged.keySignals.usageEfficiency.activity.sessions.total, 9);
  assert.equal(merged.keySignals.usageEfficiency.activity.skills[0].total, 7);
  assert.equal(projected.selection.complete, true);
  assert.equal(projected.longSessions.activeCount, 3);
  assert.equal(projected.accounting.nonZeroUsageCount, 0);
  assert.equal(projected.accounting.modelAttributedResponseCount, 4);
  assert.equal(projected.accounting.unattributedResponseCount, 0);
  assert.equal(projected.outcomeReview.recommendation, "controlled-a-b-required");
  assert.equal(projected.longSessions.samples[0].rawSessionId, "private-id");
  assert.match(projected.longSessions.samples[0].sessionRef, /^qsr1-[a-f0-9]{24}$/u);

  const bounded = projectSessionUsageSummary({
    ...censusUsage,
    longSessions: { ...censusUsage.longSessions, longActiveCount: 6 },
    candidates: Array.from({ length: 6 }, (_, index) => ({
      id: `private-id-${index + 1}`,
      activeMs: (60 - index) * 60_000,
      role: "user-thread-candidate",
      failureCount: index,
      toolTrace: {
        schemaVersion: 1,
        totalCalls: 2,
        shownCalls: 2,
        truncated: false,
        calls: [
          { id: "T1", step: 1, toolName: index === 0 ? "Read/private" : "Read", status: "observed" },
          { id: "T2", step: 2, toolName: "Bash", status: index === 0 ? "failed" : "observed" },
        ],
      },
      userInputSummary: index === 0
        ? "Fix /Users/example/private/file api_key=secretvalue"
        : `User task ${index + 1}`,
      candidateReasons: ["active-long"],
    })),
  }, 9);
  assert.deepEqual(bounded.longSessions.samples.map((row) => row.alias), ["S1", "S2", "S3", "S4"]);
  assert.equal(bounded.longSessions.samples[0].userInputSummary, "Fix <path> api_key=<redacted>");
  assert.deepEqual(bounded.longSessions.samples.slice(1).map((row) => row.userInputSummary), ["User task 2", "User task 3", "User task 4"]);
  assert.deepEqual(bounded.longSessions.samples.map((row) => row.rawSessionId), ["private-id-1", "private-id-2", "private-id-3", "private-id-4"]);
  assert.ok(bounded.longSessions.samples.every((row) => /^qsr1-[a-f0-9]{24}$/u.test(row.sessionRef)));
  assert.equal(bounded.longSessions.samples[0].toolTrace.calls[0].toolName, "Unknown tool");
  assert.ok(bounded.longSessions.samples.every((row) => row.toolTrace.shownCalls === 2));
  assert.ok(bounded.longSessions.samples.every((row) => row.toolTrace.schemaVersion === 2));
  assert.ok(bounded.longSessions.samples.every((row) => row.toolTrace.calls.every((call) => call.durationStatus === "unobserved")));
  assert.doesNotMatch(JSON.stringify(bounded.longSessions.samples), /\/Users\/example|secretvalue/);

  const completeTrace = projectSessionUsageSummary({
    ...censusUsage,
    longSessions: { ...censusUsage.longSessions, longActiveCount: 1 },
    candidates: [{
      id: "private-id-complete-trace",
      activeMs: 60 * 60_000,
      role: "user-thread-candidate",
      failureCount: 0,
      userInputSummary: "Inspect every tool call",
      candidateReasons: ["active-long"],
      toolTrace: {
        schemaVersion: 2,
        totalCalls: 125,
        shownCalls: 125,
        truncated: false,
        calls: Array.from({ length: 125 }, (_, index) => ({
          id: `T${index + 1}`,
          step: index + 1,
          toolName: index % 2 === 0 ? "Read" : "Bash",
          status: "observed",
          durationStatus: "unobserved",
        })),
      },
    }],
  }, 9);
  assert.equal(completeTrace.longSessions.samples[0].toolTrace.shownCalls, 125);
  assert.equal(completeTrace.longSessions.samples[0].toolTrace.truncated, false);
  assert.equal(completeTrace.longSessions.samples[0].toolTrace.calls.at(-1)?.step, 125);

  const afterFirstReview = projectSessionUsageSummary({
    ...censusUsage,
    longSessions: { ...censusUsage.longSessions, longActiveCount: 6 },
    candidates: Array.from({ length: 6 }, (_, index) => ({
      id: `private-id-${index + 1}`,
      sessionRef: bounded.longSessions.samples[index]?.sessionRef,
      activeMs: (60 - index) * 60_000,
      role: "user-thread-candidate",
      failureCount: index,
      userInputSummary: `User task ${index + 1}`,
      candidateReasons: ["active-long"],
    })),
    outcomeReview: {
      ...censusUsage.outcomeReview,
      reviewedActiveLongCount: 1,
      reviewedActiveLongSessionRefs: [bounded.longSessions.samples[0].sessionRef],
    },
  }, 9);
  assert.equal(afterFirstReview.outcomeReview.reviewedActiveLongCount, 1);
  assert.deepEqual(afterFirstReview.longSessions.samples.map((row) => row.rawSessionId), [
    "private-id-2",
    "private-id-3",
    "private-id-4",
    "private-id-5",
  ]);
});

test("session source bridge discards zero-signal episodes and records the boundary", () => {
  const events = Array.from({ length: 200 }, (_, index) => event({
    timestamp: `2026-07-10T10:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
    type: index === 0 ? "user" : "assistant",
  }));
  const source = candidate(events);
  assert.equal(source.taskEpisodes.length, 0);
  assert.ok(source.sessionEvents.discardedEpisodeCount > 0);
  assert.equal(source.sessionEvents.candidateEpisodeCount, 0);
});

test("session source bridge omits usage detail when the bridge flag is absent", () => {
  const source = candidate([], {
    sample: { analyzedSessionCount: 1 },
    cards: [{ id: "session-usage-efficiency", finding: "Usage detail" }],
    keySignals: {
      usageEfficiency: {
        coverage: { analyzedSessionCount: 1 },
        activity: { schemaVersion: 1, dates: ["2026-07-10"] },
      },
    },
  });

  assert.equal(source.sessionEvents.usageActivity, undefined);
  assert.equal(source.sessionEvents.usageEfficiency, undefined);
  assert.equal(source.semanticFacets.some((row) => row.id === "session-insight:session-usage-efficiency"), false);
});

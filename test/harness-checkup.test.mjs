import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyCheckupPlan,
  createQoderCliExecutor,
  resolveSourceRef,
  sha256,
} from "../scripts/coding-agent-practices/checkup/apply.mjs";
import { buildCheckupPlan } from "../scripts/coding-agent-practices/checkup/plan.mjs";
import { computePlanDigest } from "../scripts/coding-agent-practices/checkup/plan.mjs";
import { formatMarkdown } from "../scripts/coding-agent-practices/checkup/cli.mjs";
import { projectCheckupReportEvidence } from "../scripts/coding-agent-practices/checkup/contract.mjs";
import { buildCheckupScan } from "../scripts/coding-agent-practices/checkup/scan.mjs";
import { runCheckupScan } from "../scripts/coding-agent-practices/checkup/scan.mjs";
import { collectQoderSourceResolution } from "../scripts/coding-agent-practices/checkup/sources.mjs";
import {
  buildLifecycleCapabilityRecommendation,
  buildRepeatedFrictionTriage,
} from "../scripts/coding-agent-practices/checkup/friction.mjs";
import { hookConfigurationDigest } from "../scripts/agent-customize/core/items.mjs";

const NOW = "2026-07-11T12:00:00.000Z";

function inventoryFixture() {
  return {
    provider: "qoder",
    diagnostics: { installedPluginState: "qoder-installed-index" },
    plugins: [
      {
        id: "review-kit@local",
        qoderPluginId: "review-kit@local",
        kind: "plugin",
        name: "review-kit",
        displayName: "Review Kit",
        installSource: "project",
        sourceLabel: "Review Kit",
        installedAt: "2026-05-01T00:00:00.000Z",
        enabled: true,
        skills: [{ name: "review-flow" }],
        hooks: [],
        mcpServers: [],
        commands: [],
        rules: [],
        subagents: [],
      },
      {
        id: "disabled-kit@local",
        qoderPluginId: "disabled-kit@local",
        kind: "plugin",
        name: "disabled-kit",
        displayName: "Disabled Kit",
        installSource: "user",
        sourceLabel: "Disabled Kit",
        installedAt: "2026-05-01T00:00:00.000Z",
        enabled: false,
        skills: [],
        hooks: [],
        mcpServers: [],
        commands: [],
        rules: [],
        subagents: [],
      },
    ],
    manage: {
      skills: [
        {
          id: "project:skill:review-flow",
          kind: "skill",
          name: "review-flow",
          scope: "project",
          sourceLabel: "Review Kit",
          installedAt: "2026-05-01T00:00:00.000Z",
          enabled: true,
        },
        {
          id: "project:skill:stale-flow",
          kind: "skill",
          name: "stale-flow",
          scope: "project",
          sourceLabel: "demo/repo",
          installedAt: "2026-05-01T00:00:00.000Z",
          enabled: true,
        },
        {
          id: "user:skill:global-flow",
          kind: "skill",
          name: "global-flow",
          scope: "user",
          sourceLabel: "User",
          installedAt: "2026-05-01T00:00:00.000Z",
          enabled: true,
        },
      ],
      mcps: [
        {
          id: "project:mcp:fresh-docs",
          kind: "mcp",
          name: "fresh-docs",
          scope: "project",
          sourceLabel: "demo/repo",
          installedAt: "2026-07-09T00:00:00.000Z",
          enabled: true,
          toolCount: 3,
        },
      ],
      hooks: [
        {
          id: "project:hook:review-finished",
          kind: "hook",
          label: "review-finished",
          scope: "project",
          sourceLabel: "demo/repo",
          enabled: true,
        },
      ],
      rules: [],
      commands: [],
      subagents: [],
    },
  };
}

function sessionFixture() {
  return {
    sources: [
      {
        id: "/Users/private/.qoder/projects/demo",
        kind: "project-jsonl",
        role: "project-session-store",
        exists: true,
        enabled: true,
        workspaceScoped: true,
      },
    ],
    selection: { strategy: "all-eligible", eligibleCount: 12, analyzedCount: 12 },
    sessions: [{ sessionId: "stable-secret-session-id" }],
    facets: {
      sessionCount: 12,
      analyzedSessionCount: 12,
      topSkills: [{ name: "review-flow", count: 3 }],
      topHooks: [{ name: "review-finished", count: 8 }],
      topTools: [{ name: "mcp__private_docs__search", count: 2 }],
    },
    warnings: [
      {
        code: "fixture-warning",
        message: "raw path /Users/private and prompt text must not escape",
      },
    ],
  };
}

function buildFixtureScan(overrides = {}) {
  return buildCheckupScan({
    inventory: inventoryFixture(),
    lintResult: {
      profile: "agents-md-review",
      findings: [
        {
          id: "root-instructions-long",
          severity: "warning",
          evidence: "raw prompt and /Users/private/AGENTS.md",
        },
      ],
    },
    sessionResult: sessionFixture(),
    options: {
      provider: "qoder",
      workspace: "/Users/private/demo",
      workspaceLabel: "demo",
      now: NOW,
      includeGlobalCapabilities: false,
      ...overrides,
    },
  });
}

test("checkup scan separates observed, candidate, grace, global, and disabled states", () => {
  const scan = buildFixtureScan();
  const byTitle = new Map(scan.findings.map((finding) => [finding.title.split(":")[0], finding]));

  assert.equal(scan.kind, "harness-customization-checkup");
  assert.equal(scan.phase, "scan");
  assert.equal(scan.coverage.sufficient, true);
  assert.equal(byTitle.get("review-flow").status, "observed");
  assert.equal(byTitle.get("Review Kit").status, "observed");
  assert.equal(byTitle.get("review-finished").status, "observed");
  assert.equal(byTitle.get("stale-flow").status, "candidate");
  assert.equal(byTitle.get("global-flow").status, "unobserved");
  assert.equal(byTitle.get("fresh-docs").status, "unobserved");
  assert.equal(byTitle.get("Disabled Kit").status, "healthy");
  assert.deepEqual(byTitle.get("stale-flow").candidateActions.length, 1);
  assert.deepEqual(byTitle.get("global-flow").candidateActions, []);
});

test("sampled scans show unobserved Skills but never produce disable candidates", () => {
  const sessionResult = sessionFixture();
  sessionResult.selection = { strategy: "stratified", eligibleCount: 12, analyzedCount: 8 };
  sessionResult.facets.analyzedSessionCount = 8;
  const scan = buildCheckupScan({
    inventory: inventoryFixture(),
    sessionResult,
    options: { provider: "qoder", workspace: "/tmp/demo", workspaceLabel: "demo", now: NOW },
  });
  const stale = scan.findings.find((finding) => finding.title.startsWith("stale-flow:"));
  const skills = scan.summary.capabilityUse.find((row) => row.kind === "skill");
  const markdown = formatMarkdown(scan);

  assert.equal(scan.coverage.sufficient, true);
  assert.equal(scan.coverage.cleanupEligible, false);
  assert.equal(scan.coverage.cleanupReason, "cleanup-census-incomplete");
  assert.equal(stale.status, "unobserved");
  assert.equal(stale.evidence.some((item) => item.code === "cleanup-census-incomplete"), true);
  assert.equal(scan.findings.some((finding) => finding.status === "candidate" && finding.kind === "skill"), false);
  assert.equal(skills.configured, 3);
  assert.equal(skills.observed, 1);
  assert.match(markdown, /Capability Use And Cleanup Eligibility/u);
  assert.match(markdown, /Skills: configured 3; observed 1; not observed 2; cleanup candidates 0/u);
  assert.match(markdown, /--selection all-eligible/u);
});

test("checkup scan never exposes raw paths, prompts, session ids, or warning text", () => {
  const payload = JSON.stringify(buildFixtureScan());

  assert.doesNotMatch(payload, /\/Users\/private/u);
  assert.doesNotMatch(payload, /stable-secret-session-id/u);
  assert.doesNotMatch(payload, /raw prompt/u);
  assert.doesNotMatch(payload, /raw path/u);
  assert.match(payload, /root-instructions-long/u);
  assert.match(payload, /fixture-warning/u);
});

test("global candidates require an explicit global capability pass", () => {
  const sessionResult = sessionFixture();
  sessionResult.sources.push({
    id: "qoder-global-projects",
    kind: "global-project-jsonl",
    role: "user-global-project-session-store",
    exists: true,
    enabled: true,
    workspaceScoped: false,
  });
  sessionResult.facets.sourceCoverage = { "global-project-jsonl": 6, "project-jsonl": 6 };
  const scan = buildCheckupScan({
    inventory: inventoryFixture(),
    sessionResult,
    options: {
      provider: "qoder",
      workspace: "/Users/private/demo",
      workspaceLabel: "demo",
      now: NOW,
      includeGlobalCapabilities: true,
    },
  });
  const globalFinding = scan.findings.find((finding) => finding.title.startsWith("global-flow:"));

  assert.equal(globalFinding.status, "candidate");
  assert.equal(scan.coverage.userGlobal, "covered");
});

test("requesting a global pass without global session coverage is still not cleanup evidence", () => {
  const scan = buildFixtureScan({ includeGlobalCapabilities: true });
  const globalFinding = scan.findings.find((finding) => finding.title.startsWith("global-flow:"));

  assert.equal(globalFinding.status, "unobserved");
  assert.equal(scan.coverage.userGlobal, "requested-unavailable");
  assert.equal(scan.coverage.userGlobalCovered, false);
});

test("repeated friction triage routes before scoring and keeps Skill creation owner-gated", () => {
  const weak = buildRepeatedFrictionTriage({
    signals: ["recurring-review-omission"],
    strength: "weak",
    observationCount: 1,
  });
  assert.equal(weak.status, "needs-more-evidence");
  assert.deepEqual(weak.routes, []);

  const repeated = buildRepeatedFrictionTriage({
    signals: ["recurring-review-omission", "recurring-validation-failure"],
    strength: "repeated",
    observationCount: 4,
  });
  assert.equal(repeated.status, "routed");
  assert.equal(repeated.routes.some((route) => route.owner === "software-fluency"), true);
  assert.equal(repeated.routes.some((route) => route.owner === "agent-work-loop"), true);
  assert.equal(repeated.routes.some((route) => route.owner === "customization-checkup"), true);
  assert.match(
    repeated.routes.find((route) => route.owner === "software-fluency").claimBoundary,
    /cannot lower a static capability/u,
  );
  const reviewRecommendation = buildLifecycleCapabilityRecommendation({
    triage: repeated,
    configuredSkills: [],
    observedSkills: [],
  });
  assert.equal(reviewRecommendation.evidenceState, "built-in");
  assert.equal(reviewRecommendation.nextStep, "try-built-in");
  assert.match(reviewRecommendation.handoff, /ultra-review/u);

  const capabilityGap = buildRepeatedFrictionTriage({
    signals: ["capability-use-gap"],
    strength: "repeated",
    observationCount: 5,
    skillOwnerSelected: false,
  });
  const gated = buildLifecycleCapabilityRecommendation({
    triage: capabilityGap,
    configuredSkills: [],
    observedSkills: [],
  });
  assert.equal(gated.nextStep, "needs-more-evidence");

  const selectedGap = buildRepeatedFrictionTriage({
    signals: ["capability-use-gap"],
    strength: "repeated",
    observationCount: 5,
    skillOwnerSelected: true,
  });
  const handoff = buildLifecycleCapabilityRecommendation({
    triage: selectedGap,
    configuredSkills: [],
    observedSkills: [],
  });
  assert.equal(handoff.nextStep, "create-skill-handoff");
  assert.match(handoff.handoff, /^\/create-skill/u);
});

test("checkup scan exposes repeated-friction routes and the lifecycle recommendation ladder", () => {
  const scan = buildFixtureScan({
    friction: "recurring-review-omission",
    frictionStrength: "repeated",
    frictionObservationCount: 4,
  });
  const capability = scan.findings.find((finding) => finding.capabilityRecommendation);

  assert.equal(scan.repeatedFrictionTriage.status, "routed");
  assert.equal(capability.capabilityRecommendation.evidenceState, "observed");
  assert.equal(capability.capabilityRecommendation.nextStep, "keep");
  assert.equal(capability.kind, "skill");
  assert.deepEqual(capability.candidateActions, []);
});

test("project MCP shadowing and plugin ownership block direct child cleanup", () => {
  const inventory = inventoryFixture();
  inventory.manage.mcps.push(
    {
      id: "user:mcp:docs",
      kind: "mcp",
      name: "docs",
      scope: "user",
      sourceLabel: "User",
      installedAt: "2026-05-01T00:00:00.000Z",
      enabled: true,
    },
    {
      id: "project:mcp:docs",
      kind: "mcp",
      name: "docs",
      scope: "project",
      sourceLabel: "demo/repo",
      installedAt: "2026-05-01T00:00:00.000Z",
      enabled: true,
    },
  );
  inventory.manage.skills.push({
    id: "plugin:skill:unused-child",
    kind: "skill",
    name: "unused-child",
    scope: "plugin",
    sourceLabel: "Review Kit",
    installedAt: "2026-05-01T00:00:00.000Z",
    enabled: true,
  });
  const scan = buildCheckupScan({
    inventory,
    sessionResult: sessionFixture(),
    options: {
      provider: "qoder",
      workspace: "/tmp/demo",
      workspaceLabel: "demo",
      now: NOW,
      includeGlobalCapabilities: true,
    },
  });
  const docsFindings = scan.findings.filter((finding) => finding.title.startsWith("docs:"));
  const userDocs = docsFindings.find((finding) => finding.scope === "user");
  const pluginChild = scan.findings.find((finding) => finding.title.startsWith("unused-child:"));

  assert.equal(userDocs.status, "unobserved");
  assert.equal(userDocs.evidence.some((item) => item.code === "shadowed-here"), true);
  assert.deepEqual(userDocs.candidateActions, []);
  assert.equal(pluginChild.status, "unobserved");
  assert.equal(pluginChild.evidence.some((item) => item.code === "plugin-owner-required"), true);
  assert.deepEqual(pluginChild.candidateActions, []);
});

test("insufficient and unavailable runtime coverage never produce cleanup candidates", () => {
  const sessionResult = sessionFixture();
  sessionResult.selection.analyzedCount = 2;
  sessionResult.facets.analyzedSessionCount = 2;
  const insufficient = buildCheckupScan({
    inventory: inventoryFixture(),
    sessionResult,
    options: { provider: "qoder", workspace: "/tmp/demo", workspaceLabel: "demo", now: NOW },
  });
  assert.equal(insufficient.findings.some((finding) => finding.status === "candidate"), false);
  assert.equal(insufficient.findings.some((finding) => finding.status === "unobserved"), true);

  sessionResult.sources = sessionResult.sources.map((source) => ({ ...source, exists: false }));
  const unavailable = buildCheckupScan({
    inventory: inventoryFixture(),
    sessionResult,
    options: { provider: "qoder", workspace: "/tmp/demo", workspaceLabel: "demo", now: NOW },
  });
  assert.equal(unavailable.findings.some((finding) => finding.status === "candidate"), false);
  assert.equal(unavailable.findings.some((finding) => finding.status === "configured-only"), true);
});

test("checkup plan emits stable argv actions and a stable digest without applying them", () => {
  const scan = buildFixtureScan();
  const first = buildCheckupPlan(scan);
  const second = buildCheckupPlan(structuredClone(scan));

  assert.equal(first.phase, "plan");
  assert.equal(first.planDigest, second.planDigest);
  assert.equal(first.actions.length, 1);
  assert.deepEqual(first.actions[0].mutation, {
    type: "qoder-cli",
    executable: "qodercli",
    argv: ["skills", "disable", "stale-flow", "--scope", "workspace"],
  });
  assert.equal(first.confirmation.requiredForApply, true);
  assert.equal(first.confirmation.applyAvailable, true);
  assert.equal(first.actions[0].sourceFingerprints.state, "inventory-fingerprint-only");
});

test("confirmed apply executes only selected Qoder argv without a shell", async () => {
  const plan = buildCheckupPlan(buildFixtureScan());
  const calls = [];
  const executor = createQoderCliExecutor({
    spawn(executable, argv, options) {
      calls.push({ executable, argv, options });
      return { status: 0, signal: null };
    },
  });
  const result = await applyCheckupPlan(plan, {
    workspace: "/tmp/demo",
    confirmationDigest: plan.planDigest,
    selectedActionIds: [plan.actions[0].id],
    currentPlan: plan,
  }, {
    executeQoder: executor,
    queryQoder: async () => ({ ok: true, exitCode: 0 }),
    verifyAction: async () => ({ disk: "verified", runtimeReload: "required" }),
  });

  assert.equal(result.summary.applied, 1);
  assert.equal(result.summary.failed, 0);
  assert.equal(result.results[0].verification.effectiveStateCommand, "succeeded");
  assert.deepEqual(calls[0].executable, "qodercli");
  assert.deepEqual(calls[0].argv, ["skills", "disable", "stale-flow", "--scope", "workspace"]);
  assert.equal(calls[0].options.shell, false);
  assert.equal("stdout" in result.results[0].execution, false);
  assert.equal("stderr" in result.results[0].execution, false);
});

test("apply rejects missing confirmation and evidence drift before execution", async () => {
  const plan = buildCheckupPlan(buildFixtureScan());
  let calls = 0;
  const executeQoder = async () => {
    calls += 1;
    return { ok: true, exitCode: 0 };
  };
  await assert.rejects(
    applyCheckupPlan(plan, {
      workspace: "/tmp/demo",
      confirmationDigest: "wrong",
      selectedActionIds: [plan.actions[0].id],
      currentPlan: plan,
    }, { executeQoder }),
    /confirm-plan-digest/u,
  );

  const currentPlan = structuredClone(plan);
  currentPlan.scanDigest = "changed-evidence";
  currentPlan.planDigest = computePlanDigest(currentPlan);
  await assert.rejects(
    applyCheckupPlan(plan, {
      workspace: "/tmp/demo",
      confirmationDigest: plan.planDigest,
      selectedActionIds: [plan.actions[0].id],
      currentPlan,
    }, { executeQoder }),
    /drifted after planning/u,
  );
  assert.equal(calls, 0);
});

test("source patch apply verifies fingerprints, backs up, writes atomically, and detects later drift", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-checkup-apply-"));
  const sourcePath = path.join(root, ".qoder", "settings.json");
  const original = '{\n  "enabled": true\n}\n';
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, original);

  try {
    const action = {
      id: "patch-project-hook",
      operation: "deduplicate",
      target: { kind: "hook", name: "review-hook", scope: "project" },
      mutation: {
        type: "source-patch",
        sourceRef: { base: "workspace", relativePath: ".qoder/settings.json" },
        patch: {
          type: "replace-lines",
          startLine: 2,
          endLine: 2,
          expectedHash: sha256('  "enabled": true'),
          replacement: '  "enabled": false',
        },
      },
      sourceFingerprints: {
        "workspace:.qoder/settings.json": sha256(original),
      },
      validation: [],
      rollback: [],
    };
    const plan = {
      kind: "harness-customization-checkup",
      schemaVersion: 1,
      phase: "plan",
      provider: "qoder",
      workspace: path.basename(root),
      observationWindow: { since: "2026-06-01T00:00:00.000Z", until: NOW },
      scanDigest: "fixture-scan",
      actions: [action],
    };
    plan.planDigest = computePlanDigest(plan);
    const applied = await applyCheckupPlan(plan, {
      workspace: root,
      confirmationDigest: plan.planDigest,
      selectedActionIds: [action.id],
      currentPlan: plan,
      now: NOW,
    });
    assert.equal(applied.results[0].status, "applied");
    assert.equal(await readFile(sourcePath, "utf8"), '{\n  "enabled": false\n}\n');
    const backupPath = path.join(root, applied.results[0].backup);
    assert.equal(await readFile(backupPath, "utf8"), original);
    assert.match(applied.results[0].backup, /^\.better-harness-checkup-backups\//u);

    await writeFile(sourcePath, '{\n  "enabled": "drifted"\n}\n');
    const drifted = await applyCheckupPlan(plan, {
      workspace: root,
      confirmationDigest: plan.planDigest,
      selectedActionIds: [action.id],
      currentPlan: plan,
      now: NOW,
    });
    assert.equal(drifted.results[0].status, "failed");
    assert.equal(drifted.results[0].errorCode, "source-drift");
    assert.equal(await readFile(sourcePath, "utf8"), '{\n  "enabled": "drifted"\n}\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("source patch resolution rejects traversal, generated runtime files, and plugin caches", () => {
  const options = { workspace: "/tmp/workspace", qoderHome: "/tmp/qoder-home" };
  assert.throws(
    () => resolveSourceRef({ base: "workspace", relativePath: "../outside.json" }, options),
    /escapes/u,
  );
  assert.throws(
    () => resolveSourceRef({ base: "provider-home", relativePath: "extension/local/mcp.json" }, options),
    /generated, cached/u,
  );
  assert.throws(
    () => resolveSourceRef({ base: "provider-home", relativePath: "plugins/cache/tool/hooks.json" }, options),
    /generated, cached/u,
  );
});

test("same sanitized Hook identity with different arguments never produces a deduplication action", () => {
  const workspace = "/tmp/better-harness-checkup-hook-distinct";
  const filePath = path.join(workspace, ".qoder", "settings.json");
  const records = [
    { matcher: "*", hooks: [{ type: "command", command: "node hooks/review.mjs --first" }] },
    { matcher: "*", hooks: [{ type: "command", command: "node hooks/review.mjs --second" }] },
  ];
  const inventory = {
    provider: "qoder",
    workspace,
    qoderHome: "/tmp/better-harness-checkup-hook-distinct-home",
    diagnostics: { installedPluginState: "missing" },
    plugins: [],
    manage: {
      skills: [],
      mcps: [],
      rules: [],
      commands: [],
      subagents: [],
      hooks: records.map((record, registrationIndex) => ({
        id: `project:hook:${registrationIndex}`,
        kind: "hook",
        name: "Stop *",
        label: "Stop *",
        step: "Stop",
        matcher: "*",
        commandDisplay: "node hooks/review.mjs",
        configurationDigest: hookConfigurationDigest("Stop", record, record.hooks[0]),
        handlerType: "command",
        registrationIndex,
        hookIndex: 0,
        scope: "project",
        sourceLabel: "fixture",
        filePath,
        enabled: true,
      })),
    },
  };
  const scan = buildCheckupScan({
    inventory,
    sessionResult: sessionFixture(),
    options: { provider: "qoder", workspace, workspaceLabel: "fixture", now: NOW },
  });
  const plan = buildCheckupPlan(scan);

  assert.equal(scan.findings.some((item) =>
    item.evidence?.some((evidence) => evidence.code === "hook-duplicate-registration")
  ), false);
  assert.equal(plan.actions.some((item) => item.operation === "deduplicate"), false);
  assert.doesNotMatch(JSON.stringify(scan), /--first|--second/u);
});

test("normal scan and plan turn an exact duplicate Hook registration into a fingerprinted patch", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-checkup-hook-deduplicate-"));
  const qoderHome = path.join(root, "qoder-home");
  const sourcePath = path.join(root, ".qoder", "settings.json");
  const config = {
    hooks: {
      Stop: [
        { matcher: "*", hooks: [{ type: "command", command: "node hooks/review.mjs --same" }] },
        { matcher: "*", hooks: [{ type: "command", command: "node hooks/review.mjs --same" }] },
      ],
    },
  };
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await mkdir(qoderHome, { recursive: true });
  await writeFile(sourcePath, `${JSON.stringify(config, null, 2)}\n`);

  try {
    const inventory = {
      provider: "qoder",
      workspace: root,
      qoderHome,
      diagnostics: { installedPluginState: "missing" },
      plugins: [],
      manage: {
        skills: [],
        mcps: [],
        rules: [],
        commands: [],
        subagents: [],
        hooks: [0, 1].map((registrationIndex) => ({
          id: `project:hook:${registrationIndex}`,
          kind: "hook",
          name: "Stop *",
          label: "Stop *",
          step: "Stop",
          matcher: "*",
          command: "node hooks/review.mjs --same",
          commandDisplay: "node hooks/review.mjs",
          configurationDigest: hookConfigurationDigest(
            "Stop",
            config.hooks.Stop[registrationIndex],
            config.hooks.Stop[registrationIndex].hooks[0],
          ),
          handlerType: "command",
          registrationIndex,
          hookIndex: 0,
          scope: "project",
          sourceLabel: "fixture",
          filePath: sourcePath,
          enabled: true,
        })),
      },
    };
    const scan = await runCheckupScan({
      provider: "qoder",
      workspace: root,
      qoderHome,
      now: NOW,
    }, {
      inventory,
      lintResult: { profile: "agents-md-review", findings: [] },
      sessionResult: sessionFixture(),
      sourceResolution: { provider: "qoder", state: "selected", sources: [] },
    });
    const plan = buildCheckupPlan(scan);
    const action = plan.actions.find((item) => item.operation === "deduplicate");

    assert.ok(action);
    assert.equal(action.mutation.type, "source-patch");
    assert.equal(action.mutation.patch.type, "remove-hook-registration");
    assert.match(action.mutation.patch.expectedConfigurationDigest, /^[a-f0-9]{64}$/u);
    assert.match(action.sourceFingerprints["workspace:.qoder/settings.json"], /^[a-f0-9]{64}$/u);

    const applied = await applyCheckupPlan(plan, {
      workspace: root,
      qoderHome,
      confirmationDigest: plan.planDigest,
      selectedActionIds: [action.id],
      currentPlan: plan,
      now: NOW,
    });
    assert.equal(applied.summary.applied, 1);
    const updated = JSON.parse(await readFile(sourcePath, "utf8"));
    assert.equal(updated.hooks.Stop.length, 1);
    assert.equal(updated.hooks.Stop[0].hooks[0].command, "node hooks/review.mjs --same");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("checkup maps stable MCP tools and attributable slow hooks back to configured owners", () => {
  const inventory = inventoryFixture();
  inventory.manage.mcps.push(
    {
      id: "project:mcp:docs",
      kind: "mcp",
      name: "docs",
      scope: "project",
      sourceLabel: "demo/repo",
      installedAt: "2026-05-01T00:00:00.000Z",
      enabled: true,
      toolNames: ["search_docs"],
    },
    {
      id: "project:mcp:ambiguous-a",
      kind: "mcp",
      name: "ambiguous-a",
      scope: "project",
      sourceLabel: "demo/repo",
      installedAt: "2026-05-01T00:00:00.000Z",
      enabled: true,
      toolNames: ["shared_tool"],
    },
    {
      id: "project:mcp:ambiguous-b",
      kind: "mcp",
      name: "ambiguous-b",
      scope: "project",
      sourceLabel: "demo/repo",
      installedAt: "2026-05-01T00:00:00.000Z",
      enabled: true,
      toolNames: ["shared_tool"],
    },
  );
  inventory.manage.hooks.push({
    id: "project:hook:pre-tool",
    kind: "hook",
    name: "pre-tool",
    label: "pre-tool",
    step: "PreToolUse",
    commandDisplay: "node hooks/pre-tool.mjs",
    handlerType: "command",
    scope: "project",
    sourceLabel: "demo/repo",
    enabled: true,
  });
  const sessionResult = sessionFixture();
  sessionResult.facets.topTools = [
    { name: "search_docs", count: 4 },
    { name: "shared_tool", count: 3 },
  ];
  sessionResult.facets.hookRuntime = {
    finishedExecutions: 5,
    startedWithoutFinish: 0,
    ambiguousCompletions: 0,
    groups: [
      {
        name: "PreToolUse",
        executions: 5,
        failures: 0,
        durationSamples: 5,
        p50Ms: 650,
        p95Ms: 700,
        maxMs: 700,
        evidenceRefs: [{ path: "/Users/private/session.jsonl", sessionId: "secret" }],
      },
    ],
    commands: [
      {
        name: "PreToolUse -> node hooks/pre-tool.mjs",
        executions: 5,
        failures: 0,
        durationSamples: 5,
        p50Ms: 650,
        p95Ms: 700,
        maxMs: 700,
        evidenceRefs: [{ path: "/Users/private/session.jsonl", sessionId: "secret" }],
      },
    ],
  };
  const scan = buildCheckupScan({
    inventory,
    sessionResult,
    options: { provider: "qoder", workspace: "/tmp/demo", workspaceLabel: "demo", now: NOW },
  });
  const docs = scan.findings.find((finding) => finding.title.startsWith("docs:"));
  const ambiguous = scan.findings.filter((finding) => finding.title.startsWith("ambiguous-"));
  const hook = scan.findings.find((finding) => finding.title.startsWith("pre-tool:"));
  const plan = buildCheckupPlan(scan);
  const hookAction = plan.actions.find((action) => action.target.name === "pre-tool");

  assert.equal(docs.status, "observed");
  assert.equal(ambiguous.every((finding) => finding.status !== "observed"), true);
  assert.equal(hook.status, "candidate");
  assert.equal(hook.evidence.some((item) => item.code === "hook-p95-over-budget"), true);
  assert.equal(hookAction.operation, "manual-review");
  assert.equal(hookAction.mutation.type, "manual-review");
  assert.doesNotMatch(JSON.stringify(scan.observedUse.hookRuntime), /Users\/private|secret/u);
});

test("checkup names over-budget group-only Hook latency as an attribution gap", () => {
  const inventory = inventoryFixture();
  const sessionResult = sessionFixture();
  sessionResult.facets.hookRuntime = {
    finishedExecutions: 5,
    startedWithoutFinish: 0,
    ambiguousCompletions: 5,
    groups: [{
      name: "PreToolUse",
      executions: 5,
      failures: 0,
      durationSamples: 5,
      p50Ms: 650,
      p95Ms: 700,
      maxMs: 700,
    }],
    commands: [],
  };
  const scan = buildCheckupScan({
    inventory,
    sessionResult,
    options: { provider: "qoder", workspace: "/tmp/demo", workspaceLabel: "demo", now: NOW },
  });
  const finding = scan.findings.find((item) => item.id.startsWith("finding-hook-group-"));

  assert.ok(finding);
  assert.equal(finding.status, "unavailable");
  assert.equal(finding.evidence.some((item) => item.code === "hook-runtime-attribution-gap"), true);
  assert.equal(finding.candidateActions.length, 0);
  assert.equal(scan.summary.attention.some((item) => item.id === finding.id), true);
});

test("Hook count pressure and static broad matchers are visible attention, not automatic actions", () => {
  const inventory = inventoryFixture();
  inventory.manage.hooks = Array.from({ length: 11 }, (_, index) => ({
    id: `user:hook:pre-tool-${index}`,
    kind: "hook",
    name: `pre-tool-${index}`,
    label: `pre-tool-${index}`,
    step: "PreToolUse",
    matcher: "*",
    commandDisplay: `node hook-${index}.mjs`,
    handlerType: "command",
    scope: "user",
    sourceLabel: "User",
    enabled: true,
  }));
  const scan = buildCheckupScan({
    inventory,
    assetLintResult: {
      profile: "agent-assets-review",
      findings: [{
        id: "hook-broad-high-frequency-matcher",
        severity: "warning",
        assetKind: "hook",
        assetName: "pre-tool-0",
        scope: "user",
        evidence: "private configuration detail must not be copied",
      }],
    },
    sessionResult: sessionFixture(),
    options: { provider: "qoder", workspace: "/tmp/demo", workspaceLabel: "demo", now: NOW },
  });
  const countPressure = scan.findings.find((finding) =>
    finding.evidence.some((item) => item.code === "hook-count-over-recommended-limit"));
  const broadMatcher = scan.findings.find((finding) =>
    finding.evidence.some((item) => item.code === "static-hook-review"));
  const markdown = formatMarkdown(scan);

  assert.ok(countPressure);
  assert.ok(broadMatcher);
  assert.equal(countPressure.status, "unavailable");
  assert.equal(broadMatcher.status, "unavailable");
  assert.deepEqual(countPressure.candidateActions, []);
  assert.deepEqual(broadMatcher.candidateActions, []);
  assert.equal(scan.summary.attention.length, 2);
  assert.match(markdown, /Attention \(Diagnostic, No Automatic Action\)/u);
  assert.match(markdown, /11 enabled Hooks exceed the recommended limit of 10/u);
  assert.match(markdown, /hook-broad-high-frequency-matcher/u);
  assert.doesNotMatch(JSON.stringify(scan), /private configuration detail/u);
});

test("normal Checkup orchestration runs instruction and asset Hook review profiles", async () => {
  const profiles = [];
  const scan = await runCheckupScan({
    provider: "qoder",
    workspace: "/tmp/demo",
    workspaceLabel: "demo",
    now: NOW,
  }, {
    inventory: inventoryFixture(),
    runLint: async ({ profile }) => {
      profiles.push(profile);
      return {
        profile,
        findings: profile === "agent-assets-review"
          ? [{
              id: "hook-broad-high-frequency-matcher",
              severity: "warning",
              assetKind: "hook",
              assetName: "review-finished",
              scope: "project",
            }]
          : [],
      };
    },
    analyzer: { analyze: async () => sessionFixture() },
    sessionResult: sessionFixture(),
    sourceResolution: { provider: "qoder", state: "selected", sources: [] },
  });

  assert.deepEqual(profiles.sort(), ["agent-assets-review", "agents-md-review"]);
  assert.equal(scan.assetReview.findingCodes.includes("hook-broad-high-frequency-matcher"), true);
  assert.equal(scan.summary.attention.some((item) => item.evidenceCodes.includes("static-hook-review")), true);
});

test("durable Checkup evidence validates its digest and keeps only reportable sanitized rows", () => {
  const scan = buildFixtureScan();
  const evidence = projectCheckupReportEvidence(scan);

  assert.equal(evidence.phase, "report-evidence");
  assert.equal(evidence.coverage.cleanupEligible, true);
  assert.equal(evidence.findings.some((finding) => finding.status === "candidate"), true);
  assert.equal("configuredInventory" in evidence, false);
  assert.equal(evidence.summary.capabilityUse.find((row) => row.kind === "skill").configured, 3);

  const tampered = structuredClone(scan);
  tampered.findings[0].title = "/Users/private/changed after scan";
  assert.throws(() => projectCheckupReportEvidence(tampered), /digest does not match/u);
});

test("Qoder source resolution selects authored sources without merging generated or alternate homes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-checkup-sources-"));
  const workspace = path.join(root, "workspace");
  const qoderHome = path.join(root, "qoder-home");
  const cache = path.join(root, "shared-cache");
  await Promise.all([
    mkdir(path.join(workspace, ".qoder"), { recursive: true }),
    mkdir(path.join(qoderHome, "extension", "local"), { recursive: true }),
    mkdir(path.join(cache, "extension", "local"), { recursive: true }),
  ]);

  try {
    await Promise.all([
      writeFile(path.join(qoderHome, "mcp.json"), "{}\n"),
      writeFile(path.join(qoderHome, "extension", "local", "mcp.json"), "{}\n"),
      writeFile(path.join(workspace, ".qoder", "mcp.json"), "{}\n"),
      writeFile(path.join(workspace, ".mcp.json"), "{}\n"),
      writeFile(path.join(cache, "extension", "local", "mcp.json"), "{}\n"),
    ]);
    const resolution = await collectQoderSourceResolution(
      { provider: "qoder", workspace, qoderHome },
      { qoderHome, sharedClientCacheRoot: cache },
    );
    const byId = new Map(resolution.sources.map((source) => [source.id, source]));

    assert.equal(resolution.activeHomeEvidence, "explicit-option");
    assert.equal(resolution.selectedProjectSource, "qoder-project-authored");
    assert.equal(byId.get("qoder-project-authored").selected, true);
    assert.equal(byId.get("qoder-project-fallback").selected, false);
    assert.equal(byId.get("qoder-user-merged-runtime").editable, false);
    assert.equal(byId.get("qoder-shared-cache-merged-runtime").selected, false);
    assert.equal(resolution.alternateHomesMerged, false);
    assert.equal(resolution.generatedRuntimeSourcesEditable, false);
    assert.doesNotMatch(JSON.stringify(resolution), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("harness checkup CLI is parser-safe, compact, read-only, and refuses apply", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-checkup-"));
  const workspace = path.join(root, "workspace");
  const qoderHome = path.join(root, "qoder-home");
  const cache = path.join(root, "shared-cache");
  await Promise.all([mkdir(workspace), mkdir(qoderHome), mkdir(cache)]);

  try {
    const before = await readdir(root, { recursive: true });
    const command = [
      path.join(process.cwd(), "scripts", "better-harness.mjs"),
      "harness",
      "checkup",
      "--phase",
      "scan",
      "--provider",
      "qoder",
      "--workspace",
      workspace,
      "--qoder-home",
      qoderHome,
      "--shared-client-cache-root",
      cache,
      "--now",
      NOW,
      "--json",
    ];
    const scanResult = spawnSync(process.execPath, command, { encoding: "utf8" });
    assert.equal(scanResult.status, 0, scanResult.stderr);
    const scan = JSON.parse(scanResult.stdout);
    assert.equal(scan.phase, "scan");
    assert.equal(scan.coverage.runtimeAvailable, false);
    assert.doesNotMatch(scanResult.stdout, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));

    const markdownResult = spawnSync(process.execPath, command.filter((arg) => arg !== "--json"), { encoding: "utf8" });
    assert.equal(markdownResult.status, 0, markdownResult.stderr);
    assert.match(markdownResult.stdout, /No configuration was changed/u);
    assert.match(markdownResult.stdout, /configured-only/u);

    const applyResult = spawnSync(
      process.execPath,
      command.map((arg) => (arg === "scan" ? "apply" : arg)),
      { encoding: "utf8" },
    );
    assert.notEqual(applyResult.status, 0);
    assert.match(applyResult.stderr, /requires --plan/u);

    const after = await readdir(root, { recursive: true });
    assert.deepEqual(after, before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("harness checkup CLI applies a saved duplicate-hook plan only with matching digest and action id", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-checkup-cli-apply-"));
  const workspace = path.join(root, "workspace");
  const qoderHome = path.join(root, "qoder-home");
  const cache = path.join(root, "shared-cache");
  const planPath = path.join(root, "plan.json");
  const settingsPath = path.join(qoderHome, "settings.json");
  await Promise.all([mkdir(workspace), mkdir(qoderHome), mkdir(cache)]);
  await writeFile(settingsPath, `${JSON.stringify({
    hooks: {
      Stop: [
        { matcher: "*", hooks: [{ type: "command", command: "node hooks/review.mjs --same" }] },
        { matcher: "*", hooks: [{ type: "command", command: "node hooks/review.mjs --same" }] },
      ],
    },
  }, null, 2)}\n`);

  try {
    const cli = path.join(process.cwd(), "scripts", "better-harness.mjs");
    const common = [
      cli,
      "harness",
      "checkup",
      "--provider",
      "qoder",
      "--workspace",
      workspace,
      "--qoder-home",
      qoderHome,
      "--shared-client-cache-root",
      cache,
      "--now",
      NOW,
      "--json",
    ];
    const planned = spawnSync(process.execPath, [...common, "--phase", "plan"], { encoding: "utf8" });
    assert.equal(planned.status, 0, planned.stderr);
    const plan = JSON.parse(planned.stdout);
    const action = plan.actions.find((item) => item.operation === "deduplicate");
    assert.ok(action);
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);

    const applied = spawnSync(process.execPath, [
      ...common,
      "--phase",
      "apply",
      "--plan",
      planPath,
      "--confirm-plan-digest",
      plan.planDigest,
      "--action-id",
      action.id,
    ], { encoding: "utf8" });
    assert.equal(applied.status, 0, applied.stderr);
    const result = JSON.parse(applied.stdout);
    assert.equal(result.summary.applied, 1);
    assert.equal(result.results[0].operation, "deduplicate");
    assert.equal(JSON.parse(await readFile(settingsPath, "utf8")).hooks.Stop.length, 1);
    assert.doesNotMatch(applied.stdout, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

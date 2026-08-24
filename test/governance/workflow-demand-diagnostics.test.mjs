import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";

import {
  WORKFLOW_DEMAND_BUILT_IN_CAPABILITIES,
  WORKFLOW_DEMAND_DIAGNOSTICS_KIND,
  buildWorkflowDemandDiagnostics,
  validateWorkflowDemandDiagnostics,
  validateWorkflowDemandDiagnosticsAgainstInputs,
  workflowDemandSignalKey,
} from "../../scripts/harness-analysis/workflow-demand-diagnostics.mjs";

function signal(intent, confidence = "high", extra = {}) {
  return {
    intent,
    family: "detector-family",
    dimensionId: "detector-dimension",
    checkId: "detector-check",
    confidence,
    evidenceRefs: [{ kind: "fixture-event", id: `${intent}-event` }],
    ...extra,
  };
}

function episodeId(value) {
  return `episode:${createHash("sha256").update(String(value)).digest("hex").slice(0, 16)}`;
}

function episode(id, intents, { current = false, lastSeen, confidence = "high" } = {}) {
  return {
    id: episodeId(id),
    current,
    startBoundary: "session-start",
    ...(lastSeen ? { lastSeen } : {}),
    lifecycleSignals: intents.map((intent) => signal(intent, confidence)),
  };
}

function scopedEpisode(id, intent, {
  scope = "workspace",
  host = "qoder",
  current = false,
  lastSeen,
  confidence = "high",
} = {}) {
  return {
    id: episodeId(id),
    current,
    startBoundary: "session-start",
    ...(lastSeen ? { lastSeen } : {}),
    lifecycleSignals: [signal(intent, confidence, { scope, host })],
  };
}

function configuredSkill({
  id = "spec-review",
  path = ".agents/skills/spec-review/SKILL.md",
  workflowIntents = ["spec-review"],
  lifecycleFamilies = ["specification-planning"],
  trigger = true,
  procedure = true,
  output = true,
  validation = true,
  description,
} = {}) {
  return {
    id,
    path,
    workflowIntents,
    lifecycleFamilies,
    trigger,
    procedure,
    output,
    validation,
    ...(description ? { description } : {}),
    evidenceRefs: [{ kind: "repository-file", id: path }],
  };
}

function evidence(candidates = [], extra = {}) {
  return {
    status: candidates.length > 0 ? "candidates-present" : "scanned-empty",
    candidates,
    observedProjectSkills: [],
    unresolvedNameMatches: [],
    ...extra,
  };
}

test("current spec review stays a current-dimension lead and same-episode duplicates do not establish recurrence", () => {
  const task = episode("episode-current", ["specification-review", "specification-review"], { current: true });
  task.lifecycleSignals[0].rawPrompt = "review the private prompt";
  const diagnostics = buildWorkflowDemandDiagnostics({
    taskEpisodes: [task, structuredClone(task)],
    reusableSkillEvidence: evidence(),
  });

  assert.equal(diagnostics.kind, WORKFLOW_DEMAND_DIAGNOSTICS_KIND);
  assert.equal(diagnostics.currentHandoffs.length, 1);
  assert.equal(diagnostics.repeatedCandidates.length, 0);
  assert.deepEqual(diagnostics.currentHandoffs[0].primaryReview, {
    dimensionId: "task-understanding",
    checkId: "goal-understanding",
  });
  assert.equal(diagnostics.currentHandoffs[0].demandStrength, "current-bounded");
  assert.equal(diagnostics.currentHandoffs[0].scope, "workspace");
  assert.equal(diagnostics.currentHandoffs[0].host, "unknown");
  assert.equal(diagnostics.currentHandoffs[0].ownerReview.action, "owner-review");
  assert.deepEqual(
    diagnostics.currentHandoffs[0].evidenceRefs.filter((ref) => ref.kind === "workflow-demand"),
    [{ kind: "workflow-demand", id: diagnostics.currentHandoffs[0].id }],
  );
  assert.equal(diagnostics.coverage.recurrence, "insufficient-episodes");
  assert.equal(Object.hasOwn(diagnostics, "findings"), false);
  assert.doesNotMatch(JSON.stringify(diagnostics), /private prompt|rawPrompt/u);
  assert.deepEqual(validateWorkflowDemandDiagnostics(diagnostics), []);
});

test("two distinct read-only episodes create one observed-repeated candidate", () => {
  const diagnostics = buildWorkflowDemandDiagnostics({
    taskEpisodes: [
      episode("episode-a", ["specification-review"], { lastSeen: "2026-07-14T10:00:00.000Z" }),
      episode("episode-b", ["specification-review"], { current: true, lastSeen: "2026-07-15T10:00:00.000Z" }),
    ],
    reusableSkillEvidence: evidence(),
  });

  assert.equal(diagnostics.currentHandoffs.length, 1);
  assert.equal(diagnostics.repeatedCandidates.length, 1);
  const repeated = diagnostics.repeatedCandidates[0];
  assert.equal(repeated.demandKind, "observed-repeated");
  assert.equal(repeated.demandStrength, "observed-repeated");
  assert.deepEqual(repeated.sourceEpisodes, [episodeId("episode-a"), episodeId("episode-b")].sort());
  assert.equal(repeated.evidenceWindow.distinctEpisodeCount, 2);
  assert.equal(repeated.coverageReasonCodes.includes("distinct-episode-recurrence"), true);
  assert.equal(repeated.ownerReview.action, "owner-review");
  assert.deepEqual(validateWorkflowDemandDiagnostics(diagnostics), []);
});

test("a newer current episode without lifecycle demand does not revive an older handoff", () => {
  const older = episode("episode-older-demand", ["specification-review"], {
    lastSeen: "2026-07-14T10:00:00.000Z",
  });
  const newer = {
    id: episodeId("episode-newer-context"),
    current: true,
    lastSeen: "2026-07-15T10:00:00.000Z",
    lifecycleSignals: [],
  };
  const diagnostics = buildWorkflowDemandDiagnostics({
    taskEpisodes: [older, newer],
    currentEpisodeId: newer.id,
    reusableSkillEvidence: evidence(),
  });

  assert.equal(diagnostics.currentHandoffs.length, 0);
  assert.equal(diagnostics.repeatedCandidates.length, 0);
  assert.deepEqual(validateWorkflowDemandDiagnostics(diagnostics, {
    taskEpisodes: [older, newer],
    currentEpisodeId: newer.id,
    reusableSkillEvidence: evidence(),
  }), []);
});

test("same-session progress needs a distinct redacted target before it counts as repeated work", () => {
  const first = {
    ...episode("episode-target-a", ["specification-review"], { current: false }),
    targetKeys: ["target-a"],
  };
  const second = {
    ...episode("episode-target-b", ["specification-review"], { current: true }),
    startBoundary: "progress-handoff",
    targetKeys: ["target-b"],
  };
  const repeated = buildWorkflowDemandDiagnostics({
    taskEpisodes: [first, second],
    reusableSkillEvidence: evidence(),
  });
  assert.equal(repeated.repeatedCandidates.length, 1);

  second.targetKeys = ["target-a"];
  const clarification = buildWorkflowDemandDiagnostics({
    taskEpisodes: [first, second],
    reusableSkillEvidence: evidence(),
  });
  assert.equal(clarification.repeatedCandidates.length, 0);
});

test("recurrence requires the same normalized intent, scope, and host", () => {
  const taskEpisodes = [
    scopedEpisode("episode-qoder-workspace-a", "specification-review", { scope: "workspace", host: "QODER" }),
    scopedEpisode("episode-qoder-global", "specification-review", { scope: "user_global", host: "qoder" }),
    scopedEpisode("episode-codex-workspace", "specification-review", { scope: "workspace", host: "codex", current: true }),
  ];
  const separated = buildWorkflowDemandDiagnostics({
    taskEpisodes,
    reusableSkillEvidence: evidence(),
  });

  assert.equal(separated.repeatedCandidates.length, 0);
  assert.equal(separated.currentHandoffs[0].scope, "workspace");
  assert.equal(separated.currentHandoffs[0].host, "codex");

  taskEpisodes.push(scopedEpisode("episode-qoder-workspace-b", "specification-review", {
    scope: "workspace",
    host: "qoder",
    current: true,
  }));
  const repeated = buildWorkflowDemandDiagnostics({
    taskEpisodes,
    reusableSkillEvidence: evidence(),
  });

  assert.equal(repeated.repeatedCandidates.length, 1);
  assert.deepEqual(repeated.repeatedCandidates[0].sourceEpisodes, [
    episodeId("episode-qoder-workspace-a"),
    episodeId("episode-qoder-workspace-b"),
  ].sort());
  assert.equal(workflowDemandSignalKey(repeated.repeatedCandidates[0]), "spec-review|workspace|qoder");
  assert.deepEqual(validateWorkflowDemandDiagnostics(repeated, {
    taskEpisodes,
    reusableSkillEvidence: evidence(),
  }), []);
});

test("episode binding validation requires the exact lead intent, scope, and host on every source episode", () => {
  const taskEpisodes = [
    scopedEpisode("episode-a", "specification-review", { host: "qoder" }),
    scopedEpisode("episode-b", "specification-review", { host: "qoder", current: true }),
  ];
  const diagnostics = buildWorkflowDemandDiagnostics({ taskEpisodes, reusableSkillEvidence: evidence() });
  const wrongIntent = [
    taskEpisodes[0],
    scopedEpisode("episode-b", "task-planning", { host: "qoder", current: true }),
  ];
  const wrongHost = [
    taskEpisodes[0],
    scopedEpisode("episode-b", "specification-review", { host: "codex", current: true }),
  ];

  assert.deepEqual(validateWorkflowDemandDiagnostics(diagnostics), []);
  assert.match(
    validateWorkflowDemandDiagnosticsAgainstInputs(diagnostics, { taskEpisodes: wrongIntent }).join("; "),
    /does not contain exact workflow signal spec-review\|workspace\|qoder/u,
  );
  assert.match(
    validateWorkflowDemandDiagnostics(diagnostics, { taskEpisodes: wrongHost }).join("; "),
    /does not contain exact workflow signal spec-review\|workspace\|qoder/u,
  );
});

test("real detector intents and command aliases normalize into the expected lifecycle families", () => {
  const diagnostics = buildWorkflowDemandDiagnostics({
    taskEpisodes: [episode("episode-aliases", [
      "specification-review",
      "specification-authoring",
      "task-planning",
      "debug-test-verification",
      "review-acceptance-delivery",
      "/ultraplan",
      "/plan",
      "/spec",
      "/story",
      "/issue-triage",
      "/issue-plan",
    ], { current: true })],
    reusableSkillEvidence: evidence(),
  });
  const byIntent = new Map(diagnostics.currentHandoffs.map((row) => [row.intent, row]));

  assert.deepEqual([...byIntent.keys()].sort(), [
    "issue-triage",
    "issue-workflow-planning",
    "planning",
    "review-acceptance",
    "spec-review",
    "specification-preparation",
    "testing-verification",
  ]);
  for (const intent of ["issue-triage", "issue-workflow-planning", "planning", "spec-review", "specification-preparation"]) {
    assert.equal(byIntent.get(intent).family, "specification-planning");
  }
  assert.equal(byIntent.get("testing-verification").family, "debugging-testing-verification");
  assert.equal(byIntent.get("review-acceptance").family, "review-acceptance-completion");
  assert.deepEqual(validateWorkflowDemandDiagnostics(diagnostics), []);
});

test("lifecycle intents map to primary Agent Work Loop dimensions and checks", () => {
  const diagnostics = buildWorkflowDemandDiagnostics({
    taskEpisodes: [episode("episode-map", [
      "specification-review",
      "specification-authoring",
      "task-planning",
      "issue-triage",
      "issue-workflow-planning",
      "setup-isolation",
      "debugging",
      "debug-test-verification",
      "review-acceptance-delivery",
      "release-delivery",
      "branch-completion",
      "documentation-maintenance",
    ], { current: true })],
    reusableSkillEvidence: evidence(),
  });
  const reviewByIntent = Object.fromEntries(diagnostics.currentHandoffs.map((row) => [
    row.intent,
    `${row.primaryReview.dimensionId}/${row.primaryReview.checkId}`,
  ]));

  assert.equal(reviewByIntent["spec-review"], "task-understanding/goal-understanding");
  assert.equal(reviewByIntent["specification-preparation"], "task-understanding/goal-understanding");
  assert.equal(reviewByIntent.planning, "task-understanding/scope-boundary");
  assert.equal(reviewByIntent["issue-triage"], "task-understanding/goal-understanding");
  assert.equal(reviewByIntent["issue-workflow-planning"], "task-understanding/scope-boundary");
  assert.equal(reviewByIntent["setup-isolation"], "controlled-execution/instruction-led-start");
  assert.equal(reviewByIntent.debugging, "change-validation/failure-repair");
  assert.equal(reviewByIntent["testing-verification"], "change-validation/relevant-check");
  assert.equal(reviewByIntent["review-acceptance"], "reliable-delivery/acceptance-evidence");
  assert.equal(reviewByIntent["release-delivery"], "reliable-delivery/acceptance-evidence");
  assert.equal(reviewByIntent["branch-completion"], "reliable-delivery/acceptance-evidence");
  assert.equal(reviewByIntent["documentation-maintenance"], "reliable-delivery/acceptance-evidence");
  assert.deepEqual(validateWorkflowDemandDiagnostics(diagnostics), []);
});

test("a matching complete configured Skill is tried before any new owner is considered", () => {
  const skill = configuredSkill();
  const diagnostics = buildWorkflowDemandDiagnostics({
    taskEpisodes: [episode("episode-configured", ["specification-review"], { current: true })],
    reusableSkillEvidence: evidence([skill]),
  });
  const handoff = diagnostics.currentHandoffs[0];

  assert.equal(handoff.coverageClasses.configuredSkills.length, 1);
  assert.equal(handoff.coverageClasses.configuredSkills[0].completeness, "complete");
  assert.equal(handoff.ownerReview.action, "try-configured");
  assert.deepEqual(handoff.ownerReview.candidateSkillIds, ["spec-review"]);
  assert.equal(handoff.ownerReview.missingProof.includes("task-linked-skill-activation"), true);
  assert.doesNotMatch(JSON.stringify(handoff.ownerReview), /create/iu);
  assert.deepEqual(validateWorkflowDemandDiagnostics(diagnostics), []);
});

test("Qoder ultra-review is a host-scoped built-in trial only for review and delivery demand", () => {
  assert.deepEqual(WORKFLOW_DEMAND_BUILT_IN_CAPABILITIES.map((row) => row.id), ["qoder-ultra-review"]);
  const qoderEpisodes = [scopedEpisode("episode-qoder-review", "review-acceptance-delivery", {
    host: "qoder",
    current: true,
  })];
  const qoder = buildWorkflowDemandDiagnostics({
    taskEpisodes: qoderEpisodes,
    reusableSkillEvidence: evidence(),
  });
  const qoderLead = qoder.currentHandoffs[0];

  assert.equal(qoderLead.ownerReview.action, "try-built-in");
  assert.equal(qoderLead.ownerReview.candidateOwner, "Built-in");
  assert.deepEqual(qoderLead.ownerReview.candidateCapabilityIds, ["qoder-ultra-review"]);
  assert.deepEqual(qoderLead.ownerReview.candidateSkillIds, []);
  assert.equal(qoderLead.coverageClasses.builtInCapabilities[0].host, "qoder");
  assert.equal(qoderLead.coverageReasonCodes.includes("matching-built-in-capability"), true);
  assert.deepEqual(validateWorkflowDemandDiagnostics(qoder, {
    taskEpisodes: qoderEpisodes,
    reusableSkillEvidence: evidence(),
  }), []);

  const reviewSkill = configuredSkill({
    id: "change-review",
    path: ".agents/skills/change-review/SKILL.md",
    workflowIntents: ["review-acceptance"],
    lifecycleFamilies: ["review-acceptance-completion"],
  });
  const builtInBeforeConfigured = buildWorkflowDemandDiagnostics({
    taskEpisodes: qoderEpisodes,
    reusableSkillEvidence: evidence([reviewSkill]),
  });
  assert.equal(builtInBeforeConfigured.currentHandoffs[0].ownerReview.action, "try-built-in");
  const observedBeforeBuiltIn = buildWorkflowDemandDiagnostics({
    taskEpisodes: qoderEpisodes,
    reusableSkillEvidence: evidence([reviewSkill], {
      observedProjectSkills: [{ name: "change-review", path: reviewSkill.path, count: 1 }],
    }),
  });
  assert.equal(observedBeforeBuiltIn.currentHandoffs[0].ownerReview.action, "covered-observed");

  const codex = buildWorkflowDemandDiagnostics({
    taskEpisodes: [scopedEpisode("episode-codex-review", "review-acceptance-delivery", { host: "codex", current: true })],
    reusableSkillEvidence: evidence(),
  });
  assert.equal(codex.currentHandoffs[0].coverageClasses.builtInCapabilities.length, 0);
  assert.equal(codex.currentHandoffs[0].ownerReview.action, "owner-review");

  const configuredSpec = buildWorkflowDemandDiagnostics({
    taskEpisodes: [scopedEpisode("episode-qoder-spec", "specification-review", { host: "qoder", current: true })],
    reusableSkillEvidence: evidence([configuredSkill()]),
  });
  assert.equal(configuredSpec.currentHandoffs[0].coverageClasses.builtInCapabilities.length, 0);
  assert.equal(configuredSpec.currentHandoffs[0].ownerReview.action, "try-configured");
});

test("a matching partial configured Skill routes to extension and names its missing shape", () => {
  const skill = configuredSkill({ validation: false });
  const diagnostics = buildWorkflowDemandDiagnostics({
    taskEpisodes: [episode("episode-partial", ["specification-review"], { current: true })],
    reusableSkillEvidence: evidence([skill]),
  });
  const handoff = diagnostics.currentHandoffs[0];

  assert.equal(handoff.coverageClasses.configuredSkills[0].completeness, "partial");
  assert.equal(handoff.ownerReview.action, "extend-existing");
  assert.deepEqual(handoff.ownerReview.missingProof, ["skill-validation"]);
  assert.deepEqual(validateWorkflowDemandDiagnostics(diagnostics), []);
});

test("matching confirmed project activation is coverage while unscoped activity and apparent reads are not", () => {
  const skill = configuredSkill();
  const covered = buildWorkflowDemandDiagnostics({
    taskEpisodes: [episode("episode-observed", ["specification-review"], { current: true })],
    reusableSkillEvidence: evidence([skill], {
      observedProjectSkills: [{ name: "spec-review", path: skill.path, count: 2 }],
    }),
  });
  assert.equal(covered.currentHandoffs[0].ownerReview.action, "covered-observed");
  assert.equal(covered.currentHandoffs[0].coverageClasses.confirmedProjectActivation.length, 1);
  assert.deepEqual(validateWorkflowDemandDiagnostics(covered), []);

  const unresolved = buildWorkflowDemandDiagnostics({
    taskEpisodes: [episode("episode-unscoped", ["specification-review"], { current: true })],
    reusableSkillEvidence: evidence([], {
      unscopedObservedSkills: [{ name: "spec-review", count: 4 }],
      apparentSkillReads: [{ name: "spec-review", count: 3 }],
    }),
  });
  const handoff = unresolved.currentHandoffs[0];
  assert.equal(handoff.coverageClasses.confirmedProjectActivation.length, 0);
  assert.equal(handoff.coverageClasses.unscopedObservedActivation.length, 1);
  assert.equal(handoff.coverageClasses.apparentReads.length, 1);
  assert.equal(handoff.ownerReview.action, "owner-review");
  assert.equal(handoff.coverageReasonCodes.includes("unscoped-activation-not-project-coverage"), true);
  assert.equal(handoff.coverageReasonCodes.includes("apparent-read-not-activation"), true);
  assert.deepEqual(validateWorkflowDemandDiagnostics(unresolved), []);
});

test("project Skill activation paths remain case-sensitive without explicit filesystem identity", () => {
  const skill = configuredSkill({ path: ".agents/skills/Spec-Review/SKILL.md" });
  const diagnostics = buildWorkflowDemandDiagnostics({
    taskEpisodes: [episode("episode-case-sensitive", ["specification-review"], { current: true })],
    reusableSkillEvidence: evidence([skill], {
      observedProjectSkills: [{ path: ".agents/skills/spec-review/SKILL.md", count: 2 }],
    }),
  });
  const handoff = diagnostics.currentHandoffs[0];

  assert.equal(handoff.coverageClasses.confirmedProjectActivation.length, 0);
  assert.equal(handoff.ownerReview.action, "try-configured");
  assert.deepEqual(validateWorkflowDemandDiagnostics(diagnostics), []);
});

test("coverage replay uses reusable Skill evidence and activity instead of trusting injected lead coverage", () => {
  const taskEpisodes = [scopedEpisode("episode-replay", "specification-review", { host: "qoder", current: true })];
  const skill = configuredSkill();
  const reusableSkillEvidence = evidence([skill]);
  const skillActivity = {
    observedSkills: [{ name: "spec-review", path: skill.path, count: 2 }],
    unscopedObservedSkills: [],
    apparentSkillReads: [],
  };
  const observed = buildWorkflowDemandDiagnostics({ taskEpisodes, reusableSkillEvidence, skillActivity });

  assert.equal(observed.currentHandoffs[0].ownerReview.action, "covered-observed");
  assert.deepEqual(validateWorkflowDemandDiagnostics(observed, {
    taskEpisodes,
    reusableSkillEvidence,
    skillActivity,
  }), []);
  assert.match(
    validateWorkflowDemandDiagnosticsAgainstInputs(observed, {
      taskEpisodes,
      reusableSkillEvidence,
      skillActivity: {},
    }).join("; "),
    /coverageClasses do not match recomputed|deterministic input recomputation/u,
  );

  const inventedConfigured = buildWorkflowDemandDiagnostics({
    taskEpisodes,
    reusableSkillEvidence: evidence([skill]),
  });
  assert.deepEqual(validateWorkflowDemandDiagnostics(inventedConfigured), []);
  assert.match(
    validateWorkflowDemandDiagnostics(inventedConfigured, {
      taskEpisodes,
      reusableSkillEvidence: evidence(),
    }).join("; "),
    /coverageClasses do not match recomputed Skill and built-in inputs|deterministic input recomputation/u,
  );
});

test("coverage replay rejects an invented built-in capability not present in the controlled catalog", () => {
  const taskEpisodes = [scopedEpisode("episode-codex-built-in", "review-acceptance-delivery", {
    host: "codex",
    current: true,
  })];
  const invented = buildWorkflowDemandDiagnostics({
    taskEpisodes,
    reusableSkillEvidence: evidence(),
    builtInCapabilities: [{
      id: "codex-invented-review",
      name: "invented-review",
      kind: "command",
      host: "codex",
      workflowIntents: ["review-acceptance"],
      available: true,
      evidenceRefs: [{ kind: "controlled-inventory", id: "codex-invented-review" }],
    }],
  });

  assert.equal(invented.currentHandoffs[0].ownerReview.action, "try-built-in");
  assert.deepEqual(validateWorkflowDemandDiagnostics(invented), []);
  assert.match(
    validateWorkflowDemandDiagnostics(invented, {
      taskEpisodes,
      reusableSkillEvidence: evidence(),
    }).join("; "),
    /coverageClasses do not match recomputed Skill and built-in inputs|deterministic input recomputation/u,
  );
});

test("Skill filenames and generic validation prose do not create matching coverage", () => {
  const generic = configuredSkill({
    id: "workflow-helper",
    path: ".agents/skills/spec-review/SKILL.md",
    workflowIntents: [],
    lifecycleFamilies: [],
    description: "Use when coordinating a reusable project task.",
  });
  generic.body = "Review the spec in a generic validation section.";
  const diagnostics = buildWorkflowDemandDiagnostics({
    taskEpisodes: [episode("episode-generic", ["specification-review"], { current: true })],
    reusableSkillEvidence: evidence([generic]),
  });
  const handoff = diagnostics.currentHandoffs[0];

  assert.equal(handoff.coverageClasses.configuredSkills.length, 0);
  assert.equal(handoff.ownerReview.action, "owner-review");
  assert.equal(handoff.coverageReasonCodes.includes("no-matching-configured-skill"), true);
  assert.deepEqual(validateWorkflowDemandDiagnostics(diagnostics), []);
});

test("missing inventory or weak demand stops at needs-more-evidence and unknown ordinary Git intent is ignored", () => {
  const weak = buildWorkflowDemandDiagnostics({
    taskEpisodes: [episode("episode-weak", ["specification-review", "git-status"], { current: true, confidence: "low" })],
  });

  assert.equal(weak.currentHandoffs.length, 1);
  assert.equal(weak.currentHandoffs[0].ownerReview.action, "needs-more-evidence");
  assert.deepEqual(weak.currentHandoffs[0].ownerReview.candidateSkillIds, []);
  assert.equal(weak.currentHandoffs[0].ownerReview.missingProof.includes("project-skill-inventory"), true);
  assert.equal(weak.currentHandoffs[0].ownerReview.missingProof.includes("bounded-workflow-shape"), true);
  assert.doesNotMatch(JSON.stringify(weak), /git-status/u);
  assert.deepEqual(validateWorkflowDemandDiagnostics(weak), []);
});

test("builder hashes private episode and evidence identities instead of copying prompts, commands, paths, or session ids", () => {
  const diagnostics = buildWorkflowDemandDiagnostics({
    taskEpisodes: [{
      id: "customer-acme-private-42",
      current: true,
      sessionIds: ["private-123"],
      lifecycleSignals: [signal("specification-review", "high", {
        rawPrompt: "review my secret spec",
        rawCommand: "cat /Users/alice/private/spec.md",
        evidenceRefs: [{ kind: "session-event", id: "/Users/alice/.qoder/private.jsonl" }],
      })],
    }],
    reusableSkillEvidence: evidence(),
  });
  const serialized = JSON.stringify(diagnostics);

  assert.doesNotMatch(serialized, /customer-acme|private-123|Users|secret spec|rawPrompt|rawCommand/u);
  assert.match(diagnostics.currentHandoffs[0].sourceEpisodes[0], /^episode:[a-f0-9]{20}$/u);
  assert.deepEqual(validateWorkflowDemandDiagnostics(diagnostics), []);
});

test("large recurrence and Skill inventories emit honest bounded samples", () => {
  const taskEpisodes = Array.from({ length: 30 }, (_, index) => episode(
    `bounded-episode-${index}`,
    ["specification-review"],
    { current: index === 29 },
  ));
  const skills = Array.from({ length: 30 }, (_, index) => configuredSkill({
    id: `spec-review-${String(index).padStart(2, "0")}`,
    path: `.agents/skills/spec-review-${String(index).padStart(2, "0")}/SKILL.md`,
  }));
  const diagnostics = buildWorkflowDemandDiagnostics({
    taskEpisodes,
    reusableSkillEvidence: evidence(skills),
  });
  const repeated = diagnostics.repeatedCandidates[0];

  assert.equal(repeated.sourceEpisodes.length, 12);
  assert.deepEqual(repeated.evidenceWindow, {
    distinctEpisodeCount: 12,
    totalDistinctEpisodeCount: 30,
    truncated: true,
    episodeRefs: repeated.sourceEpisodes,
  });
  assert.equal(repeated.coverageClasses.configuredSkills.length, 12);
  assert.equal(repeated.coverageTotals.configuredSkills, 30);
  assert.equal(repeated.ownerReview.candidateSkillIds.length, 12);
  assert.ok(repeated.evidenceRefs.length <= 64);
  assert.deepEqual(validateWorkflowDemandDiagnostics(diagnostics, {
    taskEpisodes,
    reusableSkillEvidence: evidence(skills),
  }), []);
});

test("validator rejects recurrence inflation, auto-create actions, findings, private fields, and unsafe Skill paths", () => {
  const base = buildWorkflowDemandDiagnostics({
    taskEpisodes: [
      episode("episode-a", ["specification-review"]),
      episode("episode-b", ["specification-review"], { current: true }),
    ],
    reusableSkillEvidence: evidence([configuredSkill()]),
  });

  const duplicate = structuredClone(base);
  duplicate.repeatedCandidates[0].sourceEpisodes = [episodeId("episode-a"), episodeId("episode-a")];
  duplicate.repeatedCandidates[0].evidenceWindow = {
    distinctEpisodeCount: 1,
    episodeRefs: [episodeId("episode-a"), episodeId("episode-a")],
  };
  assert.match(validateWorkflowDemandDiagnostics(duplicate).join("; "), /distinct episode ids|at least two distinct episodes/u);

  const create = structuredClone(base);
  create.currentHandoffs[0].ownerReview.action = "create-skill";
  assert.match(validateWorkflowDemandDiagnostics(create).join("; "), /must never auto-create/u);

  const finding = structuredClone(base);
  finding.findings = [{ id: "not-allowed" }];
  assert.match(validateWorkflowDemandDiagnostics(finding).join("; "), /unsupported field: findings/u);

  const privateField = structuredClone(base);
  privateField.currentHandoffs[0].rawPrompt = "private";
  assert.match(validateWorkflowDemandDiagnostics(privateField).join("; "), /unsupported field: rawPrompt|must not contain raw prompts/u);

  const unsafePath = structuredClone(base);
  unsafePath.currentHandoffs[0].coverageClasses.configuredSkills[0].path = "C:\\Users\\alice\\spec-review\\SKILL.md";
  assert.match(validateWorkflowDemandDiagnostics(unsafePath).join("; "), /safe repository-relative path|absolute home paths/u);

  const wrongDimension = structuredClone(base);
  wrongDimension.currentHandoffs[0].primaryReview.checkId = "loop-engineering";
  assert.match(validateWorkflowDemandDiagnostics(wrongDimension).join("; "), /Agent Work Loop intent mapping/u);

  const wrongSelfRef = structuredClone(base);
  wrongSelfRef.currentHandoffs[0].evidenceRefs.find((ref) => ref.kind === "workflow-demand").id = "workflow-demand:invented";
  assert.match(validateWorkflowDemandDiagnostics(wrongSelfRef).join("; "), /workflow-demand self reference matching the lead id/u);

  const wrongHost = structuredClone(base);
  wrongHost.currentHandoffs[0].host = "Qoder Private Host";
  assert.match(validateWorkflowDemandDiagnostics(wrongHost).join("; "), /host must be a normalized privacy-safe host id/u);
});

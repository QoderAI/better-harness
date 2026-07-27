import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLearningCaptureEvidence,
  collectBoundedGitHistory,
  validateLearningCaptureEvidence,
} from "../scripts/harness-analysis/learning-capture-evidence.mjs";
import { buildHarnessReviewPacket } from "../scripts/harness-analysis/report-review-packet.mjs";
import { buildTaskLoopRepositoryEvidence } from "../scripts/harness-analysis/task-loop-repository-evidence.mjs";
import { buildTaskLoopSourceCandidate } from "../scripts/harness-analysis/task-loop-source.mjs";

const COMPLETE_SKILL = `---
name: release-review
description: Use when preparing a reviewed release.
---

# Release review

## Workflow

1. Inspect the target.
2. Prepare the release.

## Output

Produce a release report.

## Validation

Run the package test and verify commands.
`;

const COMPLETE_SPEC = `# Change contract

## Traceability

- Status: Implemented

## Acceptance Scenarios

- EC-AC-1: The scanner emits bounded evidence.
- EC-AC-2: Review remains required.

## Plan and Tasks

- Update \`scripts/example.mjs\`.

## Test and Review Evidence

- Run \`node --test test/example.test.mjs\`.

Superseded by: [Next contract](next-contract.md)
`;

function fixture() {
  const trackedFiles = [
    "AGENTS.md",
    ".qoder-plugin/plugin.json",
    ".agents/skills/release-review/SKILL.md",
    "node_modules/foreign/skills/release-review/SKILL.md",
    "docs/specs/change.md",
    "docs/adrs/adr-000-template.md",
    "docs/adrs/adr-017-testing.md",
  ];
  const fileContents = {
    "AGENTS.md": "Use [.agents/skills/release-review/SKILL.md](.agents/skills/release-review/SKILL.md) for releases and [the change spec](docs/specs/change.md) for this behavior.",
    ".qoder-plugin/plugin.json": JSON.stringify({ name: "fixture-plugin" }),
    ".agents/skills/release-review/SKILL.md": COMPLETE_SKILL,
    "docs/specs/change.md": COMPLETE_SPEC,
    "docs/adrs/adr-000-template.md": "# ADR template\n\n## Status\n\nProposed",
    "docs/adrs/adr-017-testing.md": "# Testing decision\n\n## Status\n\nAccepted\n\n## Decision\n\nUse integration tests.",
  };
  const gitHistory = {
    status: "complete",
    commits: [{
      hash: "a".repeat(40),
      parentCount: 1,
      subject: "fix parser boundary",
      files: [
        { status: "M", path: "src/parser.mjs" },
        { status: "A", path: "test/parser.test.mjs" },
      ],
    }, {
      hash: "b".repeat(40),
      parentCount: 0,
      subject: "hotfix initial import",
      files: [
        { status: "A", path: "src/import.mjs" },
        { status: "A", path: "test/import.test.mjs" },
      ],
    }, {
      hash: "c".repeat(40),
      parentCount: 1,
      subject: "fix docs",
      files: [{ status: "M", path: "README.md" }],
    }],
  };
  return { trackedFiles, fileContents, gitHistory };
}

test("learning capture resolves only routed project Skills and exact project-owned activity", () => {
  const input = fixture();
  const evidence = buildLearningCaptureEvidence({
    ...input,
    insights: {
      keySignals: {
        topSkills: [
          { name: "fixture-plugin:release-review", count: 2 },
          { name: "release-review", count: 7 },
          { name: "global-only", count: 9 },
        ],
      },
    },
  });
  const coverage = evidence.reusableSkillEvidence;

  assert.equal(coverage.candidates.length, 1);
  assert.deepEqual(coverage.candidates[0], {
    id: "release-review",
    path: ".agents/skills/release-review/SKILL.md",
    lifecycleFamilies: ["review-acceptance-completion"],
    workflowIntents: ["release-delivery"],
    trigger: true,
    procedure: true,
    output: true,
    validation: true,
    routed: true,
    routePath: "AGENTS.md",
    evidenceRefs: [
      { kind: "repository-file", id: ".agents/skills/release-review/SKILL.md", label: "tracked project Skill" },
      { kind: "repository-file", id: "AGENTS.md", label: "project instruction route to Skill" },
    ],
  });
  assert.equal(coverage.candidateState, "Exercised");
  assert.deepEqual(coverage.observedProjectSkills.map((row) => row.match), ["project-plugin-namespace"]);
  assert.deepEqual(coverage.unresolvedNameMatches, [{ name: "release-review", count: 7, candidatePath: ".agents/skills/release-review/SKILL.md" }]);
  assert.equal(coverage.excludedUnscopedActivityCount, 2);
  assert.doesNotMatch(JSON.stringify(evidence), /node_modules|foreign/);
});

test("project Skill activity paths do not collapse case-sensitive repository identities", () => {
  const skillPath = ".agents/skills/Spec-Review/SKILL.md";
  const evidence = buildLearningCaptureEvidence({
    trackedFiles: ["AGENTS.md", skillPath],
    fileContents: {
      "AGENTS.md": `Use [Spec Review](${skillPath}) before implementation.`,
      [skillPath]: `---
name: spec-review
description: Use when reviewing a specification before implementation.
---
# Spec Review
## When to use
Review the specification before implementation.
## Workflow
Inspect the acceptance boundary.
## Output
Produce a reviewed specification.
## Validation
Verify every finding has evidence.
`,
    },
    insights: {
      keySignals: {
        topSkills: [{
          name: "spec-review",
          count: 2,
          sourcePath: ".agents/skills/spec-review/SKILL.md",
        }],
      },
    },
  });
  const coverage = evidence.reusableSkillEvidence;

  assert.deepEqual(coverage.observedProjectSkills, []);
  assert.deepEqual(coverage.unresolvedNameMatches, [{
    name: "spec-review",
    count: 2,
    candidatePath: skillPath,
  }]);
  assert.notEqual(coverage.candidateState, "Exercised");
  assert.deepEqual(validateLearningCaptureEvidence(evidence), []);
});

test("reusable Skill evidence recognizes spec review from bounded trigger text", () => {
  const skillPath = ".agents/skills/workflow-helper/SKILL.md";
  const content = `---
name: workflow-helper
description: Use when a project workflow needs a bounded handoff.
---

# Workflow helper

## When to use

Use this Skill to review the spec before implementation begins.

## Workflow

1. Inspect the specification and acceptance criteria.
2. Record review findings.

## Output

Produce a review report.

## Validation

Verify that every finding has an evidence reference.
`;
  const evidence = buildLearningCaptureEvidence({
    trackedFiles: [skillPath],
    fileContents: { [skillPath]: content },
  });
  const candidate = evidence.reusableSkillEvidence.candidates[0];

  assert.equal(candidate.id, "workflow-helper");
  assert.deepEqual(candidate.workflowIntents, ["spec-review"]);
  assert.deepEqual(candidate.lifecycleFamilies, ["specification-planning"]);
  assert.equal(candidate.trigger, true);
  assert.deepEqual(validateLearningCaptureEvidence(evidence), []);
});

test("reusable Skill evidence recognizes Chinese capability headings", () => {
  for (const heading of ["何时使用", "触发条件", "能力", "适用场景", "用途"]) {
    const skillPath = `.agents/skills/chinese-${heading}/SKILL.md`;
    const content = `---
name: workflow-helper
description: 用于处理有边界的项目任务。
---

# 工作流助手

## ${heading}

在实现前评审规格和验收标准。

## 流程

1. 检查规格。
2. 记录评审结果。

## 输出

生成评审报告。

## 验证

验证每个结论都有证据引用。
`;
    const evidence = buildLearningCaptureEvidence({
      trackedFiles: [skillPath],
      fileContents: { [skillPath]: content },
    });
    const candidate = evidence.reusableSkillEvidence.candidates[0];

    assert.deepEqual(candidate.workflowIntents, ["spec-review"], heading);
    assert.deepEqual(candidate.lifecycleFamilies, ["specification-planning"], heading);
    assert.deepEqual(validateLearningCaptureEvidence(evidence), [], heading);
  }
});

test("generic review and validation sections do not classify every Skill", () => {
  const skillPath = ".agents/skills/spec-review/SKILL.md";
  const content = `---
name: project-helper
description: Use when coordinating a reusable project task.
---

# Project helper

## Workflow

1. Collect the available inputs.
2. Produce the requested output.

## Review

Review the result and note any specification concerns.

## Output

Produce a short summary.

## Validation

Review the spec and run the relevant tests.
`;
  const evidence = buildLearningCaptureEvidence({
    trackedFiles: [skillPath],
    fileContents: { [skillPath]: content },
  });
  const candidate = evidence.reusableSkillEvidence.candidates[0];

  assert.deepEqual(candidate.workflowIntents, []);
  assert.deepEqual(candidate.lifecycleFamilies, []);
  assert.equal(candidate.procedure, true);
  assert.equal(candidate.output, true);
  assert.equal(candidate.validation, true);
  assert.deepEqual(validateLearningCaptureEvidence(evidence), []);
});

test("regression protection keeps bounded non-root defect and test co-change candidates", () => {
  const evidence = buildLearningCaptureEvidence(fixture()).regressionTestEvidence;

  assert.equal(evidence.historyStatus, "complete");
  assert.equal(evidence.inspectedCommitCount, 3);
  assert.equal(evidence.candidates.length, 1);
  assert.equal(evidence.candidates[0].commit, "a".repeat(40));
  assert.deepEqual(evidence.candidates[0].sourcePaths, ["src/parser.mjs"]);
  assert.deepEqual(evidence.candidates[0].testPaths, ["test/parser.test.mjs"]);
  assert.equal(evidence.candidates[0].pathCorrelated, true);
});

test("Spec alignment exposes status, AC, implementation, test, route, and supersession evidence without promoting templates", () => {
  const evidence = buildLearningCaptureEvidence(fixture()).canonicalSpecEvidence;
  const spec = evidence.candidates.find((row) => row.path === "docs/specs/change.md");
  const template = evidence.candidates.find((row) => row.path === "docs/adrs/adr-000-template.md");
  const adr = evidence.candidates.find((row) => row.path === "docs/adrs/adr-017-testing.md");

  assert.equal(spec.candidateState, "Wired");
  assert.deepEqual(spec.statuses, ["Implemented"]);
  assert.deepEqual(spec.acceptanceIds, ["EC-AC-1", "EC-AC-2"]);
  assert.deepEqual(spec.implementationRefs, ["scripts/example.mjs"]);
  assert.deepEqual(spec.testRefs, ["test/example.test.mjs"]);
  assert.equal(spec.validationCommandCount, 1);
  assert.deepEqual(spec.supersessionLinks, ["next-contract.md"]);
  assert.equal(spec.routePath, "AGENTS.md");
  assert.equal(template.template, true);
  assert.equal(template.candidateState, "Unobserved");
  assert.equal(adr.candidateState, "Present");
  assert.doesNotMatch(JSON.stringify(evidence), /node --test/u);
});

test("source and review packet expose candidate refs but leave Learning Capture rows unresolved", () => {
  const input = fixture();
  const repositoryEvidence = buildTaskLoopRepositoryEvidence({
    ...input,
    insights: { keySignals: { topSkills: [{ name: "release-review", count: 5 }] } },
  });
  const source = buildTaskLoopSourceCandidate({
    scope: { platform: "qoder", workspace: "/workspace/project" },
    selection: { strategy: "latest-n", eligibleCount: 0, analyzedCount: 0, strata: [] },
    repositoryEvidence,
  });
  const packet = buildHarnessReviewPacket(source);
  const review = source.assessmentDecisions.find((row) => row.kind === "repository-review");

  assert.equal(packet.allowedEvidenceRefs.some((row) => row.kind === "git-commit" && row.id === "a".repeat(40)), true);
  assert.equal(packet.allowedEvidenceRefs.some((row) => row.kind === "repository-file" && row.id === "docs/specs/change.md"), true);
  assert.equal(review.reviewedChecks.find((row) => row.id === "lifecycle-repeat-detection").status, "requires-review");
  assert.equal(review.reviewedChecks.find((row) => row.id === "loop-engineering").status, "requires-review");
  assert.equal(review.reviewedChecks.find((row) => row.id === "later-validation").status, "requires-review");
  assert.equal(repositoryEvidence.findings.some((row) => /capture-gap|later-validation-gap/u.test(row.id)), false);
  assert.deepEqual(source.repositoryEvidence.learningCaptureDiagnostics.signals.observedSkills, []);
  assert.deepEqual(source.repositoryEvidence.learningCaptureDiagnostics.signals.configuredSkills, [".agents/skills/release-review/SKILL.md"]);
});

test("bounded Git history degrades safely when Git is unavailable", () => {
  const history = collectBoundedGitHistory("/workspace/project", {
    runner: () => ({ status: 128, stdout: "", error: { code: "ENOENT" } }),
  });

  assert.deepEqual(history, { status: "unavailable", commits: [], error: "ENOENT" });
});

test("Learning Capture source validation rejects absolute candidate paths", () => {
  const evidence = buildLearningCaptureEvidence(fixture());
  evidence.canonicalSpecEvidence.candidates[0].path = "/private/spec.md";

  assert.match(validateLearningCaptureEvidence(evidence).join("; "), /safe repository-relative path/u);
});

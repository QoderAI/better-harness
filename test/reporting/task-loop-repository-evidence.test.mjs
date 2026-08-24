import assert from "node:assert/strict";
import { test } from "vitest";

import { buildTaskLoopRepositoryEvidence } from "../../scripts/harness-analysis/task-loop-repository-evidence.mjs";

test("repository evidence gives Bavi a useful static baseline without inventing runtime outcomes", () => {
  const evidence = buildTaskLoopRepositoryEvidence({
    trackedFiles: [
      "AGENTS.md",
      "docs/ARCHITECTURE.md",
      "docs/specs/example.md",
      "package.json",
      "test/example.test.mjs",
      "hooks/hooks.json.template",
      "hooks/git-scripts/test-mapping/core.mjs",
    ],
    packageManifest: {
      scripts: {
        test: "node --test",
        "pack:verify": "node scripts/npm-package/verify-pack.mjs",
      },
    },
    locale: "zh-CN",
    insights: {
      cards: [{
        id: "post-edit-validation",
        finding: "Observed 10 edit event(s), but no later validation command in the analyzed sample.",
        evidenceRefs: [{
          kind: "logs-session",
          path: "/Users/example/private/session.jsonl",
          type: "tool.execution.finished",
          line: 42,
        }],
      }],
    },
  });

  assert.ok(evidence.dimensions["task-understanding"].wired.length > 0);
  assert.ok(evidence.dimensions["controlled-execution"].wired.length > 0);
  assert.ok(evidence.dimensions["change-validation"].wired.length > 0);
  assert.ok(evidence.dimensions["reliable-delivery"].present.length > 0);
  assert.equal(evidence.dimensions["reliable-delivery"].wired.length, 0);
  assert.equal(evidence.findings.some((finding) => finding.id === "session-post-edit-validation-gap"), false);
  assert.ok(evidence.findings.some((finding) => finding.id === "repository-acceptance-path-gap"));
  assert.ok(evidence.findings.some((finding) => finding.id === "repository-reproducibility-gap"));
  assert.ok(evidence.findings.every((finding) => typeof finding.expectedOutcome === "string" && finding.expectedOutcome.length > 0));
  assert.equal(evidence.findings.find((finding) => finding.id === "repository-acceptance-path-gap").title, "改动可能未经共享检查或评审就进入主线");
  assert.deepEqual(evidence.aiAgentPractice.coverageRows.find((row) => row.surface === "Rules"), {
    surface: "Rules",
    scopes: ["Project"],
    count: 1,
    paths: ["AGENTS.md"],
  });
  assert.doesNotMatch(JSON.stringify(evidence), /\/Users\/example|session\.jsonl/);
});

test("repository evidence inventories commands, custom agents, and workflows without claiming use", () => {
  const evidence = buildTaskLoopRepositoryEvidence({
    trackedFiles: [
      ".qoder/commands/review.md",
      ".agents/agents/reviewer.md",
      ".qoder/workflows/review.yml",
      ".github/workflows/check.yml",
    ],
  });
  const rows = evidence.aiAgentPractice.coverageRows;

  assert.deepEqual(rows.find((row) => row.surface === "Commands")?.paths, [".qoder/commands/review.md"]);
  assert.deepEqual(rows.find((row) => row.surface === "Custom Agents")?.paths, [".agents/agents/reviewer.md"]);
  assert.deepEqual(rows.find((row) => row.surface === "Workflows")?.paths, [".github/workflows/check.yml", ".qoder/workflows/review.yml"]);
  assert.equal(evidence.findings.some((finding) => /command|agent|workflow/i.test(finding.id)), false);
});

test("frontend repositories without a root DESIGN.md receive one Low relevant-context finding", () => {
  const evidence = buildTaskLoopRepositoryEvidence({
    trackedFiles: ["AGENTS.md", "package.json", "package-lock.json", "src/App.tsx", "src/theme.css"],
    packageManifest: {
      dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
      scripts: { test: "node --test", build: "vite build" },
    },
    locale: "zh-CN",
  });
  const findings = evidence.findings.filter((item) => item.id === "frontend-design-contract-missing");

  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "Low");
  assert.equal(findings[0].expectedArtifact, "Rule");
  assert.deepEqual(findings[0].dimensionRefs, ["task-understanding"]);
  assert.deepEqual(findings[0].subdimensionRefs, ["relevant-context"]);
  assert.match(findings[0].aiFixPrompt, /design-system-capture/);
  assert.match(findings[0].aiFixPrompt, /design-md-review/);
  assert.match(findings[0].aiFixPrompt, /finding owner/);
  assert.match(findings[0].aiFixPrompt, /完整示例/);
  assert.match(findings[0].aiFixPrompt, /结构 fallback/);
  assert.match(findings[0].aiFixPrompt, /designmd lint DESIGN\.md/);
  assert.match(findings[0].aiFixPrompt, /needs-design-decision/);
});

test("root DESIGN.md is Rules and Agent Work Loop context evidence for frontend repositories", () => {
  const evidence = buildTaskLoopRepositoryEvidence({
    trackedFiles: ["AGENTS.md", "DESIGN.md", "package.json", "package-lock.json", "src/App.tsx"],
    packageManifest: { dependencies: { react: "^19.0.0" } },
  });
  const rules = evidence.aiAgentPractice.coverageRows.find((row) => row.surface === "Rules");

  assert.deepEqual(rules, {
    surface: "Rules",
    scopes: ["Project"],
    count: 2,
    paths: ["AGENTS.md", "DESIGN.md"],
  });
  assert.ok(evidence.dimensions["task-understanding"].present.some((item) => item.id === "root-design-contract"));
  assert.ok(evidence.subdimensions["relevant-context"].present.some((item) => item.id === "root-design-contract"));
  assert.equal(evidence.findings.some((item) => item.id === "frontend-design-contract-missing"), false);
});

test("lowercase design docs and non-frontend projects do not change the DESIGN.md contract", () => {
  const lowercaseFrontend = buildTaskLoopRepositoryEvidence({
    trackedFiles: ["design.md", "package.json", "src/App.tsx"],
    packageManifest: { dependencies: { react: "^19.0.0" } },
  });
  const vanillaFrontend = buildTaskLoopRepositoryEvidence({
    trackedFiles: ["index.html", "package.json", "src/main.ts", "src/style.css", "vite.config.ts"],
    packageManifest: { devDependencies: { vite: "^7.0.0" } },
  });
  const backend = buildTaskLoopRepositoryEvidence({
    trackedFiles: ["AGENTS.md", "package.json", "package-lock.json", "src/server.mjs"],
    packageManifest: { dependencies: { express: "^5.0.0" } },
  });

  assert.ok(lowercaseFrontend.findings.some((item) => item.id === "frontend-design-contract-missing"));
  assert.equal(lowercaseFrontend.aiAgentPractice.coverageRows
    .find((row) => row.surface === "Rules"), undefined);
  assert.ok(vanillaFrontend.findings.some((item) => item.id === "frontend-design-contract-missing"));
  assert.equal(backend.findings.some((item) => item.id === "frontend-design-contract-missing"), false);
});

test("repository evidence keeps post-edit validation cards out of findings", () => {
  const evidence = buildTaskLoopRepositoryEvidence({
    trackedFiles: ["package.json", "package-lock.json"],
    packageManifest: { scripts: { test: "node --test" } },
    insights: { cards: [{
      id: "post-edit-validation",
      finding: "Observed 2 edit event(s), but no later validation command in the analyzed sample.",
      evidenceRefs: [],
    }] },
  });
  assert.equal(evidence.findings.some((item) => item.id === "session-post-edit-validation-gap"), false);
});

test("repository evidence projects a low finding when tracked specs are not observed in planning", () => {
  const evidence = buildTaskLoopRepositoryEvidence({
    trackedFiles: ["AGENTS.md", "docs/specs/change.md"],
    insights: {
      sample: { analyzedSessionCount: 6 },
      keySignals: {
        planningSignals: [{
          name: "/plan",
          kind: "plan-command",
          scope: "workspace",
          evidenceRefs: [{ kind: "project-jsonl", path: "/Users/private/session.jsonl", line: 12 }],
        }],
      },
    },
  });
  const finding = evidence.findings.find((item) => item.id === "planning-workflow-spec-use-gap");

  assert.ok(finding);
  assert.equal(finding.severity, "Low");
  assert.equal(finding.expectedArtifact, "Workflow");
  assert.equal(finding.projectionPolicy, "required");
  assert.deepEqual(finding.dimensionRefs, ["task-understanding"]);
  assert.match(finding.reason, /Planning commands or modes alone do not prove/);
  assert.match(finding.aiFixPrompt, /`docs\/specs\/change\.md`/);
  assert.match(finding.aiFixPrompt, /## Validation/);
  assert.doesNotMatch(JSON.stringify(finding), /Users\/private|session\.jsonl/);
});

test("repository evidence recognizes host-specific spec paths but keeps spec commands distinct from file use", () => {
  const evidence = buildTaskLoopRepositoryEvidence({
    trackedFiles: [".codex/specs/change.md"],
    insights: {
      sample: { analyzedSessionCount: 2 },
      keySignals: {
        planningSignals: [{ name: "/spec", kind: "spec-command", scope: "workspace" }],
      },
    },
  });

  assert.ok(evidence.dimensions["task-understanding"].wired.some((item) => item.id === "scoped-project-routes"));
  assert.ok(evidence.findings.some((item) => item.id === "planning-workflow-spec-use-gap"));
});

test("repository evidence projects a low binding finding when planning has no project spec", () => {
  const evidence = buildTaskLoopRepositoryEvidence({
    trackedFiles: ["AGENTS.md"],
    insights: {
      sample: { analyzedSessionCount: 4 },
      keySignals: {
        planningSignals: [{
          name: "/ultraplan",
          kind: "plan-command",
          scope: "workspace",
          evidenceRefs: [{ kind: "project-jsonl", line: 7 }],
        }],
      },
    },
  });
  const finding = evidence.findings.find((item) => item.id === "planning-workflow-project-binding-gap");

  assert.ok(finding);
  assert.equal(finding.severity, "Low");
  assert.equal(finding.expectedArtifact, "Document");
  assert.equal(finding.projectionPolicy, "required");
  assert.match(finding.aiFixPrompt, /`docs\/specs\/`/);
  assert.match(finding.aiFixPrompt, /acceptance id/);
});

test("repository evidence keeps complete, unavailable, and global-only planning out of findings", () => {
  const complete = buildTaskLoopRepositoryEvidence({
    trackedFiles: ["docs/specs/change.md"],
    insights: {
      sample: { analyzedSessionCount: 3 },
      keySignals: { planningSignals: [{ name: "spec-session-reference", kind: "spec-reference", scope: "workspace" }] },
    },
  });
  const unavailable = buildTaskLoopRepositoryEvidence({
    trackedFiles: ["docs/specs/change.md"],
    insights: { sample: { analyzedSessionCount: 0 }, keySignals: { planningSignals: [] } },
  });
  const globalOnly = buildTaskLoopRepositoryEvidence({
    trackedFiles: [],
    insights: {
      sample: { analyzedSessionCount: 3 },
      keySignals: { planningSignals: [{ name: "/plan", kind: "plan-command", scope: "user-global" }] },
    },
  });
  const goalOnly = buildTaskLoopRepositoryEvidence({
    trackedFiles: [],
    insights: {
      sample: { analyzedSessionCount: 3 },
      keySignals: { planningSignals: [{ name: "/goal", kind: "goal-command", scope: "workspace" }] },
    },
  });

  for (const result of [complete, unavailable, globalOnly, goalOnly]) {
    assert.equal(result.findings.some((item) => item.id.startsWith("planning-workflow-")), false);
  }
});

test("repository evidence credits real acceptance and reproducibility mechanisms", () => {
  const evidence = buildTaskLoopRepositoryEvidence({
    trackedFiles: [
      "AGENTS.md",
      "package.json",
      "package-lock.json",
      ".nvmrc",
      ".qoder/hooks.json",
      ".github/workflows/test.yml",
      ".github/CODEOWNERS",
      "test/example.test.mjs",
    ],
    packageManifest: { scripts: { test: "node --test" } },
  });

  assert.ok(evidence.subdimensions["instruction-led-start"].wired.length > 0);
  assert.ok(evidence.subdimensions["high-risk-approval"].wired.length > 0);
  assert.ok(evidence.subdimensions["acceptance-evidence"].wired.length > 0);
  assert.equal(evidence.findings.some((finding) => finding.id === "repository-acceptance-path-gap"), false);
  assert.equal(evidence.findings.some((finding) => finding.id === "repository-reproducibility-gap"), false);
});

test("repository evidence keeps locked PHP separate from unlocked Node dependencies", () => {
  const evidence = buildTaskLoopRepositoryEvidence({
    trackedFiles: [
      "composer.json",
      "composer.lock",
      "package.json",
      "packages/Admin/package.json",
      ".github/workflows/test.yml",
    ],
    packageManifest: { scripts: { test: "php artisan test" } },
    locale: "zh-CN",
  });
  const finding = evidence.findings.find((item) => item.id === "repository-reproducibility-gap");

  assert.ok(finding);
  assert.equal(finding.title, "Node 依赖没有锁定，不同机器可能安装出不同版本");
  assert.match(finding.reason, /^PHP 依赖已有锁文件，但 2 个 Node 依赖清单没有对应的锁文件/);
  assert.doesNotMatch(finding.reason, /没有已跟踪的锁文件/);
  assert.equal(finding.expectedArtifact, "Config");
});

test("repository evidence does not turn Hook absence into a generic practice gap", () => {
  const evidence = buildTaskLoopRepositoryEvidence({
    trackedFiles: [
      "AGENTS.md",
      "package.json",
      "package-lock.json",
      ".github/workflows/test.yml",
      "test/example.test.mjs",
    ],
    packageManifest: { scripts: { test: "node --test", deploy: "npm publish" } },
    locale: "zh-CN",
  });
  const finding = evidence.findings.find((item) => item.id === "repository-agent-lifecycle-guardrail-gap");

  assert.equal(finding, undefined);
});

test("repository evidence finds a merge verification gap and a concrete automation guardrail gap", () => {
  const evidence = buildTaskLoopRepositoryEvidence({
    trackedFiles: [
      "AGENTS.md",
      "agent/service_test.go",
      ".aoneci/qoder-auto-review.yaml",
      ".aoneci/release.yaml",
    ],
    fileContents: {
      "AGENTS.md": "Use the shared project workflow for risky automation.",
      ".aoneci/qoder-auto-review.yaml": "triggers:\n  merge_request:\njobs:\n  review:\n    run: qoder review",
      ".aoneci/release.yaml": "triggers:\n  push:\n    branches: [release/**]\njobs:\n  upload:\n    run: go test ./... && publish artifacts",
    },
  });

  const ciGap = evidence.findings.find((item) => item.id === "repository-ci-verification-gap");
  const guardrailGap = evidence.findings.find((item) => item.id === "repository-agent-lifecycle-guardrail-gap");
  assert.ok(ciGap);
  assert.equal(ciGap.title, "Merge requests can be accepted without running project checks");
  assert.ok(guardrailGap);
  assert.equal(guardrailGap.title, "Risky Agent actions can proceed without asking or stopping");
  assert.match(guardrailGap.reason, /no shared Hook/);
});

test("repository evidence ignores commented triggers and credits merge verification in one active workflow", () => {
  const commented = buildTaskLoopRepositoryEvidence({
    trackedFiles: ["AGENTS.md", "src/test/example_test.go", ".aoneci/build.yaml"],
    fileContents: {
      "AGENTS.md": "Follow the project review route.",
      ".aoneci/build.yaml": "# triggers:\n#   merge_request:\njobs:\n  release:\n    run: publish artifacts",
    },
  });
  const commentedGap = commented.findings.find((item) => item.id === "repository-ci-verification-gap");
  assert.ok(commentedGap);
  assert.equal(commentedGap.title, "Changes can be merged without running project tests");

  const verified = buildTaskLoopRepositoryEvidence({
    trackedFiles: ["AGENTS.md", "src/test/example_test.go", ".github/workflows/pr.yml"],
    fileContents: {
      "AGENTS.md": "Follow the project review route.",
      ".github/workflows/pr.yml": "on: pull_request\njobs:\n  test:\n    run: go test ./...",
    },
  });
  assert.equal(verified.findings.some((item) => item.id === "repository-ci-verification-gap"), false);
});

test("repository evidence recognizes Mage work surfaces without mistaking application hooks for Agent Hooks", () => {
  const evidence = buildTaskLoopRepositoryEvidence({
    trackedFiles: [
      "AGENTS.md",
      ".Qoder/rules",
      "go.mod",
      "go.sum",
      "magefile.go",
      "magefiles/check.go",
      "ent/example/hook/hook.go",
      ".aoneci/ci.yaml",
      "internal/example/service_test.go",
    ],
    fileContents: {
      "AGENTS.md": "Run mage check after code changes. If it fails after 3 attempts, stop and report the error.",
      ".Qoder/rules": "Use the documented Mage targets.",
    },
    locale: "en",
  });

  assert.ok(evidence.dimensions["controlled-execution"].wired.some((item) => item.id === "runnable-work-surface"));
  assert.ok(evidence.subdimensions["permission-boundary"].present.some((item) => item.id === "instruction-stop-boundary"));
  assert.equal(evidence.subdimensions["high-risk-approval"].present.some((item) => item.id === "hook-assets"), false);
  const finding = evidence.findings.find((item) => item.id === "repository-agent-lifecycle-guardrail-gap");
  assert.ok(finding);
  assert.equal(finding.title, "Risky Agent actions can proceed without asking or stopping");
  assert.match(finding.reason, /documents when an agent should stop/i);
});

test("repository evidence still credits packaged Agent Hook assets", () => {
  const evidence = buildTaskLoopRepositoryEvidence({
    trackedFiles: [
      "AGENTS.md",
      "package.json",
      ".qoder-plugin/hooks/hooks.json",
      ".qoder-plugin/hooks/scripts/guard.mjs",
    ],
    packageManifest: { scripts: { test: "node --test" } },
  });

  assert.ok(evidence.subdimensions["high-risk-approval"].wired.some((item) => item.id === "project-agent-hooks"));
  assert.deepEqual(evidence.aiAgentPractice.coverageRows.find((row) => row.surface === "Hooks"), {
    surface: "Hooks",
    scopes: ["Project"],
    count: 2,
    paths: [".qoder-plugin/hooks/hooks.json", ".qoder-plugin/hooks/scripts/guard.mjs"],
  });
  assert.equal(evidence.findings.some((item) => item.id === "repository-agent-lifecycle-guardrail-gap"), false);
});

test("repository evidence preserves a redacted high-confidence credential finding", () => {
  const evidence = buildTaskLoopRepositoryEvidence({
    trackedFiles: [".aoneci/build-action.yaml", "package.json", "package-lock.json"],
    packageManifest: { scripts: { test: "node --test" } },
    locale: "zh-CN",
    secretScan: {
      findings: [{
        ruleId: "url-basic-auth",
        severity: "high",
        confidence: "high",
        file: ".aoneci/build-action.yaml",
        line: 123,
        fingerprint: "redacted-fingerprint",
      }, {
        ruleId: "weak-candidate",
        severity: "medium",
        confidence: "high",
        file: ".aoneci/build-action.yaml",
        line: 124,
      }],
    },
  });
  const finding = evidence.findings.find((item) => item.id === "repository-embedded-credential");

  assert.ok(finding);
  assert.equal(finding.severity, "High");
  assert.equal(finding.projectionPolicy, "required");
  assert.match(finding.reason, /\.aoneci\/build-action\.yaml/);
  assert.match(finding.aiFixPrompt, /`\.aoneci\/build-action\.yaml`/);
  assert.match(finding.aiFixPrompt, /secret scan/);
  assert.equal(finding.staticEvidence[0].label, ".aoneci/build-action.yaml:123");
  assert.doesNotMatch(JSON.stringify(finding), /\/Users\/example|private-project/);
});

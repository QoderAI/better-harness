import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  attachAssetEvaluations,
  evaluateAgentAssetSurfaces,
  renderAssetEvaluationMarkdown,
} from "../../scripts/coding-agent-practices/asset-eval/index.mjs";

test("asset evaluation keeps score, risk, runtime, and inventory evidence separate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-asset-eval-"));
  const skillPath = path.join(root, "skills", "review", "SKILL.md");
  const agentPath = path.join(root, ".qoder", "agents", "reviewer.md");
  await mkdir(path.dirname(skillPath), { recursive: true });
  await mkdir(path.dirname(agentPath), { recursive: true });
  await writeFile(skillPath, `---\nname: review\ndescription: Use when reviewing a bounded change.\n---\n\n# Review\n\n${"Review the change carefully.\n".repeat(180)}`);
  await writeFile(agentPath, "---\nname: reviewer\ndescription: Use when a bounded independent review is required.\n---\n\nReview the change and return concise evidence to the main Agent.\n");

  try {
    const coverageRows = [
      { surface: "Rules", count: 1, scopes: ["Project"] },
      { surface: "Skills", count: 1, scopes: ["Project"] },
      { surface: "Custom Agents", count: 1, scopes: ["Project"] },
      { surface: "Hooks", count: 5, scopes: ["Project"] },
      { surface: "MCP", count: 1, scopes: ["Project"] },
    ];
    const inventory = {
      surfaces: [
        { type: "rules", items: [{ id: "rule", name: "AGENTS.md" }] },
        { type: "skills", items: [{ id: "skill", name: "review", filePath: skillPath, description: "Use when reviewing a bounded change." }] },
        { type: "agents", items: [{ id: "agent", name: "reviewer", filePath: agentPath }] },
        {
          type: "hooks",
          items: Array.from({ length: 5 }, (_, index) => ({
            id: `hook-${index}`,
            name: `hook-${index}`,
            step: "PreToolUse",
            matcher: "Write",
            async: false,
          })),
        },
        { type: "mcps", items: [{ id: "mcp", name: "docs", toolCount: 8, resourceCount: 2 }] },
      ],
    };
    const instructionReview = {
      findings: [{ id: "root-length-borderline", severity: "advisory", file: "AGENTS.md" }],
    };
    const assetReview = {
      findings: [
        { id: "skill-description-too-short", severity: "warning", assetKind: "skill", assetName: "review", file: "skills/review/SKILL.md" },
        { id: "custom-agent-unbounded-tools", severity: "advisory", assetKind: "subagent", assetName: "reviewer", file: ".qoder/agents/reviewer.md" },
        { id: "mcp-remote-without-tls", severity: "error", assetKind: "mcp", assetName: "docs", file: ".qoder/mcp.json" },
      ],
    };
    const hookRuntime = {
      groups: [{ name: "PreToolUse", executions: 5, failures: 0, durationSamples: 5, p95Ms: 700 }],
      commands: [],
    };

    const evaluations = await evaluateAgentAssetSurfaces({
      coverageRows,
      inventory,
      instructionReview,
      assetReview,
      hookRuntime,
    });

    const rules = evaluations.find((row) => row.surface === "Rules").evaluation;
    const skills = evaluations.find((row) => row.surface === "Skills").evaluation;
    const customAgents = evaluations.find((row) => row.surface === "Custom Agents").evaluation;
    const hooks = evaluations.find((row) => row.surface === "Hooks").evaluation;
    const mcp = evaluations.find((row) => row.surface === "MCP").evaluation;

    assert.equal(rules.status, "scored");
    assert.equal(rules.riskLevel, "low");
    assert.equal(skills.riskLevel, "high");
    assert.equal(skills.metrics.some((metric) => metric.id === "max-invoke-tokens"), true);
    assert.deepEqual(skills.findingRefs, ["practice-skills-quality"]);
    assert.equal(customAgents.profile, "custom-agent-quality-v1");
    assert.equal(customAgents.score, 100, "an inherited-tool advisory must not manufacture a quality deduction");
    assert.equal(customAgents.metrics.find((metric) => metric.id === "explicit-tool-boundary-count")?.value, 0);
    assert.match(customAgents.summary, /1 configured, with one profile missing a clear tool boundary/);
    assert.equal(hooks.score, 100, "runtime and pressure risk must not masquerade as a static quality deduction");
    assert.equal(hooks.riskLevel, "high");
    assert.equal(hooks.evidenceState, "mixed");
    assert.equal(hooks.observedSampleCount, 5);
    assert.equal(hooks.metrics.find((metric) => metric.id === "max-sync-fanout")?.value, 5);
    assert.equal(hooks.metrics.find((metric) => metric.id === "p95-duration")?.band, "unattributed-over-budget");
    assert.equal(mcp.score, 86);
    assert.equal(mcp.grade, "B");
    assert.equal(mcp.riskLevel, "high");
    assert.deepEqual(mcp.findingRefs, ["practice-mcp-quality"]);

    const attached = attachAssetEvaluations(coverageRows, evaluations);
    assert.equal(attached.find((row) => row.surface === "Hooks").evaluation.profile, "hook-quality-v1");

    const markdown = renderAssetEvaluationMarkdown(evaluations);
    assert.match(markdown, /## At a Glance/);
    assert.match(markdown, /## Why It Matters/);
    assert.match(markdown, /## Fix First/);
    assert.match(markdown, /## Recommended Next Step/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uninspected optional surfaces stay not applicable instead of receiving zero", async () => {
  const evaluations = await evaluateAgentAssetSurfaces();
  assert.equal(evaluations.every((row) => row.evaluation.status === "not-applicable"), true);
  assert.equal(evaluations.every((row) => row.evaluation.score === null), true);
  assert.equal(evaluations.every((row) => row.evaluation.riskLevel === "unknown"), true);
});

test("a root DESIGN.md contributes bounded positive evidence to the Rules score", async () => {
  const instructionReview = {
    findings: [{ id: "root-length-borderline", severity: "warning", file: "AGENTS.md" }],
  };
  const withoutDesign = await evaluateAgentAssetSurfaces({
    coverageRows: [{ surface: "Rules", count: 1, scopes: ["Project"] }],
    inventory: {
      surfaces: [{
        type: "rules",
        items: [{ id: "agents", name: "AGENTS.md", sourceKind: "agents-md-compat" }],
      }],
    },
    instructionReview,
  });
  const withDesign = await evaluateAgentAssetSurfaces({
    coverageRows: [{ surface: "Rules", count: 2, scopes: ["Project"] }],
    inventory: {
      surfaces: [{
        type: "rules",
        items: [
          { id: "agents", name: "AGENTS.md", sourceKind: "agents-md-compat" },
          { id: "design", name: "DESIGN.md", sourceKind: "design-md-contract" },
        ],
      }],
    },
    instructionReview,
  });
  const withoutScore = withoutDesign.find((row) => row.surface === "Rules").evaluation;
  const withScore = withDesign.find((row) => row.surface === "Rules").evaluation;

  assert.equal(withoutScore.score, 96);
  assert.equal(withScore.score, 98);
  assert.equal(withScore.riskLevel, "medium", "the positive asset must not erase the existing Rules warning");
  assert.deepEqual(withScore.findingRefs, ["practice-rules-quality"]);
});

test("Hook lint findings contribute to Hook quality score and ordinary finding refs", async () => {
  const evaluations = await evaluateAgentAssetSurfaces({
    coverageRows: [{ surface: "Hooks", count: 1, scopes: ["Project"] }],
    inventory: {
      surfaces: [{
        type: "hooks",
        items: [{ id: "guard", label: "guard", step: "PreToolUse", matcher: "Bash", async: false }],
      }],
    },
    assetReview: {
      findings: [{
        id: "hook-unsafe-input-handling",
        severity: "error",
        assetKind: "hook",
        assetName: "guard",
        file: ".qoder/hooks/guard.sh",
      }],
    },
  });
  const hooks = evaluations.find((row) => row.surface === "Hooks").evaluation;
  assert.equal(hooks.score, 86);
  assert.equal(hooks.grade, "B");
  assert.equal(hooks.riskLevel, "high");
  assert.deepEqual(hooks.findingRefs, ["practice-hooks-quality"]);
});

test("inventory counts without a completed review do not manufacture quality scores", async () => {
  const evaluations = await evaluateAgentAssetSurfaces({
    coverageRows: [{ surface: "Hooks", count: 5, scopes: ["Project"] }],
    inventory: {
      surfaces: [{
        type: "hooks",
        items: Array.from({ length: 5 }, (_, index) => ({
          id: `hook-${index}`,
          step: "PreToolUse",
          matcher: "Write",
          async: false,
        })),
      }],
    },
  });
  const hooks = evaluations.find((row) => row.surface === "Hooks").evaluation;
  assert.equal(hooks.status, "unavailable");
  assert.equal(hooks.score, null);
  assert.equal(hooks.riskLevel, "high", "fanout may raise risk without becoming a count-derived score");
  assert.equal(hooks.confidence, "low");
});

test("more than ten Hooks warns without manufacturing a quality deduction", async () => {
  const evaluations = await evaluateAgentAssetSurfaces({
    coverageRows: [{ surface: "Hooks", count: 11, scopes: ["Project"] }],
    inventory: {
      surfaces: [{
        type: "hooks",
        items: Array.from({ length: 11 }, (_, index) => ({
          id: `hook-${index}`,
          step: "Stop",
          matcher: `task-${index}`,
          async: true,
        })),
      }],
    },
    assetReview: { findings: [] },
  });
  const hooks = evaluations.find((row) => row.surface === "Hooks").evaluation;
  assert.equal(hooks.score, 100);
  assert.equal(hooks.riskLevel, "high");
  assert.equal(hooks.metrics.find((metric) => metric.id === "asset-count")?.band, "over-limit");
  assert.match(hooks.summary, /Your lifecycle guardrails are well covered/);
  assert.match(hooks.summary, /11 Hooks exceed the recommended limit of 10/);
  assert.match(hooks.summary, /slow the Agent/);
});

test("over-budget Hook group latency stays unattributed and does not deduct script quality", async () => {
  const evaluations = await evaluateAgentAssetSurfaces({
    coverageRows: [{ surface: "Hooks", count: 1, scopes: ["Project"] }],
    inventory: {
      surfaces: [{
        type: "hooks",
        items: [{ id: "guard", label: "guard", step: "PreToolUse", matcher: "Write", async: false }],
      }],
    },
    assetReview: { findings: [] },
    hookRuntime: {
      groups: [{ name: "PreToolUse", executions: 8, failures: 0, durationSamples: 8, p95Ms: 900 }],
      commands: [{ name: "PreToolUse -> node guard.mjs", executions: 2, failures: 0, durationSamples: 2, p95Ms: 400 }],
    },
  });
  const hooks = evaluations.find((row) => row.surface === "Hooks").evaluation;
  assert.equal(hooks.score, 100);
  assert.equal(hooks.riskLevel, "high");
  assert.equal(hooks.metrics.find((metric) => metric.id === "p95-duration")?.band, "unattributed-over-budget");
  assert.match(hooks.summary, /cannot be attributed to one command/);
  assert.doesNotMatch(hooks.summary, /guard\.mjs/);
});

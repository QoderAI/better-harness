import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { promisify } from "node:util";

import { repairFindingsJsonData } from "../../scripts/harness-analysis/repair-findings-json.mjs";
import { evaluateFindingsJson } from "../../scripts/harness-analysis/validate-canvas.mjs";

const execFileAsync = promisify(execFile);

const validPrompt = `/better-harness fix this issue

Runtime validation needs a visible gate: local validation exists, but the report does not show a repeatable runtime smoke path.

Limit the change to ./AGENTS.md and directly related files.

## Validation

- Run node --test test/skills-docs/doc-link-graph.test.mjs
- Confirm the finding is resolved`;

function validFindingsJson() {
  return {
    summary: {
      projectName: "Fixture",
      modelId: "software-fluency",
      strengths: ["Project guidance exists."],
      dimensions: [
        { id: "context-map", label: "Context Map", score: 70, summary: "Project guidance identifies the main workflow and common ownership paths.", findingRefs: [] },
        { id: "environment-readiness", label: "Environment Readiness", score: 68, summary: "Setup entrypoints are documented, but reset evidence was not observed.", findingRefs: [] },
        { id: "fast-feedback", label: "Fast Feedback", score: 42, summary: "Local validation exists, but no repeatable runtime smoke path is visible.", findingRefs: ["ff-runtime-validation"] },
        { id: "quality-gates", label: "Quality Gates", score: 48, summary: "Static checks exist, but runtime validation is not enforced before review.", findingRefs: ["ff-runtime-validation"] },
        { id: "safe-change", label: "Change Safety", score: 54, summary: "Review guidance is visible, while rollback evidence was not observed.", findingRefs: [] },
      ],
      aiAgentPractice: {
        inspectedSurfaces: ["AGENTS.md", "Project Skills"],
        coverageRows: [{
          surface: "AGENTS.md",
          status: "Present",
          reason: "Project rules describe how agents should navigate validation work.",
          scopes: ["Project", "Project", "Unknown"],
          count: "1",
          paths: ["AGENTS.md", "AGENTS.md", "/Users/example/private/AGENTS.md"],
          evidence: "old field",
          confidence: "High",
          evaluation: {
            schemaVersion: 9,
            profile: "rules-quality-v1",
            status: "scored",
            score: 81,
            grade: "A",
            riskLevel: "medium",
            confidence: "high",
            evidenceState: "static",
            evaluatedCount: "1",
            observedSampleCount: "0",
            summary: "Project guidance has one bounded warning.",
            checkCounts: { total: "1", pass: "0", warn: "1", fail: "0", info: "0", failedErrors: "0" },
            metrics: [],
            findingRefs: ["ff-runtime-validation"],
            legacy: true,
          },
        }],
        sourceBoundary: "old field",
      },
      scoreCaveat: "old field",
    },
    findings: [{
      id: "ff-runtime-validation",
      title: "Runtime validation needs a visible gate",
      severity: "high",
      reason: "Local validation exists, but the report does not show a repeatable runtime smoke path.",
      aiFixPrompt: "Please add validation guidance.",
      dimensionRefs: ["fast-feedback", "quality-gates"],
      domain: "engineering-implementation",
      evidence: "old field",
      recommendation: "old field",
      passCheck: "old field",
      aiFixLabel: "old field",
      quickFix: true,
    }],
  };
}

test("repairFindingsJsonData normalizes to the minimal findings contract", () => {
  const repaired = repairFindingsJsonData(validFindingsJson(), { targetPath: "/tmp/fixture-project" });

  assert.equal(repaired.changed, true);
  assert.equal(repaired.data.findings[0].severity, "High");
  assert.match(repaired.data.findings[0].aiFixPrompt, /^\/better-harness fix this issue/);
  assert.match(repaired.data.findings[0].aiFixPrompt, /## Validation/);
  assert.deepEqual(Object.keys(repaired.data.findings[0]).sort(), [
    "aiFixPrompt",
    "dimensionRefs",
    "id",
    "reason",
    "severity",
    "title",
  ]);
  assert.deepEqual(Object.keys(repaired.data.summary).sort(), [
    "aiAgentPractice",
    "dimensions",
    "modelId",
    "projectName",
    "strengths",
  ]);
  assert.deepEqual(repaired.data.summary.aiAgentPractice.inspectedSurfaces, ["Rules", "Skills"]);
  assert.equal(repaired.data.summary.dimensions[2].summary, "Local validation exists, but no repeatable runtime smoke path is visible.");
  assert.deepEqual(Object.keys(repaired.data.summary.aiAgentPractice.coverageRows[0]).sort(), ["count", "paths", "scopes", "surface"]);
  assert.deepEqual(repaired.data.summary.aiAgentPractice.coverageRows[0].scopes, ["Project"]);
  assert.equal(repaired.data.summary.aiAgentPractice.coverageRows[0].count, 1);
  assert.deepEqual(repaired.data.summary.aiAgentPractice.coverageRows[0].paths, ["AGENTS.md"]);
  assert.equal(Object.hasOwn(repaired.data.summary.aiAgentPractice.coverageRows[0], "status"), false);
  assert.equal(Object.hasOwn(repaired.data.summary.aiAgentPractice.coverageRows[0], "reason"), false);
  assert.equal(Object.hasOwn(repaired.data.summary.aiAgentPractice.coverageRows[0], "evaluation"), false);

  const validation = evaluateFindingsJson(JSON.stringify(repaired.data), null);
  assert.equal(validation.status, "pass", validation.errors.join("\n"));
});

test("repairFindingsJsonData preserves a valid structured finding target", () => {
  const input = validFindingsJson();
  input.findings[0].target = {
    kind: "workspace-member",
    packageRoute: "packages/app",
    ownerRoute: "packages/app",
  };
  const repaired = repairFindingsJsonData(input, { targetPath: "/tmp/fixture-project" });

  assert.deepEqual(repaired.data.findings[0].target, input.findings[0].target);
  const validation = evaluateFindingsJson(JSON.stringify(repaired.data), null);
  assert.equal(validation.status, "pass", validation.errors.join("\n"));
});

test("repairFindingsJsonData preserves structurally complete task-loop result contracts regardless of version metadata", () => {
  const report = (reportContractVersion) => ({
    summary: {
      projectName: "Fixture",
      modelId: "future-agent-work-loop-model",
      ...(reportContractVersion === undefined ? {} : { reportContractVersion }),
      dimensions: [{ id: "reliable-delivery", findingRefs: ["finding-1"] }],
      learningCapture: {},
      aiAgentPractice: {},
      suggestions: [{
        id: "try-existing-check",
        kind: "try-existing",
        title: "Try the configured delivery check",
        reason: "The inspected capability matches the current need but was not exercised.",
        confidence: "Medium",
        owner: "Delivery maintainers",
        nextStep: "Use it once on the next bounded change.",
        validation: "Confirm it retains the expected focused check result.",
      }],
      assignmentSummaries: [{ findingId: "finding-1", revision: 1, locale: "en", title: "Verified result", body: "The repair passed validation.", outputs: [] }],
    },
    findings: [{
      id: "finding-1",
      dimensionRefs: ["reliable-delivery"],
      actualOutputRevision: 1,
      actualOutput: [],
      assignmentSummary: { locale: "en", title: "Verified result", body: "The repair passed validation." },
    }],
  });
  const future = report(999);
  const withoutVersion = report(undefined);

  assert.deepEqual(repairFindingsJsonData(future), { data: future, changes: [], changed: false });
  assert.deepEqual(repairFindingsJsonData(withoutVersion), { data: withoutVersion, changes: [], changed: false });
});

test("repairFindingsJsonData preserves valid human-authored repair prompts", () => {
  const input = validFindingsJson();
  input.findings[0].severity = "High";
  input.findings[0].aiFixPrompt = validPrompt;
  delete input.findings[0].domain;
  delete input.findings[0].evidence;
  delete input.findings[0].recommendation;
  delete input.findings[0].passCheck;
  delete input.findings[0].aiFixLabel;
  delete input.findings[0].quickFix;
  delete input.summary.scoreCaveat;
  delete input.summary.aiAgentPractice.coverageRows[0].evidence;
  delete input.summary.aiAgentPractice.coverageRows[0].confidence;
  delete input.summary.aiAgentPractice.sourceBoundary;

  const repaired = repairFindingsJsonData(input, { targetPath: "/tmp/fixture-project" });

  assert.equal(repaired.data.findings[0].aiFixPrompt, validPrompt);
  assert.equal(
    repaired.changes.some((change) => change.path === "findings[0].aiFixPrompt"),
    false,
    JSON.stringify(repaired.changes, null, 2),
  );

  const validation = evaluateFindingsJson(JSON.stringify(repaired.data), null);
  assert.equal(validation.status, "pass", validation.errors.join("\n"));
});

test("repairFindingsJsonData maps known severe labels and rejects arbitrary severities", () => {
  const input = validFindingsJson();
  input.findings = [
    {
      ...input.findings[0],
      id: "critical-finding",
      title: "Critical finding stays high risk",
      severity: "Critical",
    },
    {
      ...input.findings[0],
      id: "blocker-finding",
      title: "Blocker finding stays high risk",
      severity: "Blocker",
    },
    {
      ...input.findings[0],
      id: "medium-finding",
      title: "Medium finding stays medium risk",
      severity: "Medium",
    },
  ];

  const repaired = repairFindingsJsonData(input, { targetPath: "/tmp/fixture-project" });

  assert.equal(repaired.data.findings[0].severity, "High");
  assert.equal(repaired.data.findings[1].severity, "High");
  assert.equal(repaired.data.findings[2].severity, "Medium");
  assert.ok(repaired.changes.some((change) => change.path === "findings[0].severity"));
  assert.ok(repaired.changes.some((change) => change.path === "findings[1].severity"));

  const validation = evaluateFindingsJson(JSON.stringify(repaired.data), null);
  assert.equal(validation.status, "pass", validation.errors.join("\n"));

  input.findings[1].severity = "Cosmic";
  const rejected = repairFindingsJsonData(input, { targetPath: "/tmp/fixture-project" });
  assert.equal(rejected.data.findings[1].severity, "Cosmic");
  assert.equal(
    rejected.changes.some((change) => change.path === "findings[1].severity"),
    false,
  );

  const rejectedValidation = evaluateFindingsJson(JSON.stringify(rejected.data), null);
  assert.equal(rejectedValidation.status, "fail");
  assert.ok(rejectedValidation.errors.some((error) => error.includes("severity")));
});

test("repairFindingsJsonData strips non-openable Memory directory paths but keeps count and scope", () => {
  const input = validFindingsJson();
  input.summary.aiAgentPractice.coverageRows.push({
    surface: "Memories",
    scopes: ["Project"],
    count: 4,
    paths: ["~/.qoder/memories/account/projects/demo/project_introduction"],
  });

  const before = evaluateFindingsJson(JSON.stringify(input), null);
  assert.equal(before.status, "fail");
  assert.ok(before.errors.some((error) => error.includes("omit user-home note paths")));

  const repaired = repairFindingsJsonData(input, { targetPath: "/tmp/fixture-project" });
  const memories = repaired.data.summary.aiAgentPractice.coverageRows.find((row) => row.surface === "Memories");

  assert.deepEqual(memories?.scopes, ["Project"]);
  assert.equal(memories?.count, 4);
  assert.equal(Object.hasOwn(memories ?? {}, "paths"), false);

  const after = evaluateFindingsJson(JSON.stringify(repaired.data), null);
  assert.equal(after.status, "pass", after.errors.join("\n"));
});

test("repairFindingsJsonData strips Memory note paths detached from project MEMORY.md", () => {
  const input = validFindingsJson();
  input.summary.aiAgentPractice.coverageRows.push({
    surface: "Memories",
    scopes: ["Project"],
    count: 60,
    paths: ["project_introduction/memory.md"],
  });

  const before = evaluateFindingsJson(JSON.stringify(input), null);
  assert.equal(before.status, "fail");
  assert.ok(before.errors.some((error) => error.includes("project-relative MEMORY.md")));

  const repaired = repairFindingsJsonData(input, { targetPath: "/tmp/fixture-project" });
  const memories = repaired.data.summary.aiAgentPractice.coverageRows.find((row) => row.surface === "Memories");

  assert.equal(memories?.count, 60);
  assert.equal(Object.hasOwn(memories ?? {}, "paths"), false);
});

test("repairFindingsJsonData rewrites synthetic numbered evidence aliases", () => {
  const input = validFindingsJson();
  input.findings[0].aiFixPrompt = `${validPrompt}\n\n- E1: inspect the linked evidence first.`;

  const repaired = repairFindingsJsonData(input, { targetPath: "/tmp/fixture-project" });

  assert.notEqual(repaired.data.findings[0].aiFixPrompt, input.findings[0].aiFixPrompt);
  assert.doesNotMatch(repaired.data.findings[0].aiFixPrompt, /\b[ES]\d+\b/u);
  assert.ok(repaired.changes.some((change) => change.path === "findings[0].aiFixPrompt"));
  const validation = evaluateFindingsJson(JSON.stringify(repaired.data), null);
  assert.equal(validation.status, "pass", validation.errors.join("\n"));
});

test("repairFindingsJsonData rewrites malformed generated AI fix scopes", () => {
  const input = validFindingsJson();
  const oldMergeJargon = `${"base"}-${"bound"}`;
  input.findings = [
    {
      id: "fb-no-fast-local-check",
      title: "缺少改动后的快速本地反馈路径",
      severity: "High",
      reason: "当前 app/src 下只有一个 androidTest 插桩测试（CanvasPreviewInstrumentedTest.kt），必须通过 ./gradlew :app:connectedAndroidTest 连接真机或模拟器才能运行；没有任何单元测试、lint 或秒级 smoke 路径。",
      aiFixPrompt: "/better-harness fix this issue\n\n缺少改动后的快速本地反馈路径。\n\nLimit the change to /模拟器的插桩测试，缺少快速本地反馈。请新增一条不依赖设备的快速校验路径 and the directly related files.\n\n## Validation\n\n- Run node scripts/harness-analysis/validate-canvas.mjs --canvas <run>/insights.canvas.tsx --findings <run>/findings.json",
      dimensionRefs: ["fast-feedback"],
    },
    {
      id: "safe-change-ci-unverified",
      title: `缺少可观测的 ${oldMergeJargon} 接受路径`,
      severity: "Medium",
      reason: `当前仓库没有主机/分支保护证据，${oldMergeJargon} 接受路径的状态未经验证。`,
      aiFixPrompt: `/better-harness fix this issue\n\n缺少可观测的 ${oldMergeJargon} 接受路径。\n\nLimit the change to GitHub/GitLab/ and the directly related files.\n\n## Validation\n\n- Run node scripts/harness-analysis/validate-canvas.mjs --canvas <run>/insights.canvas.tsx --findings <run>/findings.json`,
      dimensionRefs: ["safe-change"],
    },
    {
      id: "qg-no-linter",
      title: "未配置通用 lint 或类型检查",
      severity: "Medium",
      reason: "项目没有 ESLint、Prettier、TypeScript 类型检查或格式化门禁。",
      aiFixPrompt: "/better-harness fix this issue\n\n未配置通用 lint 或类型检查。\n\nLimit the change to JavaScript/Node and the directly related files.\n\n## Validation\n\n- Run Node 项目添加 ESLint 和 Prettier 配置",
      dimensionRefs: ["quality-gates"],
    },
  ];
  input.summary.dimensions[2].findingRefs = ["fb-no-fast-local-check"];
  input.summary.dimensions[3].findingRefs = ["qg-no-linter"];
  input.summary.dimensions[4].findingRefs = ["safe-change-ci-unverified"];

  const repaired = repairFindingsJsonData(input);
  const prompts = repaired.data.findings.map((finding) => finding.aiFixPrompt).join("\n\n");

  assert.equal(repaired.changed, true);
  assert.doesNotMatch(prompts, /\/模拟器|GitHub\/GitLab|JavaScript\/Node/);
  assert.doesNotMatch(prompts, /validate-canvas\.mjs/);
  assert.doesNotMatch(JSON.stringify(repaired.data), new RegExp(oldMergeJargon, "i"));
  assert.match(repaired.data.findings[1].title, /合并前验收路径/);
  assert.match(repaired.data.findings[0].aiFixPrompt, /负责快速反馈的 lint、测试或 smoke 检查面/);
  assert.match(repaired.data.findings[0].aiFixPrompt, /运行新增或更新后的快速检查/);
  assert.match(repaired.data.findings[1].aiFixPrompt, /负责 hook、CI\/评审、权限或发布安全边界的配置/);
  assert.match(repaired.data.findings[2].aiFixPrompt, /负责该规则的 lint、安全扫描、架构或契约检查面/);

  const validation = evaluateFindingsJson(JSON.stringify(repaired.data), null);
  assert.equal(validation.status, "pass", validation.errors.join("\n"));
});

test("repairFindingsJsonData removes stale score-row finding refs", () => {
  const input = validFindingsJson();
  input.summary.dimensions[1].findingRefs = ["missing-finding"];

  const repaired = repairFindingsJsonData(input, { targetPath: "/tmp/fixture-project" });

  assert.equal(repaired.changed, true);
  assert.deepEqual(repaired.data.summary.dimensions[1].findingRefs, []);
  assert.ok(repaired.changes.some((change) => change.path === "summary.dimensions[1].findingRefs"));

  const validation = evaluateFindingsJson(JSON.stringify(repaired.data), null);
  assert.equal(validation.status, "pass", validation.errors.join("\n"));
});

test("repair-findings-json CLI writes a repair summary", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-findings-repair-"));
  try {
    const findingsPath = path.join(root, "findings.json");
    await writeFile(findingsPath, `${JSON.stringify(validFindingsJson(), null, 2)}\n`);

    const { stdout } = await execFileAsync(process.execPath, [
      "scripts/harness-analysis/repair-findings-json.mjs",
      "--findings",
      findingsPath,
      "--target",
      "/tmp/fixture-project",
      "--write",
      "--json",
    ], { cwd: process.cwd() });

    const payload = JSON.parse(stdout);
    assert.equal(payload.kind, "harness-findings-json-repair");
    assert.equal(payload.status, "pass");
    assert.equal(payload.changed, true);
    assert.ok(payload.changeCount > 0);

    const repaired = JSON.parse(await readFile(findingsPath, "utf8"));
    const validation = evaluateFindingsJson(JSON.stringify(repaired), null);
    assert.equal(validation.status, "pass", validation.errors.join("\n"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

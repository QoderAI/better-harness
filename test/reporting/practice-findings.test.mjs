import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { projectAgentLintPracticeEvidence } from "../../scripts/harness-analysis/practice-findings.mjs";
import { collectAgentLintPracticeEvidence } from "../../scripts/harness-analysis/task-loop-source.mjs";

function lintPayload(profile, findings) {
  return { kind: "agent-lint", profile, findings };
}

test("agent-lint practice reviews become grouped Agent Work Loop findings", () => {
  const result = projectAgentLintPracticeEvidence({
    locale: "zh-CN",
    provider: "qoder",
    instructionReview: lintPayload("agents-md-review", [{
      id: "root-length-hard-cap",
      severity: "warning",
      file: "AGENTS.md",
      title: { "zh-CN": "根指引过长会吞没关键规则", en: "Root guide is too long" },
      why: { "zh-CN": "关键规则会被背景细节淹没。", en: "Important rules are hidden." },
    }]),
    assetReview: lintPayload("agent-assets-review", [{
      id: "skill-missing-description",
      severity: "warning",
      file: ".qoder/skills/get-aone-issue/SKILL.md",
      assetKind: "skill",
      assetName: "get-aone-issue",
    }, {
      id: "skill-long-without-progressive-references",
      severity: "advisory",
      file: ".qoder/skills/electron-automation/SKILL.md",
      assetKind: "skill",
      assetName: "electron-automation",
    }]),
  });

  assert.deepEqual(result.findings.map((finding) => finding.id), [
    "practice-rules-quality",
    "practice-skills-quality",
  ]);
  const rules = result.findings[0];
  const skills = result.findings[1];
  assert.equal(rules.severity, "Medium");
  assert.equal(rules.title, "根指引过长会吞没关键规则");
  assert.deepEqual(rules.dimensionRefs, ["task-understanding"]);
  assert.deepEqual(rules.subdimensionRefs, ["relevant-context"]);
  assert.equal(rules.expectedArtifact, "Rule");
  assert.match(rules.reason, /关键规则/);
  assert.doesNotMatch(rules.reason, /agent-lint/);
  assert.equal(skills.severity, "Medium");
  assert.deepEqual(skills.dimensionRefs, ["controlled-execution"]);
  assert.deepEqual(skills.subdimensionRefs, ["supported-operation"]);
  assert.equal(skills.expectedArtifact, "Skill");
  assert.match(skills.reason, /get-aone-issue.*description/);
  assert.match(skills.reason, /electron-automation.*一跳式引用/);
  assert.match(skills.reason, /^项目 Skill 中发现了/);
  assert.doesNotMatch(skills.reason, /\bagent\b/u);
  assert.doesNotMatch(skills.reason, /。；|。。/);
  assert.doesNotMatch(skills.reason, /agent-lint/);
  assert.match(skills.aiFixPrompt, /^\/better-harness 修复这个问题/);
  assert.match(skills.aiFixPrompt, /agent-assets-review/);
  assert.equal(result.reviews.length, 2);
});
test("clean practice reviews remain inventory evidence and create no finding", () => {
  const result = projectAgentLintPracticeEvidence({
    instructionReview: lintPayload("agents-md-review", []),
    assetReview: lintPayload("agent-assets-review", []),
  });
  assert.deepEqual(result.findings, []);
  assert.ok(result.reviews.every((review) => review.status === "reviewed"));
  assert.ok(result.reviews.every((review) => review.evidenceRefs[0].status === "clean"));
});

test("asset integrity review becomes grouped Memory, Plugin, and Hook findings", () => {
  const result = projectAgentLintPracticeEvidence({
    locale: "zh-CN",
    provider: "qoder",
    instructionReview: lintPayload("agents-md-review", []),
    assetReview: lintPayload("agent-assets-review", []),
    integrityReview: {
      profile: "asset-integrity-review",
      findings: [{
        id: "memory-title-similarity",
        severity: "advisory",
        assetKind: "memory",
        assetName: "memory-title-pair-1",
        why: "两个 Memory 标题高度相似，仅作为人工合并审查候选。",
      }, {
        id: "memory-title-collision",
        severity: "advisory",
        assetKind: "memory",
        assetName: "memory-title-group-1",
        why: "两个 Memory 标题规范化后同名，仅作为人工治理审查候选。",
      }, {
        id: "plugin-name-collision",
        severity: "warning",
        assetKind: "plugin",
        assetName: "plugin-group-1",
        why: "两个已启用 Plugin 使用相同名称。",
      }, {
        id: "hook-count-over-recommended-limit",
        severity: "warning",
        assetKind: "hook",
        assetName: "enabled-hooks",
        why: "11 个 Hooks 已超过建议上限 10 个。",
      }],
    },
  });

  assert.deepEqual(result.findings.map((finding) => finding.id), [
    "practice-hooks-quality",
    "practice-plugins-quality",
    "practice-memories-quality",
  ]);
  assert.equal(result.findings.find((finding) => finding.practiceSurface === "Memories")?.expectedArtifact, "Memory");
  assert.deepEqual(result.findings.find((finding) => finding.practiceSurface === "Memories")?.dimensionRefs, ["task-understanding"]);
  assert.deepEqual(Object.fromEntries(result.findings.map((finding) => [finding.practiceSurface, finding.severity])), {
    Hooks: "Medium",
    Plugins: "Medium",
    Memories: "Low",
  });
  assert.match(result.findings.find((finding) => finding.practiceSurface === "Memories")?.reason, /元数据重叠候选/u);
  assert.doesNotMatch(result.findings.find((finding) => finding.practiceSurface === "Memories")?.reason, /会让 Agent/u);
  assert.ok(result.findings.every((finding) => finding.staticEvidence.every((ref) => ref.kind === "asset-integrity")));
  assert.ok(result.findings.every((finding) => finding.aiFixPrompt.includes("asset-integrity qoder")));
  assert.match(result.findings.find((finding) => finding.practiceSurface === "Plugins")?.aiFixPrompt, /不要直接编辑 Plugin cache/u);
  const memoryPrompt = result.findings.find((finding) => finding.practiceSurface === "Memories")?.aiFixPrompt;
  assert.match(memoryPrompt, /如果重复项属于 Qoder Memory/u);
  assert.match(memoryPrompt, /先用 `SearchMemory` 取得候选的精确 Memory ID 和当前内容/u);
  assert.match(memoryPrompt, /`update_memory` 的 update 操作合并仍然有效的内容/u);
  assert.match(memoryPrompt, /规范记录更新成功.*delete 操作处理另一个精确 ID/u);
  assert.match(memoryPrompt, /返回一条以 `\/knowledge` 开头的可执行交接提示/u);
  assert.match(memoryPrompt, /不要查找同名 Skill 或扫描命令目录/u);
  assert.match(memoryPrompt, /只使用实际追加的 Wiki\/知识卡工具/u);
  assert.match(memoryPrompt, /list\/read、CRUD、重新读取验证/u);
  assert.match(memoryPrompt, /不要同时更新 Memory 与 Wiki\/知识卡/u);
  assert.match(memoryPrompt, /不要直接修改 Memory 文件或数据库/u);
  assert.doesNotMatch(memoryPrompt, /检查.*slash commands/u);
  assert.match(memoryPrompt, /不要用 `\/knowledge` 代替 Memory 治理/u);
  assert.match(memoryPrompt, /不要用 `update_memory` 改项目文档/u);
  assert.doesNotMatch(result.findings.find((finding) => finding.practiceSurface === "Plugins")?.aiFixPrompt, /\/knowledge/u);
  assert.equal(result.reviews.length, 3);
});

test("English Qoder Memory integrity repair routes by Memory or project knowledge owner", () => {
  const result = projectAgentLintPracticeEvidence({
    locale: "en",
    provider: "qoder",
    integrityReview: {
      profile: "asset-integrity-review",
      findings: [{
        id: "memory-title-collision",
        severity: "advisory",
        assetKind: "memory",
        assetName: "memory-title-group-1",
        why: "Two Memory titles collide after normalization.",
      }],
    },
  });

  const prompt = result.findings[0]?.aiFixPrompt;
  assert.match(prompt, /For duplicate Qoder Memory, use `SearchMemory` to obtain the exact Memory IDs/u);
  assert.match(prompt, /Use `update_memory` with update to merge still-valid content/u);
  assert.match(prompt, /canonical update succeeds.*same tool with delete on the other exact ID/u);
  assert.match(prompt, /return a ready-to-run handoff beginning with `\/knowledge`/u);
  assert.match(prompt, /do not search for a same-named Skill or scan command directories/u);
  assert.match(prompt, /Do not update both stores unless current evidence proves that both assets own the same fact/u);
  assert.match(prompt, /Never edit Memory files or databases directly/u);
  assert.doesNotMatch(prompt, /check whether.*slash commands/u);
});

test("non-Qoder Memory integrity repair does not invent Qoder memory or knowledge tools", () => {
  const result = projectAgentLintPracticeEvidence({
    locale: "en",
    provider: "codex",
    integrityReview: {
      profile: "asset-integrity-review",
      findings: [{
        id: "memory-title-collision",
        severity: "advisory",
        assetKind: "memory",
        assetName: "memory-title-group-1",
        why: "Two Memory titles collide after normalization.",
      }],
    },
  });

  const prompt = result.findings[0]?.aiFixPrompt;
  assert.doesNotMatch(prompt, /SearchMemory|update_memory|\/knowledge/u);
});

test("Hook lint findings become one ordinary Hook quality finding", () => {
  const result = projectAgentLintPracticeEvidence({
    locale: "zh-CN",
    provider: "qoder",
    assetReview: lintPayload("agent-assets-review", [{
      id: "hook-unsafe-input-handling",
      severity: "error",
      file: ".qoder/hooks/guard.sh",
      assetKind: "hook",
      assetName: "Pre Tool Use Bash",
      evidence: "guard.sh directly executes unescaped Hook input.",
    }, {
      id: "hook-broad-high-frequency-matcher",
      severity: "warning",
      file: ".qoder/settings.json",
      assetKind: "hook",
      assetName: "Pre Tool Use",
      evidence: "Pre Tool Use is synchronous with a match-all matcher.",
    }]),
  });

  assert.deepEqual(result.findings.map((finding) => finding.id), ["practice-hooks-quality"]);
  assert.equal(result.findings[0].expectedArtifact, "Hook");
  assert.deepEqual(result.findings[0].dimensionRefs, ["reliable-delivery"]);
  assert.match(result.findings[0].reason, /Hook/);
  assert.equal(result.findings[0].staticEvidence.length, 2);
});

test("Custom Agent profile gaps become one reader-safe practice finding", () => {
  const result = projectAgentLintPracticeEvidence({
    locale: "zh-CN",
    provider: "qoder",
    assetReview: lintPayload("agent-assets-review", [{
      id: "custom-agent-missing-description",
      severity: "warning",
      file: ".qoder/agents/reviewer.md",
      assetKind: "subagent",
      assetName: "reviewer",
    }, {
      id: "custom-agent-unbounded-tools",
      severity: "advisory",
      file: ".qoder/agents/reviewer.md",
      assetKind: "subagent",
      assetName: "reviewer",
    }]),
  });

  assert.deepEqual(result.findings.map((finding) => finding.id), ["practice-custom-agents-quality"]);
  assert.equal(result.findings[0].expectedArtifact, "Config");
  assert.match(result.findings[0].reason, /路由描述/);
  assert.match(result.findings[0].reason, /最小权限工具边界/);
  assert.match(result.findings[0].expectedOutcome, /专用 Agent/);
  assert.doesNotMatch(JSON.stringify(result), /system prompt body/);
});

test("acceptable root length remains review evidence without becoming a problem", () => {
  const result = projectAgentLintPracticeEvidence({
    instructionReview: lintPayload("agents-md-review", [{
      id: "root-length-acceptable",
      severity: "advisory",
      file: "AGENTS.md",
      evidence: "AGENTS.md is 92 lines; this is acceptable for multi-tool repositories.",
    }]),
    assetReview: lintPayload("agent-assets-review", []),
  });

  assert.deepEqual(result.findings, []);
  assert.equal(result.reviews[0].evidenceRefs[0].status, "advisory");
});

test("Chinese MCP practice reasons do not leak analyzer English", () => {
  const result = projectAgentLintPracticeEvidence({
    locale: "zh-CN",
    assetReview: lintPayload("agent-assets-review", [{
      id: "mcp-without-workflow-owner",
      severity: "warning",
      assetKind: "mcp",
      evidence: "Detected 2 MCP server entries but no project Skill or Command owner.",
    }]),
  });

  assert.equal(result.findings[0].title, "项目 MCP 访问缺少可靠的工作流边界");
  assert.match(result.findings[0].reason, /项目 MCP 配置没有对应的 Skill 或命令说明工作流归属/);
  assert.doesNotMatch(result.findings[0].reason, /Detected|server entries/);
});

test("Chinese Skill description findings do not leak analyzer English", () => {
  const result = projectAgentLintPracticeEvidence({
    locale: "zh-CN",
    assetReview: lintPayload("agent-assets-review", [{
      id: "skill-description-too-short",
      severity: "warning",
      assetKind: "skill",
      assetName: "review-flow",
      evidence: "review-flow has a very short description.",
    }]),
  });

  assert.match(result.findings[0].reason, /review-flow 的 frontmatter description 过短/);
  assert.doesNotMatch(result.findings[0].reason, /has a very short description/);
});

test("live Downstream IDE-style Rule and Skill lint evidence reaches practice findings", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-practice-findings-"));
  const qoderHome = path.join(root, "qoder-home");
  const workspace = path.join(root, "ide-client-style");
  try {
    await mkdir(path.join(workspace, ".qoder", "skills", "get-aone-issue"), { recursive: true });
    await mkdir(path.join(workspace, ".qoder", "skills", "electron-automation"), { recursive: true });
    await mkdir(qoderHome, { recursive: true });
    await writeFile(path.join(workspace, "AGENTS.md"), `# Project guidance\n${Array.from({ length: 205 }, (_, index) => `- rule ${index + 1}`).join("\n")}\n`);
    await writeFile(path.join(workspace, ".qoder", "skills", "get-aone-issue", "SKILL.md"), "# Aone issue lookup\n\nUse the API to retrieve an issue.\n");
    await writeFile(path.join(workspace, ".qoder", "skills", "electron-automation", "SKILL.md"), `---\nname: electron-automation\ndescription: Verify an Electron application through a bounded UI workflow.\n---\n\n# Electron automation\n${Array.from({ length: 150 }, (_, index) => `- step ${index + 1}`).join("\n")}\n`);

    const result = await collectAgentLintPracticeEvidence({
      workspace,
      platform: "qoder",
      language: "zh-CN",
      qoderHome,
    });

    assert.ok(result.findings.some((finding) => finding.id === "practice-rules-quality"));
    assert.ok(result.findings.some((finding) => finding.id === "practice-skills-quality"));
    assert.ok(result.findings.every((finding) => finding.staticEvidence.every((ref) => ref.kind === "agent-lint")));
    assert.equal(result.findings.find((finding) => finding.id === "practice-rules-quality")?.title, "根 Agent 指引过长，关键规则难以按需加载");
    assert.doesNotMatch(JSON.stringify(result), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

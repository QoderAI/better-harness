import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";

import {
  ASSET_INTEGRITY_PROFILE,
  normalizeAssetTitle,
  reviewAssetIntegrity,
  titleSimilarity,
} from "../../scripts/coding-agent-practices/asset-integrity.mjs";

const execFileAsync = promisify(execFile);

function titleEntry(title, index, scope = "Project") {
  return {
    title,
    path: path.join("memory-root", scope, `note-${index}.md`),
    scope,
    category: "learned_skill_experience",
  };
}

function plugin(id, name, overrides = {}) {
  return {
    id,
    name,
    displayName: name,
    canonicalName: overrides.canonicalName ?? name,
    version: overrides.version,
    capabilityCount: overrides.capabilityCount ?? 0,
    capabilityFingerprint: overrides.capabilityFingerprint,
  };
}

function hook(index, overrides = {}) {
  return {
    id: `hook-${index}`,
    name: `Hook ${index}`,
    scope: "user",
    path: path.join("qoder-home", "settings.json"),
    step: overrides.step ?? "Stop",
    matcher: overrides.matcher ?? "*",
    commandDisplay: overrides.commandDisplay ?? `check-${index}.sh`,
    configurationDigest: overrides.configurationDigest ?? createHash("sha256").update(`hook-${index}`).digest("hex"),
    async: overrides.async ?? false,
  };
}

function inventory({ titles = [], plugins = [], hooks = [] } = {}) {
  return {
    memories: {
      categories: [{
        category: "learned_skill_experience",
        scope: "Project",
        count: titles.length,
        titleEntries: titles.map((title, index) => titleEntry(title, index)),
      }],
    },
    surfaces: [
      { type: "plugins", group: "Plugin/marketplace assets", items: plugins },
      { type: "hooks", group: "User/global assets", items: hooks },
    ],
  };
}

test("Memory integrity indexes 100+ titles, separates exact and near candidates, and bounds review", () => {
  const unrelated = Array.from({ length: 101 }, (_, index) =>
    `z${createHash("sha256").update(`unique-memory-title-${index}`).digest("hex").slice(0, 24)}`);
  const result = reviewAssetIntegrity(inventory({
    titles: [
      ...unrelated,
      "Same Memory Title",
      "same_memory_title",
      "Better Harness项目介绍与核心能力",
      "Better Harness项目概述与核心能力",
    ],
  }), { locale: "zh-CN", maxMemoryTitlesReviewed: 104 });

  assert.equal(normalizeAssetTitle("Same_Memory Title"), "samememorytitle");
  assert.ok(titleSimilarity("Better Harness项目介绍与核心能力", "Better Harness项目概述与核心能力") >= 0.8);
  assert.equal(result.profile, ASSET_INTEGRITY_PROFILE);
  assert.equal(result.contentPolicy, "memory-title-and-path-metadata-only");
  assert.equal(result.summary.memories.titleCount, 105);
  assert.equal(result.summary.memories.reviewedTitleCount, 104);
  assert.equal(result.summary.memories.truncated, true);
  assert.equal(result.summary.memories.exactCollisionGroups, 1);
  assert.equal(result.findings.find((finding) => finding.id === "memory-title-collision")?.severity, "advisory");
  assert.equal(result.findings.find((finding) => finding.id === "memory-title-similarity")?.severity, "advisory");
  assert.doesNotMatch(JSON.stringify(result), /memory-root|\.md/u);
});

test("Plugin and Hook integrity distinguishes collisions, variants, duplicates, fan-out, and count pressure", () => {
  const sharedFingerprint = createHash("sha256").update("skills:harness").digest("hex");
  const hooks = Array.from({ length: 11 }, (_, index) => hook(index));
  hooks[1] = hook(1, { configurationDigest: hooks[0].configurationDigest });
  hooks[2] = hook(2, { step: "PreToolUse", matcher: "*" });
  hooks[3] = hook(3, { step: "PreToolUse", matcher: "*" });
  hooks[4] = hook(4, { step: "PreToolUse", matcher: "*" });
  const result = reviewAssetIntegrity(inventory({
    plugins: [
      plugin("better-harness@bundled", "Better Harness", { version: "1.1.0", capabilityCount: 1, capabilityFingerprint: sharedFingerprint }),
      plugin("better-harness@local", "Better Harness", { version: "1.0.0", capabilityCount: 1, capabilityFingerprint: sharedFingerprint }),
      plugin("better-harness-tools@local", "Better Harness Tools", { version: "0.1.58" }),
      plugin("better-harness-current-e2e@local", "Better Harness Current E2e"),
      plugin("better-harness-current-e2e-p7@local", "Better Harness Current E2e P7"),
    ],
    hooks,
  }), { locale: "en" });
  const ids = result.findings.map((finding) => finding.id);

  assert.ok(ids.includes("plugin-name-collision"));
  assert.ok(ids.includes("plugin-capability-overlap"));
  assert.ok(ids.includes("plugin-name-family-overlap"));
  assert.ok(result.findings.some((finding) =>
    finding.id === "plugin-name-family-overlap" && /better-harness.*better-harness-tools|better-harness-tools.*better-harness/iu.test(finding.why)));
  assert.ok(ids.includes("hook-count-over-recommended-limit"));
  assert.ok(ids.includes("hook-duplicate-registration"));
  assert.ok(ids.includes("hook-event-matcher-fanout"));
  assert.equal(result.summary.hooks.enabledHookCount, 11);
  assert.equal(result.summary.hooks.overRecommendedLimit, true);
  assert.match(result.findings.find((finding) => finding.id === "plugin-name-family-overlap").why, /must not be disabled automatically/u);
  assert.match(result.findings.find((finding) => finding.id === "hook-event-matcher-fanout").why, /does not claim observed runtime latency/u);
});

test("public asset-integrity CLI stays read-only and omits Memory body text and private paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-asset-integrity-"));
  const workspace = path.join(root, "workspace");
  const qoderHome = path.join(root, ".qoder");
  try {
    await mkdir(workspace, { recursive: true });
    const slug = (await realpath(workspace)).replace(/^[A-Za-z]:/u, "").replace(/[\\/]+/gu, "-").replace(/^-+|-+$/gu, "");
    const memoryDir = path.join(qoderHome, "memories", "account", "projects", slug, "project_introduction");
    await mkdir(memoryDir, { recursive: true });
    await writeFile(path.join(memoryDir, "Project Overview.md"), "private body must stay private\n");
    await writeFile(path.join(memoryDir, "Project_Overview.md"), "another private body\n");
    const script = path.join(process.cwd(), "scripts", "better-harness.mjs");
    const { stdout } = await execFileAsync(process.execPath, [
      script,
      "coding-agent-practices",
      "asset-integrity",
      "qoder",
      "--workspace",
      workspace,
      "--qoder-home",
      qoderHome,
      "--include-memories",
      "--json",
    ]);
    const result = JSON.parse(stdout);
    assert.equal(result.summary.memories.titleCount, 2);
    assert.equal(result.summary.memories.exactCollisionGroups, 1);
    assert.doesNotMatch(stdout, /private body|another private body|better-harness-asset-integrity-/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("public asset-integrity CLI reviews Qwen asset metadata without reading bodies", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-qwen-integrity-"));
  const workspace = path.join(root, "workspace");
  const qwenHome = path.join(root, ".qwen");
  try {
    await mkdir(workspace, { recursive: true });
    await mkdir(path.join(qwenHome, "skills", "audit"), { recursive: true });
    await writeFile(
      path.join(qwenHome, "skills", "audit", "SKILL.md"),
      "---\nname: audit\ndescription: Audit assets.\n---\n",
    );
    await writeFile(path.join(workspace, "QWEN.md"), "# Qwen project\n");
    const script = path.join(process.cwd(), "scripts", "better-harness.mjs");
    const { stdout } = await execFileAsync(process.execPath, [
      script,
      "coding-agent-practices",
      "asset-integrity",
      "qwen",
      "--workspace",
      workspace,
      "--qwen-home",
      qwenHome,
      "--include-user-home",
      "--json",
    ]);
    const result = JSON.parse(stdout);
    assert.ok(result.summary);
    assert.doesNotMatch(stdout, /better-harness-qwen-integrity-/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("public asset-integrity CLI reviews Codex Memory metadata without reading bodies", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-codex-integrity-"));
  const workspace = path.join(root, "workspace");
  const codexHome = path.join(root, ".codex");
  try {
    const memoryDir = path.join(codexHome, "memories", "learned");
    await mkdir(memoryDir, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(path.join(memoryDir, "Project Overview.md"), "private codex body\n");
    await writeFile(path.join(memoryDir, "Project_Overview.md"), "another private codex body\n");
    const script = path.join(process.cwd(), "scripts", "better-harness.mjs");
    const excluded = await execFileAsync(process.execPath, [
      script,
      "coding-agent-practices",
      "asset-integrity",
      "codex",
      "--workspace",
      workspace,
      "--codex-home",
      codexHome,
      "--json",
    ]);
    assert.equal(JSON.parse(excluded.stdout).summary.memories.titleCount, 0);
    const { stdout } = await execFileAsync(process.execPath, [
      script,
      "coding-agent-practices",
      "asset-integrity",
      "codex",
      "--workspace",
      workspace,
      "--codex-home",
      codexHome,
      "--include-memories",
      "--include-user-home",
      "--json",
    ]);
    const result = JSON.parse(stdout);
    assert.equal(result.summary.memories.titleCount, 2);
    assert.equal(result.summary.memories.exactCollisionGroups, 1);
    assert.doesNotMatch(stdout, /private codex body|another private codex body|better-harness-codex-integrity-/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("public asset-integrity CLI admits empty DSH metadata surfaces with frozen cwd", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-dsh-integrity-"));
  const workspace = path.join(root, "workspace");
  const cwd = path.join(workspace, "..valid-child", "src");
  const dshHome = path.join(root, "isolated-dsh-home");
  try {
    await mkdir(path.join(workspace, ".git"), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await mkdir(dshHome, { recursive: true });
    const script = path.join(process.cwd(), "scripts", "better-harness.mjs");
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      script,
      "coding-agent-practices",
      "asset-integrity",
      "dsh",
      "--workspace",
      workspace,
      "--cwd",
      cwd,
      "--dsh-home",
      dshHome,
      "--json",
    ], {
      env: { ...process.env, HOME: root, USERPROFILE: root, DSH_HOME: dshHome },
    });

    assert.equal(stderr, "");
    const result = JSON.parse(stdout);
    assert.equal(result.status, "reviewed");
    assert.equal(result.summary.findingCount, 0);
    assert.equal(result.summary.memories.titleCount, 0);
    assert.equal(result.summary.plugins.enabledPluginCount, 0);
    assert.equal(result.summary.hooks.enabledHookCount, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("public asset-integrity CLI rejects a configured cwd that resolves outside workspace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-dsh-integrity-escape-"));
  const workspace = path.join(root, "workspace");
  const outside = path.join(root, "outside");
  const escape = path.join(workspace, "escape");
  const dshHome = path.join(root, "isolated-dsh-home");
  try {
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(outside, { recursive: true }),
      mkdir(dshHome, { recursive: true }),
    ]);
    await symlink(outside, escape, "dir");
    const script = path.join(process.cwd(), "scripts", "better-harness.mjs");
    await assert.rejects(
      execFileAsync(process.execPath, [
        script,
        "coding-agent-practices",
        "asset-integrity",
        "dsh",
        "--workspace",
        workspace,
        "--cwd",
        escape,
        "--dsh-home",
        dshHome,
        "--json",
      ], { env: { ...process.env, HOME: root, USERPROFILE: root, DSH_HOME: dshHome } }),
      (error) => error?.code === 1 && /cwd must resolve inside workspace/u.test(error.stderr),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

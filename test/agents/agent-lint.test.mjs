import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";

import {
  collectAgentInstructionGraph,
  runAgentLint,
  parseMarkdownDocument,
} from "../../scripts/agent-lint/index.mjs";

const execFileAsync = promisify(execFile);

async function writeText(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

async function makeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-lint-"));
  await writeText(
    path.join(root, "AGENTS.md"),
    `# Demo Agents

Architecture lives in [Architecture](docs/ARCHITECTURE.md#agent-friendly-cli-contracts).
Read [Reference guide][ref-guide] for focused examples.
Use [external docs](https://example.invalid/agent-docs) only when provided.
Missing docs are [Missing](docs/MISSING.md).
Self anchors such as [Test and Verify](#test-and-verify) stay local to the document.

Use \`npm test\` before completion.

\`\`\`md
[ignored](docs/IGNORED.md)
\`\`\`

## Test and Verify

- Run \`npm test\`.

[ref-guide]: docs/REFERENCE.md
`,
  );
  await writeText(
    path.join(root, "docs", "ARCHITECTURE.md"),
    `# Architecture

## Agent-Friendly CLI Contracts

Keep command output parser-safe.
`,
  );
  await writeText(
    path.join(root, "docs", "REFERENCE.md"),
    `# Reference Guide

Read this only for detailed examples.
`,
  );
  return root;
}

test("markdown parser extracts headings, links, reference definitions, inline code, and code fences", () => {
  const parsed = parseMarkdownDocument({
    path: "/workspace/AGENTS.md",
    relativePath: "AGENTS.md",
    text: `# Demo

Use [Architecture][arch] and \`npm test\`.

\`\`\`md
[ignored](docs/IGNORED.md)
\`\`\`

## Verify

[arch]: docs/ARCHITECTURE.md#agent-friendly-cli-contracts
`,
  });

  assert.deepEqual(parsed.headings.map((heading) => [heading.depth, heading.text, heading.line]), [
    [1, "Demo", 1],
    [2, "Verify", 9],
  ]);
  assert.deepEqual(parsed.inlineCode.map((span) => [span.text, span.line]), [["npm test", 3]]);
  assert.equal(parsed.codeFences.length, 1);
  assert.equal(parsed.codeFences[0].language, "md");
  assert.equal(parsed.codeFences[0].startLine, 5);
  assert.equal(parsed.codeFences[0].endLine, 7);
  assert.equal(parsed.links.length, 1);
  assert.equal(parsed.links[0].text, "Architecture");
  assert.equal(parsed.links[0].destination, "docs/ARCHITECTURE.md#agent-friendly-cli-contracts");
  assert.equal(parsed.links[0].referenceId, "arch");
  assert.equal(parsed.referenceDefinitions.length, 1);
  assert.equal(parsed.referenceDefinitions[0].id, "arch");
  assert.equal(parsed.referenceDefinitions[0].destination, "docs/ARCHITECTURE.md#agent-friendly-cli-contracts");
  assert.equal(parsed.links.some((link) => link.destination.includes("IGNORED")), false);
});

test("markdown parser does not treat an inline-code link example as a dependency", () => {
  const parsed = parseMarkdownDocument({
    path: "/workspace/agent.md",
    relativePath: "agent.md",
    text: "Use this example only: `- [Title](file.md) — one-line hook`.\n",
  });

  assert.equal(parsed.inlineCode.length, 1);
  assert.deepEqual(parsed.links, []);
});

test("agent instruction graph resolves AGENTS.md local markdown references with bounded depth", async () => {
  const root = await makeFixture();

  try {
    const graph = await collectAgentInstructionGraph({ workspace: root, maxReferenceDepth: 1 });

    assert.equal(graph.kind, "agent-instruction-graph");
    assert.equal(graph.workspace, root);
    assert.deepEqual(graph.entrypoints.map((entrypoint) => entrypoint.relativePath), ["AGENTS.md"]);
    assert.equal(graph.documents.some((document) => document.relativePath === "docs/ARCHITECTURE.md"), true);
    assert.equal(graph.documents.some((document) => document.relativePath === "docs/REFERENCE.md"), true);
    assert.equal(graph.documents.some((document) => document.relativePath === "docs/IGNORED.md"), false);

    const agents = graph.documents.find((document) => document.relativePath === "AGENTS.md");
    assert.equal(agents.lineCount, 19);
    assert.equal(agents.links.length, 5);

    const architecture = agents.references.find((reference) => reference.destination.startsWith("docs/ARCHITECTURE.md"));
    assert.equal(architecture.kind, "local");
    assert.equal(architecture.exists, true);
    assert.equal(architecture.relativePath, "docs/ARCHITECTURE.md");
    assert.equal(architecture.anchor, "agent-friendly-cli-contracts");

    const missing = agents.references.find((reference) => reference.destination === "docs/MISSING.md");
    assert.equal(missing.kind, "local");
    assert.equal(missing.exists, false);

    const external = agents.references.find((reference) => reference.destination.startsWith("https://"));
    assert.equal(external.kind, "external");
    assert.equal(external.exists, null);

    const selfAnchor = agents.references.find((reference) => reference.destination === "#test-and-verify");
    assert.equal(selfAnchor.kind, "anchor");
    assert.equal(selfAnchor.exists, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agent-lint CLI emits parser-safe JSON through the Better Harness facade", async () => {
  const root = await makeFixture();
  const cliPath = path.join(process.cwd(), "scripts", "better-harness.mjs");

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      cliPath,
      "agent-lint",
      "--workspace",
      root,
      "--max-reference-depth",
      "1",
      "--json",
    ]);

    assert.equal(stderr, "");
    const payload = JSON.parse(stdout);
    assert.equal(payload.kind, "agent-lint");
    assert.equal(payload.graph.entrypoints[0].relativePath, "AGENTS.md");
    assert.equal(payload.summary.entrypoints, 1);
    assert.equal(payload.summary.documents, 3);
    assert.equal(payload.summary.references, 5);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agent instruction graph discovers vendor and nested instruction entrypoints", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-lint-entrypoints-"));

  try {
    await writeText(
      path.join(root, "CLAUDE.md"),
      `# Claude Guide

Run \`npm test\`.
`,
    );
    await writeText(
      path.join(root, ".github", "copilot-instructions.md"),
      `# Copilot Guide

Use project conventions.
`,
    );
    await writeText(
      path.join(root, ".cursor", "rules", "frontend.mdc"),
      `# Cursor Rule

Prefer focused tests.
`,
    );
    await writeText(
      path.join(root, "packages", "api", "AGENTS.md"),
      `# API Agents

Run \`go test ./...\`.
`,
    );

    const graph = await collectAgentInstructionGraph({ workspace: root, maxEntrypointDepth: 3 });

    assert.deepEqual(graph.entrypointSummary, {
      canonicalAgentsMd: false,
      vendorOnly: true,
      multiEntrypoint: true,
      nestedInstructionCount: 1,
      primaryEntrypoint: "CLAUDE.md",
    });
    assert.deepEqual(
      graph.entrypoints.map((entrypoint) => [entrypoint.relativePath, entrypoint.sourceKind]),
      [
        ["CLAUDE.md", "claude-md"],
        [".cursor/rules/frontend.mdc", "cursor-rule"],
        [".github/copilot-instructions.md", "copilot-instructions"],
        ["packages/api/AGENTS.md", "nested-agent-guide"],
      ],
    );
    assert.equal(graph.documents.some((document) => document.relativePath === ".cursor/rules/frontend.mdc"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Qoder instruction review compares only active user Rules, project Rules, and root AGENTS", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-lint-qoder-ledger-"));
  const workspace = path.join(root, "workspace");
  const qoderHome = path.join(root, ".qoder-home");

  try {
    await writeText(
      path.join(qoderHome, "rules", "global.md"),
      "# User rules\n\nAlways use pnpm for dependency installation.\n\npnpm test\n\n## Review\n\n- Inspect the focused diff before completion.\n- Run the smallest relevant automated tests.\n- Record material risks and unverified items.\n- Keep the result concise for readers.\n",
    );
    await writeText(
      path.join(workspace, ".qoder", "rules", "project.md"),
      "# Project rules\n\nAlways use pnpm for dependency installation.\n\npnpm test\n\n## Delivery review\n\n- Inspect the focused diff before completion.\n- Run the smallest relevant automated tests.\n- Record material risks and unverified items.\n- Link the acceptance evidence.\n",
    );
    await writeText(
      path.join(workspace, "AGENTS.md"),
      "# Agents\n\nAlways use npm for dependency installation.\n\nRun npm test before completion.\n",
    );
    await writeText(
      path.join(qoderHome, "AGENTS.md"),
      "# Inactive global AGENTS\n\nAlways use yarn for dependency installation.\n",
    );
    await writeText(
      path.join(workspace, "packages", "api", "AGENTS.md"),
      "# Inactive nested Qoder AGENTS\n\nAlways use bun for dependency installation.\n",
    );
    await writeText(
      path.join(workspace, "CLAUDE.md"),
      "# Inactive Claude source\n\nAlways use yarn for dependency installation.\n",
    );

    const result = await runAgentLint({
      workspace,
      profile: "agents-md-review",
      provider: "qoder",
      qoderHome,
      includeUserHome: true,
    });
    const ledgerPaths = result.hostInstructionReview.sources.map((source) => source.relativePath);

    assert.deepEqual(result.graph.entrypoints.map((entrypoint) => entrypoint.relativePath), [
      "AGENTS.md",
      ".qoder/rules/project.md",
    ]);
    assert.equal(ledgerPaths.includes("user:rules/global.md"), true);
    assert.equal(ledgerPaths.includes(".qoder/rules/project.md"), true);
    assert.equal(ledgerPaths.includes("AGENTS.md"), true);
    assert.equal(ledgerPaths.some((value) => value.includes("CLAUDE")), false);
    assert.equal(ledgerPaths.some((value) => value.includes("packages/api")), false);
    assert.equal(result.findings.some((finding) => finding.id.startsWith("instruction-exact-duplicate-")), true);
    assert.equal(result.findings.some((finding) => finding.id.startsWith("instruction-command-duplicate-")), true);
    assert.equal(result.findings.some((finding) => finding.id.startsWith("instruction-section-overlap-")), true);
    assert.equal(result.findings.some((finding) => finding.id.startsWith("instruction-conflict-")), true);
    assert.equal(
      result.findings
        .flatMap((finding) => finding.locations ?? [])
        .some((location) => location.source.includes("Inactive")),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Claude and Codex instruction ledgers keep their active filenames separate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-lint-host-ledger-"));
  const workspace = path.join(root, "workspace");
  const claudeHome = path.join(root, ".claude-home");
  const codexHome = path.join(root, ".codex-home");

  try {
    await writeText(path.join(claudeHome, "CLAUDE.md"), "# Claude global\n\nRun npm test before completion.\n");
    await writeText(path.join(codexHome, "AGENTS.md"), "# Codex global\n\nRun pnpm test before completion.\n");
    await writeText(path.join(workspace, "CLAUDE.md"), "# Claude project\n\nUse Claude tools.\n");
    await writeText(path.join(workspace, ".claude", "CLAUDE.md"), "# Claude alternate project\n\nUse alternate Claude tools.\n");
    await writeText(path.join(workspace, "CLAUDE.local.md"), "# Claude local\n\nUse local Claude tools.\n");
    await writeText(path.join(workspace, ".claude", "rules", "security.md"), "# Claude security rule\n\nNever expose credentials.\n");
    await writeText(path.join(workspace, "AGENTS.md"), "# Codex project\n\nUse Codex tools.\n");
    await writeText(path.join(workspace, "pkg", "CLAUDE.md"), "# Claude nested\n\nUse nested Claude rules.\n");
    await writeText(path.join(workspace, "pkg", "AGENTS.md"), "# Codex nested\n\nUse nested Codex rules.\n");

    const claude = await runAgentLint({
      workspace,
      profile: "agents-md-review",
      provider: "claude",
      claudeHome,
      includeUserHome: true,
    });
    const codex = await runAgentLint({
      workspace,
      profile: "agents-md-review",
      provider: "codex",
      codexHome,
      includeUserHome: true,
    });

    assert.deepEqual(
      claude.graph.entrypoints.map((entrypoint) => entrypoint.relativePath),
      ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md", ".claude/rules/security.md", "pkg/CLAUDE.md"],
    );
    const claudeSources = claude.hostInstructionReview.sources;
    assert.deepEqual(
      claudeSources
        .filter((source) => source.scope !== "ancestor")
        .map((source) => source.relativePath),
      [
        "user:CLAUDE.md",
        ".claude/CLAUDE.md",
        "CLAUDE.md",
        "pkg/CLAUDE.md",
        ".claude/rules/security.md",
        "CLAUDE.local.md",
      ],
    );
    assert.equal(
      claudeSources
        .filter((source) => source.scope === "ancestor")
        .every((source) => source.sourceKind === "claude-ancestor"
          && source.relativePath === "ancestor:CLAUDE.md"),
      true,
    );
    assert.equal(claudeSources.some((source) => source.relativePath.includes("AGENTS")), false);
    assert.deepEqual(
      codex.graph.entrypoints.map((entrypoint) => entrypoint.relativePath),
      ["AGENTS.md", "pkg/AGENTS.md"],
    );
    assert.equal(codex.hostInstructionReview.sources.every((source) => source.relativePath.includes("AGENTS")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agents-md-review profile emits evidence-backed findings", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-lint-review-"));
  const filler = Array.from({ length: 185 }, (_, index) => `- Generic process note ${index + 1}.`).join("\n");

  try {
    await writeText(
      path.join(root, "AGENTS.md"),
      `# Big Agents

${filler}

See [Missing](docs/MISSING.md).
`,
    );
    await writeText(
      path.join(root, "CLAUDE.md"),
      `# Claude Detail

Run \`npm test\`.
`,
    );
    await writeText(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }, null, 2));

    const payload = await runAgentLint({ workspace: root, profile: "agents-md-review", maxReferenceDepth: 1 });
    const ids = payload.findings.map((finding) => finding.id);

    assert.equal(payload.profile, "agents-md-review");
    assert.equal(payload.summary.findings, 7);
    assert.equal(payload.summary.errors, 1);
    assert.ok(ids.includes("multi-entrypoint-review"));
    assert.ok(ids.includes("root-length-overloaded"));
    assert.ok(ids.includes("missing-local-reference"));
    assert.ok(ids.includes("long-root-without-progressive-references"));
    assert.ok(ids.includes("missing-risk-controls"));
    assert.ok(ids.includes("missing-project-facts"));
    assert.ok(ids.includes("missing-decision-rules"));

    const progressive = payload.findings.find((finding) => finding.id === "long-root-without-progressive-references");
    assert.match(progressive.whyThisMatters, /progressive disclosure/);
    assert.equal(progressive.rubricRef, "Progressive Disclosure");

    const missing = payload.findings.find((finding) => finding.id === "missing-local-reference");
    assert.equal(missing.file, "AGENTS.md");
    assert.equal(missing.line, 189);
    assert.equal(missing.severity, "error");
    assert.equal(missing.recommendationId, "agent-lint.agents-md-review.missing-local-reference");
    assert.deepEqual(missing.title, {
      "zh-CN": "关键指引链接会在执行时断开",
      en: "Broken local instruction link",
    });
    assert.match(missing.why["zh-CN"], /验证命令会在真正执行时缺席/);
    assert.match(missing.recommendation["zh-CN"], /补齐目标 Markdown 文件/);
    assert.match(missing.passCheck.en, /missing-local-reference/);
    assert.deepEqual(missing.aiFixLabel, {
      "zh-CN": "修复指引链接",
      en: "Fix instruction link",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("findings recommendations are owned by the shared JSON catalog", async () => {
  const catalog = JSON.parse(await readFile(path.resolve("scripts/findings-recommend/findings-recommend.json"), "utf8"));

  assert.deepEqual(Object.keys(catalog).sort(), ["findings", "summary"]);
  assert.equal(catalog.summary.kind, "better-harness.findings-recommend");
  assert.equal(Array.isArray(catalog.findings), false);
  assert.ok(catalog.findings["agent-lint.agents-md-review.missing-local-reference"]);
  assert.ok(catalog.findings["review-trigger.change-test-evidence.large-change-without-tests"]);
  assert.deepEqual(
    catalog.findings["agent-lint.agents-md-review.missing-local-reference"].recommendation,
    {
      "zh-CN": "修复这个链接，或补齐目标 Markdown 文件；如果这段指引已经过期，就删除链接和对应说明。",
      en: "Repair the link, add the referenced Markdown file, or remove the stale guidance if it is no longer valid.",
    },
  );
});

test("agent-lint CLI scans child workspaces with review markdown output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-lint-children-"));
  const cliPath = path.join(process.cwd(), "scripts", "better-harness.mjs");

  try {
    await writeText(
      path.join(root, "vendor-only", "CLAUDE.md"),
      `# Claude

Run \`npm test\`.
`,
    );
    await writeText(
      path.join(root, "healthy", "AGENTS.md"),
      `# Healthy

Use Node 22.
Run \`npm test\`.
Ask before destructive changes.
Never commit secrets.
`,
    );
    await writeText(path.join(root, "healthy", "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
    await writeText(path.join(root, "results", "AGENTS.md"), "# Not a project\n");

    const { stdout, stderr } = await execFileAsync(process.execPath, [
      cliPath,
      "agent-lint",
      "--workspace-root",
      root,
      "--scan-children",
      "--profile",
      "agents-md-review",
      "--format",
      "review-markdown",
    ]);

    assert.equal(stderr, "");
    assert.match(stdout, /# Agent Lint Review/);
    assert.match(stdout, /Projects: 2/);
    assert.match(stdout, /vendor-only/);
    assert.match(stdout, /no-canonical-agents-md/);
    assert.doesNotMatch(stdout, /results/);

    const { stdout: jsonStdout } = await execFileAsync(process.execPath, [
      cliPath,
      "agent-lint",
      "--workspace-root",
      root,
      "--scan-children",
      "--profile=agents-md-review",
      "--json",
    ]);
    const payload = JSON.parse(jsonStdout);
    assert.equal(payload.summary.projects, 2);
    assert.equal(payload.projects.some((project) => project.name === "vendor-only"), true);
    assert.equal(payload.projects.some((project) => project.name === "results"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agent-assets-review profile reports skill contract findings", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-lint-assets-skill-"));
  const qoderHome = path.join(root, ".home", "qoder");
  const sharedClientCacheRoot = path.join(root, ".home", "shared-cache");
  const filler = Array.from({ length: 500 }, (_, index) => `- Long workflow detail ${index + 1}.`).join("\n");

  try {
    await writeText(
      path.join(root, ".agents", "skills", "asset-review", "SKILL.md"),
      `---
name: broad-reviewer
description: do things
---

# Broad Reviewer

See [Missing Runbook](references/runbook.md).

${filler}
`,
    );

    const payload = await runAgentLint({
      workspace: root,
      profile: "agent-assets-review",
      provider: "qoder",
      qoderHome,
      qoderSharedClientCacheRoot: sharedClientCacheRoot,
    });
    const ids = payload.findings.map((finding) => finding.id);

    assert.equal(payload.profile, "agent-assets-review");
    assert.equal(payload.assetInventory.provider, "qoder");
    assert.equal(payload.assetInventory.summary.skills, 1);
    assert.ok(ids.includes("skill-name-mismatch"));
    assert.ok(ids.includes("skill-description-too-short"));
    assert.ok(ids.includes("skill-length-hard-cap"));
    assert.ok(ids.includes("skill-missing-local-reference"));

    const missing = payload.findings.find((finding) => finding.id === "skill-missing-local-reference");
    assert.equal(missing.file, ".agents/skills/asset-review/SKILL.md");
    assert.equal(missing.severity, "error");
    assert.equal(missing.assetKind, "skill");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agent-assets-review carries a declared plugin revision and leaves a project file undeclared", async () => {
  // The temp root is resolved because plugin scope resolution compares real
  // paths, and the platform temp directory can itself be a symlink.
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-lint-assets-revision-")));
  const qoderHome = path.join(root, ".home", "qoder");
  const pluginRoot = path.join(qoderHome, "plugins", "cache", "qoder-marketplace", "design-review", "1.4.2");
  const overlongRoot = path.join(qoderHome, "plugins", "cache", "qoder-marketplace", "sprawling-review", "1");
  // Longer than the reported revision limit. A shortened revision would be a
  // different version than the host declared, so none is reported.
  const overlongVersion = `9.9.9-${"build".repeat(40)}`;

  try {
    // A project Skill declares no version; an installed plugin does.
    await writeText(
      path.join(root, ".agents", "skills", "asset-review", "SKILL.md"),
      "---\nname: asset-review\ndescription: Use when reviewing configured agent assets in this workspace.\n---\n\n# Asset Review\n",
    );
    await writeText(
      path.join(pluginRoot, ".qoder-plugin", "plugin.json"),
      JSON.stringify({ name: "design-review", displayName: "Design Review", version: "1.4.2" }),
    );
    await writeText(
      path.join(overlongRoot, ".qoder-plugin", "plugin.json"),
      JSON.stringify({ name: "sprawling-review", displayName: "Sprawling Review", version: overlongVersion }),
    );
    await writeText(
      path.join(qoderHome, "plugins", "installed_plugins.json"),
      JSON.stringify({
        plugins: {
          "design-review@qoder-marketplace": { installPath: pluginRoot, version: "1.4.2", scope: "user" },
          "sprawling-review@qoder-marketplace": { installPath: overlongRoot, version: overlongVersion, scope: "user" },
        },
      }),
    );
    await writeText(
      path.join(qoderHome, "settings.json"),
      JSON.stringify({
        enabledPlugins: {
          "design-review@qoder-marketplace": true,
          "sprawling-review@qoder-marketplace": true,
        },
      }),
    );

    const payload = await runAgentLint({
      workspace: root,
      profile: "agent-assets-review",
      provider: "qoder",
      // Plugin-scoped assets are outside the profile's default boundary, so the
      // revision path is exercised by asking for them explicitly.
      includePluginAssets: true,
      qoderHome,
      qoderSharedClientCacheRoot: path.join(root, ".home", "shared-cache"),
    });
    const assets = payload.assetInventory.assets ?? [];

    const skill = assets.find((asset) => asset.kind === "skill" && asset.name === "asset-review");
    assert.ok(skill, "the project Skill is inventoried");
    assert.equal(Object.hasOwn(skill, "revision"), false);
    assert.equal(Object.hasOwn(skill, "publisher"), false);

    const plugin = assets.find((asset) => asset.kind === "plugin" && asset.name === "design-review");
    assert.ok(plugin, "the installed plugin is inventoried");
    assert.equal(plugin.revision, "1.4.2");
    assert.equal(plugin.publisher, "Qoder Marketplace");

    // The over-long revision is dropped rather than shortened, but the asset is
    // still inventoried and still carries its publisher.
    const sprawling = assets.find((asset) => asset.kind === "plugin" && asset.name === "sprawling-review");
    assert.ok(sprawling, "the plugin with an over-long version is still inventoried");
    assert.equal(Object.hasOwn(sprawling, "revision"), false);
    assert.equal(sprawling.publisher, "Qoder Marketplace");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agent-assets-review reads folded and literal Skill descriptions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-lint-frontmatter-"));
  const qoderHome = path.join(root, ".home", "qoder");
  const sharedClientCacheRoot = path.join(root, ".home", "shared-cache");

  try {
    await writeText(
      path.join(root, ".agents", "skills", "folded-skill", "SKILL.md"),
      "---\r\nname: folded-skill\r\ndescription: >-\r\n  Use when a bounded workflow needs review,\r\n  validation, and a clear stop condition.\r\n---\r\n\r\n# Folded Skill\r\n",
    );
    await writeText(
      path.join(root, ".agents", "skills", "literal-skill", "SKILL.md"),
      `---
name: literal-skill
description: |
  Use when a release handoff needs a bounded
  validation and recovery procedure.
---

# Literal Skill
`,
    );

    const payload = await runAgentLint({
      workspace: root,
      profile: "agent-assets-review",
      provider: "qoder",
      qoderHome,
      qoderSharedClientCacheRoot: sharedClientCacheRoot,
    });
    const descriptionFindings = payload.findings.filter((finding) => [
      "skill-missing-description",
      "skill-description-too-short",
    ].includes(finding.id));

    assert.deepEqual(descriptionFindings, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agent-assets-review checks Custom Agent routing, prompt, references, and tool boundaries", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-lint-custom-agents-"));
  const qoderHome = path.join(root, ".home", "qoder");
  const sharedClientCacheRoot = path.join(root, ".home", "shared-cache");

  try {
    await writeText(
      path.join(root, ".qoder", "agents", "reviewer.md"),
      `---
name: Reviewer Agent
description: review
tools: [Read, Write]
---

Act as a review-only specialist. Never edit files. Read the private-marker only while following [Missing](references/missing.md).
`,
    );
    await writeText(
      path.join(root, ".qoder", "agents", "tester.md"),
      `---
name: tester
description: Use when a focused test plan and verification result are required.
tools:
  - Read
  - Grep
---

Inspect the relevant test surface, run only the approved checks, and return concise evidence to the main Agent.
`,
    );

    const payload = await runAgentLint({
      workspace: root,
      profile: "agent-assets-review",
      provider: "qoder",
      qoderHome,
      qoderSharedClientCacheRoot: sharedClientCacheRoot,
    });
    const ids = payload.findings.map((finding) => finding.id);

    assert.equal(payload.assetInventory.summary.agents, 2);
    assert.ok(ids.includes("custom-agent-invalid-name"));
    assert.ok(ids.includes("custom-agent-name-mismatch"));
    assert.ok(ids.includes("custom-agent-description-too-short"));
    assert.ok(ids.includes("custom-agent-tool-role-conflict"));
    assert.ok(ids.includes("custom-agent-missing-local-reference"));
    assert.equal(payload.findings.filter((finding) => finding.assetName === "tester").length, 0);
    assert.equal(payload.findings.filter((finding) => finding.assetKind === "subagent").length, 5);
    assert.doesNotMatch(JSON.stringify(payload), /private-marker/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agent-assets-review canonicalizes Qoder compatibility-directory aliases", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-lint-agent-aliases-"));
  const qoderHome = path.join(root, ".home", "qoder");
  const sharedClientCacheRoot = path.join(root, ".home", "shared-cache");

  try {
    const canonicalRoot = path.join(root, ".claude", "agents");
    await writeText(
      path.join(canonicalRoot, "reviewer.md"),
      `---
name: reviewer
description: Use when a focused read-only review needs independent evidence.
tools: [Read, Grep]
---

Inspect the bounded target and return evidence. The literal \`- [Title](file.md)\` is only an output example.
`,
    );
    await mkdir(path.join(root, ".qoder"), { recursive: true });
    await mkdir(path.join(root, ".agents"), { recursive: true });
    const linkType = process.platform === "win32" ? "junction" : "dir";
    await symlink(canonicalRoot, path.join(root, ".qoder", "agents"), linkType);
    await symlink(canonicalRoot, path.join(root, ".agents", "agents"), linkType);

    const payload = await runAgentLint({
      workspace: root,
      profile: "agent-assets-review",
      provider: "qoder",
      qoderHome,
      qoderSharedClientCacheRoot: sharedClientCacheRoot,
    });

    assert.equal(payload.assetInventory.summary.agents, 1);
    assert.equal(payload.findings.some((finding) => finding.id === "custom-agent-missing-local-reference"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agent-assets-review reports bounded Hook safety, semantics, pressure, and portability findings", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-lint-assets-hooks-"));
  const qoderHome = path.join(root, ".home", "qoder");
  const sharedClientCacheRoot = path.join(root, ".home", "shared-cache");

  try {
    await writeText(path.join(root, ".qoder", "hooks", "unsafe.sh"), `#!/bin/bash
input=$(cat)
command=$(printf '%s' "$input" | jq -r '.tool_input.command')
eval $command
`);
    await writeText(path.join(root, ".qoder", "hooks", "blocking.mjs"), "process.exit(2);\n");
    await writeText(path.join(root, ".qoder", "hooks", "audit.mjs"), `import { appendFileSync } from "node:fs";
process.stdin.resume();
appendFileSync("hook.jsonl", "audit\\n");
`);
    await writeText(path.join(root, ".qoder", "hooks", "platform.mjs"), `import { execFileSync } from "node:child_process";
process.stdin.resume();
execFileSync("osascript", ["-e", "display notification 'done'"]);
`);
    await writeText(path.join(root, ".qoder", "hooks", "safe.mjs"), `let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => process.stdout.write(JSON.stringify({ continue: JSON.parse(input).allow !== false })));
`);
    await writeText(
      path.join(root, ".qoder", "settings.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { hooks: [{ type: "command", command: "bash .qoder/hooks/unsafe.sh" }] },
            { matcher: "Write", hooks: [{ type: "command", command: "node .qoder/hooks/safe.mjs", async: true }] },
          ],
          PostToolUse: [
            { matcher: "Write", hooks: [{ type: "command", command: "node .qoder/hooks/blocking.mjs", async: true }] },
            { matcher: "Write", hooks: [{ type: "command", command: "node .qoder/hooks/audit.mjs" }] },
          ],
          Stop: [{ hooks: [{ type: "command", command: "node .qoder/hooks/platform.mjs", async: true }] }],
        },
      }, null, 2),
    );

    const payload = await runAgentLint({
      workspace: root,
      profile: "agent-assets-review",
      provider: "qoder",
      qoderHome,
      qoderSharedClientCacheRoot: sharedClientCacheRoot,
    });
    const ids = payload.findings.map((finding) => finding.id);

    assert.equal(payload.assetInventory.summary.hooks, 5);
    assert.ok(ids.includes("hook-unsafe-input-handling"));
    assert.ok(ids.includes("hook-blocking-contract-mismatch"));
    assert.ok(ids.includes("hook-broad-high-frequency-matcher"));
    assert.ok(ids.includes("hook-sync-side-effect"));
    assert.ok(ids.includes("hook-portability-or-missing-dependency"));
    assert.equal(payload.findings.every((finding) => finding.assetKind === "hook"), true);
    assert.equal(payload.findings.some((finding) => finding.file?.endsWith("safe.mjs")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agent-assets-review explicit skill chain reports inline path references", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-lint-explicit-skill-"));
  const qoderHome = path.join(root, ".home", "qoder");
  const sharedClientCacheRoot = path.join(root, ".home", "shared-cache");
  const cliPath = path.join(process.cwd(), "scripts", "better-harness.mjs");

  try {
    await writeText(
      path.join(root, "skills", "better-harness", "SKILL.md"),
      `---
name: better-harness
description: Use when validating a Better Harness skill chain.
---

# Better Harness

Load \`references/runbook.md\`.
`,
    );
    await writeText(
      path.join(root, "skills", "better-harness", "references", "runbook.md"),
      `# Runbook

Use \`templates/harness-report/output-modes/missing.md\`.
See [\`docs/ok.md\`](../../../docs/ok.md).
Glob examples such as \`docs/specs/*.md\` are not concrete links.
Target projects may have \`.github/copilot-instructions.md\`.
`,
    );
    await writeText(path.join(root, "docs", "ok.md"), "# OK\n");
    await writeText(
      path.join(root, ".agents", "skills", "noisy", "SKILL.md"),
      `---
name: noisy
description: Use when testing unrelated inventory noise.
---

# Noisy

See [Missing](missing.md).
`,
    );

    const payload = await runAgentLint({
      workspace: root,
      profile: "agent-assets-review",
      provider: "qoder",
      qoderHome,
      qoderSharedClientCacheRoot: sharedClientCacheRoot,
      skill: "skills/better-harness",
    });

    assert.equal(payload.assetInventory.summary.skills, 1);
    assert.equal(payload.findings.length, 1);
    assert.equal(payload.findings[0].id, "skill-missing-local-reference");
    assert.equal(payload.findings[0].file, "skills/better-harness/references/runbook.md");
    assert.equal(payload.findings[0].line, 3);
    assert.match(payload.findings[0].evidence, /templates\/harness-report\/output-modes\/missing\.md/);
    assert.doesNotMatch(payload.findings[0].evidence, /\.github\/copilot-instructions\.md/);

    const { stdout, stderr } = await execFileAsync(process.execPath, [
      cliPath,
      "agent-lint",
      "--workspace",
      root,
      "--profile",
      "agent-assets-review",
      "--provider",
      "qoder",
      "--qoder-home",
      qoderHome,
      "--qoder-shared-client-cache-root",
      sharedClientCacheRoot,
      "--skill",
      "skills/better-harness/SKILL.md",
      "--json",
    ]);

    assert.equal(stderr, "");
    const cliPayload = JSON.parse(stdout);
    assert.equal(cliPayload.assetInventory.summary.skills, 1);
    assert.equal(cliPayload.findings[0].file, "skills/better-harness/references/runbook.md");

    const missingTargetPayload = await runAgentLint({
      workspace: root,
      profile: "agent-assets-review",
      provider: "qoder",
      qoderHome,
      qoderSharedClientCacheRoot: sharedClientCacheRoot,
      skill: "skills/missing",
    });
    assert.equal(missingTargetPayload.assetInventory.summary.skills, 0);
    assert.deepEqual(missingTargetPayload.findings.map((finding) => finding.id), ["skill-target-not-found"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agent-assets-review profile reports MCP risks and CLI review output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-lint-assets-mcp-"));
  const qoderHome = path.join(root, ".home", "qoder");
  const sharedClientCacheRoot = path.join(root, ".home", "shared-cache");
  const cliPath = path.join(process.cwd(), "scripts", "better-harness.mjs");

  try {
    await writeText(
      path.join(root, ".qoder", "mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            empty: {},
            remoteDocs: { url: "http://example.invalid/mcp" },
            packageRunner: {
              command: "npx",
              args: ["-y", "@example/mcp-server"],
              env: { API_TOKEN: "plain-secret" },
            },
          },
        },
        null,
        2,
      ),
    );

    const payload = await runAgentLint({
      workspace: root,
      profile: "agent-assets-review",
      provider: "qoder",
      qoderHome,
      qoderSharedClientCacheRoot: sharedClientCacheRoot,
    });
    const ids = payload.findings.map((finding) => finding.id);

    assert.equal(payload.assetInventory.summary.mcps, 3);
    assert.ok(ids.includes("mcp-missing-command-or-url"));
    assert.ok(ids.includes("mcp-remote-without-tls"));
    assert.ok(ids.includes("mcp-direct-secret-env-value"));
    assert.ok(ids.includes("mcp-unpinned-package-runner"));
    assert.ok(ids.includes("mcp-without-workflow-owner"));

    const secret = payload.findings.find((finding) => finding.id === "mcp-direct-secret-env-value");
    assert.equal(secret.assetKind, "mcp");
    assert.equal(secret.assetName, "packageRunner");
    assert.match(secret.evidence, /API_TOKEN/);
    assert.doesNotMatch(secret.evidence, /plain-secret/);

    const { stdout, stderr } = await execFileAsync(process.execPath, [
      cliPath,
      "agent-lint",
      "--workspace",
      root,
      "--profile",
      "agent-assets-review",
      "--provider",
      "qoder",
      "--qoder-home",
      qoderHome,
      "--qoder-shared-client-cache-root",
      sharedClientCacheRoot,
      "--format",
      "review-markdown",
    ]);

    assert.equal(stderr, "");
    assert.match(stdout, /# Agent Lint Review/);
    assert.match(stdout, /mcp-direct-secret-env-value/);
    assert.match(stdout, /mcp-without-workflow-owner/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agent-assets-review multi-project JSON keeps per-project asset summaries", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-lint-assets-children-"));
  const qoderHome = path.join(root, ".home", "qoder");
  const sharedClientCacheRoot = path.join(root, ".home", "shared-cache");

  try {
    await writeText(
      path.join(root, "one", ".agents", "skills", "review", "SKILL.md"),
      `---
name: review
description: Use when reviewing configured assets.
---

# Review
`,
    );
    await writeText(
      path.join(root, "two", ".qoder", "mcp.json"),
      JSON.stringify({ mcpServers: { empty: {} } }, null, 2),
    );

    const payload = await runAgentLint({
      workspaceRoot: root,
      scanChildren: true,
      profile: "agent-assets-review",
      provider: "qoder",
      qoderHome,
      qoderSharedClientCacheRoot: sharedClientCacheRoot,
    });

    const one = payload.projects.find((project) => project.name === "one");
    const two = payload.projects.find((project) => project.name === "two");
    assert.equal(one.assetInventory.summary.skills, 1);
    assert.equal(two.assetInventory.summary.mcps, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agent-assets-review CLI admits DSH and forwards nested cwd selection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-dsh-agent-lint-"));
  const repository = path.join(root, "repository");
  const workspace = path.join(repository, "packages", "api");
  const cwd = path.join(workspace, "..valid-child", "src");
  const dshHome = path.join(root, "isolated-dsh-home");
  const cliPath = path.join(process.cwd(), "scripts", "better-harness.mjs");

  try {
    await mkdir(path.join(repository, ".git"), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await mkdir(dshHome, { recursive: true });
    await writeText(path.join(workspace, "AGENTS.md"), "# Workspace instruction\n");
    await writeText(path.join(cwd, "AGENTS.local.md"), "# Nested local instruction\n");

    const { stdout, stderr } = await execFileAsync(process.execPath, [
      cliPath,
      "agent-lint",
      "--workspace",
      workspace,
      "--cwd",
      cwd,
      "--profile",
      "agent-assets-review",
      "--provider",
      "dsh",
      "--dsh-home",
      dshHome,
      "--json",
    ], {
      env: { ...process.env, HOME: root, USERPROFILE: root, DSH_HOME: dshHome },
    });

    assert.equal(stderr, "");
    const payload = JSON.parse(stdout);
    assert.equal(payload.assetInventory.provider, "dsh");
    assert.equal(payload.assetInventory.summary.rules, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agent-assets-review rejects a configured cwd that resolves outside workspace before asset reads", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-dsh-agent-lint-escape-"));
  const workspace = path.join(root, "workspace");
  const outside = path.join(root, "outside");
  const escape = path.join(workspace, "escape");
  const dshHome = path.join(root, "isolated-dsh-home");
  const cliPath = path.join(process.cwd(), "scripts", "better-harness.mjs");
  try {
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(outside, { recursive: true }),
      mkdir(dshHome, { recursive: true }),
    ]);
    await symlink(outside, escape, "dir");
    await assert.rejects(
      execFileAsync(process.execPath, [
        cliPath,
        "agent-lint",
        "--workspace",
        workspace,
        "--cwd",
        escape,
        "--profile",
        "agent-assets-review",
        "--provider",
        "dsh",
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

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  collectAgentInstructionGraph,
  discoverAgentEntrypoints,
  runAgentLint,
} from "../../scripts/agent-lint/index.mjs";
import { resolveWorkspaceTopology } from "../../scripts/workspace-topology/index.mjs";

function git(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : os.devNull,
      GIT_CONFIG_NOSYSTEM: "1",
      XDG_CONFIG_HOME: path.join(cwd, ".git-test-xdg"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed\n${result.stderr}`);
  }
}

async function writeFixtureFile(root, route, content) {
  const absolute = path.join(root, ...route.split("/"));
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
}

async function makeMonorepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-lint-topology-"));
  const files = {
    "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
    "AGENTS.md": "# Root agents\n",
    "CLAUDE.md": "# Root Claude\n",
    "CLAUDE.local.md": "# Root local Claude\n",
    "QWEN.md": "# Root Qwen\n",
    ".claude/rules/root.mdc": "# Root Claude rule\n",
    ".cursor/rules/root.md": "# Root Cursor rule\n",
    ".github/copilot-instructions.md": "# Root Copilot instructions\n",
    ".github/instructions/backend.instructions.md": "---\napplyTo: packages/a/**\n---\n# Backend\n",
    ".qoder/rules/root.md": "# Root Qoder rule\n",
    ".qoder/rules/root.mdc": "# Root Qoder mdc rule\n",
    ".ci/AGENTS.md": "# CI agents\n",
    "packages/a/package.json": JSON.stringify({ name: "a" }),
    "packages/a/AGENTS.md": "# Package A agents\n\n[Missing](missing.md)\n",
    "packages/a/CLAUDE.md": "# Package A Claude\n",
    "packages/a/.claude/rules/local.md": "# Package A Claude rule\n",
    "packages/a/.cursor/rules/local.mdc": "# Package A Cursor rule\n",
    "packages/a/.qoder/rules/local.md": "# Package A Qoder rule\n",
    "packages/a/.qoder/rules/local.mdc": "# Package A Qoder mdc rule\n",
    "packages/a/src/AGENTS.md": "# Package A source agents\n",
    "packages/b/package.json": JSON.stringify({ name: "b" }),
    "packages/b/AGENTS.md": "# Package B agents\n",
  };

  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test User"]);
  for (const [route, content] of Object.entries(files)) {
    await writeFixtureFile(root, route, content);
  }
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "fixture"]);
  return root;
}

function byRoute(entrypoints, route) {
  return entrypoints.find((entrypoint) => entrypoint.relativePath === route);
}

test("topology-backed root discovery inventories provider scopes without a nested filesystem walk", async () => {
  const repo = await makeMonorepo();
  try {
    const { topology } = await resolveWorkspaceTopology({ workspace: repo });
    await writeFixtureFile(repo, "packages/late/AGENTS.md", "# Added after topology resolution\n");

    const entrypoints = await discoverAgentEntrypoints({
      workspace: path.join(repo, "packages/a"),
      provider: "qoder",
      topology,
    });
    const routes = entrypoints.map((entrypoint) => entrypoint.relativePath);

    assert.ok(routes.includes("AGENTS.md"));
    assert.ok(routes.includes(".ci/AGENTS.md"));
    assert.ok(routes.includes("packages/a/AGENTS.md"));
    assert.ok(routes.includes("packages/b/AGENTS.md"));
    assert.ok(routes.includes("packages/a/.qoder/rules/local.md"));
    assert.ok(routes.includes("packages/a/.qoder/rules/local.mdc"));
    assert.ok(routes.includes(".qoder/rules/root.mdc"));
    assert.ok(!routes.includes("CLAUDE.md"));
    assert.ok(!routes.includes(".claude/rules/root.mdc"));
    assert.ok(!routes.includes(".cursor/rules/root.md"));
    assert.ok(!routes.includes(".github/copilot-instructions.md"));
    assert.ok(!routes.includes("packages/late/AGENTS.md"));
    assert.equal(byRoute(entrypoints, "AGENTS.md").activation, "effective");
    assert.equal(byRoute(entrypoints, "packages/a/AGENTS.md").activation, "candidate");
    assert.equal(byRoute(entrypoints, "packages/a/AGENTS.md").packageRoute, "packages/a");
    assert.equal(byRoute(entrypoints, ".ci/AGENTS.md").packageRoute, ".");

    const claudeRoutes = (await discoverAgentEntrypoints({
      workspace: path.join(repo, "packages/a"),
      provider: "claude",
      topology,
    })).map((entrypoint) => entrypoint.relativePath);
    assert.ok(claudeRoutes.includes("CLAUDE.md"));
    assert.ok(claudeRoutes.includes("CLAUDE.local.md"));
    assert.ok(claudeRoutes.includes(".claude/rules/root.mdc"));
    assert.ok(claudeRoutes.includes("packages/a/.claude/rules/local.md"));
    assert.ok(!claudeRoutes.includes(".cursor/rules/root.md"));

    const cursorRoutes = (await discoverAgentEntrypoints({
      workspace: path.join(repo, "packages/a"),
      provider: "cursor",
      topology,
    })).map((entrypoint) => entrypoint.relativePath);
    assert.ok(cursorRoutes.includes(".cursor/rules/root.md"));
    assert.ok(cursorRoutes.includes("packages/a/.cursor/rules/local.mdc"));
    assert.ok(cursorRoutes.includes(".github/copilot-instructions.md"));
    assert.ok(!cursorRoutes.includes("CLAUDE.local.md"));

    const qwenRoutes = (await discoverAgentEntrypoints({
      workspace: path.join(repo, "packages/a"),
      provider: "qwen",
      topology,
    })).map((entrypoint) => entrypoint.relativePath);
    assert.ok(qwenRoutes.includes("AGENTS.md"));
    assert.ok(qwenRoutes.includes("QWEN.md"));

    const copilotRoutes = (await discoverAgentEntrypoints({
      workspace: path.join(repo, "packages/a"),
      provider: "copilot",
      topology,
    })).map((entrypoint) => entrypoint.relativePath);
    assert.ok(copilotRoutes.includes("AGENTS.md"));
    assert.ok(copilotRoutes.includes(".github/copilot-instructions.md"));
    assert.ok(copilotRoutes.includes(".github/instructions/backend.instructions.md"));

    const piRoutes = (await discoverAgentEntrypoints({
      workspace: path.join(repo, "packages/a"),
      provider: "pi",
      topology,
    })).map((entrypoint) => entrypoint.relativePath);
    assert.ok(piRoutes.includes("AGENTS.md"));
    assert.ok(!piRoutes.includes("CLAUDE.md"));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("topology-backed path discovery keeps ancestor and target scopes while excluding siblings", async () => {
  const repo = await makeMonorepo();
  try {
    const { topology } = await resolveWorkspaceTopology({
      workspace: path.join(repo, "packages/a"),
    });
    const graph = await collectAgentInstructionGraph({
      workspace: path.join(repo, "packages/a"),
      provider: "qoder",
      topology,
    });
    const routes = graph.entrypoints.map((entrypoint) => entrypoint.relativePath);

    assert.equal(graph.workspace, topology.gitRoot);
    assert.ok(routes.includes("AGENTS.md"));
    assert.ok(routes.includes(".qoder/rules/root.md"));
    assert.ok(routes.includes("packages/a/AGENTS.md"));
    assert.ok(routes.includes("packages/a/src/AGENTS.md"));
    assert.ok(routes.includes("packages/a/.qoder/rules/local.md"));
    assert.ok(!routes.includes(".ci/AGENTS.md"));
    assert.ok(!routes.includes("packages/b/AGENTS.md"));
    assert.ok(!routes.includes("CLAUDE.md"));

    const local = byRoute(graph.entrypoints, "packages/a/AGENTS.md");
    assert.equal(local.activation, "candidate");
    assert.equal(local.packageRoute, "packages/a");
    const localDocument = graph.documents.find((document) => document.relativePath === "packages/a/AGENTS.md");
    assert.equal(localDocument.activation, "candidate");
    assert.equal(localDocument.packageRoute, "packages/a");

    const review = await runAgentLint({
      workspace: path.join(repo, "packages/a"),
      provider: "qoder",
      profile: "agents-md-review",
      topology,
    });
    const rootFinding = review.findings.find((finding) => finding.file === "AGENTS.md");
    const packageFinding = review.findings.find((finding) => finding.file === "packages/a/AGENTS.md");
    assert.equal(rootFinding?.ownerRoute, ".");
    assert.equal(rootFinding?.packageRoute, ".");
    assert.equal(packageFinding?.ownerRoute, "packages/a");
    assert.equal(packageFinding?.packageRoute, "packages/a");
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

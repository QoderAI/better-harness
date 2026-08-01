import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { main as topologyMain, parseArgs as parseTopologyArgs } from "../scripts/workspace-topology/cli.mjs";
import {
  WORKSPACE_TOPOLOGY_KIND,
  findingTargetErrors,
  findingTargetFromTopology,
  ownerRouteForPath,
  resolveWorkspaceTopology,
  validateWorkspaceTopology,
} from "../scripts/workspace-topology/index.mjs";

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
  return result.stdout.trim();
}

async function writeFixtureFile(root, route, content = "") {
  const absolute = path.join(root, ...route.split("/"));
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
}

async function makeGitRepo(files, afterCommit = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-topology-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test User"]);
  for (const [route, content] of Object.entries(files)) {
    await writeFixtureFile(root, route, content);
  }
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "fixture"]);
  for (const [route, content] of Object.entries(afterCommit)) {
    await writeFixtureFile(root, route, content);
  }
  return root;
}

function memberRoutes(result) {
  return result.topology.members.items.map((member) => member.route);
}

test("workspace topology resolves manifest members, instruction scopes, ignored files, and package targets", async () => {
  const repo = await makeGitRepo({
    ".gitignore": ".build/\nout*/\n",
    "package.json": JSON.stringify({
      workspaces: ["packages/*", "!packages/excluded"],
    }),
    "AGENTS.md": "# root\n",
    "CLAUDE.local.md": "# root local Claude\n",
    "QWEN.md": "# root Qwen\n",
    ".claude/rules/root.mdc": "# root Claude rule\n",
    ".cursor/rules/root.md": "# root Cursor rule\n",
    ".qoder/rules/root.mdc": "# root Qoder rule\n",
    ".github/copilot-instructions.md": "# root Copilot instructions\n",
    ".github/instructions/backend.instructions.md": "---\napplyTo: src/**\n---\n# backend\n",
    ".ci/AGENTS.md": "# operational scope\n",
    "packages/a/package.json": JSON.stringify({ name: "a" }),
    "packages/a/AGENTS.md": "# package a\n",
    "packages/a/.claude/rules/local.md": "# package Claude rule\n",
    "packages/a/.cursor/rules/local.mdc": "# package Cursor rule\n",
    "packages/a/.qoder/rules/local.mdc": "# package Qoder rule\n",
    "packages/a/src/index.ts": "export const a = true;\n",
    "packages/b/package.json": JSON.stringify({ name: "b" }),
    "packages/excluded/package.json": JSON.stringify({ name: "excluded" }),
    "extensions/chat/AGENTS.md": "# convention member\n",
    "src/product/AGENTS.md": "# product member\n",
    "cli/AGENTS.md": "# cli member\n",
    "build/source.ts": "export const trackedBuildSource = true;\n",
  }, {
    ".build/extensions/chat/AGENTS.md": "# ignored copy\n",
    "out-build/packages/a/AGENTS.md": "# ignored output\n",
    "packages/c/package.json": JSON.stringify({ name: "c" }),
    "packages/c/AGENTS.md": "# untracked package\n",
  });

  try {
    const rootResult = await resolveWorkspaceTopology({ workspace: repo });
    assert.equal(rootResult.topology.kind, WORKSPACE_TOPOLOGY_KIND);
    assert.equal(rootResult.topology.status, "complete");
    assert.equal(rootResult.topology.target.kind, "repo-root");
    assert.deepEqual(memberRoutes(rootResult), [
      "cli",
      "extensions/chat",
      "packages/a",
      "packages/b",
      "packages/c",
      "src/product",
    ]);
    assert.ok(!memberRoutes(rootResult).includes(".ci"));
    assert.ok(!memberRoutes(rootResult).includes("packages/excluded"));
    assert.ok(rootResult.inventory.items.some((item) =>
      item.route === "build/source.ts" && item.provenance === "tracked"));
    assert.ok(rootResult.inventory.items.some((item) =>
      item.route === "packages/c/package.json" && item.provenance === "untracked"));
    assert.ok(rootResult.inventory.items.every((item) =>
      !item.route.startsWith(".build/") && !item.route.startsWith("out-build/")));
    assert.ok(rootResult.topology.instructionScopes.items.some((item) =>
      item.route === "AGENTS.md" && item.provider === "qoder" && item.activation === "effective"));
    assert.ok(rootResult.topology.instructionScopes.items.some((item) =>
      item.route === "packages/a/AGENTS.md"
      && item.provider === "qoder"
      && item.activation === "candidate"));
    for (const [route, provider] of [
      ["CLAUDE.local.md", "claude"],
      ["QWEN.md", "qwen"],
      [".claude/rules/root.mdc", "claude"],
      [".cursor/rules/root.md", "cursor"],
      [".qoder/rules/root.mdc", "qoder"],
      [".github/copilot-instructions.md", "cursor"],
      [".github/copilot-instructions.md", "copilot"],
      [".github/instructions/backend.instructions.md", "copilot"],
      ["packages/a/.claude/rules/local.md", "claude"],
      ["packages/a/.cursor/rules/local.mdc", "cursor"],
      ["packages/a/.qoder/rules/local.mdc", "qoder"],
    ]) {
      assert.ok(rootResult.topology.instructionScopes.items.some((item) =>
        item.route === route && item.provider === provider), `${provider}:${route}`);
    }
    for (const provider of ["qwen", "copilot", "pi"]) {
      assert.ok(rootResult.topology.instructionScopes.items.some((item) =>
        item.route === "AGENTS.md" && item.provider === provider && item.activation === "effective"));
    }

    const packageResult = await resolveWorkspaceTopology({
      workspace: path.join(repo, "packages/a"),
    });
    assert.deepEqual(packageResult.topology.target, {
      kind: "workspace-member",
      route: "packages/a",
      memberRoute: "packages/a",
      memberMatch: "exact",
    });
    assert.deepEqual(packageResult.analysisScope, {
      kind: "path",
      route: "packages/a",
      pathspecs: [":(top,literal)packages/a"],
    });
    assert.equal(ownerRouteForPath(packageResult.topology, "packages/a/src/index.ts"), "packages/a");
    assert.equal(ownerRouteForPath(packageResult.topology, "packages/b/package.json"), "packages/b");
    const findingTarget = findingTargetFromTopology(packageResult.topology);
    assert.deepEqual(findingTarget, {
      kind: "workspace-member",
      packageRoute: "packages/a",
      ownerRoute: "packages/a",
    });
    assert.deepEqual(findingTargetErrors(findingTarget, {
      topology: packageResult.topology,
      required: true,
    }), []);
    assert.throws(
      () => findingTargetFromTopology(packageResult.topology, { ownerRoute: null }),
      /ownerRoute is required/u,
    );
    assert.match(findingTargetErrors({
      ...findingTarget,
      ownerRoute: "packages/b",
    }, {
      topology: packageResult.topology,
    }).join("; "), /outside the frozen target route/u);
    assert.match(findingTargetErrors({
      ...findingTarget,
      ownerRoute: ".",
    }, {
      topology: rootResult.topology,
    }).join("; "), /kind does not match/u);
    validateWorkspaceTopology(packageResult.topology);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("finding target rejects traversal and cross-package topology mismatches", () => {
  assert.match(findingTargetErrors(null).join("; "), /must be an object/u);
  assert.match(findingTargetErrors({
    kind: "workspace-member",
    packageRoute: "packages/a",
    ownerRoute: null,
  }, {
    requireOwnerRoute: true,
  }).join("; "), /ownerRoute is required/u);

  const target = {
    kind: "workspace-member",
    packageRoute: "../packages/a",
    ownerRoute: "packages/a",
  };
  assert.match(findingTargetErrors(target).join("; "), /must not escape its root/u);

  const topology = {
    kind: WORKSPACE_TOPOLOGY_KIND,
    schemaVersion: 1,
    status: "complete",
    requestedWorkspace: path.resolve("packages/b"),
    gitRoot: path.resolve("."),
    target: {
      kind: "workspace-member",
      route: "packages/b",
      memberRoute: "packages/b",
      memberMatch: "exact",
    },
    members: {
      items: [
        { route: "packages/a", kind: "manifest", discoveredBy: ["package.json"] },
        { route: "packages/b", kind: "manifest", discoveredBy: ["package.json"] },
      ],
      total: 2,
      omitted: 0,
      truncated: false,
    },
    instructionScopes: { items: [], total: 0, omitted: 0, truncated: false },
    discovery: {
      tracked: 1,
      untracked: 0,
      scanned: 1,
      omitted: 0,
      truncated: false,
      warnings: [],
    },
  };
  assert.match(findingTargetErrors({
    kind: "workspace-member",
    packageRoute: "packages/a",
    ownerRoute: "packages/a",
  }, { topology }).join("; "), /packageRoute does not match/u);
});

test("workspace topology rejects a target route that does not identify the requested workspace", async () => {
  const resolved = await resolveWorkspaceTopology({ workspace: process.cwd() });
  const mismatched = structuredClone(resolved.topology);
  mismatched.target = {
    kind: "repo-subtree",
    route: "scripts",
    memberRoute: null,
    memberMatch: "none",
  };
  assert.throws(
    () => validateWorkspaceTopology(mismatched),
    /target\.route must resolve from gitRoot to requestedWorkspace/u,
  );
});

test("workspace topology combines pnpm, Go, and Cargo members with exclusions", async () => {
  const repo = await makeGitRepo({
    "pnpm-workspace.yaml": "packages:\n  - 'web/*'\n",
    "web/app/package.json": JSON.stringify({ name: "web-app" }),
    "go.work": "go 1.23\n\nuse (\n  ./go/service\n)\n",
    "go/service/go.mod": "module example.com/service\n",
    "Cargo.toml": "[workspace]\nmembers = [\"crates/*\"]\nexclude = [\"crates/excluded\"]\n",
    "crates/core/Cargo.toml": "[package]\nname = \"core\"\nversion = \"0.1.0\"\n",
    "crates/excluded/Cargo.toml": "[package]\nname = \"excluded\"\nversion = \"0.1.0\"\n",
  });

  try {
    const result = await resolveWorkspaceTopology({ workspace: repo });
    assert.deepEqual(memberRoutes(result), [
      "crates/core",
      "go/service",
      "web/app",
    ]);
    assert.equal(result.topology.members.items.find((member) => member.route === "crates/core").kind, "manifest");
    assert.ok(result.topology.members.items.find((member) =>
      member.route === "go/service").discoveredBy.some((source) => source === "go.work"));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("workspace topology ignores escaping workspace patterns and reports partial coverage", async () => {
  const repo = await makeGitRepo({
    "package.json": JSON.stringify({
      workspaces: ["packages/*", "../outside/*"],
    }),
    "packages/app/package.json": JSON.stringify({ name: "app" }),
  });

  try {
    const result = await resolveWorkspaceTopology({ workspace: repo });
    assert.deepEqual(memberRoutes(result), ["packages/app"]);
    assert.equal(result.topology.status, "partial");
    assert.ok(result.topology.discovery.warnings.some((item) =>
      item.code === "workspace-pattern-outside-root" && item.route === "package.json"));
    assert.match(findingTargetErrors({
      kind: "repo-root",
      packageRoute: null,
      ownerRoute: ".",
    }, { topology: result.topology }).join("; "), /requires complete workspace topology/u);
    assert.throws(
      () => findingTargetFromTopology(result.topology),
      (error) => error?.code === "INVALID_FINDING_TARGET"
        && /requires complete workspace topology/u.test(error.message),
    );
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("workspace topology distinguishes repo subtrees and standalone targets", async () => {
  const repo = await makeGitRepo({
    "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
    "packages/app/package.json": JSON.stringify({ name: "app" }),
    "docs/guide.md": "# Guide\n",
  });
  const standalone = await mkdtemp(path.join(os.tmpdir(), "better-harness-standalone-"));
  await writeFixtureFile(standalone, "src/index.ts", "export const value = true;\n");

  try {
    const subtree = await resolveWorkspaceTopology({ workspace: path.join(repo, "docs") });
    assert.deepEqual(subtree.topology.target, {
      kind: "repo-subtree",
      route: "docs",
      memberRoute: null,
      memberMatch: "none",
    });

    const isolated = await resolveWorkspaceTopology({ workspace: standalone });
    assert.equal(isolated.topology.gitRoot, null);
    assert.equal(isolated.topology.target.kind, "standalone");
    assert.deepEqual(isolated.analysisScope, { kind: "repo", route: ".", pathspecs: [] });
    assert.equal(isolated.topology.discovery.inventoryMode, "filesystem-fallback");
  } finally {
    await rm(repo, { recursive: true, force: true });
    await rm(standalone, { recursive: true, force: true });
  }
});

test("workspace topology preserves target ownership while reporting bounded inventory", async () => {
  const repo = await makeGitRepo({
    "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
    "aaa.txt": "a\n",
    "bbb.txt": "b\n",
    "packages/late/package.json": JSON.stringify({ name: "late" }),
    "packages/late/src/index.ts": "export const late = true;\n",
  });

  try {
    const result = await resolveWorkspaceTopology({
      workspace: path.join(repo, "packages/late"),
      maxFiles: 2,
    });
    assert.equal(result.topology.status, "partial");
    assert.equal(result.topology.discovery.truncated, true);
    assert.ok(result.topology.discovery.omitted > 0);
    assert.ok(result.inventory.items.length <= 2);
    assert.equal(
      result.topology.discovery.scanned + result.topology.discovery.omitted,
      result.topology.discovery.tracked + result.topology.discovery.untracked,
    );
    assert.ok(result.topology.discovery.warnings.some((item) =>
      item.code === "inventory-count-lower-bound"));
    assert.equal(result.topology.target.memberRoute, "packages/late");
    assert.ok(memberRoutes(result).includes("packages/late"));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("workspace topology resolves a symlinked package through its real path", async () => {
  const repo = await makeGitRepo({
    "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
    "packages/app/package.json": JSON.stringify({ name: "app" }),
  });
  const links = await mkdtemp(path.join(os.tmpdir(), "better-harness-topology-links-"));
  const link = path.join(links, "app-link");
  await symlink(path.join(repo, "packages/app"), link, "dir");

  try {
    const result = await resolveWorkspaceTopology({ workspace: link });
    assert.equal(result.topology.requestedWorkspace, await realpath(path.join(repo, "packages/app")));
    assert.equal(result.topology.target.memberRoute, "packages/app");
  } finally {
    await rm(repo, { recursive: true, force: true });
    await rm(links, { recursive: true, force: true });
  }
});

test("workspace topology accepts a contained tracked structural symlink", async (t) => {
  const repo = await makeGitRepo({
    "AGENTS.md": "# canonical instructions\n",
  });
  try {
    try {
      await symlink("AGENTS.md", path.join(repo, "CLAUDE.md"));
    } catch (error) {
      t.skip(`symlink unavailable: ${error.message}`);
      return;
    }
    git(repo, ["add", "CLAUDE.md"]);
    git(repo, ["commit", "-q", "-m", "add contained structural symlink fixture"]);

    const result = await resolveWorkspaceTopology({ workspace: repo });

    assert.equal(result.topology.status, "complete");
    assert.ok(result.topology.instructionScopes.items.some((item) =>
      item.route === "CLAUDE.md" && item.provider === "claude" && item.activation === "effective"));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("workspace topology does not follow a tracked structural symlink outside the Git root", async () => {
  const repo = await makeGitRepo({
    "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
    "packages/app/package.json": JSON.stringify({ name: "app" }),
  });
  const outside = await mkdtemp(path.join(os.tmpdir(), "better-harness-topology-outside-"));
  await writeFixtureFile(outside, "package.json", JSON.stringify({ name: "outside" }));
  await mkdir(path.join(repo, "packages", "escape"), { recursive: true });
  await symlink(
    path.join(outside, "package.json"),
    path.join(repo, "packages", "escape", "package.json"),
  );
  git(repo, ["add", "packages/escape/package.json"]);
  git(repo, ["commit", "-q", "-m", "add structural symlink fixture"]);

  try {
    const result = await resolveWorkspaceTopology({ workspace: repo });
    assert.equal(memberRoutes(result).includes("packages/escape"), false);
    assert.equal(result.topology.status, "partial");
    assert.ok(result.topology.discovery.warnings.some((item) =>
      item.code === "structure-entry-unsafe" && item.route === "packages/escape/package.json"));
  } finally {
    await rm(repo, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("workspace topology CLI help avoids probing and JSON output is parser-safe", async () => {
  let called = false;
  let help = "";
  const helpStatus = await topologyMain(["--help"], {
    resolveWorkspaceTopology: async () => {
      called = true;
      throw new Error("must not run");
    },
    stdout: { write: (value) => { help += value; } },
  });
  assert.equal(helpStatus, 0);
  assert.equal(called, false);
  assert.match(help, /--workspace/);

  assert.deepEqual(parseTopologyArgs(["--json=false", "--help=true"]), {
    json: false,
    help: true,
  });
  assert.throws(
    () => parseTopologyArgs(["--json=1"]),
    (error) => error.code === "INVALID_BOOLEAN_OPTION",
  );

  let falseFlagOutput = "";
  const falseFlagStatus = await topologyMain([
    "--workspace", "/unused",
    "--json=false",
    "--help=false",
  ], {
    resolveWorkspaceTopology: async () => ({
      topology: {
        status: "complete",
        target: { kind: "standalone", route: "." },
        gitRoot: null,
        members: { items: [], total: 0 },
        instructionScopes: { items: [], total: 0 },
        discovery: { inventoryMode: "filesystem", scanned: 0, omitted: 0 },
      },
      analysisScope: { kind: "repo", route: "." },
    }),
    stdout: { write: (value) => { falseFlagOutput += value; } },
  });
  assert.equal(falseFlagStatus, 0);
  assert.match(falseFlagOutput, /^Workspace topology: complete/u);

  const repo = await makeGitRepo({ "README.md": "# fixture\n" });
  try {
    const result = spawnSync(process.execPath, [
      path.join(process.cwd(), "scripts/workspace-topology/cli.mjs"),
      "--workspace",
      repo,
      "--json",
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.topology.target.kind, "repo-root");
    assert.equal(parsed.analysisScope.kind, "repo");
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

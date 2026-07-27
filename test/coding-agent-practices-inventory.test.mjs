import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { collectQoderInventory } from "../scripts/coding-agent-practices/inventory.mjs";

const execFileAsync = promisify(execFile);

async function writeText(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

async function writeJson(filePath, value) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function makeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-assets-"));
  const workspace = path.join(root, "workspace", "demo");
  const qoderHome = path.join(root, ".qoder");
  const sharedCache = path.join(root, "SharedClientCache", "cache");

  await writeText(path.join(workspace, ".qoder", "rules", "always.md"), "# Always\n");
  await writeText(path.join(workspace, "AGENTS.md"), "# Project Agent Rules\n");
  await writeText(path.join(workspace, "DESIGN.md"), "# Product Design Contract\n");
  await writeText(path.join(workspace, ".qoder", "skills", "local-skill", "SKILL.md"), "---\nname: local-skill\ndescription: local\n---\n");
  await writeText(path.join(workspace, ".agents", "skills", "mirror", "SKILL.md"), "---\nname: mirror\ndescription: mirrored\n---\n");
  await writeJson(path.join(workspace, ".qoder", "settings.json"), {
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./check.js" }] }] },
  });
  await writeText(path.join(workspace, "check.js"), "process.exit(0);\n");
  await writeJson(path.join(workspace, ".qoder", "mcp.json"), {
    mcpServers: { fetch: { type: "sse", url: "https://example.invalid/sse" } },
  });
  await writeText(path.join(workspace, ".qoder", "workflows", "review.yml"), "name: review\n");

  await writeText(path.join(qoderHome, "skills", "global-skill", "SKILL.md"), "---\nname: global-skill\ndescription: global\n---\n");
  await writeText(path.join(qoderHome, "hooks", "check-command.js"), "process.exit(0);\n");
  await writeText(path.join(qoderHome, "commands", "ship.md"), "ship it\n");
  await writeText(path.join(qoderHome, "agents", "reviewer.md"), "---\nname: reviewer\n---\nReview code.\n");
  await writeJson(path.join(qoderHome, "settings.json"), {
    hooks: { Stop: [{ hooks: [{ type: "command", command: "~/.qoder/hooks/check-command.js" }] }] },
  });
  const paperRoot = path.join(qoderHome, "plugins", "cache", "local", "paper", "1.0.0");
  await writeJson(path.join(qoderHome, "plugins", "installed_plugins_v2.json"), {
    plugins: {
      "paper@local": [{ scope: "user", installPath: paperRoot, version: "1.0.0" }],
    },
  });
  await writeJson(path.join(paperRoot, ".qoder-plugin", "plugin.json"), {
    name: "paper",
    version: "1.0.0",
    skills: "./skills/",
  });
  await writeText(
    path.join(paperRoot, "skills", "paper", "SKILL.md"),
    "---\nname: paper\ndescription: paper plugin\n---\n",
  );
  await writeText(
    path.join(qoderHome, "memories", "demo", "global", "user_communication", "memory.md"),
    "private memory secret should not appear\n",
  );

  await writeJson(path.join(sharedCache, "app-config.json"), {
    "memory.fetch.enable": false,
    "memory.retrieve.enable": false,
    "memory.file_memory.prompt.enabled": true,
    unrelated: "ignored",
  });
  await writeText(path.join(sharedCache, "db", "local.db"), "");

  return { root, workspace, qoderHome, sharedCache };
}

async function makeCodexFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-assets-codex-"));
  const workspace = path.join(root, "workspace", "demo");
  const codexHome = path.join(root, ".codex");
  const codexAppPath = path.join(root, "Applications", "Codex.app");

  await writeText(
    path.join(workspace, ".codex", "skills", "project-skill", "SKILL.md"),
    "---\nname: project-skill\ndescription: project\n---\n",
  );
  await writeJson(path.join(workspace, ".codex", "hooks.json"), {
    hooks: { Stop: [{ hooks: [{ type: "command", command: "./check-stop.sh" }] }] },
  });

  await writeText(
    path.join(codexHome, "skills", "global-skill", "SKILL.md"),
    "---\nname: global-skill\ndescription: global\n---\n",
  );
  await writeJson(path.join(codexHome, "hooks.json"), {
    hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "~/.codex/guard.sh" }] }] },
  });
  await writeText(path.join(codexHome, "memories", "MEMORY.md"), "private codex memory secret should not appear\n");
  await writeText(path.join(codexHome, "memories", "rollout_summaries", "summary.md"), "also private\n");
  await writeText(
    path.join(codexHome, "config.toml"),
    "[features]\nmemories = true\n\n[memories]\nuse_memories = false\n",
  );

  const pluginParent = path.join(codexHome, "plugins", "cache", "openai-curated-remote", "data-analytics");
  const pluginRoot = path.join(pluginParent, "0.1.0");
  await writeJson(path.join(pluginParent, ".codex-remote-plugin-install.json"), {
    remote_plugin_id: "plugin_data_123",
  });
  await writeJson(path.join(pluginRoot, ".codex-plugin", "plugin.json"), {
    name: "data-analytics",
    version: "0.1.0",
    interface: { displayName: "Data Analytics" },
    skills: "./skills/",
  });
  await writeText(
    path.join(pluginRoot, "skills", "build-dashboard", "SKILL.md"),
    "---\nname: build-dashboard\ndescription: dashboard\n---\n",
  );
  await mkdir(codexAppPath, { recursive: true });

  return { root, workspace, codexHome, codexAppPath };
}

test("Qoder global inventory separates project, user, plugin, session, and memory evidence", async () => {
  const fixture = await makeFixture();

  try {
    const result = await collectQoderInventory({
      platform: "qoder",
      workspace: fixture.workspace,
      qoderHome: fixture.qoderHome,
      includeUserHome: true,
      includeMemories: true,
      sharedCache: fixture.sharedCache,
    });

    assert.equal(result.scope.platform, "qoder");
    assert.equal(result.summary.projectAssets, 5);
    assert.equal(result.summary.userAssets, 4);
    assert.equal(result.summary.pluginAssets, 2);
    assert.equal(result.summary.memories, 2);

    assert.ok(result.surfaces.some((surface) => surface.id === "project-qoder-hooks"));
    assert.equal(
      result.surfaces.find((surface) => surface.id === "project-qoder-hooks")?.items[0]?.scriptPath,
      path.join(fixture.workspace, "check.js"),
    );
    assert.ok(
      result.surfaces.some(
        (surface) =>
          surface.id === "project-qoder-rules" &&
          surface.items.some((item) => item.name === "AGENTS.md" && item.sourceKind === "agents-md-compat") &&
          surface.items.some((item) => item.name === "DESIGN.md" && item.sourceKind === "design-md-contract"),
      ),
    );
    const rules = result.summary.practiceCoverageRows.find((row) => row.surface === "Rules");
    assert.equal(rules?.count, 3);
    assert.deepEqual(rules?.paths, [".qoder/rules/always.md", "AGENTS.md", "DESIGN.md"]);
    assert.ok(result.surfaces.some((surface) => surface.id === "user-qoder-hooks"));
    assert.ok(result.surfaces.some((surface) => surface.id === "plugin-qoder-skills"));
    assert.deepEqual(
      result.summary.practiceCoverageRows.find((row) => row.surface === "Hooks")?.scopes,
      ["Project", "Global"],
    );
    assert.deepEqual(
      result.summary.practiceCoverageRows.find((row) => row.surface === "MCP")?.scopes,
      ["Project"],
    );
    assert.deepEqual(
      result.summary.practiceCoverageRows.find((row) => row.surface === "Commands")?.scopes,
      ["Global"],
    );
    assert.deepEqual(
      result.summary.practiceCoverageRows.find((row) => row.surface === "Custom Agents")?.scopes,
      ["Global"],
    );
    assert.deepEqual(
      result.summary.practiceCoverageRows.find((row) => row.surface === "Workflows")?.scopes,
      ["Project"],
    );
    assert.ok(result.sessionSourceHints.some((hint) => hint.command.includes("session-analysis.mjs sources")));

    const memoryCategories = result.memories.categories.map((item) => item.category);
    assert.deepEqual(memoryCategories, ["user_communication"]);
    assert.deepEqual(
      result.memories.categories.map((item) => item.path && path.relative(fixture.root, item.path).replaceAll(path.sep, "/")),
      [".qoder/memories/demo/global/user_communication/memory.md"],
    );
    assert.ok(result.memories.configKeys.some((item) => item.key === "memory.fetch.enable" && item.value === false));
    assert.ok(result.memories.databaseFiles.some((item) => item.path.endsWith(path.join("db", "local.db"))));
    const memories = result.summary.practiceCoverageRows.find((row) => row.surface === "Memories");
    assert.deepEqual(memories?.scopes, ["Global"]);
    assert.equal(memories?.count, 1);
    assert.doesNotMatch(JSON.stringify(result), /private memory secret/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Qoder inventory can include effective global settings hooks without broad user-home inventory", async () => {
  const fixture = await makeFixture();

  try {
    const result = await collectQoderInventory({
      workspace: fixture.workspace,
      qoderHome: fixture.qoderHome,
      includeGlobalHooks: true,
      sharedCache: fixture.sharedCache,
    });

    const hooks = result.summary.practiceCoverageRows.find((row) => row.surface === "Hooks");
    assert.deepEqual(hooks?.scopes, ["Project", "Global"]);
    assert.equal(hooks?.count, 2);
    assert.ok(result.surfaces
      .find((surface) => surface.id === "user-qoder-hooks")
      ?.items.some((item) => item.path.endsWith(path.join(".qoder", "settings.json"))));
    assert.equal(
      result.summary.practiceCoverageRows.some((row) => row.surface === "MCP" && row.scopes.includes("Global")),
      false,
    );
    assert.equal(
      result.summary.practiceCoverageRows.some((row) => row.surface === "Skills" && row.scopes.includes("Global")),
      false,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Qoder inventory includes current-project memories without global capability scope", async () => {
  const fixture = await makeFixture();

  try {
    const workspaceSlug = path.resolve(fixture.workspace)
      .replace(/^[A-Za-z]:/u, "")
      .replace(/[\\/]+/gu, "-")
      .replace(/^-+|-+$/gu, "");
    await writeText(
      path.join(
        fixture.qoderHome,
        "memories",
        "account-1",
        "projects",
        workspaceSlug,
        "project_introduction",
        "memory.md",
      ),
      "private project memory should not appear\n",
    );

    const result = await collectQoderInventory({
      workspace: fixture.workspace,
      qoderHome: fixture.qoderHome,
      includeUserHome: false,
      includeMemories: true,
      sharedCache: fixture.sharedCache,
    });

    assert.deepEqual(result.memories.categories.map((item) => item.category), ["project_introduction"]);
    assert.deepEqual(result.memories.categories.map((item) => item.scope), ["Project"]);
    assert.deepEqual(
      result.memories.categories.map((item) => item.path && path.relative(fixture.root, item.path).replaceAll(path.sep, "/")),
      [`.qoder/memories/account-1/projects/${workspaceSlug}/project_introduction/memory.md`],
    );
    assert.deepEqual(result.memories.configKeys, []);
    assert.deepEqual(result.memories.databaseFiles, []);
    const memories = result.summary.practiceCoverageRows.find((row) => row.surface === "Memories");
    assert.deepEqual(memories?.scopes, ["Project"]);
    assert.equal(memories?.count, 1);
    assert.deepEqual(result.memories.categories[0].titleEntries.map((entry) => entry.title), ["memory"]);
    assert.equal(JSON.stringify(result.memories.categories).includes("titleEntries"), false);
    assert.doesNotMatch(JSON.stringify(result), /private project memory|private memory secret/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Qoder Plugin coverage excludes disabled installs and settings-only stale entries", async () => {
  const fixture = await makeFixture();

  try {
    await writeJson(path.join(fixture.qoderHome, "settings.json"), {
      enabledPlugins: {
        "paper@local": false,
        "ghost@local": true,
      },
      hooks: { Stop: [{ hooks: [{ type: "command", command: "~/.qoder/hooks/check-command.js" }] }] },
    });
    const result = await collectQoderInventory({
      workspace: fixture.workspace,
      qoderHome: fixture.qoderHome,
      includeUserHome: true,
      includeGlobalHooks: true,
      sharedCache: fixture.sharedCache,
    });

    assert.equal(result.summary.practiceCoverageRows.some((row) => row.surface === "Plugins"), false);
    assert.equal(result.customizeDiagnostics.installedPluginRecordCount, 1);
    assert.equal(result.customizeDiagnostics.disabledInstalledPluginCount, 1);
    assert.equal(result.customizeDiagnostics.unmatchedEnabledPluginSettingCount, 1);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Qoder inventory CLI emits JSON and markdown without raw memory content", async () => {
  const fixture = await makeFixture();

  try {
    const script = path.join(process.cwd(), "scripts/coding-agent-practices/inventory.mjs");
    const { stdout: jsonStdout } = await execFileAsync(process.execPath, [
      script,
      "qoder",
      "--workspace",
      fixture.workspace,
      "--qoder-home",
      fixture.qoderHome,
      "--include-user-home",
      "--include-memories",
      "--shared-cache",
      fixture.sharedCache,
      "--format",
      "json",
    ], {
      env: { ...process.env, HOME: fixture.root, USERPROFILE: fixture.root },
    });
    const json = JSON.parse(jsonStdout);
    assert.equal(json.summary.pluginAssets, 2);
    assert.ok(json.summary.practiceCoverageRows.every((row) => row.count > 0));
    assert.deepEqual(
      json.summary.practiceCoverageRows.find((row) => row.surface === "Plugins")?.paths,
      ["~/.qoder/plugins/cache/local/paper/1.0.0/.qoder-plugin/plugin.json"],
    );
    assert.doesNotMatch(jsonStdout, /private memory secret/);

    const { stdout: markdownStdout } = await execFileAsync(process.execPath, [
      script,
      "qoder",
      "--workspace",
      fixture.workspace,
      "--qoder-home",
      fixture.qoderHome,
      "--include-user-home",
      "--include-memories",
      "--shared-cache",
      fixture.sharedCache,
      "--format",
      "markdown",
    ]);
    assert.match(markdownStdout, /# Coding Agent Asset Inventory/);
    assert.match(markdownStdout, /User\/global assets/);
    assert.match(markdownStdout, /Memories/);
    assert.doesNotMatch(markdownStdout, /private memory secret/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Qoder inventory CLI keeps project Memory semantic scope while emitting a home-relative .md source", async () => {
  const fixture = await makeFixture();

  try {
    const workspaceSlug = path.resolve(fixture.workspace)
      .replace(/^[A-Za-z]:/u, "")
      .replace(/[\\/]+/gu, "-")
      .replace(/^-+|-+$/gu, "");
    await writeText(
      path.join(
        fixture.qoderHome,
        "memories",
        "account-1",
        "projects",
        workspaceSlug,
        "project_introduction",
        "memory.md",
      ),
      "private project memory should not appear\n",
    );

    const script = path.join(process.cwd(), "scripts/coding-agent-practices/inventory.mjs");
    const { stdout } = await execFileAsync(process.execPath, [
      script,
      "qoder",
      "--workspace",
      fixture.workspace,
      "--qoder-home",
      fixture.qoderHome,
      "--include-memories",
      "--shared-cache",
      fixture.sharedCache,
      "--format",
      "json",
    ], {
      env: {
        ...process.env,
        HOME: fixture.root,
        USERPROFILE: fixture.root,
      },
    });
    const json = JSON.parse(stdout);
    const memories = json.summary.practiceCoverageRows.find((row) => row.surface === "Memories");
    assert.deepEqual(memories?.scopes, ["Project"]);
    assert.equal(memories?.count, 1);
    assert.deepEqual(
      memories?.paths,
      [`~/.qoder/memories/account-1/projects/${workspaceSlug}/project_introduction/memory.md`],
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("inventory CLI resolves platform from --platform, --json, and bare invocation", async () => {
  const fixture = await makeFixture();
  const script = path.join(process.cwd(), "scripts/coding-agent-practices/inventory.mjs");
  const base = ["--workspace", fixture.workspace, "--qoder-home", fixture.qoderHome];

  try {
    // `--platform qoder` previously failed with `Unsupported platform: --platform`.
    const viaFlag = await execFileAsync(process.execPath, [script, "--platform", "qoder", ...base, "--json"]);
    assert.equal(JSON.parse(viaFlag.stdout).scope.platform, "qoder");

    // `--json` as the leading flag previously became the platform.
    const viaJson = await execFileAsync(process.execPath, [script, ...base, "--json"]);
    assert.equal(JSON.parse(viaJson.stdout).scope.platform, "qoder");

    // Bare invocation (no positional, no flags) defaults to qoder.
    const bare = await execFileAsync(process.execPath, [script, ...base]);
    assert.equal(JSON.parse(bare.stdout).scope.platform, "qoder");

    // Positional platform still works.
    const positional = await execFileAsync(process.execPath, [script, "qoder", ...base, "--json"]);
    assert.equal(JSON.parse(positional.stdout).scope.platform, "qoder");

    const help = await execFileAsync(process.execPath, [script, "--help"]);
    assert.match(help.stdout, /Usage: better-harness coding-agent-practices inventory/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Qoder inventory separates a SharedClientCache QODER_HOME from ~/.qoder assets", async () => {
  const fixture = await makeFixture();
  const script = path.join(process.cwd(), "scripts/coding-agent-practices/inventory.mjs");
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      script,
      "qoder",
      "--workspace",
      fixture.workspace,
      "--include-user-home",
      "--include-memories",
      "--json",
    ], {
      env: {
        ...process.env,
        HOME: fixture.root,
        USERPROFILE: fixture.root,
        QODER_HOME: path.dirname(fixture.sharedCache),
      },
    });
    const result = JSON.parse(stdout);
    assert.equal(result.scope.qoderHome, fixture.qoderHome);
    assert.equal(result.scope.sharedCache, fixture.sharedCache);
    assert.ok(result.summary.practiceCoverageRows.some((row) => row.surface === "Hooks" && row.scopes.includes("Global")));
    assert.ok(result.summary.practiceCoverageRows.some((row) => row.surface === "Memories" && row.scopes.includes("Global")));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("inventory CLI reports an unsupported platform with a usage hint", async () => {
  const script = path.join(process.cwd(), "scripts/coding-agent-practices/inventory.mjs");
  await assert.rejects(
    execFileAsync(process.execPath, [script, "bogus"]),
    (error) => {
      assert.match(error.stderr, /Unsupported platform: bogus/);
      assert.match(error.stderr, /Usage: better-harness coding-agent-practices inventory/);
      return true;
    },
  );
});

test("inventory CLI keeps Codex memory metadata separate from configured assets and raw content", async () => {
  const fixture = await makeCodexFixture();

  try {
    const script = path.join(process.cwd(), "scripts/coding-agent-practices/inventory.mjs");
    const { stdout } = await execFileAsync(process.execPath, [
      script,
      "codex",
      "--workspace",
      fixture.workspace,
      "--codex-home",
      fixture.codexHome,
      "--codex-app-path",
      fixture.codexAppPath,
      "--include-user-home",
      "--include-memories",
      "--format",
      "json",
    ], {
      env: { ...process.env, HOME: fixture.root, USERPROFILE: fixture.root },
    });
    const json = JSON.parse(stdout);
    assert.equal(json.scope.platform, "codex");
    assert.equal(json.summary.projectAssets, 2);
    assert.equal(json.summary.userAssets, 2);
    assert.equal(json.summary.pluginAssets, 2);
    assert.equal(json.summary.memories, 2);
    assert.ok(json.surfaces.some((surface) => surface.id === "project-codex-skills"));
    assert.ok(json.surfaces.some((surface) => surface.id === "user-codex-skills"));
    assert.ok(json.surfaces.some((surface) => surface.id === "plugin-codex-plugins"));
    assert.ok(json.surfaces.some((surface) => surface.id === "codex-memory-files"));
    assert.ok(json.surfaces.some((surface) => surface.id === "codex-memory-config"));
    assert.equal(json.memories.contentPolicy, "raw-memory-content-not-read");
    assert.ok(json.memories.categories.some((item) => item.category === "root"));
    assert.ok(json.memories.categories.some((item) => item.category === "rollout_summaries"));
    assert.equal(
      json.memories.categories.find((item) => item.category === "root")?.path,
      path.join(fixture.codexHome, "memories", "MEMORY.md"),
    );
    assert.equal(
      json.memories.categories.find((item) => item.category === "rollout_summaries")?.path,
      path.join(fixture.codexHome, "memories", "rollout_summaries", "summary.md"),
    );
    assert.ok(json.memories.configKeys.some((item) => item.key === "features.memories" && item.value === true));
    assert.ok(json.memories.configKeys.some((item) => item.key === "memories.use_memories" && item.value === false));
    assert.equal(json.warnings.length, 0);
    assert.doesNotMatch(JSON.stringify(json), /private codex memory secret/);
    assert.ok(json.sessionSourceHints.some((hint) => hint.command.includes("--platform codex")));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Codex inventory keeps user, Plugin, and Memory metadata closed without scope flags", async () => {
  const fixture = await makeCodexFixture();

  try {
    const script = path.join(process.cwd(), "scripts/coding-agent-practices/inventory.mjs");
    const { stdout } = await execFileAsync(process.execPath, [
      script,
      "codex",
      "--workspace",
      fixture.workspace,
      "--codex-home",
      fixture.codexHome,
      "--format",
      "json",
    ], {
      env: { ...process.env, HOME: fixture.root, USERPROFILE: fixture.root },
    });
    const json = JSON.parse(stdout);
    assert.equal(json.summary.userAssets, 0);
    assert.equal(json.summary.pluginAssets, 0);
    assert.equal(json.summary.memories, 0);
    assert.equal(json.customizeDiagnostics.installedPluginState, "not-authorized");
    assert.equal(json.surfaces.some((surface) => surface.scope === "user" || surface.scope === "plugin"), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

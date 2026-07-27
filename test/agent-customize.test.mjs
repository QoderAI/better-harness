import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  collectAgentCustomizeInventory,
  filterManageItems,
  groupManageItems,
  tabAvailableForScope,
} from "../scripts/agent-customize/index.mjs";
import { pluginMetadataEvidencePath } from "../scripts/agent-customize/core/items.mjs";
import { collectProviderInventory as collectPracticeInventory } from "../scripts/coding-agent-practices/inventory.mjs";

async function writeText(filePath, text) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text);
}

async function writeJson(filePath, value) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function workspaceProjectSlug(workspace) {
  return path
    .resolve(workspace)
    .split(path.sep)
    .filter(Boolean)
    .join("-")
    .replace(/[^A-Za-z0-9._-]/gu, "-");
}

function qoderWorkspaceSlug(workspace) {
  return path.resolve(workspace).replace(/[\\/]+/gu, "-");
}

test("plugin metadata evidence follows candidate precedence and preserves the root fallback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-plugin-evidence-"));

  try {
    const packageJson = path.join(root, "package.json");
    const manifest = path.join(root, ".sample-plugin", "plugin.json");
    const candidates = [[".sample-plugin", "plugin.json"], ["package.json"]];

    await writeJson(packageJson, { name: "sample" });
    assert.equal(await pluginMetadataEvidencePath(root, candidates), packageJson);

    await writeJson(manifest, { name: "sample" });
    assert.equal(await pluginMetadataEvidencePath(root, candidates), manifest);
    assert.equal(await pluginMetadataEvidencePath(root, [["missing.json"]]), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function makeCursorFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-customize-"));
  const cursorHome = path.join(root, ".cursor");
  const workspace = path.join(root, "workspace", "codex");

  const hexRoot = path.join(
    cursorHome,
    "plugins",
    "cache",
    "cursor-public",
    "hex",
    "abc123",
  );
  await writeText(path.join(hexRoot, "README.md"), "# Hex\n\nHex plugin.\n");
  await writeJson(path.join(hexRoot, ".cursor-plugin", "plugin.json"), {
    id: "hex-id",
    name: "hex",
    description: "Hex plugin",
  });
  await writeText(
    path.join(hexRoot, "skills", "hex-to-canvas", "SKILL.md"),
    "---\nname: hex-to-canvas\ndescription: Create Hex canvases.\n---\n",
  );
  await writeJson(path.join(hexRoot, "mcp.json"), {
    mcpServers: {
      hex: { command: "npx", args: ["-y", "@hex/mcp"] },
    },
  });
  await writeText(path.join(hexRoot, "rules", "ensure-hex.md"), "# Ensure Hex\n");
  await writeText(path.join(hexRoot, "commands", "hex-report.md"), "Build a Hex report.\n");
  await writeText(
    path.join(hexRoot, "agents", "hex-analyst.md"),
    "---\nname: hex-analyst\n---\nYou analyze Hex notebooks.\n",
  );
  await writeJson(path.join(hexRoot, "hooks.json"), {
    hooks: {
      postToolUse: [{ label: "Hex audit", command: "echo hex" }],
    },
  });

  const paperRoot = path.join(
    cursorHome,
    "plugins",
    "cache",
    "cursor-public",
    "paper-desktop",
    "def456",
  );
  await writeJson(path.join(paperRoot, "manifest.json"), {
    id: "paper-id",
    name: "paper-desktop",
    displayName: "Paper",
    description: "Paper design plugin",
  });

  const metaRoot = path.join(
    cursorHome,
    "plugins",
    "cache",
    "cursor-public",
    "meta-quest-agentic-tools",
    "ghi789",
  );
  await writeJson(path.join(metaRoot, ".cursor-plugin", "plugin.json"), {
    id: "meta-id",
    name: "meta-quest-agentic-tools",
    description: "Meta Quest project plugin",
  });
  await writeText(path.join(metaRoot, "README.md"), "# meta-quest/agentic-tools\n");

  await writeJson(path.join(cursorHome, "mcp.json"), {
    mcpServers: {
      userLinear: { command: "npx", args: ["-y", "@linear/mcp"] },
    },
  });
  await writeJson(path.join(workspace, ".cursor", "mcp.json"), {
    mcpServers: {
      workspaceDocs: { url: "https://example.invalid/mcp" },
    },
  });
  await writeText(path.join(workspace, ".cursor", "rules", "always.md"), "# Always Cursor\n");
  await writeText(path.join(workspace, "AGENTS.md"), "# Project Agent Rules\n");
  await writeText(path.join(workspace, "DESIGN.md"), "# Product Design Contract\n");
  await writeText(
    path.join(workspace, ".codex", "skills", "codex-bug", "SKILL.md"),
    "---\nname: internal-codex-bug\ndescription: Diagnose Codex bugs.\n---\n",
  );
  await writeText(
    path.join(workspace, ".git", "config"),
    "[remote \"origin\"]\n\turl = https://github.com/openai/codex.git\n",
  );
  await writeText(
    path.join(cursorHome, "skills", "sessions-diagnostics", "SKILL.md"),
    "---\nname: sessions-diagnostics\ndescription: Inspect sessions.\n---\n",
  );
  await writeText(
    path.join(cursorHome, "agents", "reviewer.md"),
    "---\nname: reviewer\n---\nReview code.\n",
  );
  await writeText(path.join(cursorHome, "commands", "summarize.md"), "Summarize.\n");
  await writeText(path.join(cursorHome, "rules", "tone.mdc"), "Be concise.\n");
  await writeJson(path.join(cursorHome, "hooks.json"), {
    hooks: {
      userPromptSubmit: [{ label: "Guard prompt", command: "echo guard" }],
    },
  });

  return { root, cursorHome, workspace };
}

async function makeQoderFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bh-qoder-"));
  const qoderHome = path.join(root, ".qoder");
  const sharedClientCacheRoot = path.join(root, "SharedClientCache");
  const workspace = path.join(root, "workspace");

  const betterHarnessRoot = path.join(
    qoderHome,
    "plugins",
    "cache",
    "local",
    "better-harness-plugin",
    "0.1.0",
  );
  await writeJson(path.join(betterHarnessRoot, ".qoder-plugin", "plugin.json"), {
    name: "better-harness-plugin",
    displayName: "Better Harness",
    version: "0.1.0",
    description: "Build an AI-ready engineering system.",
    author: { name: "Qoder" },
    skills: "./skills/",
    commands: {
      "better-harness-check": {
        source: "./commands/check.md",
        description: "Run a Better Harness check.",
      },
    },
    mcpServers: "./.mcp.json",
    hooks: "./.qoder-plugin/qoder-hooks.json",
  });
  await writeText(
    path.join(betterHarnessRoot, "skills", "better-harness", "SKILL.md"),
    "---\nname: harness\ndescription: Analyze AI readiness.\n---\n",
  );
  await writeText(path.join(betterHarnessRoot, "commands", "check.md"), "# Better Harness Check\n");
  await writeJson(path.join(betterHarnessRoot, ".mcp.json"), {
    mcpServers: {
      "better-harness": { command: "node", args: ["scripts/better-harness.mjs"] },
    },
  });
  await writeJson(path.join(betterHarnessRoot, ".qoder-plugin", "qoder-hooks.json"), {
    hooks: {
      PostToolUse: [
        {
          matcher: "*",
          hooks: [{ type: "command", command: "node hooks/better-harness.mjs" }],
        },
      ],
    },
  });

  const designRoot = path.join(
    qoderHome,
    "plugins",
    "cache",
    "qoder-marketplace",
    "design-review",
    "0.1.0",
  );
  await writeJson(path.join(designRoot, ".qoder-plugin", "plugin.json"), {
    name: "design-review",
    displayName: "Design Review",
    version: "0.1.0",
    description: "Review frontend design contracts.",
    interface: { displayName: "Design" },
    skills: "./skills/",
  });
  await writeText(
    path.join(designRoot, "skills", "design-qa", "SKILL.md"),
    "---\nname: design-qa\ndescription: Review design quality.\n---\n",
  );

  const cachedOnlyRoot = path.join(
    qoderHome,
    "plugins",
    "cache",
    "qoder-marketplace",
    "apollo",
    "1.0.0",
  );
  await writeJson(path.join(cachedOnlyRoot, ".qoder-plugin", "plugin.json"), {
    name: "apollo",
    displayName: "Apollo",
  });

  await writeJson(path.join(qoderHome, "plugins", "installed_plugins.json"), {
    plugins: {
      "design-review@qoder-marketplace": {
        installPath: designRoot,
        version: "0.1.0",
        scope: "user",
      },
      "better-harness-plugin@local": {
        installPath: betterHarnessRoot,
        version: "0.1.0",
        scope: "user",
      },
    },
  });
  await writeJson(path.join(qoderHome, "plugins", "installed_plugins_v2.json"), {
    version: 2,
    plugins: {
      "better-harness-plugin@local": [
        {
          scope: "user",
          installPath: betterHarnessRoot,
          version: "0.1.0",
          installedAt: "2026-06-23T07:15:07.153Z",
        },
        {
          scope: "local",
          installPath: betterHarnessRoot,
          version: "0.1.0",
          projectPath: workspace,
          installedAt: "2026-06-23T07:15:19.937Z",
        },
      ],
    },
  });

  await writeJson(path.join(qoderHome, "settings.json"), {
    enabledPlugins: {
      "design-review@qoder-marketplace": true,
      "better-harness-plugin@local": true,
      "apollo@qoder-marketplace": true,
    },
    hooks: {
      PreToolUse: [
        {
          matcher: "*",
          hooks: [{ type: "command", command: "bash ~/.qoder/hooks/guard-tool.sh" }],
        },
      ],
    },
  });
  await writeJson(path.join(workspace, ".qoder", "settings.json"), {
    hooks: {
      Stop: [
        {
          hooks: [{
            type: "command",
            command: "node hooks/check-stop.mjs",
            timeout: 1500,
            if: 'env.REVIEW_TOKEN == "private-value"',
            async: true,
          }],
        },
      ],
    },
  });
  await writeText(path.join(workspace, ".qoder", "rules", "always.md"), "# Always\n");
  await writeText(path.join(workspace, "AGENTS.md"), "# Project Agent Rules\n");
  await writeText(path.join(workspace, "DESIGN.md"), "# Product Design Contract\n");
  await writeText(
    path.join(workspace, ".agents", "skills", "release-review", "SKILL.md"),
    "---\nname: release-review\ndescription: Review release readiness.\n---\n",
  );
  await writeJson(path.join(qoderHome, "shared_client", "mcp.json"), {
    mcpServers: {
      legacy: { command: "npx", args: ["legacy-mcp"] },
    },
  });
  await writeJson(path.join(sharedClientCacheRoot, "mcp.json"), {
    mcpServers: {
      chrome: { command: "npx", args: ["chrome-devtools-mcp"] },
      postgres: { command: "npx", args: ["postgres-mcp"] },
    },
  });
  await writeJson(path.join(sharedClientCacheRoot, "extension", "local", "mcp.json"), {
    mcpServers: {
      chrome: { command: "npx", args: ["chrome-devtools-mcp"] },
    },
  });
  await writeJson(path.join(sharedClientCacheRoot, "mcps", "chrome", "SERVER_METADATA.json"), {
    name: "chrome",
    source: "user",
    toolCount: 29,
  });
  await writeJson(path.join(sharedClientCacheRoot, "mcps", "chrome", "tools", "open-page.json"), {
    name: "open_page",
  });
  await writeJson(path.join(workspace, ".qoder", "mcp.json"), {
    mcpServers: {
      schedule: { command: "npx", args: ["schedule-mcp"] },
    },
  });
  await writeJson(
    path.join(
      sharedClientCacheRoot,
      "projects",
      qoderWorkspaceSlug(workspace),
      "mcps",
      "schedule",
      "SERVER_METADATA.json",
    ),
    {
      name: "schedule",
      source: "user",
      toolCount: 1,
    },
  );
  await writeJson(
    path.join(
      sharedClientCacheRoot,
      "projects",
      qoderWorkspaceSlug(workspace),
      "mcps",
      "schedule",
      "tools",
      "list-events.json",
    ),
    { name: "list_events" },
  );

  return { root, qoderHome, sharedClientCacheRoot, workspace };
}

async function makeCodexFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-customize-codex-"));
  const codexHome = path.join(root, ".codex");
  const codexAppPath = path.join(root, "Applications", "Codex.app");
  const workspace = path.join(root, "workspace", "better-harness");

  const dataPluginName = "data-analytics";
  const dataPluginParent = path.join(codexHome, "plugins", "cache", "openai-curated-remote", dataPluginName);
  const dataPluginRoot = path.join(dataPluginParent, "0.1.0");
  await writeJson(path.join(dataPluginParent, ".codex-remote-plugin-install.json"), {
    schema_version: 1,
    remote_plugin_id: "plugin_data_123",
  });
  await writeJson(path.join(dataPluginRoot, ".codex-plugin", "plugin.json"), {
    name: dataPluginName,
    version: "0.1.0",
    description: "Analyze data.",
    author: { name: "OpenAI" },
    interface: {
      displayName: "Data Analytics",
      shortDescription: "Analyze data with Codex.",
      developerName: "OpenAI",
    },
    skills: "./skills/",
    commands: {
      "build-report": {
        source: "./commands/build-report.md",
        description: "Build a report.",
      },
    },
    mcpServers: "./.mcp.json",
  });
  await writeText(
    path.join(dataPluginRoot, "skills", "build-dashboard", "SKILL.md"),
    "---\nname: build-dashboard\ndescription: Build dashboards.\n---\n",
  );
  await writeText(path.join(dataPluginRoot, "commands", "build-report.md"), "# Build Report\n");
  await writeJson(path.join(dataPluginRoot, ".mcp.json"), {
    mcpServers: {
      dataAnalytics: { command: "node", args: ["mcp/server.cjs"] },
    },
  });
  await writeJson(path.join(dataPluginRoot, "hooks.json"), {
    hooks: {
      PostToolUse: [
        {
          matcher: "Write",
          hooks: [{ type: "command", command: "node hooks/audit-data.mjs" }],
        },
      ],
    },
  });

  const browserPluginRoot = path.join(
    codexHome,
    "plugins",
    "cache",
    "openai-bundled",
    "browser",
    "26.1.0",
  );
  await writeJson(path.join(browserPluginRoot, ".codex-plugin", "plugin.json"), {
    name: "browser",
    version: "26.1.0",
    description: "Control the in-app browser.",
    author: { name: "OpenAI" },
    interface: {
      displayName: "Browser",
      shortDescription: "Control Browser.",
    },
    skills: "./skills/",
  });
  await writeText(
    path.join(browserPluginRoot, "skills", "control-in-app-browser", "SKILL.md"),
    "---\nname: control-in-app-browser\ndescription: Control browser.\n---\n",
  );

  const cacheOnlyRoot = path.join(
    codexHome,
    "plugins",
    "cache",
    "openai-curated-remote",
    "apollo",
    "1.0.0",
  );
  await writeJson(path.join(cacheOnlyRoot, ".codex-plugin", "plugin.json"), {
    name: "apollo",
    interface: { displayName: "Apollo" },
  });

  const staleCuratedRoot = path.join(
    codexHome,
    "plugins",
    "cache",
    "openai-curated",
    dataPluginName,
    "3c06cb2e",
  );
  await writeJson(path.join(staleCuratedRoot, ".codex-plugin", "plugin.json"), {
    name: dataPluginName,
    version: "3c06cb2e",
    interface: { displayName: "Data Analytics" },
  });

  await writeText(
    path.join(codexHome, "skills", "local-review", "SKILL.md"),
    "---\nname: local-review\ndescription: Review locally.\n---\n",
  );
  await writeJson(path.join(codexHome, "mcp.json"), {
    mcpServers: {
      localMcp: { command: "node", args: ["server.mjs"] },
    },
  });
  await writeJson(path.join(codexHome, "hooks.json"), {
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [{ type: "command", command: "~/.codex/hooks/guard-prompt.sh" }],
        },
      ],
    },
  });

  await writeText(
    path.join(workspace, ".codex", "skills", "codex-workflow", "SKILL.md"),
    "---\nname: codex-workflow\ndescription: Codex workflow.\n---\n",
  );
  await writeText(
    path.join(workspace, ".agents", "skills", "agent-workflow", "SKILL.md"),
    "---\nname: agent-workflow\ndescription: Agent workflow.\n---\n",
  );
  await writeText(path.join(workspace, ".codex", "rules", "always.md"), "# Always Codex\n");
  await writeText(path.join(workspace, "AGENTS.md"), "# Project Agent Rules\n");
  await writeText(path.join(workspace, "DESIGN.md"), "# Product Design Contract\n");
  await writeJson(path.join(workspace, ".codex", "hooks.json"), {
    hooks: {
      Stop: [
        {
          hooks: [{ type: "command", command: "node hooks/check-stop.mjs" }],
        },
      ],
    },
  });
  await writeText(
    path.join(workspace, ".git", "config"),
    "[remote \"origin\"]\n\turl = https://github.com/example/better-harness.git\n",
  );
  await mkdir(codexAppPath, { recursive: true });

  return { root, codexHome, codexAppPath, workspace };
}

async function makeClaudeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-customize-claude-"));
  const claudeHome = path.join(root, ".claude");
  const claudeStatePath = path.join(root, ".claude.json");
  const workspace = path.join(root, "workspace", "better-harness");
  const enabledPluginId = "delivery@fixture-marketplace";
  const disabledPluginId = "disabled@fixture-marketplace";
  const enabledPluginRoot = path.join(claudeHome, "plugins", "cache", "fixture-marketplace", "delivery", "1.0.0");
  const disabledPluginRoot = path.join(claudeHome, "plugins", "cache", "fixture-marketplace", "disabled", "1.0.0");

  await writeText(
    path.join(claudeHome, "skills", "user-review", "SKILL.md"),
    "---\nname: user-review\ndescription: Review a user-scoped change.\n---\n",
  );
  await writeText(path.join(claudeHome, "agents", "user-reviewer.md"), "---\nname: user-reviewer\ndescription: Review code.\ntools: Read\n---\n");
  await writeText(path.join(claudeHome, "commands", "user-check.md"), "# User Check\n");
  await writeText(path.join(claudeHome, "CLAUDE.md"), "# Claude User Instructions\n");
  await writeText(path.join(claudeHome, "rules", "user-rule.md"), "# User Rule\n");
  await writeJson(path.join(claudeHome, "settings.json"), {
    enabledPlugins: {
      [disabledPluginId]: false,
    },
    hooks: {
      PreToolUse: [{
        matcher: "Write",
        hooks: [{
          type: "command",
          command: "bash \"$CLAUDE_PROJECT_DIR/hooks/user-audit.sh\" --token fixture-hook-secret",
          timeout: 3,
          async: true,
        }],
      }],
    },
  });

  await writeText(
    path.join(workspace, ".claude", "skills", "project-review", "SKILL.md"),
    "---\nname: project-review\ndescription: Review the selected project.\n---\n",
  );
  await writeText(path.join(workspace, ".claude", "agents", "project-reviewer.md"), "---\nname: project-reviewer\ndescription: Review this project.\ntools: Read\n---\n");
  await writeText(path.join(workspace, ".claude", "commands", "project-check.md"), "# Project Check\n");
  await writeText(path.join(workspace, "CLAUDE.md"), "# Claude Project Instructions\n");
  await writeText(path.join(workspace, ".claude", "CLAUDE.md"), "# Alternate Claude Project Instructions\n");
  await writeText(path.join(workspace, "CLAUDE.local.md"), "# Claude Local Instructions\n");
  await writeText(path.join(workspace, ".claude", "rules", "security.md"), "# Security Rule\n");
  await writeText(path.join(workspace, "AGENTS.md"), "# Not A Native Claude Instruction\n");
  await writeText(path.join(workspace, "hooks", "user-audit.sh"), "#!/bin/sh\nexit 0\n");
  await writeJson(path.join(workspace, ".claude", "settings.json"), {
    enabledPlugins: { [enabledPluginId]: true },
    hooks: {
      SessionStart: [{ hooks: [{ type: "prompt", prompt: "fixture-prompt-secret", timeout: 2 }] }],
    },
  });
  await writeJson(path.join(workspace, ".claude", "settings.local.json"), {
    hooks: {
      Stop: [{ hooks: [{ type: "agent", prompt: "fixture-agent-secret", timeout: 5 }] }],
    },
  });
  await writeJson(path.join(workspace, ".mcp.json"), {
    mcpServers: {
      projectRemote: {
        type: "http",
        url: "https://project-user:project-password@example.invalid/project?token=fixture-project-secret",
        env: { PROJECT_API_TOKEN: "fixture-project-secret" },
      },
    },
  });

  await writeJson(path.join(enabledPluginRoot, ".claude-plugin", "plugin.json"), {
    name: "delivery",
    displayName: "Delivery",
    version: "1.0.0",
    description: "Delivery workflow plugin.",
    skills: ["./extra-skills"],
    commands: ["./custom/commands"],
    agents: "./custom/agents",
    hooks: {
      PostToolUse: [{
        matcher: "Write",
        hooks: [{ type: "command", command: "node $CLAUDE_PLUGIN_ROOT/hooks/plugin-audit.mjs", timeout: 4 }],
      }],
    },
    mcpServers: {
      pluginRemote: { type: "http", url: "https://example.invalid/plugin?token=fixture-plugin-secret" },
    },
  });
  await writeText(
    path.join(enabledPluginRoot, "skills", "default-delivery", "SKILL.md"),
    "---\nname: default-delivery\ndescription: Run the default delivery workflow.\n---\n",
  );
  await writeText(
    path.join(enabledPluginRoot, "extra-skills", "release-delivery", "SKILL.md"),
    "---\nname: release-delivery\ndescription: Run a release delivery workflow.\n---\n",
  );
  await writeText(path.join(enabledPluginRoot, "commands", "ignored-default.md"), "# Ignored Default\n");
  await writeText(path.join(enabledPluginRoot, "custom", "commands", "ship.md"), "# Ship\n");
  await writeText(path.join(enabledPluginRoot, "custom", "agents", "release-reviewer.md"), "---\nname: release-reviewer\ndescription: Review a release.\ntools: Read\n---\n");
  await writeText(path.join(enabledPluginRoot, "hooks", "plugin-audit.mjs"), "process.exit(0);\n");

  await writeJson(path.join(disabledPluginRoot, ".claude-plugin", "plugin.json"), {
    name: "disabled",
    displayName: "Disabled Plugin",
  });
  await writeText(
    path.join(disabledPluginRoot, "skills", "disabled-skill", "SKILL.md"),
    "---\nname: disabled-skill\ndescription: This disabled Skill must not enter public surfaces.\n---\n",
  );

  await writeJson(path.join(claudeHome, "plugins", "installed_plugins.json"), {
    version: 2,
    plugins: {
      [enabledPluginId]: [{
        scope: "project",
        projectPath: workspace,
        installPath: enabledPluginRoot,
        version: "1.0.0",
      }],
      [disabledPluginId]: [{
        scope: "user",
        installPath: disabledPluginRoot,
        version: "1.0.0",
      }],
    },
  });
  await writeJson(claudeStatePath, {
    oauthAccount: { accessToken: "fixture-oauth-secret" },
    mcpServers: {
      userNode: {
        command: "node",
        args: ["server.mjs", "--token", "fixture-user-mcp-secret"],
        env: { API_TOKEN: "fixture-user-mcp-secret" },
      },
    },
    projects: {
      [workspace]: {
        mcpServers: {
          localDocs: { type: "http", url: "https://example.invalid/local?key=fixture-local-secret" },
        },
      },
      [path.join(root, "other-workspace")]: {
        mcpServers: { unrelated: { command: "fixture-unrelated-secret" } },
      },
    },
  });

  return { root, claudeHome, claudeStatePath, workspace, enabledPluginId, disabledPluginId };
}

test("collectAgentCustomizeInventory returns Cursor-style manage tabs and scoped sources", async () => {
  const fixture = await makeCursorFixture();

  try {
    const inventory = await collectAgentCustomizeInventory({
      cursorHome: fixture.cursorHome,
      workspace: fixture.workspace,
      installedPluginRecords: [
        { id: "hex-id", sources: ["user"] },
        { id: "paper-id", sources: ["user"] },
      ],
    });

    assert.deepEqual(
      inventory.tabs.map((tab) => tab.id),
      ["plugins", "mcps", "skills", "agents", "rules", "commands", "hooks"],
    );

    assert.deepEqual(
      inventory.plugins.map((plugin) => plugin.displayName),
      ["Hex", "Paper"],
    );
    assert.deepEqual(
      inventory.plugins.map((plugin) => plugin.cursorPluginId),
      ["hex-id", "paper-id"],
    );
    const hex = inventory.plugins.find((plugin) => plugin.name === "hex");
    const paper = inventory.plugins.find((plugin) => plugin.name === "paper-desktop");
    assert.ok(hex);
    assert.ok(paper);
    assert.equal(hex.evidence.path, path.join(hex.rootPath, ".cursor-plugin", "plugin.json"));
    assert.equal(paper.evidence.path, path.join(paper.rootPath, "manifest.json"));
    assert.equal(inventory.plugins[0].skills[0].name, "hex-to-canvas");
    assert.equal(inventory.plugins[0].mcpServers[0].name, "hex");
    assert.equal(inventory.plugins[0].hooks[0].label, "Hex audit");

    assert.deepEqual(
      inventory.manage.mcps.map((server) => `${server.scope}:${server.name}`).sort(),
      ["plugin:hex", "project:workspaceDocs", "user:userLinear"],
    );
    assert.equal(
      inventory.manage.skills.some(
        (skill) => skill.scope === "user" && skill.name === "sessions-diagnostics",
      ),
      true,
    );
    assert.equal(
      inventory.manage.skills.some(
        (skill) =>
          skill.scope === "project" && skill.name === "codex-bug" && skill.sourceLabel === "openai/codex",
      ),
      true,
    );
    assert.equal(
      inventory.manage.rules.some((rule) => rule.scope === "plugin" && rule.name === "ensure-hex"),
      true,
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "rules", scopeKind: "project" }).map(
        (item) => `${item.name}:${item.sourceKind ?? "native"}`,
      ),
      ["always:native", "AGENTS.md:agents-md-compat", "DESIGN.md:design-md-contract"],
    );

    await rm(path.join(fixture.workspace, "DESIGN.md"));
    await writeText(path.join(fixture.workspace, "design.md"), "# Architecture Design\n");
    const lowercaseInventory = await collectAgentCustomizeInventory({
      cursorHome: fixture.cursorHome,
      workspace: fixture.workspace,
      installedPluginRecords: [
        { id: "hex-id", sources: ["user"] },
        { id: "paper-id", sources: ["user"] },
      ],
    });
    assert.equal(
      filterManageItems(lowercaseInventory, { tab: "rules", scopeKind: "project" })
        .some((item) => item.sourceKind === "design-md-contract"),
      false,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("filterManageItems follows Cursor manage tab search rules", async () => {
  const fixture = await makeCursorFixture();

  try {
    const inventory = await collectAgentCustomizeInventory({
      cursorHome: fixture.cursorHome,
      workspace: fixture.workspace,
      installedPluginRecords: [
        { id: "hex-id", sources: ["user"] },
        { id: "paper-id", sources: ["user"] },
      ],
    });

    assert.deepEqual(
      filterManageItems(inventory, { tab: "plugins", query: "pap" }).map(
        (item) => item.displayName,
      ),
      ["Paper"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "mcps", query: "docs" }).map((item) => item.name),
      ["workspaceDocs"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "hooks", query: "prompt" }).map((item) => item.label),
      ["Guard prompt"],
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("filterManageItems scopes plugin installs like Cursor Manage scope", async () => {
  const fixture = await makeCursorFixture();

  try {
    const inventory = await collectAgentCustomizeInventory({
      cursorHome: fixture.cursorHome,
      workspace: fixture.workspace,
      installedPluginRecords: [
        { id: "hex-id", sources: ["user"] },
        { id: "paper-id", sources: ["user"] },
        { id: "meta-id", sources: ["project"] },
      ],
    });

    assert.deepEqual(
      filterManageItems(inventory, { tab: "plugins", scopeKind: "user" }).map(
        (item) => item.displayName,
      ),
      ["Hex", "Paper"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "plugins", scopeKind: "project" }).map(
        (item) => item.displayName,
      ),
      ["meta-quest/agentic-tools"],
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("direct plugin ids preserve Cursor install order", async () => {
  const fixture = await makeCursorFixture();

  try {
    const inventory = await collectAgentCustomizeInventory({
      cursorHome: fixture.cursorHome,
      workspace: fixture.workspace,
      installedPluginRecords: [
        { id: "paper-id", sources: ["user"] },
        { id: "hex-id", sources: ["user"] },
        { id: "meta-id", sources: ["project"] },
      ],
    });

    assert.deepEqual(
      inventory.plugins.map((plugin) => plugin.displayName),
      ["Paper", "Hex", "meta-quest/agentic-tools"],
    );
    assert.deepEqual(
      inventory.plugins.map((plugin) => plugin.installMatch),
      ["id", "id", "id"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "plugins", scopeKind: "project" }).map(
        (item) => item.displayName,
      ),
      ["meta-quest/agentic-tools"],
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("project MCP tool snapshots map numeric plugin ids when local evidence exists", async () => {
  const fixture = await makeCursorFixture();

  try {
    const projectMcpRoot = path.join(
      fixture.cursorHome,
      "projects",
      workspaceProjectSlug(fixture.workspace),
      "mcps",
      "plugin-meta-quest-agentic-tools-hzdb",
    );
    await writeJson(path.join(projectMcpRoot, "tools", "search.json"), {
      name: "search",
      pluginId: "1293",
    });

    const inventory = await collectAgentCustomizeInventory({
      cursorHome: fixture.cursorHome,
      workspace: fixture.workspace,
      installedPluginRecords: [{ id: "1293", sources: ["project"] }],
    });

    assert.deepEqual(
      inventory.plugins.map((plugin) => plugin.displayName),
      ["meta-quest/agentic-tools"],
    );
    assert.deepEqual(
      inventory.plugins.map((plugin) => plugin.installMatch),
      ["project-mcp"],
    );
    assert.deepEqual(inventory.diagnostics.unmatchedInstalledPluginIds, []);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("unproven numeric plugin ids use cache fallback with diagnostics", async () => {
  const fixture = await makeCursorFixture();

  try {
    const futureRoot = path.join(
      fixture.cursorHome,
      "plugins",
      "cache",
      "cursor-public",
      "future-tool",
      "jkl012",
    );
    await writeJson(path.join(futureRoot, ".cursor-plugin", "plugin.json"), {
      name: "future-tool",
      description: "Future tool plugin",
    });

    const inventory = await collectAgentCustomizeInventory({
      cursorHome: fixture.cursorHome,
      workspace: fixture.workspace,
      installedPluginRecords: [{ id: "9001", sources: ["user"] }],
    });

    assert.deepEqual(
      inventory.plugins.map((plugin) => plugin.displayName),
      ["Future Tool"],
    );
    assert.deepEqual(
      inventory.plugins.map((plugin) => plugin.installMatch),
      ["cache-fallback"],
    );
    assert.equal(inventory.plugins[0].cursorPluginId, undefined);
    assert.equal(inventory.plugins[0].installedPluginRecordId, undefined);
    assert.equal(inventory.plugins[0].installOrder, undefined);
    assert.equal(inventory.diagnostics.installedPluginFallbackCount, 1);
    assert.deepEqual(inventory.diagnostics.unmatchedInstalledPluginIds, ["9001"]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("project skills include .codex skills and group by workspace source", async () => {
  const fixture = await makeCursorFixture();

  try {
    const inventory = await collectAgentCustomizeInventory({
      cursorHome: fixture.cursorHome,
      workspace: fixture.workspace,
      installedPluginRecords: [],
    });
    const items = filterManageItems(inventory, { tab: "skills", scopeKind: "project" });
    const groups = groupManageItems(items, { tab: "skills" });

    assert.deepEqual(
      items.map((item) => item.name),
      ["codex-bug"],
    );
    assert.deepEqual(
      groups.map((group) => `${group.title}:${group.items.length}`),
      ["openai/codex:1"],
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("runtime plugin MCP snapshots appear in user-scope MCPs", async () => {
  const fixture = await makeCursorFixture();

  try {
    const runtimeRoot = path.join(fixture.cursorHome, "projects", "Users-example-codex", "mcps");
    const hzdbRoot = path.join(runtimeRoot, "plugin-meta-quest-agentic-tools-hzdb");
    await writeJson(path.join(hzdbRoot, "SERVER_METADATA.json"), {
      serverIdentifier: "plugin-meta-quest-agentic-tools-hzdb",
      serverName: "hzdb",
    });
    await writeJson(path.join(hzdbRoot, "tools", "take_screenshot.json"), { name: "take_screenshot" });
    const atlassianRoot = path.join(runtimeRoot, "plugin-atlassian-atlassian");
    await writeJson(path.join(atlassianRoot, "SERVER_METADATA.json"), {
      serverIdentifier: "plugin-atlassian-atlassian",
      serverName: "atlassian",
    });
    await writeText(
      path.join(atlassianRoot, "STATUS.md"),
      "The MCP server needs authentication.",
    );

    const inventory = await collectAgentCustomizeInventory({
      cursorHome: fixture.cursorHome,
      workspace: fixture.workspace,
      installedPluginRecords: [],
    });
    const items = filterManageItems(inventory, { tab: "mcps", scopeKind: "user" });
    const groups = groupManageItems(items, { tab: "mcps" });

    assert.deepEqual(
      items.map((item) => item.name),
      ["atlassian", "hzdb", "userLinear"],
    );
    assert.deepEqual(
      groups.map((group) => `${group.title}:${group.items.map((item) => item.name).join(",")}`),
      ["Needs Attention:atlassian", "Connected:hzdb", "Installed:userLinear"],
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("collectAgentCustomizeInventory returns Qoder installed plugins and scoped sources", async () => {
  const fixture = await makeQoderFixture();

  try {
    const inventory = await collectAgentCustomizeInventory({
      provider: "qoder",
      qoderHome: fixture.qoderHome,
      qoderSharedClientCacheRoot: fixture.sharedClientCacheRoot,
      workspace: fixture.workspace,
    });

    assert.equal(inventory.provider, "qoder");
    assert.equal(inventory.qoderHome, fixture.qoderHome);
    assert.equal(inventory.sharedClientCacheRoot, fixture.sharedClientCacheRoot);
    assert.deepEqual(
      inventory.plugins.map((plugin) => plugin.displayName),
      ["Better Harness", "Design"],
    );
    assert.equal(
      inventory.plugins.some((plugin) => plugin.displayName === "Apollo"),
      false,
    );

    const betterHarness = inventory.plugins.find((plugin) => plugin.name === "better-harness-plugin");
    assert.ok(betterHarness);
    assert.deepEqual(betterHarness.installSources, ["user", "project"]);
    assert.equal(betterHarness.installMatch, "qoder-installed-index");
    assert.equal(betterHarness.installedAt, "2026-06-23T07:15:07.153Z");
    assert.equal(betterHarness.enabled, true);
    assert.equal(betterHarness.skills[0].name, "better-harness");
    assert.equal(betterHarness.commands[0].name, "better-harness-check");
    assert.equal(betterHarness.mcpServers[0].name, "better-harness");
    assert.equal(betterHarness.hooks[0].command, "node hooks/better-harness.mjs");
    assert.equal(
      betterHarness.evidence.path,
      path.join(betterHarness.rootPath, ".qoder-plugin", "plugin.json"),
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "rules", scopeKind: "project" }).map(
        (item) => `${item.name}:${item.sourceKind}`,
      ),
      ["always:qoder-rules", "AGENTS.md:agents-md-compat", "DESIGN.md:design-md-contract"],
    );
    assert.equal(
      filterManageItems(inventory, { tab: "rules", scopeKind: "project" })
        .find((item) => item.name === "AGENTS.md")
        ?.precedence,
      "after-qoder-rules",
    );
    assert.equal(
      filterManageItems(inventory, { tab: "rules", scopeKind: "project" })
        .find((item) => item.name === "DESIGN.md")
        ?.precedence,
      "after-agents-md",
    );

    assert.deepEqual(
      filterManageItems(inventory, { tab: "plugins", scopeKind: "user" }).map(
        (item) => item.displayName,
      ),
      ["Better Harness", "Design"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "plugins", scopeKind: "project" }).map(
        (item) => item.displayName,
      ),
      ["Better Harness"],
    );
    assert.deepEqual(inventory.diagnostics.installedPluginRecordCount, 2);
    assert.equal(inventory.diagnostics.enabledInstalledPluginCount, 2);
    assert.equal(inventory.diagnostics.disabledInstalledPluginCount, 0);
    assert.equal(inventory.diagnostics.unspecifiedInstalledPluginCount, 0);
    assert.equal(inventory.diagnostics.configuredPluginStateCount, 3);
    assert.equal(inventory.diagnostics.unmatchedEnabledPluginSettingCount, 1);
    assert.deepEqual(inventory.diagnostics.installedPluginIndexFiles.map((file) => path.basename(file)), [
      "installed_plugins.json",
      "installed_plugins_v2.json",
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Qoder provider collects configured MCPs and uses runtime metadata only as enrichment", async () => {
  const fixture = await makeQoderFixture();

  try {
    const inventory = await collectAgentCustomizeInventory({
      provider: "qoder",
      qoderHome: fixture.qoderHome,
      qoderSharedClientCacheRoot: fixture.sharedClientCacheRoot,
      workspace: fixture.workspace,
    });

    assert.deepEqual(
      filterManageItems(inventory, { tab: "mcps", scopeKind: "user" }).map((item) => item.name),
      ["better-harness", "chrome", "postgres"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "mcps", scopeKind: "project" }).map((item) => item.name),
      ["schedule"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "mcps", scopeKind: "project" })[0].toolNames,
      ["list_events"],
    );
    assert.deepEqual(
      groupManageItems(filterManageItems(inventory, { tab: "mcps", scopeKind: "user" }), {
        tab: "mcps",
      }).map((group) => `${group.title}:${group.items.map((item) => item.name).join(",")}`),
      ["Connected:chrome", "Installed:better-harness,postgres"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "hooks", scopeKind: "user" })
        .map((item) => item.command)
        .sort(),
      ["bash ~/.qoder/hooks/guard-tool.sh", "node hooks/better-harness.mjs"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "hooks", scopeKind: "project" }).map((item) => item.command),
      ["node hooks/check-stop.mjs"],
    );
    const projectHook = filterManageItems(inventory, { tab: "hooks", scopeKind: "project" })[0];
    assert.equal(projectHook.handlerType, "command");
    assert.equal(projectHook.commandDisplay, "node hooks/check-stop.mjs");
    assert.equal(projectHook.scriptPath, path.join(fixture.workspace, "hooks", "check-stop.mjs"));
    assert.equal(projectHook.timeoutMs, 1500);
    assert.equal(projectHook.condition, "env.REVIEW_TOKEN == <value>");
    assert.equal(projectHook.async, true);
    assert.equal(projectHook.registrationIndex, 0);
    assert.equal(projectHook.hookIndex, 0);
    assert.equal(inventory.diagnostics.runtimeOnlyProjectMcpCount, 0);
    assert.equal(inventory.manage.mcps.some((item) => item.name === "legacy"), false);
    assert.deepEqual(
      filterManageItems(inventory, { tab: "skills", scopeKind: "project" }).map((item) => item.name),
      ["release-review"],
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("collectAgentCustomizeInventory returns Codex installed plugins from install evidence", async () => {
  const fixture = await makeCodexFixture();

  try {
    const inventory = await collectAgentCustomizeInventory({
      provider: "codex",
      codexHome: fixture.codexHome,
      codexAppPath: fixture.codexAppPath,
      workspace: fixture.workspace,
    });

    assert.equal(inventory.provider, "codex");
    assert.equal(inventory.codexHome, fixture.codexHome);
    assert.equal(inventory.codexAppPath, fixture.codexAppPath);
    assert.deepEqual(
      inventory.plugins.map((plugin) => plugin.displayName),
      ["Browser", "Data Analytics"],
    );
    assert.equal(
      inventory.plugins.some((plugin) => plugin.displayName === "Apollo"),
      false,
    );

    const dataAnalytics = inventory.plugins.find((plugin) => plugin.name === "data-analytics");
    assert.ok(dataAnalytics);
    assert.equal(dataAnalytics.installMatch, "codex-remote-plugin-install");
    assert.equal(dataAnalytics.remotePluginId, "plugin_data_123");
    assert.equal(dataAnalytics.skills[0].name, "build-dashboard");
    assert.equal(dataAnalytics.commands[0].name, "build-report");
    assert.equal(dataAnalytics.mcpServers[0].name, "dataAnalytics");
    assert.equal(dataAnalytics.hooks[0].command, "node hooks/audit-data.mjs");
    assert.equal(
      dataAnalytics.evidence.path,
      path.join(dataAnalytics.rootPath, ".codex-plugin", "plugin.json"),
    );

    assert.deepEqual(
      filterManageItems(inventory, { tab: "plugins", scopeKind: "user" }).map(
        (item) => item.displayName,
      ),
      ["Browser", "Data Analytics"],
    );
    assert.equal(inventory.diagnostics.installedPluginState, "codex-plugin-cache");
    assert.equal(inventory.diagnostics.remotePluginInstallMarkersRequired, true);
    assert.equal(inventory.diagnostics.appBundleExists, true);
    assert.deepEqual(inventory.diagnostics.installedPluginRecordFiles.map((file) => path.basename(file)), [
      ".codex-remote-plugin-install.json",
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Codex provider collects user and project MCPs, skills, and hooks", async () => {
  const fixture = await makeCodexFixture();

  try {
    const inventory = await collectAgentCustomizeInventory({
      provider: "codex",
      codexHome: fixture.codexHome,
      codexAppPath: fixture.codexAppPath,
      workspace: fixture.workspace,
    });

    assert.deepEqual(
      filterManageItems(inventory, { tab: "mcps", scopeKind: "user" }).map((item) => item.name),
      ["dataAnalytics", "localMcp"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "skills", scopeKind: "project" }).map((item) => item.name),
      ["agent-workflow", "codex-workflow"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "hooks", scopeKind: "user" })
        .map((item) => item.command)
        .sort(),
      ["node hooks/audit-data.mjs", "~/.codex/hooks/guard-prompt.sh"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "hooks", scopeKind: "project" }).map((item) => item.command),
      ["node hooks/check-stop.mjs"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "rules", scopeKind: "project" }).map(
        (item) => `${item.name}:${item.sourceKind ?? "native"}`,
      ),
      ["always:native", "AGENTS.md:agents-md-compat", "DESIGN.md:design-md-contract"],
    );
    assert.deepEqual(
      groupManageItems(filterManageItems(inventory, { tab: "mcps", scopeKind: "user" }), {
        tab: "mcps",
      }).map((group) => `${group.title}:${group.items.map((item) => item.name).join(",")}`),
      ["Installed:dataAnalytics,localMcp"],
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Claude provider collects native scoped assets from settings, state, and installed Plugin evidence", async () => {
  const fixture = await makeClaudeFixture();

  try {
    const inventory = await collectAgentCustomizeInventory({
      provider: "claude",
      claudeHome: fixture.claudeHome,
      claudeStatePath: fixture.claudeStatePath,
      workspace: fixture.workspace,
      includeUserHome: true,
    });

    assert.equal(inventory.provider, "claude");
    assert.equal(inventory.claudeHome, fixture.claudeHome);
    assert.equal(inventory.claudeStatePath, fixture.claudeStatePath);
    assert.deepEqual(inventory.plugins.map((plugin) => `${plugin.claudePluginId}:${plugin.enabled}`), [
      `${fixture.enabledPluginId}:true`,
      `${fixture.disabledPluginId}:false`,
    ]);
    const delivery = inventory.plugins.find((plugin) => plugin.claudePluginId === fixture.enabledPluginId);
    assert.ok(delivery);
    assert.equal(delivery.installSource, "project");
    assert.equal(delivery.enabledSettingScope, "project");
    assert.deepEqual(delivery.skills.map((skill) => skill.name), ["default-delivery", "release-delivery"]);
    assert.deepEqual(delivery.commands.map((command) => command.name), ["ship"]);
    assert.deepEqual(delivery.subagents.map((agent) => agent.name), ["release-reviewer"]);
    assert.deepEqual(delivery.rules, []);
    assert.equal(delivery.hooks[0].handlerType, "command");
    assert.equal(delivery.hooks[0].command, undefined);
    assert.equal(delivery.hooks[0].commandDisplay, "node plugin-audit.mjs");
    assert.equal(delivery.hooks[0].timeoutMs, 4000);
    assert.equal(delivery.mcpServers[0].url, "https://example.invalid/plugin");

    assert.deepEqual(
      inventory.manage.skills.filter((item) => item.scope === "user").map((item) => item.name),
      ["user-review"],
    );
    assert.deepEqual(
      inventory.manage.skills.filter((item) => item.scope === "project").map((item) => item.name),
      ["project-review"],
    );
    assert.deepEqual(
      inventory.manage.rules.filter((item) => item.scope === "project").map((item) => item.name),
      [".claude/CLAUDE.md", "CLAUDE.local.md", "CLAUDE.md", "security"],
    );
    assert.equal(inventory.manage.rules.some((item) => item.name === "AGENTS.md"), false);

    const userHook = inventory.manage.hooks.find((hook) => hook.scope === "user");
    assert.ok(userHook);
    assert.equal(userHook.command, undefined);
    assert.equal(userHook.commandDisplay, "bash user-audit.sh");
    assert.equal(userHook.timeoutMs, 3000);
    assert.equal(userHook.async, true);
    assert.equal(userHook.scriptPath, path.join(fixture.workspace, "hooks", "user-audit.sh"));
    assert.deepEqual(
      inventory.manage.hooks.filter((hook) => hook.scope === "project").map((hook) => `${hook.step}:${hook.handlerType}:${hook.timeoutMs}`),
      ["SessionStart:prompt:2000", "Stop:agent:5000"],
    );

    assert.deepEqual(
      inventory.manage.mcps.map((server) => `${server.scope}:${server.name}`).sort(),
      ["plugin:pluginRemote", "project:localDocs", "project:projectRemote", "user:userNode"],
    );
    const userMcp = inventory.manage.mcps.find((server) => server.name === "userNode");
    assert.deepEqual(userMcp.args, ["server.mjs", "<redacted>", "<redacted>"]);
    assert.deepEqual(userMcp.directSecretEnvKeys, ["API_TOKEN"]);
    const projectMcp = inventory.manage.mcps.find((server) => server.name === "projectRemote");
    assert.equal(projectMcp.url, "https://example.invalid/project");
    assert.deepEqual(projectMcp.directSecretEnvKeys, ["PROJECT_API_TOKEN"]);
    assert.equal(inventory.manage.mcps.some((server) => server.name === "unrelated"), false);
    assert.equal(inventory.diagnostics.installedPluginState, "claude-installed-index");
    assert.equal(inventory.diagnostics.installedPluginRecordCount, 2);
    assert.equal(inventory.diagnostics.effectivePluginCount, 1);
    assert.equal(inventory.diagnostics.runtimeMcpProbeExecuted, false);

    const serialized = JSON.stringify(inventory);
    assert.doesNotMatch(serialized, /fixture-(?:hook|prompt|agent|oauth|user-mcp|project|plugin|local|unrelated)-secret/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Claude public configured-asset surfaces exclude disabled Plugin children", async () => {
  const fixture = await makeClaudeFixture();

  try {
    const inventory = await collectPracticeInventory({
      platform: "claude",
      workspace: fixture.workspace,
      claudeHome: fixture.claudeHome,
      claudeStatePath: fixture.claudeStatePath,
      includeUserHome: true,
    });
    const pluginSurface = inventory.surfaces.find((surface) => surface.type === "plugins");
    const pluginSkillSurface = inventory.surfaces.find(
      (surface) => surface.type === "skills" && surface.group === "Plugin/marketplace assets",
    );

    assert.deepEqual(pluginSurface.items.map((item) => item.name), ["Delivery"]);
    assert.deepEqual(pluginSkillSurface.items.map((item) => item.name), ["default-delivery", "release-delivery"]);
    assert.equal(JSON.stringify(inventory).includes("disabled-skill"), false);
    assert.equal(inventory.scope.claudeHome, fixture.claudeHome);
    assert.equal(inventory.scope.claudeStatePath, fixture.claudeStatePath);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("tab availability matches Cursor Customize manage scope rules", () => {
  assert.equal(tabAvailableForScope("plugins", "team"), true);
  assert.equal(tabAvailableForScope("mcps", "team"), true);
  assert.equal(tabAvailableForScope("rules", "team"), true);
  assert.equal(tabAvailableForScope("commands", "team"), true);
  assert.equal(tabAvailableForScope("skills", "team"), false);
  assert.equal(tabAvailableForScope("agents", "team"), false);
  assert.equal(tabAvailableForScope("hooks", "team"), false);
  assert.equal(tabAvailableForScope("skills", "workspace"), true);
  assert.equal(tabAvailableForScope("hooks", "user"), true);
});
